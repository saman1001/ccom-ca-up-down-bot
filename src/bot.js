import { loadConfig } from "./config.js";
import { CryptoComClient } from "./cryptoComClient.js";
import { extractBalances, extractTickerPrice, portfolioValue } from "./portfolio.js";
import { buildOrder, decide } from "./strategy.js";
import { appendSnapshot, ensureLogDir, readPreviousSnapshot } from "./storage.js";
import { addDust, loadDustBank, saveDustBank, subtractDust } from "./dustBank.js";
import { loadInstrumentRules } from "./instrumentRules.js";
import { generateReport } from "./report.js";
import {
  applyDryRunBatchPlan,
  applyFilledBatchAction,
  buildBatchPlan,
  loadBatches,
  saveBatches
} from "./batchStrategy.js";

async function runOnce() {
  const config = loadConfig();
  const configProblems = validateConfig(config);
  if (configProblems.length) {
    throw new Error(`Invalid bot configuration: ${configProblems.join("; ")}`);
  }
  ensureLogDir(config.logDir);

  const client = new CryptoComClient(config);
  const previous = readPreviousSnapshot(config.logDir);

  const ticker = await client.publicGet("public/get-tickers", {
    instrument_name: config.instrument
  });
  const price = extractTickerPrice(ticker, config.instrument);

  const balanceResponse = await client.privatePost("private/user-balance", {});
  const balances = extractBalances(balanceResponse);
  const portfolio = portfolioValue({
    balances,
    baseAsset: config.baseAsset,
    quoteAsset: config.quoteAsset,
    price
  });

  assertMarketDataSafe({ price, portfolio, previous, config });

  const snapshot = {
    at: new Date().toISOString(),
    instrument: config.instrument,
    price,
    portfolio
  };

  if (config.strategy === "batches") {
    const result = await runBatchStrategy({ client, config, snapshot });
    appendSnapshot(config.logDir, result);
    generateReportSafely(config);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const signal = decide({ current: snapshot, previous, config });
  const order = applyOrderSafetyGuard({
    order: buildOrder({ signal, snapshot, config }),
    portfolio: snapshot.portfolio,
    price: snapshot.price,
    config
  });

  const result = {
    ...snapshot,
    signal,
    order,
    dryRun: config.dryRun,
    tradingEnabled: config.enableTrading
  };

  if (order && !config.dryRun && config.enableTrading) {
    result.orderResult = await client.privatePost("private/create-order", order);
  }

  appendSnapshot(config.logDir, result);
  generateReportSafely(config);
  console.log(JSON.stringify(result, null, 2));
}

async function runBatchStrategy({ client, config, snapshot }) {
  const batches = loadBatches(config.logDir);
  const dustBank = loadDustBank(config.logDir);
  const instrumentRules = await loadInstrumentRules(client, config.instrument);
  const plan = buildBatchPlan({
    batches,
    dustBank,
    instrumentRules,
    price: snapshot.price,
    config,
    now: snapshot.at
  });
  const guardedPlan = applyPlanSafetyGuards({
    plan,
    portfolio: snapshot.portfolio,
    price: snapshot.price,
    config
  });

  const result = {
    ...snapshot,
    strategy: "batches",
    instrumentRules,
    openBatchesBefore: batches.filter((batch) => batch.status === "OPEN").length,
    dustBankBefore: dustBank.quantity || 0,
    plan: guardedPlan,
    dryRun: config.dryRun,
    tradingEnabled: config.enableTrading
  };

  if (config.dryRun || !config.enableTrading) {
    result.simulatedBatches = applyDryRunBatchPlan({
      batches,
      plan: guardedPlan,
      price: snapshot.price,
      now: snapshot.at
    });
    return result;
  }

  const updatedBatches = JSON.parse(JSON.stringify(batches));
  const updatedDustBank = JSON.parse(JSON.stringify(dustBank));
  result.orderResults = [];
  let previousPortfolio = snapshot.portfolio;

  for (const action of guardedPlan.actions) {
    if (!action.order) {
      result.orderResults.push({
        action,
        skipped: true
      });
      continue;
    }

    const orderResult = await client.privatePost("private/create-order", action.order);
    await sleep(1500);
    const balanceAfterOrder = await client.privatePost("private/user-balance", {});
    const balancesAfterOrder = extractBalances(balanceAfterOrder);
    const nextPortfolio = portfolioValue({
      balances: balancesAfterOrder,
      baseAsset: config.baseAsset,
      quoteAsset: config.quoteAsset,
      price: snapshot.price
    });
    const fill = inferFillFromPortfolioDelta({
      action,
      before: previousPortfolio,
      after: nextPortfolio,
      fallbackPrice: snapshot.price
    });

    result.orderResults.push({
      action,
      orderResult,
      fill,
      portfolioAfterOrder: nextPortfolio
    });

    applyFilledBatchAction({
      batches: updatedBatches,
      action,
      fillPrice: fill.price,
      filledQuantity: fill.quantity,
      now: snapshot.at
    });

    if (action.kind === "TAKE_PROFIT" && action.dustQuantity > 0) {
      addDust(updatedDustBank, {
        asset: config.baseAsset,
        quantity: action.dustQuantity,
        price: fill.price,
        sourceBatchId: action.batchId,
        reason: "TAKE_PROFIT_ROUNDING",
        at: snapshot.at
      });
    }

    if (action.kind === "DUST_SELL") {
      subtractDust(updatedDustBank, {
        quantity: fill.quantity,
        price: fill.price,
        orderId: orderResult.result?.order_id,
        at: snapshot.at
      });
    }

    previousPortfolio = nextPortfolio;
  }

  saveBatches(config.logDir, updatedBatches);
  saveDustBank(config.logDir, updatedDustBank);
  result.openBatchesAfter = updatedBatches.filter((batch) => batch.status === "OPEN").length;
  result.dustBankAfter = updatedDustBank.quantity || 0;
  return result;
}

function validateConfig(config) {
  const problems = [];
  const positive = [
    ["CHECK_INTERVAL_MINUTES", config.checkIntervalMinutes],
    ["BATCH_QUANTITY", config.batchQuantity],
    ["MAX_BATCH_QUANTITY", config.maxBatchQuantity],
    ["AVERAGE_DOWN_DROP_PCT", config.averageDownDropPct],
    ["TAKE_PROFIT_RISE_PCT", config.takeProfitRisePct]
  ];

  if (!["production", "uat"].includes(process.env.CCOM_ENV || "production")) {
    problems.push("CCOM_ENV must be production or uat");
  }
  if (!["updown", "batches"].includes(config.strategy)) {
    problems.push("STRATEGY must be updown or batches");
  }
  if (!config.instrument || !config.instrument.includes("_")) problems.push("INSTRUMENT must look like BASE_QUOTE, for example CRO_USD");
  if (!config.baseAsset) problems.push("BASE_ASSET is required");
  if (!config.quoteAsset) problems.push("QUOTE_ASSET is required");
  if (config.baseAsset === config.quoteAsset) problems.push("BASE_ASSET and QUOTE_ASSET must be different");
  if (!config.dryRun && config.enableTrading && (!config.apiKey || !config.apiSecret)) {
    problems.push("CCOM_API_KEY and CCOM_API_SECRET are required for live trading");
  }

  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) problems.push(`${name} must be greater than 0`);
  }
  if (config.maxBatchQuantity < config.batchQuantity) problems.push("MAX_BATCH_QUANTITY must be at least BATCH_QUANTITY");
  if (!Number.isFinite(config.maxOpenBatches) || config.maxOpenBatches < 0) problems.push("MAX_OPEN_BATCHES must be 0 or greater");
  if (!Number.isFinite(config.dailyBaseBuyLimit) || config.dailyBaseBuyLimit < 0) problems.push("DAILY_BASE_BUY_LIMIT must be 0 or greater");
  if (!Number.isFinite(config.minQuoteBalance) || config.minQuoteBalance < 0) problems.push("MIN_QUOTE_BALANCE must be 0 or greater");
  if (!Number.isFinite(config.maxSuspiciousPriceMovePct) || config.maxSuspiciousPriceMovePct < 0) {
    problems.push("MAX_SUSPICIOUS_PRICE_MOVE_PCT must be 0 or greater");
  }
  if (!Number.isFinite(config.dustSellQuantity) || config.dustSellQuantity < 0) problems.push("DUST_SELL_QUANTITY must be 0 or greater");
  return problems;
}

