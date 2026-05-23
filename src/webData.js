import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openSqlite, sqlitePath } from "./sqliteStore.js";

const SAFE_SETTING_KEYS = [
  "INSTRUMENT",
  "BASE_ASSET",
  "QUOTE_ASSET",
  "LOG_DIR",
  "STRATEGY",
  "ORDER_MODE",
  "BATCH_QUANTITY",
  "AVERAGE_DOWN_QUANTITY",
  "MAX_BATCH_QUANTITY",
  "MAX_OPEN_BATCHES",
  "DAILY_BASE_BUY_LIMIT",
  "FORCE_BASE_BUY_WEEKLY_LIMIT",
  "BASE_BUY_COOLDOWN_MINUTES",
  "AVERAGE_DOWN_DROP_PCT",
  "TAKE_PROFIT_RISE_PCT",
  "BUY_BASE_BATCH_EVERY_RUN",
  "DUST_SELL_QUANTITY",
  "MIN_QUOTE_BALANCE",
  "MAX_SUSPICIOUS_PRICE_MOVE_PCT",
  "CHECK_INTERVAL_MINUTES",
  "DRY_RUN",
  "ENABLE_TRADING",
  "MAKER_BOOK_LEVEL",
  "MAKER_MAX_SPREAD_PCT",
  "MAKER_ORDER_TIMEOUT_MINUTES",
  "MAKER_REPRICE_AFTER_MINUTES"
];

const DEFAULT_PAIR_FILES = [".env.cro-usd", ".env.btc-usd"];
const DEFAULT_PAIRS = [
  { envFile: ".env.cro-usd", instrument: "CRO_USD", baseAsset: "CRO", quoteAsset: "USD", logDir: "logs/cro-usd" },
  { envFile: ".env.btc-usd", instrument: "BTC_USD", baseAsset: "BTC", quoteAsset: "USD", logDir: "logs/btc-usd" }
];

export function buildDashboardPayload(options = {}) {
  const pairs = discoverPairConfigs(options.envFiles).map((config) => buildPairPayload(config));
  const alerts = pairs.flatMap((pair) => pair.alerts.map((alert) => ({ ...alert, instrument: pair.instrument })));

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    pairs,
    totals: buildTotals(pairs),
    alerts,
    notes: [
      "Read-only dashboard. Web UI does not place orders, edit env files, restart services, or call Crypto.com API.",
      "Secrets such as API keys, email addresses, SMTP credentials and exact VPS IP are never included in this payload."
    ]
  };
}

