import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { CryptoComClient } from "./cryptoComClient.js";
import { extractBalances, extractTickerPrice, portfolioValue } from "./portfolio.js";
import { buildOrder, decide } from "./strategy.js";
import { appendSnapshot, ensureLogDir, readPreviousSnapshot } from "./storage.js";
import { addDust, loadDustBank, saveDustBank, subtractDust } from "./dustBank.js";
import { loadInstrumentRules } from "./instrumentRules.js";
import { applyMakerPricesToPlan } from "./makerOrders.js";
import { generateReport } from "./report.js";
import {
  appendOrderEvent,
  isTerminalOrderStatus,
  latestActiveOrderEventForAction,
  latestOrderEventByClientOid,
  loadOrderLedger
} from "./orderLedger.js";
import { appendPriceHistory } from "./priceHistory.js";
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
  appendPriceHistory(config.logDir, {
    at: snapshot.at,
    instrument: config.instrument,
    price,
    quoteAsset: config.quoteAsset
  });
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
  const basePlan = buildBatchPlan({
    batches,
    dustBank,
    instrumentRules,
    price: snapshot.price,
    config,
    now: snapshot.at
  });
  const plan = await applyMakerPricesToPlan({
    client,
    plan: basePlan,
    config,
    instrumentRules
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

    let order = {
      ...action.order,
      client_oid: buildClientOid({ action, config, now: snapshot.at })
    };
    let actionWithClientOid = {
      ...action,
      order
    };
    const activeMakerOrder = config.orderMode === "maker"
      ? latestActiveOrderEventForAction(orderEvents, actionWithClientOid)
      : null;
    const existingOrder = activeMakerOrder || latestOrderEventByClientOid(orderEvents, order.client_oid);
    let orderResult = null;
    let recoveredFromLedger = false;

    if (existingOrder && !isTerminalOrderStatus(existingOrder.status)) {
      recoveredFromLedger = true;
      if (existingOrder.clientOid && existingOrder.clientOid !== order.client_oid) {
        order = {
          ...order,
          client_oid: existingOrder.clientOid
        };
        actionWithClientOid = {
          ...actionWithClientOid,
          order
        };
      }
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
    const makerFallback = makerFallbackDecision({
      existingOrder,
      recoveredFromLedger,
      action: actionWithClientOid,
      orderDetail,
      config,
      now: snapshot.at
    });
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
    const cumulativeFill = inferFillFromOrderDetail({
      action: actionWithClientOid,
      orderResult,
      orderDetail,
      fallbackFill,
      config
    });
    const previousAppliedFill = latestAppliedFillByClientOid(orderEvents, order.client_oid);
    const fill = incrementalFillFromCumulative({
      cumulativeFill,
      previousAppliedFill,
      action: actionWithClientOid,
      config
    });
    const ledgerStatus = orderLedgerStatusFromFill({ fill, cumulativeFill });
    let cancelResult = null;

    if (makerFallback.shouldCancel) {
      cancelResult = await cancelOrderSafely({
        client,
        orderId: cumulativeFill.orderId || getOrderId(orderResult),
        clientOid: order.client_oid
      });
      appendOrderEvent(config.logDir, {
        status: cancelResult.ok ? "CANCEL_REQUESTED" : "CANCEL_ERROR",
        instrument: config.instrument,
        clientOid: order.client_oid,
        orderId: cumulativeFill.orderId || getOrderId(orderResult),
        action: sanitizeLedgerAction(actionWithClientOid),
        reason: makerFallback.reason,
        cancelResult: sanitizeCancelResult(cancelResult)
      });
      orderEvents.push({
        status: cancelResult.ok ? "CANCEL_REQUESTED" : "CANCEL_ERROR",
        clientOid: order.client_oid,
        orderId: cumulativeFill.orderId || getOrderId(orderResult)
      });
    }

    appendOrderEvent(config.logDir, {
      status: ledgerStatus,
      instrument: config.instrument,
      clientOid: order.client_oid,
      orderId: cumulativeFill.orderId || fill.orderId || getOrderId(orderResult),
      action: sanitizeLedgerAction(actionWithClientOid),
      orderDetail: sanitizeOrderDetail(orderDetail),
      fill: sanitizeLedgerFill(fill)
    });
    orderEvents.push({
      status: ledgerStatus,
      clientOid: order.client_oid,
      orderId: cumulativeFill.orderId || fill.orderId || getOrderId(orderResult),
      fill: sanitizeLedgerFill(fill)
    });

    result.orderResults.push({
      action: actionWithClientOid,
      recoveredFromLedger,
      previousStatus: recoveredFromLedger ? existingOrder.status : "",
      previousOrderId: recoveredFromLedger ? existingOrder.orderId || "" : "",
      orderResult,
      orderDetail: sanitizeOrderDetail(orderDetail),
      fill,
      cumulativeFill,
      makerFallback,
      cancelResult: sanitizeCancelResult(cancelResult),
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
    ["AVERAGE_DOWN_QUANTITY", config.averageDownQuantity],
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
  if (!["market", "maker"].includes(config.orderMode)) {
    problems.push("ORDER_MODE must be market or maker");
  }
  if (!Number.isFinite(config.makerBookLevel) || config.makerBookLevel < 1) {
    problems.push("MAKER_BOOK_LEVEL must be 1 or greater");
  }
  if (!Number.isFinite(config.makerMaxSpreadPct) || config.makerMaxSpreadPct < 0) {
    problems.push("MAKER_MAX_SPREAD_PCT must be 0 or greater");
  }
  if (!Number.isFinite(config.makerOrderTimeoutMinutes) || config.makerOrderTimeoutMinutes < 0) {
    problems.push("MAKER_ORDER_TIMEOUT_MINUTES must be 0 or greater");
  }
  if (!Number.isFinite(config.makerRepriceAfterMinutes) || config.makerRepriceAfterMinutes < 0) {
    problems.push("MAKER_REPRICE_AFTER_MINUTES must be 0 or greater");
  }
  if (!["POST_ONLY", "SMART_POST_ONLY"].includes(config.makerPostOnlyMode)) {
    problems.push("MAKER_POST_ONLY_MODE must be POST_ONLY or SMART_POST_ONLY");
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
  if (!Number.isFinite(config.forceBaseBuyWeeklyLimit) || config.forceBaseBuyWeeklyLimit < 0) {
    problems.push("FORCE_BASE_BUY_WEEKLY_LIMIT must be 0 or greater");
  }
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
        kind: "SKIP_BUY_SAFETY_GUARD",
        batchId: action.batchId || null,
        order: null,
        originalKind: action.kind,
        reason: buySafetyGuardReason({
          order: action.order,
          portfolio: { ...portfolio, quoteAvailable: remainingQuote },
          price,
          config
        })
      };
    })
  };
}

function applyOrderSafetyGuard({ order, portfolio, price, config }) {
  if (!order || order.side !== "BUY") return order;
  const minQuoteBalance = Math.max(0, Number(config.minQuoteBalance || 0));
  const estimatedSpend = estimateQuoteSpend(order, price);
  if (!Number.isFinite(estimatedSpend) || estimatedSpend <= 0) return null;
  if (portfolio.quoteAvailable < estimatedSpend) return null;
  return portfolio.quoteAvailable - estimatedSpend >= minQuoteBalance ? order : null;
}

function estimateQuoteSpend(order, price) {
  return Number(order.quantity || 0) * Number(order.price || price);
}

function buySafetyGuardReason({ order, portfolio, price, config }) {
  const estimatedSpend = estimateQuoteSpend(order, price);
  if (!Number.isFinite(estimatedSpend) || estimatedSpend <= 0) {
    return "Buying was skipped because estimated spend is invalid.";
  }
  if (portfolio.quoteAvailable < estimatedSpend) {
    return `Buying would need about ${estimatedSpend} ${config.quoteAsset}, but only ${portfolio.quoteAvailable} is available.`;
  }
  return `Buying would bring ${config.quoteAsset} balance below MIN_QUOTE_BALANCE=${config.minQuoteBalance}.`;
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

async function cancelOrderSafely({ client, orderId, clientOid }) {
  if (!orderId) {
    return {
      ok: false,
      error: "Cannot cancel maker order because order_id is missing.",
      clientOid
    };
  }

  try {
    const response = await client.privatePost("private/cancel-order", { order_id: orderId });
    return {
      ok: true,
      orderId,
      response
    };
  } catch (error) {
    return {
      ok: false,
      orderId,
      error: error.message
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

function sanitizeCancelResult(cancelResult) {
  if (!cancelResult) return null;
  return {
    ok: Boolean(cancelResult.ok),
    orderId: cancelResult.orderId || "",
    clientOid: cancelResult.clientOid || "",
    error: cancelResult.error || "",
    code: cancelResult.response?.code ?? null,
    method: cancelResult.response?.method || ""
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
          price: action.order.price,
          quantity: action.order.quantity,
          client_oid: action.order.client_oid,
          exec_inst: action.order.exec_inst,
          time_in_force: action.order.time_in_force
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
    pending: Boolean(fill.pending),
    cumulativeQuantity: fill.cumulativeQuantity,
    cumulativeGrossQuantity: fill.cumulativeGrossQuantity,
    cumulativeNetQuantity: fill.cumulativeNetQuantity,
    cumulativeQuoteValue: fill.cumulativeQuoteValue,
    cumulativeFee: fill.cumulativeFee || null
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

function makerFallbackDecision({ existingOrder, recoveredFromLedger, action, orderDetail, config, now }) {
  if (!recoveredFromLedger || config.orderMode !== "maker" || action.order?.type !== "LIMIT") {
    return { shouldCancel: false, reason: "" };
  }
  const exchangeStatus = String(orderDetailStatus(orderDetail) || "").toUpperCase();
  if (isExchangeFilledStatus(exchangeStatus) || isExchangeTerminalNoFillStatus(exchangeStatus)) {
    return { shouldCancel: false, reason: "" };
  }

  const createdAt = new Date(existingOrder?.firstActiveAt || existingOrder?.at || 0).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(nowMs) || nowMs <= createdAt) {
    return { shouldCancel: false, reason: "" };
  }

  const ageMinutes = (nowMs - createdAt) / 60000;
  const timeout = Math.max(0, Number(config.makerOrderTimeoutMinutes || 0));
  const reprice = Math.max(0, Number(config.makerRepriceAfterMinutes || 0));

  if (timeout > 0 && ageMinutes >= timeout) {
    return {
      shouldCancel: true,
      reason: `Maker order is ${ageMinutes.toFixed(1)} minutes old, above MAKER_ORDER_TIMEOUT_MINUTES=${timeout}.`
    };
  }

  if (reprice > 0 && ageMinutes >= reprice) {
    return {
      shouldCancel: true,
      reason: `Maker order is ${ageMinutes.toFixed(1)} minutes old, above MAKER_REPRICE_AFTER_MINUTES=${reprice}. It will be cancelled so the next run can place a fresh book-level order.`
    };
  }

  return { shouldCancel: false, reason: "" };
}

function orderDetailStatus(orderDetail) {
  const row = orderDetail?.result?.order_info || orderDetail?.result?.data || orderDetail?.result;
  return row?.status || "";
}

function latestAppliedFillByClientOid(events, clientOid) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.clientOid !== clientOid || !event.fill) continue;
    const cumulativeQuantity = Number(event.fill.cumulativeQuantity ?? event.fill.quantity ?? 0);
    const cumulativeGrossQuantity = Number(event.fill.cumulativeGrossQuantity ?? event.fill.grossQuantity ?? 0);
    if (cumulativeQuantity > 0 || cumulativeGrossQuantity > 0) return event.fill;
  }
  return null;
}

function incrementalFillFromCumulative({ cumulativeFill, previousAppliedFill, action, config }) {
  if (!hasCumulativeFill(cumulativeFill)) return cumulativeFill;

  const previous = previousAppliedFill || {};
  const previousQuantity = Number(previous.cumulativeQuantity ?? previous.quantity ?? 0);
  const previousGrossQuantity = Number(previous.cumulativeGrossQuantity ?? previous.grossQuantity ?? 0);
  const previousNetQuantity = Number(previous.cumulativeNetQuantity ?? previous.netQuantity ?? previous.quantity ?? 0);
  const previousQuoteValue = Number(previous.cumulativeQuoteValue ?? previous.quoteValue ?? 0);
  const previousFeeAmount = Number(previous.cumulativeFee?.amount ?? previous.fee?.amount ?? 0);

  const currentQuantity = Number(cumulativeFill.quantity || 0);
  const currentGrossQuantity = Number(cumulativeFill.grossQuantity || 0);
  const currentNetQuantity = Number(cumulativeFill.netQuantity ?? cumulativeFill.quantity ?? 0);
  const currentQuoteValue = Number(cumulativeFill.quoteValue || 0);
  const currentFeeAmount = Number(cumulativeFill.fee?.amount || 0);
  const feeCurrency = cumulativeFill.fee?.currency || previous.cumulativeFee?.currency || previous.fee?.currency || "";

  const deltaQuantity = cleanDelta(currentQuantity - previousQuantity);
  const deltaGrossQuantity = cleanDelta(currentGrossQuantity - previousGrossQuantity);
  const deltaNetQuantity = cleanDelta(currentNetQuantity - previousNetQuantity);
  const deltaQuoteValue = cleanDelta(currentQuoteValue - previousQuoteValue);
  const deltaFeeAmount = cleanDelta(currentFeeAmount - previousFeeAmount);
  const side = action.order?.side || "";

  const quantity = side === "BUY" ? deltaQuantity : deltaGrossQuantity || deltaQuantity;
  const grossQuantity = deltaGrossQuantity || quantity;
  const netQuantity = side === "BUY" ? deltaNetQuantity || quantity : grossQuantity;
  const totalQuote = side === "BUY" && feeCurrency === config.quoteAsset ? deltaQuoteValue + deltaFeeAmount : deltaQuoteValue;
  const price = quantity > 0 ? totalQuote / quantity : 0;

  return {
    ...cumulativeFill,
    quantity,
    grossQuantity,
    netQuantity,
    price: Number.isFinite(price) && price > 0 ? price : 0,
    quoteValue: deltaQuoteValue,
    fee: deltaFeeAmount > 0 ? { amount: deltaFeeAmount, currency: feeCurrency } : null,
    baseDelta: cleanSignedDelta((cumulativeFill.baseDelta || 0) - Number(previous.baseDelta || 0)),
    quoteDelta: cleanSignedDelta((cumulativeFill.quoteDelta || 0) - Number(previous.quoteDelta || 0)),
    cumulativeQuantity: currentQuantity,
    cumulativeGrossQuantity: currentGrossQuantity,
    cumulativeNetQuantity: currentNetQuantity,
    cumulativeQuoteValue: currentQuoteValue,
    cumulativeFee: cumulativeFill.fee || null
  };
}

function hasCumulativeFill(fill) {
  return Number(fill?.quantity || 0) > 0 || Number(fill?.grossQuantity || 0) > 0;
}

function orderLedgerStatusFromFill({ fill, cumulativeFill }) {
  const exchangeStatus = String(cumulativeFill?.status || "").toUpperCase();
  if (isExchangeTerminalNoFillStatus(exchangeStatus) && !hasFilledQuantity(fill)) return exchangeStatus;
  if (isExchangeFilledStatus(exchangeStatus)) {
    return hasFilledQuantity(fill) ? "FILLED" : "FILLED_ALREADY_APPLIED";
  }
  if (hasFilledQuantity(fill)) return "PARTIAL_FILL";
  return "NO_FILL";
}

function isExchangeFilledStatus(status) {
  return ["FILLED", "FULLY_FILLED"].includes(status);
}

function isExchangeTerminalNoFillStatus(status) {
  return ["CANCELED", "CANCELLED", "REJECTED", "EXPIRED", "FAILED"].includes(status);
}

function cleanDelta(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(Number(value).toFixed(12)));
}

function cleanSignedDelta(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(Number(value).toFixed(12));
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
  const intervalMs = Math.max(1, Number(config.checkIntervalMinutes || 60)) * 60 * 1000;

  await runOnce();
  setInterval(() => {
    runOnce().catch(async (error) => {
      console.error(`[${new Date().toISOString()}] ${error.stack || error.message}`);
      await notifyErrorSafely(error);
    });
  }, intervalMs);
}

async function checkConfig() {
  const config = loadConfig();
  const validationProblems = validateConfig(config);
  const client = new CryptoComClient(config);
  const instrumentRules = await loadInstrumentRules(client, config.instrument);
  const safeConfig = {
    ...config,
    apiKey: config.apiKey ? "(set)" : "(missing)",
    apiSecret: config.apiSecret ? "(set)" : "(missing)",
    telegramBotToken: config.telegramBotToken ? "(set)" : "(missing)",
    telegramChatId: config.telegramChatId ? "(set)" : "(missing)",
    emailReportTo: config.emailReportTo ? "(set)" : "(missing)",
    emailReportFrom: config.emailReportFrom ? "(set)" : "(missing)",
    instrumentRules,
    validation: validationProblems.length ? { ok: false, problems: validationProblems } : { ok: true, problems: [] }
  };
  console.log(JSON.stringify(safeConfig, null, 2));
}

const command = process.argv[2] || "once";

try {
  if (command === "watch") {
    await watch();
  } else if (command === "check") {
    await checkConfig();
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
