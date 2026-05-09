import { loadConfig } from "./config.js";
import { CryptoComClient } from "./cryptoComClient.js";
import { extractBalances, extractTickerPrice, portfolioValue } from "./portfolio.js";
import { buildOrder, decide } from "./strategy.js";
import { appendSnapshot, ensureLogDir, readPreviousSnapshot } from "./storage.js";
import {
  applyDryRunBatchPlan,
  applyFilledBatchAction,
  buildBatchPlan,
  loadBatches,
  saveBatches
} from "./batchStrategy.js";

async function runOnce() {
  const config = loadConfig();
  ensureLogDir(config.logDir);

  const client = new CryptoComClient(config);

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

  const previous = readPreviousSnapshot(config.logDir);
  const snapshot = {
    at: new Date().toISOString(),
    instrument: config.instrument,
    price,
    portfolio
  };

  if (config.strategy === "batches") {
    const result = await runBatchStrategy({ client, config, snapshot });
    appendSnapshot(config.logDir, result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const signal = decide({ current: snapshot, previous, config });
  const order = buildOrder({ signal, snapshot, config });

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
  console.log(JSON.stringify(result, null, 2));
}

async function runBatchStrategy({ client, config, snapshot }) {
  const batches = loadBatches(config.logDir);
  const plan = buildBatchPlan({
    batches,
    price: snapshot.price,
    config,
    now: snapshot.at
  });

  const result = {
    ...snapshot,
    strategy: "batches",
    openBatchesBefore: batches.filter((batch) => batch.status === "OPEN").length,
    plan,
    dryRun: config.dryRun,
    tradingEnabled: config.enableTrading
  };

  if (config.dryRun || !config.enableTrading) {
    result.simulatedBatches = applyDryRunBatchPlan({
      batches,
      plan,
      price: snapshot.price,
      now: snapshot.at
    });
    return result;
  }

  const updatedBatches = JSON.parse(JSON.stringify(batches));
  result.orderResults = [];
  let previousPortfolio = snapshot.portfolio;

  for (const action of plan.actions) {
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
    previousPortfolio = nextPortfolio;
  }

  saveBatches(config.logDir, updatedBatches);
  result.openBatchesAfter = updatedBatches.filter((batch) => batch.status === "OPEN").length;
  return result;
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
  const safeConfig = {
    ...config,
    apiKey: config.apiKey ? "(set)" : "(missing)",
    apiSecret: config.apiSecret ? "(set)" : "(missing)"
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