function discoverPairConfigs(envFiles) {
  const requested = envFiles?.length
    ? envFiles
    : String(process.env.WEB_ENV_FILES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const files = requested.length ? requested : DEFAULT_PAIR_FILES.filter((file) => fs.existsSync(file));
  if (files.length) {
    return files.map((envFile) => configFromEnvFile(envFile));
  }

  return DEFAULT_PAIRS.map((pair) => ({
    ...pair,
    envFileExists: false,
    env: {},
    logDir: path.resolve(pair.logDir),
    safeSettings: defaultSafeSettings(pair)
  }));
}

function configFromEnvFile(envFile) {
  const env = readDotEnv(envFile);
  const instrument = env.INSTRUMENT || instrumentFromEnvFile(envFile);
  const fallback = DEFAULT_PAIRS.find((pair) => pair.instrument === instrument) || DEFAULT_PAIRS[0];
  const baseAsset = env.BASE_ASSET || fallback.baseAsset || instrument.split("_")[0] || "BTC";
  const quoteAsset = env.QUOTE_ASSET || fallback.quoteAsset || instrument.split("_")[1] || "USD";
  const logDir = path.resolve(env.LOG_DIR || fallback.logDir || `logs/${slugify(instrument)}`);

  return {
    envFile,
    envFileExists: fs.existsSync(envFile),
    env,
    instrument,
    baseAsset,
    quoteAsset,
    logDir,
    strategy: env.STRATEGY || "batches",
    dryRun: boolValue(env.DRY_RUN, true),
    enableTrading: boolValue(env.ENABLE_TRADING, false),
    takeProfitRisePct: numberValue(env.TAKE_PROFIT_RISE_PCT, 5),
    safeSettings: pickSafeSettings(env, { instrument, baseAsset, quoteAsset, logDir })
  };
}

function buildPairPayload(config) {
  const source = readPairSource(config);
  const batches = source.batches;
  const dustBank = source.dustBank;
  const snapshots = source.snapshots;
  const orderEvents = source.orderEvents;
  const reportData = buildReportData({ config, batches, dustBank, snapshots, orderEvents });
  const latest = reportData.latest;
  const serviceName = serviceNameForInstrument(config.instrument);
  const serviceActive = systemctlIsActive(serviceName);
  const snapshotAgeMinutes = latest?.at ? minutesSince(latest.at) : null;
  const safeSettings = {
    ...config.safeSettings,
    SERVICE_NAME: serviceName
  };

  const alerts = buildAlerts({ latest, snapshotAgeMinutes, serviceActive, serviceName, reportData, config });

  return {
    instrument: config.instrument,
    baseAsset: config.baseAsset,
    quoteAsset: config.quoteAsset,
    envFile: config.envFile,
    envFileExists: config.envFileExists,
    logDir: displayPath(config.logDir),
    dataSource: source.source,
    sqlitePath: source.sqlitePath ? displayPath(source.sqlitePath) : null,
    serviceName,
    serviceActive,
    status: statusFor({ latest, snapshotAgeMinutes, serviceActive, alerts }),
    latestSnapshotAt: latest?.at || null,
    snapshotAgeMinutes,
    lastPrice: reportData.lastPrice || 0,
    nextSellPrice: reportData.nextSellPrice,
    avgOpenPrice: reportData.avgOpenPrice || 0,
    portfolio: latest?.portfolio || null,
    openBatches: reportData.openBatches.length,
    closedBatches: reportData.closedBatches.length,
    totalOpenQuantity: reportData.totalOpenQuantity || 0,
    realizedCash: reportData.realizedCash || 0,
    realizedInclDust: reportData.realizedWithClosedDust || 0,
    unrealized: reportData.unrealized || 0,
    dustBankQuantity: Number(dustBank.quantity || 0),
    dustBankValue: reportData.dustBankValue || 0,
    feeStats: reportData.feeStats,
    feePeriodDaily: reportData.feePeriodStats?.daily?.slice(0, 20) || [],
    makerStats: reportData.makerStats,
    avgHoldingDays: averageHoldingDays(reportData.closedStats),
    todayRealizedPnl: todayRealizedPnl(reportData.dailySummaries),
    recentSnapshots: buildChartPoints(reportData.recentSnapshots, batches),
    openBatchRows: reportData.openBatches.slice(0, 50).map((batch) => openBatchRow(batch, reportData.lastPrice, config)),
    closedBatchRows: reportData.closedStats.slice(-50).reverse().map(closedBatchRow),
    recentOrders: reportData.recentOrders.slice(0, 25).map(orderRow),
    dailySummaries: reportData.dailySummaries.slice(0, 20),
    safeSettings,
    alerts
  };
}

function readPairSource(config) {
  const mode = String(process.env.WEB_DATA_SOURCE || "auto").toLowerCase();
  if (mode !== "logs") {
    const sqlite = readPairSourceSqlite(config);
    if (sqlite || mode === "sqlite") {
      return sqlite || readPairSourceLogs(config, "logs-fallback");
    }
  }
  return readPairSourceLogs(config, "logs");
}

function readPairSourceSqlite(config) {
  try {
    const db = openSqlite(config.logDir);
    if (!db) return null;
    const snapshots = db.prepare("SELECT snapshot_json FROM snapshots ORDER BY at").all().map((row) => JSON.parse(row.snapshot_json));
    if (!snapshots.length) return null;
    const orderEvents = db.prepare("SELECT event_json FROM order_events ORDER BY at, id").all().map((row) => JSON.parse(row.event_json));
    const batches = readStateFromDb(db, "batches", []);
    const dustBank = readStateFromDb(db, "dust_bank", { quantity: 0, entries: [], sells: [] });
    return {
      source: "sqlite",
      sqlitePath: sqlitePath(config.logDir),
      batches,
      dustBank,
      snapshots,
      orderEvents
    };
  } catch (error) {
    if (String(process.env.WEB_DATA_SOURCE || "auto").toLowerCase() === "sqlite") {
      console.error(`[web] sqlite source failed for ${config.instrument}: ${error.message}`);
    }
    return null;
  }
}

function readPairSourceLogs(config, source) {
  return {
    source,
    sqlitePath: null,
    batches: readJson(path.join(config.logDir, "batches.json"), []),
    dustBank: readJson(path.join(config.logDir, "dust-bank.json"), { quantity: 0, entries: [], sells: [] }),
    snapshots: readJsonl(path.join(config.logDir, "snapshots.jsonl")),
    orderEvents: readJsonl(path.join(config.logDir, "orders.jsonl"))
  };
}

function readStateFromDb(db, name, fallback) {
  const row = db.prepare("SELECT json FROM state WHERE name = ?").get(name);
  return row ? JSON.parse(row.json) : fallback;
}

function buildTotals(pairs) {
  return {
    portfolioValue: pairs.reduce((sum, pair) => sum + Number(pair.portfolio?.totalQuoteValue || 0), 0),
    todayRealizedPnl: pairs.reduce((sum, pair) => sum + Number(pair.todayRealizedPnl || 0), 0),
    realizedInclDust: pairs.reduce((sum, pair) => sum + Number(pair.realizedInclDust || 0), 0),
    unrealized: pairs.reduce((sum, pair) => sum + Number(pair.unrealized || 0), 0),
    openBatches: pairs.reduce((sum, pair) => sum + Number(pair.openBatches || 0), 0),
    closedBatches: pairs.reduce((sum, pair) => sum + Number(pair.closedBatches || 0), 0)
  };
}

function averageHoldingDays(closedStats) {
  const hours = closedStats
    .map((batch) => Number(batch.holdingHours))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!hours.length) return null;
  return hours.reduce((sum, value) => sum + value, 0) / hours.length / 24;
}

