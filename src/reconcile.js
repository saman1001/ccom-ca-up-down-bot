import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { CryptoComClient } from "./cryptoComClient.js";
import { generateReport } from "./report.js";
import { loadBatches, saveBatches } from "./batchStrategy.js";

const command = parseArgs(process.argv.slice(2));

try {
  await reconcile();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}

async function reconcile() {
  const config = loadConfig();
  const batches = loadBatches(config.logDir);
  const snapshots = readJsonl(path.join(config.logDir, "snapshots.jsonl"));
  const orders = collectSnapshotOrders(snapshots, command.limit);

  const summary = {
    instrument: config.instrument,
    envFile: config.envFile,
    logDir: config.logDir,
    dryRun: command.dryRun,
    ordersFound: orders.length,
    orderDetailsLoaded: 0,
    tradesUpdated: 0,
    tradesAlreadyExact: 0,
    tradesNotFound: 0,
    skippedOrders: 0,
    errors: []
  };

  if (!orders.length) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const client = new CryptoComClient(config);
  const updatedBatches = JSON.parse(JSON.stringify(batches));

  for (const order of orders) {
    try {
      const orderDetail = await client.privatePost("private/get-order-detail", { order_id: order.orderId });
      summary.orderDetailsLoaded += 1;
      const fill = fillFromOrderDetail({ action: order.action, orderId: order.orderId, orderDetail, config });

      if (!fill) {
        summary.skippedOrders += 1;
        continue;
      }

      const result = applyFillToBatchTrade({
        batches: updatedBatches,
        order,
        fill
      });

      if (result === "updated") summary.tradesUpdated += 1;
      if (result === "same") summary.tradesAlreadyExact += 1;
      if (result === "missing") summary.tradesNotFound += 1;
    } catch (error) {
      summary.errors.push({
        orderId: order.orderId,
        message: error.message
      });
    }
  }

  if (summary.tradesUpdated > 0) {
    recalculateBatches(updatedBatches);
    if (!command.dryRun) {
      summary.backupPath = backupBatches(config.logDir);
      saveBatches(config.logDir, updatedBatches);
      generateReport({ config, quiet: true });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(args) {
  const result = {
    dryRun: args.includes("--dry-run"),
    limit: 0
  };

  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  if (limitArg) {
    const limit = Number(limitArg.slice("--limit=".length));
    result.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  }

  return result;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function collectSnapshotOrders(snapshots, limit) {
  const orders = new Map();

  for (const snapshot of snapshots) {
    for (const result of snapshot.orderResults || []) {
      const action = result.action || {};
      const orderId = findOrderId(result);
      if (!orderId || !action.order) continue;
      if (!["BASE_BUY", "AVERAGE_DOWN", "TAKE_PROFIT"].includes(action.kind)) continue;

      orders.set(orderId, {
        orderId,
        at: snapshot.at,
        instrument: snapshot.instrument,
        action
      });
    }
  }

  const values = Array.from(orders.values());
  return limit > 0 ? values.slice(-limit) : values;
}

function findOrderId(result) {
  return (
    result.fill?.orderId ||
    result.orderDetail?.orderId ||
    result.orderResult?.result?.order_id ||
    result.orderResult?.result?.data?.order_id ||
    ""
  );
}

function fillFromOrderDetail({ action, orderId, orderDetail, config }) {
  const row = orderDetail?.result?.order_info || orderDetail?.result?.data || orderDetail?.result;
  if (!row) return null;

  const grossQuantity = Number(row.cumulative_quantity ?? row.quantity ?? 0);
  const quoteValue = Number(row.cumulative_value ?? row.order_value ?? 0);
  const averageExecutionPrice = Number(row.avg_price ?? 0);
  const feeAmount = Number(row.cumulative_fee ?? 0);
  const feeCurrency = row.fee_instrument_name || row.fee_currency || "";
  const status = row.status || "";

  if (!Number.isFinite(grossQuantity) || grossQuantity <= 0) return null;

  const fee = Number.isFinite(feeAmount) && feeAmount > 0 ? { amount: feeAmount, currency: feeCurrency } : null;
  const grossQuoteValue =
    Number.isFinite(quoteValue) && quoteValue > 0
      ? quoteValue
      : grossQuantity * (Number.isFinite(averageExecutionPrice) && averageExecutionPrice > 0 ? averageExecutionPrice : 0);

  if (action.order.side === "BUY") {
    const netQuantity = feeCurrency === config.baseAsset ? Math.max(0, grossQuantity - feeAmount) : grossQuantity;
    const totalQuoteCost = feeCurrency === config.quoteAsset ? grossQuoteValue + feeAmount : grossQuoteValue;
    const price = netQuantity > 0 ? totalQuoteCost / netQuantity : averageExecutionPrice;
    return {
      source: "order_detail",
      orderId: row.order_id || orderId,
      status,
      quantity: netQuantity,
      grossQuantity,
      netQuantity,
      price,
      averageExecutionPrice: averageExecutionPrice || (grossQuantity > 0 ? grossQuoteValue / grossQuantity : 0),
      quoteValue: grossQuoteValue,
      fee
    };
  }

  const netQuoteValue = feeCurrency === config.quoteAsset ? Math.max(0, grossQuoteValue - feeAmount) : grossQuoteValue;
  const price = grossQuantity > 0 ? netQuoteValue / grossQuantity : averageExecutionPrice;
  return {
    source: "order_detail",
    orderId: row.order_id || orderId,
    status,
    quantity: grossQuantity,
    grossQuantity,
    netQuantity: grossQuantity,
    price,
    averageExecutionPrice: averageExecutionPrice || (grossQuantity > 0 ? grossQuoteValue / grossQuantity : 0),
    quoteValue: netQuoteValue,
    fee
  };
}

function applyFillToBatchTrade({ batches, order, fill }) {
  const trade = findTrade({ batches, order });
  if (!trade && order.action.kind === "BASE_BUY" && order.action.order.side === "BUY") {
    batches.push({
      id: `batch_reconcile_${order.orderId}`,
      status: "OPEN",
      createdAt: order.at,
      updatedAt: order.at,
      quantity: cleanNumber(fill.quantity),
      averagePrice: cleanNumber(fill.price),
      buys: [
        {
          at: order.at,
          quantity: cleanNumber(fill.quantity),
          price: cleanNumber(fill.price),
          reason: order.action.kind,
          ...tradeFillFields(fill)
        }
      ],
      sells: []
    });
    return "updated";
  }

  if (!trade && order.action.kind === "AVERAGE_DOWN" && order.action.batchId) {
    const batch = batches.find((item) => item.id === order.action.batchId);
    if (!batch) return "missing";
    batch.buys = batch.buys || [];
    batch.buys.push({
      at: order.at,
      quantity: cleanNumber(fill.quantity),
      price: cleanNumber(fill.price),
      reason: order.action.kind,
      ...tradeFillFields(fill)
    });
    return "updated";
  }

  if (!trade && order.action.kind === "TAKE_PROFIT" && order.action.batchId) {
    const batch = batches.find((item) => item.id === order.action.batchId);
    if (!batch) return "missing";
    batch.sells = batch.sells || [];
    batch.sells.push({
      at: order.at,
      quantity: cleanNumber(fill.quantity),
      price: cleanNumber(fill.price),
      reason: order.action.kind,
      ...tradeFillFields(fill)
    });
    if (isFullActionFill({ action: order.action, fill })) {
      batch.status = "CLOSED";
      batch.closedAt = order.at;
    }
    return "updated";
  }

  if (!trade) return "missing";

  const next = {
    ...trade,
    quantity: cleanNumber(fill.quantity),
    price: cleanNumber(fill.price),
    orderId: fill.orderId,
    orderStatus: fill.status,
    fillSource: fill.source,
    grossQuantity: cleanNumber(fill.grossQuantity),
    netQuantity: cleanNumber(fill.netQuantity),
    averageExecutionPrice: cleanNumber(fill.averageExecutionPrice),
    quoteValue: cleanNumber(fill.quoteValue)
  };

  if (fill.fee) {
    next.feeAmount = cleanNumber(fill.fee.amount);
    next.feeCurrency = fill.fee.currency;
  }

  for (const key of Object.keys(next)) {
    if (trade[key] !== next[key]) {
      Object.assign(trade, next);
      return "updated";
    }
  }

  return "same";
}

function tradeFillFields(fill) {
  const result = {
    orderId: fill.orderId || "",
    orderStatus: fill.status || "",
    fillSource: fill.source || "",
    grossQuantity: cleanNumber(fill.grossQuantity),
    netQuantity: cleanNumber(fill.netQuantity),
    averageExecutionPrice: cleanNumber(fill.averageExecutionPrice),
    quoteValue: cleanNumber(fill.quoteValue)
  };
  if (fill.fee) {
    result.feeAmount = cleanNumber(fill.fee.amount);
    result.feeCurrency = fill.fee.currency;
  }
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function isFullActionFill({ action, fill }) {
  const requestedQuantity = Number(action.order?.quantity || 0);
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return false;
  return Number(fill?.grossQuantity || fill?.quantity || 0) >= requestedQuantity - 1e-12;
}

function findTrade({ batches, order }) {
  const expectedSide = order.action.order.side;
  const tradeKey = expectedSide === "SELL" ? "sells" : "buys";

  for (const batch of batches) {
    for (const trade of batch[tradeKey] || []) {
      if (trade.orderId && trade.orderId === order.orderId) return trade;
    }
  }

  if (order.action.batchId) {
    const batch = batches.find((item) => item.id === order.action.batchId);
    const matched = findTradeByTimeAndReason(batch?.[tradeKey], order);
    if (matched) return matched;
  }

  for (const batch of batches) {
    const matched = findTradeByTimeAndReason(batch[tradeKey], order);
    if (matched) return matched;
  }

  return null;
}

function findTradeByTimeAndReason(trades = [], order) {
  const exact = trades.find((trade) => trade.at === order.at && trade.reason === order.action.kind);
  if (exact) return exact;

  const orderTime = new Date(order.at).getTime();
  if (!Number.isFinite(orderTime)) return null;

  return (
    trades.find((trade) => {
      if (trade.reason !== order.action.kind) return false;
      const tradeTime = new Date(trade.at).getTime();
      return Number.isFinite(tradeTime) && Math.abs(tradeTime - orderTime) <= 5000;
    }) || null
  );
}

function recalculateBatches(batches) {
  for (const batch of batches) {
    const boughtQuantity = sum(batch.buys, "quantity");
    const boughtCost = (batch.buys || []).reduce((total, buy) => total + Number(buy.quantity || 0) * Number(buy.price || 0), 0);
    const soldQuantity = sum(batch.sells, "quantity");

    if (boughtQuantity > 0) {
      batch.averagePrice = cleanNumber(boughtCost / boughtQuantity);
    }

    if (batch.status === "OPEN") {
      batch.quantity = cleanNumber(Math.max(0, boughtQuantity - soldQuantity));
    } else {
      batch.dustQuantity = cleanNumber(Math.max(0, boughtQuantity - soldQuantity));
    }

    batch.updatedAt = latestAt(batch) || batch.updatedAt;
  }
}

function sum(items = [], key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function latestAt(batch) {
  const timestamps = [batch.updatedAt, ...(batch.buys || []).map((item) => item.at), ...(batch.sells || []).map((item) => item.at)]
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) return "";
  return new Date(Math.max(...timestamps)).toISOString();
}

function backupBatches(logDir) {
  const source = path.join(logDir, "batches.json");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const backupPath = path.join(logDir, `batches-reconcile-${stamp}.json`);
  fs.copyFileSync(source, backupPath);
  return backupPath;
}

function cleanNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(Number(value).toFixed(12));
}
