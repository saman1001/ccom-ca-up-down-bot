import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { CryptoComClient } from "./cryptoComClient.js";
import { extractBalances, extractTickerPrice, portfolioValue } from "./portfolio.js";
import { buildOrder, decide } from "./strategy.js";
import { appendSnapshot, ensureLogDir, readPreviousSnapshot } from "./storage.js";
import { addDust, loadDustBank, saveDustBank, subtractDust } from "./dustBank.js";
import { loadInstrumentRules } from "./instrumentRules.js";
import { generateReport } from "./report.js";
import { appendOrderEvent, isTerminalOrderStatus, latestOrderEventByClientOid, loadOrderLedger } from "./orderLedger.js";
import {
  notifyDailyReportIfNeeded,
  notifyLowQuoteBalanceIfNeeded,
  notifySale,
  recordBotError,
  recordBotSuccess
} from "./notifications.js";
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
  await notifyLowQuoteBalanceIfNeeded(config, portfolio);

  if (config.strategy === "batches") {
    const result = await runBatchStrategy({ client, config, snapshot });
    appendSnapshot(config.logDir, result);
    generateReportSafely(config);
    await notifyDailyReportIfNeeded(config, result);
    await recordBotSuccess(config);
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
  await notifyDailyReportIfNeeded(config, result);
  await recordBotSuccess(config);
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
  const orderEvents = loadOrderLedger(config.logDir);
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

    const order = {
      ...action.order,
      client_oid: buildClientOid({ action, config, now: snapshot.at })
    };
    const actionWithClientOid = {
      ...action,
      order
    };
    const existingOrder = latestOrderEventByClientOid(orderEvents, order.client_oid);
    let orderResult = null;
    let recoveredFromLedger = false;

    if (existingOrder && !isTerminalOrderStatus(existingOrder.status)) {
      recoveredFromLedger = true;
    }

    if (!recoveredFromLedger) {
      appendOrderEvent(config.logDir, {
        status: "PENDING",
        instrument: config.instrument,
        clientOid: order.client_oid,
        action: sanitizeLedgerAction(actionWithClientOid)
      });
      orderEvents.push({ status: "PENDING", clientOid: order.client_oid });
    }

    const recoveredOrderDetail = recoveredFromLedger
      ? await loadOrderDetailByIdentifiers({
          client,
          orderId: existingOrder.orderId || "",
          clientOid: order.client_oid
        })
      : null;

    if (!hasOrderDetailRow(recoveredOrderDetail)) {
      try {
        orderResult = await client.privatePost("private/create-order", order);
        appendOrderEvent(config.logDir, {
          status: "CREATED",
          instrument: config.instrument,
          clientOid: order.client_oid,
          orderId: getOrderId(orderResult),
          action: sanitizeLedgerAction(actionWithClientOid)
        });
        orderEvents.push({ status: "CREATED", clientOid: order.client_oid, orderId: getOrderId(orderResult) });
      } catch (error) {
        appendOrderEvent(config.logDir, {
          status: "CREATE_ERROR",
          instrument: config.instrument,
          clientOid: order.client_oid,
          orderId: "",
          action: sanitizeLedgerAction(actionWithClientOid),
          error: error.message
        });
        throw error;
      }
    } else {
      orderResult = {
        result: {
          order_id: getOrderIdFromDetail(recoveredOrderDetail),
          client_oid: order.client_oid
        }
      };
    }

    await sleep(1500);
    const orderDetail = recoveredOrderDetail || await loadOrderDetailSafely({ client, orderResult, clientOid: order.client_oid });
    const balanceAfterOrder = await client.privatePost("private/user-balance", {});
    const balancesAfterOrder = extractBalances(balanceAfterOrder);
    const nextPortfolio = portfolioValue({
      balances: balancesAfterOrder,
      baseAsset: config.baseAsset,
      quoteAsset: config.quoteAsset,
      price: snapshot.price
    });
    const fallbackFill = inferFillFromPortfolioDelta({
      action: actionWithClientOid,
      before: previousPortfolio,
      after: nextPortfolio,
      fallbackPrice: snapshot.price
    });
    const fill = inferFillFromOrderDetail({
      action: actionWithClientOid,
      orderResult,
      orderDetail,
      fallbackFill,
      config
    });

    appendOrderEvent(config.logDir, {
      status: hasFilledQuantity(fill) ? "FILLED" : "NO_FILL",
      instrument: config.instrument,
      clientOid: order.client_oid,
      orderId: fill.orderId || getOrderId(orderResult),
      action: sanitizeLedgerAction(actionWithClientOid),
      orderDetail: sanitizeOrderDetail(orderDetail),
      fill: sanitizeLedgerFill(fill)
    });
    orderEvents.push({
      status: hasFilledQuantity(fill) ? "FILLED" : "NO_FILL",
      clientOid: order.client_oid,
      orderId: fill.orderId || getOrderId(orderResult)
    });

    result.orderResults.push({
      action: actionWithClientOid,
      recoveredFromLedger,
      previousStatus: recoveredFromLedger ? existingOrder.status : "",
      previousOrderId: recoveredFromLedger ? existingOrder.orderId || "" : "",
      orderResult,
      orderDetail: sanitizeOrderDetail(orderDetail),
      fill,
      portfolioAfterOrder: nextPortfolio
    });

    if (!hasFilledQuantity(fill)) {
      previousPortfolio = nextPortfolio;
      continue;
    }

    applyFilledBatchAction({
      batches: updatedBatches,
      action: actionWithClientOid,
      fillPrice: fill.price,
      filledQuantity: fill.quantity,
      fill,
      now: snapshot.at
    });

    if (action.kind === "TAKE_PROFIT" && isFullActionFill({ action: actionWithClientOid, fill }) && action.dustQuantity > 0) {
      addDust(updatedDustBank, {
        asset: config.baseAsset,
        quantity: action.dustQuantity,
        price: fill.price,
        sourceBatchId: action.batchId,
        reason: "TAKE_PROFIT_ROUNDING",
        at: snapshot.at
      });
    }

    if (action.kind === "TAKE_PROFIT") {
      await notifySale(config, { action: actionWithClientOid, fill });
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
}\n
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

async function loadOrderDetailSafely({ client, orderResult, clientOid = "" }) {
  const orderId = getOrderId(orderResult);
  if (!orderId && !clientOid) return null;
  return loadOrderDetailByIdentifiers({ client, orderId, clientOid });
}

async function loadOrderDetailByIdentifiers({ client, orderId = "", clientOid = "" }) {
  try {
    if (orderId) return await client.privatePost("private/get-order-detail", { order_id: orderId });
    return await client.privatePost("private/get-order-detail", { client_oid: clientOid });
  } catch (error) {
    return {
      error: error.message,
      orderId,
      clientOid
    };
  }
}

function inferFillFromOrderDetail({ action, orderResult, orderDetail, fallbackFill, config }) {
  const row = orderDetail?.result?.order_info || orderDetail?.result?.data || orderDetail?.result;
  const grossQuantity = Number(row?.cumulative_quantity ?? row?.quantity ?? 0);
  const quoteValue = Number(row?.cumulative_value ?? row?.order_value ?? 0);
  const averageExecutionPrice = Number(row?.avg_price ?? 0);
  const feeAmount = Number(row?.cumulative_fee ?? 0);
  const feeCurrency = row?.fee_instrument_name || row?.fee_currency || "";
  const orderId = row?.order_id || getOrderId(orderResult);
  const status = row?.status || "";

  if (row && (!Number.isFinite(grossQuantity) || grossQuantity <= 0)) {
    return {
      source: "order_detail",
      orderId,
      status,
      quantity: 0,
      grossQuantity: 0,
      netQuantity: 0,
      price: 0,
      averageExecutionPrice: Number.isFinite(averageExecutionPrice) ? averageExecutionPrice : 0,
      quoteValue: 0,
      fee: Number.isFinite(feeAmount) && feeAmount > 0 ? { amount: feeAmount, currency: feeCurrency } : null,
      pending: true,
      baseDelta: 0,
      quoteDelta: 0
    };
  }

  if (!row) {
    return {
      ...fallbackFill,
      source: "portfolio_delta",
      orderId,
      status,
      fee: Number.isFinite(feeAmount) && feeAmount > 0 ? { amount: feeAmount, currency: feeCurrency } : null
    };
  }

  const fee = Number.isFinite(feeAmount) && feeAmount > 0 ? { amount: feeAmount, currency: feeCurrency } : null;
  const grossQuoteValue = Number.isFinite(quoteValue) && quoteValue > 0
    ? quoteValue
    : grossQuantity * (Number.isFinite(averageExecutionPrice) && averageExecutionPrice > 0 ? averageExecutionPrice : fallbackFill.price);

  if (action.order.side === "BUY") {
    const netQuantity = feeCurrency === config.baseAsset ? Math.max(0, grossQuantity - feeAmount) : grossQuantity;
    const totalQuoteCost = feeCurrency === config.quoteAsset ? grossQuoteValue + feeAmount : grossQuoteValue;
    const price = netQuantity > 0 ? totalQuoteCost / netQuantity : fallbackFill.price;
    return {
      source: "order_detail",
      orderId,
      status,
      quantity: netQuantity,
      grossQuantity,
      netQuantity,
      price,
      averageExecutionPrice: averageExecutionPrice || grossQuoteValue / grossQuantity,
      quoteValue: grossQuoteValue,
      fee,
      baseDelta: netQuantity,
      quoteDelta: -totalQuoteCost
    };
  }

  const netQuoteValue = feeCurrency === config.quoteAsset ? Math.max(0, grossQuoteValue - feeAmount) : grossQuoteValue;
  const price = grossQuantity > 0 ? netQuoteValue / grossQuantity : fallbackFill.price;
  return {
    source: "order_detail",
    orderId,
    status,
    quantity: grossQuantity,
    grossQuantity,
    netQuantity: grossQuantity,
    price,
    averageExecutionPrice: averageExecutionPrice || grossQuoteValue / grossQuantity,
    quoteValue: netQuoteValue,
    fee,
    baseDelta: -grossQuantity,
    quoteDelta: netQuoteValue
  };
}

function sanitizeOrderDetail(orderDetail) {
  const row = orderDetail?.result?.order_info || orderDetail?.result?.data || orderDetail?.result;
  if (!row) {
    return orderDetail?.error ? { error: orderDetail.error, orderId: orderDetail.orderId || "" } : null;
  }
  return {
    orderId: row.order_id || "",
    clientOid: row.client_oid || "",
    instrument: row.instrument_name || "",
    side: row.side || "",
    type: row.order_type || "",
    status: row.status || "",
    quantity: row.quantity || "",
    averagePrice: row.avg_price || "",
    cumulativeQuantity: row.cumulative_quantity || "",
    cumulativeValue: row.cumulative_value || "",
    cumulativeFee: row.cumulative_fee || "",
    feeCurrency: row.fee_instrument_name || "",
    createTime: row.create_time || null,
    updateTime: row.update_time || null
  };
}

function hasOrderDetailRow(orderDetail) {
  return Boolean(orderDetail?.result?.order_info || orderDetail?.result?.data || orderDetail?.result?.order_id);
}

function getOrderId(orderResult) {
  return orderResult?.result?.order_id || orderResult?.result?.data?.order_id || "";
}

function getOrderIdFromDetail(orderDetail) {
  const row = orderDetail?.result?.order_info || orderDetail?.result?.data || orderDetail?.result;
  return row?.order_id || "";
}

function buildClientOid({ action, config, now }) {
  const intervalMs = Math.max(1, Number(config.checkIntervalMinutes || 60)) * 60 * 1000;
  const nowMs = new Date(now).getTime();
  const bucket = Number.isFinite(nowMs) ? Math.floor(nowMs / intervalMs) : Math.floor(Date.now() / intervalMs);
  const source = [
    config.instrument,
    action.kind,
    action.batchId || "none",
    action.order?.side || "",
    action.order?.type || "",
    action.order?.quantity || "",
    bucket
  ].join("|");
  return `ccbot_${crypto.createHash("sha256").update(source).digest("hex").slice(0, 24)}`;
}

function sanitizeLedgerAction(action) {
  return {
    kind: action.kind,
    batchId: action.batchId || null,
    order: action.order
      ? {
          instrument_name: action.order.instrument_name,
          side: action.order.side,
          type: action.order.type,
          quantity: action.order.quantity,
          client_oid: action.order.client_oid
        }
      : null,
    reason: action.reason || ""
  };
}

function sanitizeLedgerFill(fill) {
  if (!fill) return null;
  return {
    source: fill.source || "",
    orderId: fill.orderId || "",
    status: fill.status || "",
    quantity: fill.quantity || 0,
    grossQuantity: fill.grossQuantity || 0,
    netQuantity: fill.netQuantity || 0,
    price: fill.price || 0,
    averageExecutionPrice: fill.averageExecutionPrice || 0,
    quoteValue: fill.quoteValue || 0,
    fee: fill.fee || null,
    pending: Boolean(fill.pending)
  };
}

function inferFillFromPortfolioDelta({ action, before, after, fallbackPrice }) {
  const baseDelta = after.baseTotal - before.baseTotal;
  const quoteDelta = after.quoteTotal - before.quoteTotal;

  if (action.order.side === "BUY") {
    const quantity = baseDelta > 0 ? baseDelta : 0;
    const quoteSpent = quoteDelta < 0 ? Math.abs(quoteDelta) : quantity * fallbackPrice;
    return {
      quantity,
      price: quantity > 0 ? quoteSpent / quantity : 0,
      baseDelta,
      quoteDelta
    };
  }

  const quantity = baseDelta < 0 ? Math.abs(baseDelta) : 0;
  const quoteReceived = quoteDelta > 0 ? quoteDelta : quantity * fallbackPrice;
  return {
    quantity,
    price: quantity > 0 ? quoteReceived / quantity : 0,
    baseDelta,
    quoteDelta
  };
}

function hasFilledQuantity(fill) {
  return Number.isFinite(fill?.quantity) && fill.quantity > 0 && Number.isFinite(fill?.price) && fill.price > 0;
}

function isFullActionFill({ action, fill }) {
  const requestedQuantity = Number(action.order?.quantity || 0);
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return false;
  return Number(fill?.grossQuantity || fill?.quantity || 0) >= requestedQuantity - 1e-12;
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
    runOnce().catch(async (error) => {
      console.error(`[${new Date().toISOString()}] ${error.stack || error.message}`);
      await notifyErrorSafely(error);
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
    telegramBotToken: config.telegramBotToken ? "(set)" : "(missing)",
    telegramChatId: config.telegramChatId ? "(set)" : "(missing)",
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
  await notifyErrorSafely(error);
  process.exitCode = 1;
}

async function notifyErrorSafely(error) {
  try {
    const config = loadConfig();
    await recordBotError(config, error);
  } catch (notificationError) {
    console.error(`[${new Date().toISOString()}] notification failed: ${notificationError.message}`);
  }
}