function todayRealizedPnl(dailySummaries) {
  const today = new Date().toISOString().slice(0, 10);
  const row = dailySummaries.find((item) => item.day === today);
  return row ? Number(row.realizedCash || 0) : 0;
}

function buildReportData({ config, batches, dustBank, snapshots, orderEvents }) {
  const openBatches = batches.filter((batch) => batch.status === "OPEN");
  const closedBatches = batches.filter((batch) => batch.status === "CLOSED");
  const latest = snapshots.at(-1) || null;
  const lastPrice = Number(latest?.price || 0);
  const realizedCash = closedBatches.reduce((sum, batch) => sum + realizedPnl(batch), 0);
  const closedBatchDustQuantity = closedBatches.reduce((sum, batch) => sum + Number(batch.dustQuantity || 0), 0);
  const realizedWithClosedDust = realizedCash + closedBatchDustQuantity * lastPrice;
  const unrealized = openBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0) * (lastPrice - Number(batch.averagePrice || 0)), 0);
  const totalOpenQuantity = openBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
  const totalOpenCost = openBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0) * Number(batch.averagePrice || 0), 0);
  const avgOpenPrice = totalOpenQuantity > 0 ? totalOpenCost / totalOpenQuantity : 0;
  const nextSellPrice = nextOpenBatchSellPrice(openBatches, config.takeProfitRisePct);
  const closedStats = buildClosedBatchStats(closedBatches, lastPrice);
  const orders = extractOrders({ snapshots, orderEvents });

  return {
    latest,
    lastPrice,
    openBatches,
    closedBatches,
    closedStats,
    recentSnapshots: snapshots.slice(-240),
    recentOrders: orders.slice(-50).reverse(),
    orders,
    makerStats: buildMakerOrderStats(orders),
    feeStats: buildFeeStats({ batches, orders, dustBank }),
    feePeriodStats: { daily: buildDailyFees({ batches, orders, dustBank }) },
    dailySummaries: buildDailySummaries(closedBatches, dustBank),
    realizedCash,
    realizedWithClosedDust,
    unrealized,
    totalOpenQuantity,
    avgOpenPrice,
    nextSellPrice,
    dustBankValue: Number(dustBank.quantity || 0) * lastPrice
  };
}