function assertMarketDataSafe({ price, portfolio, previous, config }) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Suspicious market data: invalid ${config.instrument} price ${price}.`);
  }
  for (const [name, value] of Object.entries(portfolio)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Suspicious balance data: ${name} is ${value}.`);
    }
  }

  const previousPrice = Number(previous?.price || 0);
  const limit = Number(config.maxSuspiciousPriceMovePct || 0);
  if (previousPrice > 0 && limit > 0) {
    const movePct = Math.abs((price - previousPrice) / previousPrice) * 100;
    if (movePct > limit) {
      throw new Error(
        `Suspicious market data: ${config.instrument} price moved ${movePct.toFixed(2)}% since last snapshot, above ${limit}%.`
      );
    }
  }
}

function applyPlanSafetyGuards({ plan, portfolio, price, config }) {
  let remainingQuote = portfolio.quoteAvailable;
  return {
    ...plan,
    actions: plan.actions.map((action) => {
      if (action.order?.side !== "BUY") return action;
      const estimatedSpend = estimateQuoteSpend(action.order, price);
      const guardedOrder = applyOrderSafetyGuard({
        order: action.order,
        portfolio: { ...portfolio, quoteAvailable: remainingQuote },
        price,
        config
      });
      if (guardedOrder) {
        remainingQuote -= estimatedSpend;
        return action;
      }
      return {
        kind: "SKIP_BUY_MIN_QUOTE_BALANCE",
        batchId: action.batchId || null,
        order: null,
        originalKind: action.kind,
        reason: `Buying would bring ${config.quoteAsset} balance below MIN_QUOTE_BALANCE=${config.minQuoteBalance}.`
      };
    })
  };
}