function realizedPnl(batch) {
  const buyCost = (batch.buys || []).reduce((sum, buy) => sum + Number(buy.quantity || 0) * Number(buy.price || 0), 0);
  const sellValue = (batch.sells || []).reduce((sum, sell) => sum + Number(sell.quantity || 0) * Number(sell.price || 0), 0);
  return sellValue - buyCost;
}

function buildClosedBatchStats(closedBatches, lastPrice) {
  return closedBatches.map((batch) => {
    const buyCost = (batch.buys || []).reduce((sum, buy) => sum + Number(buy.quantity || 0) * Number(buy.price || 0), 0);
    const sellValue = (batch.sells || []).reduce((sum, sell) => sum + Number(sell.quantity || 0) * Number(sell.price || 0), 0);
    const dustQuantity = Number(batch.dustQuantity || 0);
    const realized = sellValue - buyCost;
    const firstBuyAt = firstDate((batch.buys || []).map((buy) => buy.at).concat(batch.createdAt));
    const lastSellAt = lastDate((batch.sells || []).map((sell) => sell.at).concat(batch.closedAt));
    const holdingMs = firstBuyAt && lastSellAt ? lastSellAt.getTime() - firstBuyAt.getTime() : null;
    return {
      id: batch.id,
      closedAt: batch.closedAt || "",
      realizedPnl: realized,
      realizedPnlInclDust: realized + dustQuantity * lastPrice,
      realizedPctInclDust: buyCost > 0 ? ((realized + dustQuantity * lastPrice) / buyCost) * 100 : 0,
      dustQuantity,
      holdingHours: holdingMs === null ? null : holdingMs / 36e5,
      buys: (batch.buys || []).length,
      sells: (batch.sells || []).length
    };
  });
}

function nextOpenBatchSellPrice(openBatches, takeProfitRisePct) {
  const multiplier = 1 + Math.abs(Number(takeProfitRisePct || 0)) / 100;
  const prices = openBatches
    .map((batch) => Number(batch.averagePrice || 0) * multiplier)
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : null;
}

function buildDailySummaries(closedBatches, dustBank) {
  const rows = new Map();
  for (const batch of closedBatches) {
    const closedAt = batch.closedAt || (batch.sells || []).at(-1)?.at;
    if (!closedAt) continue;
    const day = closedAt.slice(0, 10);
    const row = rows.get(day) || { day, closedBatches: 0, realizedCash: 0, dustQuantity: 0, dustSoldQuantity: 0, dustSoldValue: 0 };
    row.closedBatches += 1;
    row.realizedCash += realizedPnl(batch);
    row.dustQuantity += Number(batch.dustQuantity || 0);
    rows.set(day, row);
  }
  for (const sell of dustBank.sells || []) {
    if (!sell.at) continue;
    const day = sell.at.slice(0, 10);
    const row = rows.get(day) || { day, closedBatches: 0, realizedCash: 0, dustQuantity: 0, dustSoldQuantity: 0, dustSoldValue: 0 };
    row.dustSoldQuantity += Number(sell.quantity || 0);
    row.dustSoldValue += Number(sell.quantity || 0) * Number(sell.price || 0);
    rows.set(day, row);
  }
  return Array.from(rows.values()).sort((a, b) => b.day.localeCompare(a.day));
}