function applyOrderSafetyGuard({ order, portfolio, price, config }) {
  if (!order || order.side !== "BUY") return order;
  const minQuoteBalance = Math.max(0, Number(config.minQuoteBalance || 0));
  if (minQuoteBalance <= 0) return order;
  const estimatedSpend = estimateQuoteSpend(order, price);
  if (!Number.isFinite(estimatedSpend) || estimatedSpend <= 0) return null;
  return portfolio.quoteAvailable - estimatedSpend >= minQuoteBalance ? order : null;
}

function estimateQuoteSpend(order, price) {
  return Number(order.quantity || 0) * price;
}

function inferFillFromPortfolioDelta({ action, before, after, fallbackPrice }) {
  const baseDelta = after.baseTotal - before.baseTotal;
  const quoteDelta = after.quoteTotal - before.quoteTotal;

  if (action.order.side === "BUY") {
    const quantity = baseDelta > 0 ? baseDelta : Number(action.order.quantity);
    const quoteSpent = quoteDelta < 0 ? Math.abs(quoteDelta) : quantity * fallbackPrice;
    return {
      quantity,
      price: quoteSpent / quantity,
      baseDelta,
      quoteDelta
    };
  }

  const quantity = baseDelta < 0 ? Math.abs(baseDelta) : Number(action.order.quantity);
  const quoteReceived = quoteDelta > 0 ? quoteDelta : quantity * fallbackPrice;
  return {
    quantity,
    price: quoteReceived / quantity,
    baseDelta,
    quoteDelta
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateReportSafely(config) {
  try {
    generateReport({ config, quiet: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] report generation failed: ${error.stack || error.message}`);
  }
}

async function watch() {
  const config = loadConfig();
  const intervalMs = Math.max(1, config.checkIntervalMinutes) * 60 * 1000;

  await runOnce();
  setInterval(() => {
    runOnce().catch((error) => {
      console.error(`[${new Date().toISOString()}] ${error.stack || error.message}`);
    });
  }, intervalMs);
}

function checkConfig() {
  const config = loadConfig();
  const validationProblems = validateConfig(config);
  const safeConfig = {
    ...config,
    apiKey: config.apiKey ? "(set)" : "(missing)",
    apiSecret: config.apiSecret ? "(set)" : "(missing)",
    validation: validationProblems.length ? { ok: false, problems: validationProblems } : { ok: true, problems: [] }
  };
  console.log(JSON.stringify(safeConfig, null, 2));
}

const command = process.argv[2] || "once";

try {
  if (command === "watch") {
    await watch();
  } else if (command === "check") {
    checkConfig();
  } else {
    await runOnce();
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