function extractOrders({ snapshots, orderEvents }) {
  if (orderEvents.length) return extractOrdersFromLedger(orderEvents);
  return snapshots.flatMap((snapshot) => (snapshot.orderResults || []).map((result) => ({
    at: result.fill?.executedAt || result.fill?.orderCreatedAt || snapshot.at,
    instrument: snapshot.instrument,
    kind: result.action?.kind || "",
    side: result.action?.order?.side || "",
    orderType: result.action?.order?.type || "",
    limitPrice: Number(result.action?.order?.price || 0),
    fillStatus: result.fill?.status || result.orderDetail?.status || "",
    batchId: result.action?.batchId || "",
    quantity: Number(result.fill?.quantity ?? result.action?.order?.quantity ?? 0),
    price: Number(result.fill?.price || 0),
    fee: extractFee(result),
    skipped: Boolean(result.skipped),
    orderId: result.fill?.orderId || result.orderDetail?.orderId || result.orderResult?.result?.order_id || ""
  })));
}

function extractOrdersFromLedger(orderEvents) {
  return orderEvents
    .filter((event) => event?.action?.order && (event.fill || event.status))
    .map((event) => {
      const action = event.action || {};
      const order = action.order || {};
      const fill = event.fill || {};
      const orderDetail = event.orderDetail || {};
      return {
        at: fill.executedAt || fill.orderCreatedAt || event.at,
        instrument: event.instrument || order.instrument_name || "",
        kind: action.kind || "",
        side: order.side || "",
        orderType: order.type || "",
        limitPrice: Number(order.price || 0),
        fillStatus: fill.status || event.status || "",
        batchId: action.batchId || "",
        quantity: Number(fill.quantity || 0),
        price: Number(fill.price || 0),
        fee: fill.fee || extractFee({ fill, orderDetail }),
        skipped: false,
        orderId: fill.orderId || orderDetail.orderId || event.orderId || ""
      };
    })
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

function buildMakerOrderStats(orders) {
  const makerOrders = orders.filter((order) => String(order.orderType).toUpperCase() === "LIMIT");
  const filled = makerOrders.filter((order) => String(order.fillStatus).toUpperCase().includes("FILLED")).length;
  const canceled = makerOrders.filter((order) => String(order.fillStatus).toUpperCase().includes("CANCEL")).length;
  const active = makerOrders.filter((order) => String(order.fillStatus).toUpperCase().includes("ACTIVE")).length;
  return {
    total: makerOrders.length,
    filled,
    canceled,
    active,
    fillRatePct: makerOrders.length ? (filled / makerOrders.length) * 100 : 0,
    cancelRatePct: makerOrders.length ? (canceled / makerOrders.length) * 100 : 0
  };
}

function buildFeeStats({ batches, orders, dustBank }) {
  const byCurrency = new Map();
  for (const item of collectFeeItems({ batches, orders, dustBank })) {
    if (!Number.isFinite(item.amount) || item.amount === 0) continue;
    const currency = item.currency || "UNKNOWN";
    const row = byCurrency.get(currency) || { currency, amount: 0, count: 0 };
    row.amount += Math.abs(item.amount);
    row.count += 1;
    byCurrency.set(currency, row);
  }
  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

function buildDailyFees({ batches, orders, dustBank }) {
  const rows = new Map();
  for (const item of collectFeeItems({ batches, orders, dustBank })) {
    if (!item.at || !Number.isFinite(item.amount) || item.amount === 0) continue;
    const period = item.at.slice(0, 10);
    const currency = item.currency || "UNKNOWN";
    const key = `${period}|${currency}`;
    const row = rows.get(key) || { period, currency, amount: 0, count: 0 };
    row.amount += Math.abs(item.amount);
    row.count += 1;
    rows.set(key, row);
  }
  return Array.from(rows.values()).sort((a, b) => b.period.localeCompare(a.period) || a.currency.localeCompare(b.currency));
}

function collectFeeItems({ batches, orders, dustBank }) {
  const items = [];
  for (const batch of batches) {
    for (const trade of [...(batch.buys || []), ...(batch.sells || [])]) addFeeIfPresent(items, trade);
  }
  for (const order of orders) addFeeIfPresent(items, { ...order.fee, at: order.at, orderId: order.orderId });
  for (const entry of [...(dustBank.entries || []), ...(dustBank.sells || [])]) addFeeIfPresent(items, entry);
  return uniqueFeeItems(items);
}

function addFeeIfPresent(items, source) {
  if (!source) return;
  const amount = source.amount ?? source.feeAmount ?? source.fee_amount ?? source.fee;
  const currency = source.currency ?? source.feeCurrency ?? source.fee_currency;
  if (amount !== undefined) {
    items.push({ amount: Number(amount), currency, at: source.at || "", orderId: source.orderId || "" });
  }
}

function uniqueFeeItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.orderId
      ? `${item.orderId}|${item.currency}|${Math.abs(item.amount)}`
      : `${item.at}|${item.currency}|${Math.abs(item.amount)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractFee(result) {
  const candidates = [result.fill, result.fill?.fee, result.orderDetail, result.orderResult?.result, result.orderResult?.result?.data];
  for (const candidate of candidates) {
    const amount = candidate?.feeAmount ?? candidate?.fee_amount ?? candidate?.fee ?? candidate?.cumulativeFee;
    if (amount !== undefined) {
      return { amount: Number(amount), currency: candidate?.feeCurrency ?? candidate?.fee_currency ?? candidate?.fee_ccy ?? candidate?.currency ?? "" };
    }
  }
  return null;
}

function firstDate(values) {
  const dates = values.map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
}

function lastDate(values) {
  const dates = values.map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

function buildAlerts({ latest, snapshotAgeMinutes, serviceActive, serviceName, reportData, config }) {
  const alerts = [];
  if (!latest) alerts.push({ level: "warn", title: "Missing snapshot", text: "No snapshots.jsonl data found yet." });
  if (snapshotAgeMinutes !== null && snapshotAgeMinutes > maxSnapshotAgeMinutes()) {
    alerts.push({ level: "warn", title: "Old bot run", text: `Last snapshot is ${snapshotAgeMinutes.toFixed(1)} minutes old.` });
  }
  if (serviceActive === false) {
    alerts.push({ level: "error", title: "Service inactive", text: `${serviceName} is not active.` });
  }
  if (!config.envFileExists) {
    alerts.push({ level: "info", title: "Env file not found", text: `${config.envFile} is missing. Showing fallback pair shell.` });
  }
  if (reportData.openBatches.length && Number(config.env.MAX_OPEN_BATCHES || 0) > 0) {
    const max = Number(config.env.MAX_OPEN_BATCHES);
    const usage = reportData.openBatches.length / max;
    if (usage >= 0.8) alerts.push({ level: "warn", title: "Open batch limit near", text: `${reportData.openBatches.length} / ${max} open batches.` });
  }
  return alerts;
}

function statusFor({ latest, snapshotAgeMinutes, serviceActive, alerts }) {
  if (alerts.some((alert) => alert.level === "error")) return "error";
  if (!latest || (snapshotAgeMinutes !== null && snapshotAgeMinutes > maxSnapshotAgeMinutes())) return "warn";
  if (serviceActive === false) return "error";
  if (alerts.some((alert) => alert.level === "warn")) return "warn";
  return "running";
}

function openBatchRow(batch, lastPrice, config) {
  const quantity = Number(batch.quantity || 0);
  const averagePrice = Number(batch.averagePrice || 0);
  return {
    id: batch.id,
    createdAt: batch.createdAt || "",
    quantity,
    averagePrice,
    nextSellPrice: averagePrice * (1 + Math.abs(Number(config.takeProfitRisePct || 0)) / 100),
    unrealized: quantity * (Number(lastPrice || 0) - averagePrice),
    buys: (batch.buys || []).length,
    sells: (batch.sells || []).length
  };
}

function closedBatchRow(batch) {
  return {
    id: batch.id,
    closedAt: batch.closedAt || "",
    realizedPnl: batch.realizedPnl || 0,
    realizedPnlInclDust: batch.realizedPnlInclDust || 0,
    realizedPctInclDust: batch.realizedPctInclDust || 0,
    dustQuantity: batch.dustQuantity || 0,
    holdingHours: batch.holdingHours,
    buys: batch.buys,
    sells: batch.sells
  };
}

function orderRow(order) {
  return {
    at: order.at,
    kind: order.kind,
    side: order.side,
    orderType: order.orderType,
    fillStatus: order.fillStatus,
    batchId: order.batchId,
    quantity: order.quantity,
    price: order.price,
    limitPrice: order.limitPrice,
    fee: order.fee,
    skipped: order.skipped,
    orderId: order.orderId
  };
}

function buildChartPoints(snapshots, batches) {
  const points = snapshots.map((snapshot) => ({
    at: snapshot.at,
    price: snapshot.price,
    buyCount: 0,
    sellCount: 0,
    orderCount: 0
  }));
  const pointTimes = points.map((point) => new Date(point.at).getTime());
  if (!points.length) return points;

  for (const marker of batchTradeMarkers(batches)) {
    const markerTime = new Date(marker.at).getTime();
    if (!Number.isFinite(markerTime)) continue;
    const index = nearestPointIndex(pointTimes, markerTime);
    if (index === -1) continue;
    const distanceMs = Math.abs(pointTimes[index] - markerTime);
    if (distanceMs > 3 * 60 * 60 * 1000) continue;
    if (marker.side === "BUY") points[index].buyCount += 1;
    if (marker.side === "SELL") points[index].sellCount += 1;
    points[index].orderCount = points[index].buyCount + points[index].sellCount;
  }

  return points;
}

function batchTradeMarkers(batches) {
  const markers = [];
  for (const batch of batches || []) {
    for (const buy of batch.buys || []) {
      if (Number(buy.quantity || 0) > 0 && Number(buy.price || 0) > 0) {
        markers.push({ at: buy.at || batch.createdAt, side: "BUY" });
      }
    }
    for (const sell of batch.sells || []) {
      if (Number(sell.quantity || 0) > 0 && Number(sell.price || 0) > 0) {
        markers.push({ at: sell.at || batch.closedAt, side: "SELL" });
      }
    }
  }
  return markers;
}

function nearestPointIndex(times, timestamp) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (!Number.isFinite(time)) continue;
    const distance = Math.abs(time - timestamp);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function pickSafeSettings(env, defaults) {
  const result = {};
  for (const key of SAFE_SETTING_KEYS) {
    if (key === "INSTRUMENT") result[key] = defaults.instrument;
    else if (key === "BASE_ASSET") result[key] = defaults.baseAsset;
    else if (key === "QUOTE_ASSET") result[key] = defaults.quoteAsset;
    else if (key === "LOG_DIR") result[key] = displayPath(defaults.logDir);
    else if (env[key] !== undefined) result[key] = env[key];
  }
  return result;
}

function defaultSafeSettings(pair) {
  return pickSafeSettings({}, {
    instrument: pair.instrument,
    baseAsset: pair.baseAsset,
    quoteAsset: pair.quoteAsset,
    logDir: path.resolve(pair.logDir)
  });
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key) env[key] = value;
  }
  return env;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function systemctlIsActive(serviceName) {
  if (process.platform === "win32") return null;
  const result = spawnSync("systemctl", ["is-active", "--quiet", serviceName], { stdio: "ignore" });
  return result.status === 0;
}

function serviceNameForInstrument(instrument) {
  if (instrument === "CRO_USD") return "ccom-updown.service";
  if (instrument === "BTC_USD") return "ccom-updown-btc.service";
  return `ccom-updown-${slugify(instrument)}.service`;
}

function instrumentFromEnvFile(envFile) {
  const slug = slugify(envFile);
  if (slug.includes("cro")) return "CRO_USD";
  if (slug.includes("btc")) return "BTC_USD";
  return "BTC_USD";
}

function boolValue(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function minutesSince(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Number(((Date.now() - timestamp) / 60000).toFixed(1));
}

function maxSnapshotAgeMinutes() {
  return numberValue(process.env.WEB_MAX_SNAPSHOT_AGE_MINUTES, 90);
}

function displayPath(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
