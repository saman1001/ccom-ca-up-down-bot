import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);

export function generateReport(options = {}) {
  const config = options.config || loadConfig();
  const logDir = config.logDir;
  const reportDir = path.resolve("reports");
  const reportName = `${slugify(config.instrument)}-dashboard.html`;
  const reportPath = path.join(reportDir, reportName);
  const batchesCsvPath = path.join(reportDir, `${slugify(config.instrument)}-batches.csv`);
  const ordersCsvPath = path.join(reportDir, `${slugify(config.instrument)}-orders.csv`);
  const dailyCsvPath = path.join(reportDir, `${slugify(config.instrument)}-daily.csv`);
  const indexPath = path.join(reportDir, "index.html");

  const batches = readJson(path.join(logDir, "batches.json"), []);
  const dustBank = readJson(path.join(logDir, "dust-bank.json"), { quantity: 0, entries: [], sells: [] });
  const snapshots = readJsonl(path.join(logDir, "snapshots.jsonl"));
  const data = buildReportData({ config, batches, dustBank, snapshots });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, renderDashboard(data), "utf8");
  fs.writeFileSync(batchesCsvPath, renderBatchesCsv(data), "utf8");
  fs.writeFileSync(ordersCsvPath, renderOrdersCsv(data), "utf8");
  fs.writeFileSync(dailyCsvPath, renderDailyCsv(data), "utf8");
  writeReportIndex(reportDir, indexPath);

  const result = {
    reportPath,
    batchesCsvPath,
    ordersCsvPath,
    dailyCsvPath,
    indexPath
  };

  if (!options.quiet) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

function buildReportData({ config, batches, dustBank, snapshots }) {
  const openBatches = batches.filter((batch) => batch.status === "OPEN");
  const closedBatches = batches.filter((batch) => batch.status === "CLOSED");
  const latest = snapshots.at(-1) || null;
  const lastPrice = latest?.price ?? 0;
  const closedBatchDustQuantity = closedBatches.reduce((sum, batch) => sum + Number(batch.dustQuantity || 0), 0);
  const closedBatchDustValue = closedBatchDustQuantity * lastPrice;
  const dustBankValue = (dustBank.quantity || 0) * lastPrice;
  const realizedCash = closedBatches.reduce((sum, batch) => sum + realizedPnl(batch), 0);
  const realizedWithClosedDust = realizedCash + closedBatchDustValue;
  const unrealized = openBatches.reduce((sum, batch) => {
    return sum + batch.quantity * (lastPrice - batch.averagePrice);
  }, 0);
  const totalOpenQuantity = openBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  const totalOpenCost = openBatches.reduce((sum, batch) => sum + batch.quantity * batch.averagePrice, 0);
  const avgOpenPrice = totalOpenQuantity > 0 ? totalOpenCost / totalOpenQuantity : 0;
  const closedStats = buildClosedBatchStats(closedBatches);
  const dailySummaries = buildDailySummaries(closedBatches, dustBank);
  const orders = extractOrders(snapshots);
  const feeStats = buildFeeStats({ batches, orders, dustBank });
  const annualizedStats = buildAnnualizedStats({ closedStats, dustBank });
  const recentSnapshots = snapshots.slice(-240);
  const recentOrders = orders.slice(-50).reverse();
  const rankedClosedBatches = closedStats
    .slice()
    .sort((a, b) => b.realizedPnl - a.realizedPnl);

  return {
    config,
    batches,
    openBatches,
    closedBatches,
    closedStats,
    rankedClosedBatches,
    dailySummaries,
    dustBank,
    snapshots,
    latest,
    lastPrice,
    realizedCash,
    realizedWithClosedDust,
    closedBatchDustQuantity,
    closedBatchDustValue,
    dustBankValue,
    unrealized,
    totalOpenQuantity,
    avgOpenPrice,
    recentSnapshots,
    recentOrders,
    orders,
    feeStats,
    annualizedStats,
    dashboardTitle: `${config.instrument} Bot Dashboard`
  };
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function realizedPnl(batch) {
  const buyCost = (batch.buys || []).reduce((sum, buy) => sum + Number(buy.quantity || 0) * Number(buy.price || 0), 0);
  const sellValue = (batch.sells || []).reduce((sum, sell) => sum + Number(sell.quantity || 0) * Number(sell.price || 0), 0);
  return sellValue - buyCost;
}

function buildClosedBatchStats(closedBatches) {
  return closedBatches.map((batch) => {
    const buyCost = (batch.buys || []).reduce((sum, buy) => sum + Number(buy.quantity || 0) * Number(buy.price || 0), 0);
    const sellValue = (batch.sells || []).reduce((sum, sell) => sum + Number(sell.quantity || 0) * Number(sell.price || 0), 0);
    const firstBuyAt = firstDate((batch.buys || []).map((buy) => buy.at).concat(batch.createdAt));
    const lastSellAt = lastDate((batch.sells || []).map((sell) => sell.at).concat(batch.closedAt));
    const realized = sellValue - buyCost;
    const holdingMs = firstBuyAt && lastSellAt ? lastSellAt.getTime() - firstBuyAt.getTime() : null;
    return {
      id: batch.id,
      quantity: Number(batch.quantity || 0),
      averagePrice: Number(batch.averagePrice || 0),
      buyCost,
      sellValue,
      realizedPnl: realized,
      realizedPct: buyCost > 0 ? (realized / buyCost) * 100 : 0,
      dustQuantity: Number(batch.dustQuantity || 0),
      createdAt: batch.createdAt || "",
      closedAt: batch.closedAt || "",
      holdingMs,
      holdingHours: holdingMs === null ? null : holdingMs / 36e5,
      annualizedPct: annualizedPct({ profit: realized, capital: buyCost, holdingMs }),
      buys: (batch.buys || []).length,
      sells: (batch.sells || []).length
    };
  });
}

function buildAnnualizedStats({ closedStats, dustBank }) {
  const batchCapitalYears = closedStats.reduce((sum, batch) => {
    return sum + capitalYears(batch.buyCost, batch.holdingMs);
  }, 0);
  const batchProfit = closedStats.reduce((sum, batch) => sum + batch.realizedPnl, 0);
  const dust = buildSoldDustStats(dustBank);
  const totalCapitalYears = batchCapitalYears + dust.capitalYears;
  const profitInclSoldDust = batchProfit + dust.soldValue;

  return {
    batchProfit,
    batchCapitalYears,
    batchAnnualizedPct: ratePct(batchProfit, batchCapitalYears),
    soldDustValue: dust.soldValue,
    soldDustCapitalYears: dust.capitalYears,
    profitInclSoldDust,
    totalCapitalYears,
    annualizedInclSoldDustPct: ratePct(profitInclSoldDust, totalCapitalYears)
  };
}

function buildSoldDustStats(dustBank) {
  const lots = (dustBank.entries || [])
    .map((entry) => ({
      remaining: Number(entry.quantity || 0),
      price: Number(entry.price || 0),
      at: entry.at
    }))
    .filter((lot) => lot.remaining > 0);
  let soldValue = 0;
  let dustCapitalYears = 0;

  for (const sell of dustBank.sells || []) {
    let quantityToAllocate = Number(sell.quantity || 0);
    const sellPrice = Number(sell.price || 0);
    const soldAt = sell.at;
    if (!Number.isFinite(quantityToAllocate) || quantityToAllocate <= 0) continue;
    soldValue += quantityToAllocate * sellPrice;

    for (const lot of lots) {
      if (quantityToAllocate <= 0) break;
      if (lot.remaining <= 0) continue;
      const quantity = Math.min(lot.remaining, quantityToAllocate);
      const capital = quantity * lot.price;
      dustCapitalYears += capitalYearsBetween(capital, lot.at, soldAt);
      lot.remaining -= quantity;
      quantityToAllocate -= quantity;
    }
  }

  return {
    soldValue,
    capitalYears: dustCapitalYears
  };
}

function buildDailySummaries(closedBatches, dustBank) {
  const rows = new Map();
  for (const batch of closedBatches) {
    const closedAt = batch.closedAt || (batch.sells || []).at(-1)?.at;
    if (!closedAt) continue;
    const day = closedAt.slice(0, 10);
    const row = ensureDailyRow(rows, day);
    row.closedBatches += 1;
    row.realizedCash += realizedPnl(batch);
    row.dustQuantity += Number(batch.dustQuantity || 0);
  }
  for (const sell of dustBank.sells || []) {
    if (!sell.at) continue;
    const row = ensureDailyRow(rows, sell.at.slice(0, 10));
    row.dustSoldQuantity += Number(sell.quantity || 0);
    row.dustSoldValue += Number(sell.quantity || 0) * Number(sell.price || 0);
  }
  return Array.from(rows.values()).sort((a, b) => b.day.localeCompare(a.day));
}

function ensureDailyRow(rows, day) {
  if (!rows.has(day)) {
    rows.set(day, {
      day,
      closedBatches: 0,
      realizedCash: 0,
      dustQuantity: 0,
      dustSoldQuantity: 0,
      dustSoldValue: 0
    });
  }
  return rows.get(day);
}

function extractOrders(snapshots) {
  return snapshots
    .flatMap((snapshot) => {
      return (snapshot.orderResults || []).map((result) => ({
        at: snapshot.at,
        instrument: snapshot.instrument,
        kind: result.action?.kind || "",
        side: result.action?.order?.side || "",
        batchId: result.action?.batchId || "",
        quantity: Number(result.fill?.quantity ?? result.action?.order?.quantity ?? 0),
        price: Number(result.fill?.price ?? snapshot.price ?? 0),
        baseDelta: Number(result.fill?.baseDelta ?? 0),
        quoteDelta: Number(result.fill?.quoteDelta ?? 0),
        fee: extractFee(result),
        skipped: result.skipped || false,
        orderId: result.orderResult?.result?.order_id || ""
      }));
    });
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

function collectFeeItems({ batches, orders, dustBank }) {
  const items = [];
  for (const batch of batches) {
    for (const trade of [...(batch.buys || []), ...(batch.sells || [])]) {
      addFeeIfPresent(items, trade);
    }
  }
  for (const order of orders) {
    addFeeIfPresent(items, order.fee);
  }
  for (const entry of [...(dustBank.entries || []), ...(dustBank.sells || [])]) {
    addFeeIfPresent(items, entry);
  }
  return items;
}

function addFeeIfPresent(items, source) {
  if (!source) return;
  if (source.amount !== undefined && source.currency !== undefined) {
    items.push({ amount: Number(source.amount), currency: source.currency });
    return;
  }
  const amount = source.feeAmount ?? source.fee_amount ?? source.fee;
  const currency = source.feeCurrency ?? source.fee_currency ?? source.currency;
  if (amount !== undefined) {
    items.push({ amount: Number(amount), currency });
  }
}

function extractFee(result) {
  const candidates = [
    result.fill,
    result.orderResult?.result,
    result.orderResult?.result?.data,
    result.orderResult?.result?.order_info
  ];
  for (const candidate of candidates) {
    const amount = candidate?.feeAmount ?? candidate?.fee_amount ?? candidate?.fee;
    if (amount !== undefined) {
      return {
        amount: Number(amount),
        currency: candidate?.feeCurrency ?? candidate?.fee_currency ?? candidate?.fee_ccy ?? candidate?.currency ?? ""
      };
    }
  }
  return null;
}

function renderDashboard(data) {
  const {
    config,
    dashboardTitle,
    latest,
    openBatches,
    closedStats,
    rankedClosedBatches,
    dailySummaries,
    dustBank,
    lastPrice,
    realizedCash,
    realizedWithClosedDust,
    dustBankValue,
    unrealized,
    totalOpenQuantity,
    avgOpenPrice,
    recentSnapshots,
    recentOrders,
    feeStats,
    annualizedStats
  } = data;
  const chartData = recentSnapshots.map((snapshot) => ({
    at: snapshot.at,
    price: snapshot.price,
    orders: (snapshot.orderResults || [])
      .filter((result) => result.action?.order && !result.skipped)
      .map((result) => ({
        kind: result.action?.kind,
        side: result.action?.order?.side,
        quantity: result.fill?.quantity ?? Number(result.action?.order?.quantity),
        price: result.fill?.price ?? snapshot.price,
        batchId: result.action?.batchId
      }))
  }));
  const avgHoldingHours = average(closedStats.map((batch) => batch.holdingHours).filter((value) => value !== null));
  const bestBatch = rankedClosedBatches[0] || null;
  const worstBatch = rankedClosedBatches.at(-1) || null;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(dashboardTitle)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #687386;
      --line: #d9dee7;
      --green: #087f5b;
      --red: #c92a2a;
      --blue: #1c5d99;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    header, main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    header { padding-bottom: 8px; }
    h1 { margin: 0 0 6px; font-size: 28px; font-weight: 750; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    .muted { color: var(--muted); }
    .grid { display: grid; gap: 14px; }
    .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .metric, section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .metric .value { margin-top: 8px; font-size: 24px; font-weight: 740; }
    .pos { color: var(--green); }
    .neg { color: var(--red); }
    .two { grid-template-columns: 1.4fr .9fr; align-items: start; }
    canvas { width: 100%; height: 320px; display: block; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
    th { color: var(--muted); font-weight: 650; }
    .scroll { overflow-x: auto; }
    @media (max-width: 900px) {
      header, main { padding: 16px; }
      .metrics, .two { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(dashboardTitle)}</h1>
    <div class="muted">Generated ${escapeHtml(new Date().toISOString())}. Latest bot tick: ${escapeHtml(latest?.at || "none")}.</div>
  </header>
  <main class="grid">
    <div class="grid metrics">
      ${metric("Portfolio", latest ? money(latest.portfolio?.totalQuoteValue || 0) : "-")}
      ${metric("Open Batches", String(openBatches.length))}
      ${metric(`Open ${config.baseAsset}`, fmt(totalOpenQuantity, 4))}
      ${metric("Avg Open Price", avgOpenPrice ? money(avgOpenPrice) : "-")}
      ${metric(`${config.quoteAsset} Balance`, latest ? money(latest.portfolio?.quoteTotal || 0) : "-")}
      ${metric(`${config.baseAsset} Balance`, latest ? fmt(latest.portfolio?.baseTotal || 0, 4) : "-")}
      ${metric("Dust Bank", fmt(dustBank.quantity || 0, 8))}
      ${metric("Dust Value", money(dustBankValue))}
      ${metric("Realized Cash P/L", money(realizedCash), realizedCash)}
      ${metric("Realized Incl. Dust", money(realizedWithClosedDust), realizedWithClosedDust)}
      ${metric("Unrealized P/L", money(unrealized), unrealized)}
      ${metric("Avg Holding", avgHoldingHours === null ? "-" : duration(avgHoldingHours * 36e5))}
      ${metric("P/L p.a.", pct(annualizedStats.batchAnnualizedPct), annualizedStats.batchAnnualizedPct)}
      ${metric("P/L p.a. Incl. Sold Dust", pct(annualizedStats.annualizedInclSoldDustPct), annualizedStats.annualizedInclSoldDustPct)}
      ${metric("Best Batch", bestBatch ? money(bestBatch.realizedPnl) : "-")}
      ${metric("Worst Batch", worstBatch ? money(worstBatch.realizedPnl) : "-")}
      ${metric("Fee Rows", String(feeStats.reduce((sum, row) => sum + row.count, 0)))}
    </div>

    <section>
      <h2>Price, Buys And Sells</h2>
      <canvas id="chart" width="1100" height="320"></canvas>
    </section>

    <div class="grid two">
      <section>
        <h2>Annualized P/L</h2>
        <div class="scroll">${table(["Metric", "Value"], [
          ["Closed batch profit", money(annualizedStats.batchProfit)],
          ["Closed batch capital-years", fmt(annualizedStats.batchCapitalYears, 6)],
          ["Closed batch P/L p.a.", pct(annualizedStats.batchAnnualizedPct)],
          ["Sold dust proceeds", money(annualizedStats.soldDustValue)],
          ["Sold dust capital-years", fmt(annualizedStats.soldDustCapitalYears, 6)],
          ["P/L p.a. incl. sold dust", pct(annualizedStats.annualizedInclSoldDustPct)]
        ])}</div>
      </section>
      <section>
        <h2>Daily Summary</h2>
        <div class="scroll">${table(["Day", "Closed", "Realized", "Dust", "Dust Sold"], dailySummaries.slice(0, 30).map((row) => [
          row.day,
          row.closedBatches,
          money(row.realizedCash),
          fmt(row.dustQuantity, 8),
          money(row.dustSoldValue)
        ]))}</div>
      </section>
      <section>
        <h2>Fee Summary</h2>
        <div class="scroll">${feeStats.length ? table(["Currency", "Amount", "Rows"], feeStats.map((row) => [
          row.currency,
          fmt(row.amount, 8),
          row.count
        ])) : `<div class="muted">No fee rows found in logs yet. Exact fee reporting needs trade/order-detail data in snapshots or batches.</div>`}</div>
      </section>
    </div>

    <div class="grid two">
      <section>
        <h2>Best Closed Batches</h2>
        <div class="scroll">${closedBatchTable(rankedClosedBatches.slice(0, 10))}</div>
      </section>
      <section>
        <h2>Worst Closed Batches</h2>
        <div class="scroll">${closedBatchTable(rankedClosedBatches.slice(-10).reverse())}</div>
      </section>
    </div>

    <div class="grid two">
      <section>
        <h2>Open Batches</h2>
        <div class="scroll">
          ${table(["ID", "Qty", "Avg Price", "P/L", "Created", "Buys"], openBatches.slice().reverse().map((batch) => {
            const pnl = batch.quantity * (lastPrice - batch.averagePrice);
            return [
              batch.id,
              fmt(batch.quantity, 8),
              money(batch.averagePrice),
              signedMoney(pnl),
              batch.createdAt,
              (batch.buys || []).length
            ];
          }))}
        </div>
      </section>
      <section>
        <h2>Recent Orders</h2>
        <div class="scroll">${table(["Time", "Kind", "Side", "Qty", "Price"], recentOrders.map((order) => [
          order.at,
          order.kind || "-",
          order.side || "-",
          fmt(order.quantity || 0, 8),
          order.price ? money(order.price) : "-"
        ]))}</div>
      </section>
    </div>
  </main>
  <script>
    const data = ${JSON.stringify(chartData)};
    const canvas = document.getElementById("chart");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const times = data.map(point => new Date(point.at).getTime()).filter(value => Number.isFinite(value));
    const prices = data.map(point => point.price).filter(value => Number.isFinite(value));
    const priceDigits = prices.length ? Math.max(...prices.map(price => ("$" + price.toFixed(5)).length)) : 8;
    const pad = { left: Math.max(76, priceDigits * 8 + 18), right: 22, top: 30, bottom: 64 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const pricePad = Math.max((maxPrice - minPrice) * 0.08, maxPrice * 0.001);
    const yMin = minPrice - pricePad;
    const yMax = maxPrice + pricePad;
    const ySpan = yMax - yMin || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "12px system-ui";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;

    if (data.length) {
      for (let i = 0; i <= 5; i++) {
        const y = pad.top + (plotH * i) / 5;
        const value = yMax - (ySpan * i) / 5;
        ctx.strokeStyle = "#d9dee7";
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillStyle = "#687386";
        ctx.textAlign = "right";
        ctx.fillText("$" + value.toFixed(5), pad.left - 10, y);
      }
      drawTimeAxis();
      drawPriceLine();
      drawOrderMarkers();
    }

    ctx.strokeStyle = "#17202a";
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1c5d99";
    ctx.fillText("${escapeJs(config.instrument)}", pad.left, 18);
    drawLegendMarker(pad.left + 104, 18, "#087f5b", "BUY");
    drawLegendMarker(pad.left + 168, 18, "#c92a2a", "SELL");

    function drawPriceLine() {
      ctx.strokeStyle = "#1c5d99";
      ctx.lineWidth = 2;
      ctx.beginPath();
      data.forEach((point, index) => {
        const x = xForTime(new Date(point.at).getTime());
        const y = yForPrice(point.price);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    function drawTimeAxis() {
      const ticks = Math.min(5, Math.max(2, data.length));
      ctx.fillStyle = "#687386";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = "11px system-ui";
      for (let i = 0; i < ticks; i++) {
        const ratio = ticks === 1 ? 0 : i / (ticks - 1);
        const time = minTime + (maxTime - minTime) * ratio;
        const x = xForTime(time);
        const date = new Date(time);
        const label = date.toLocaleString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });
        ctx.strokeStyle = "#d9dee7";
        ctx.beginPath();
        ctx.moveTo(x, h - pad.bottom);
        ctx.lineTo(x, h - pad.bottom + 5);
        ctx.stroke();
        ctx.textAlign = i === 0 ? "left" : i === ticks - 1 ? "right" : "center";
        ctx.fillText(label, x, h - pad.bottom + 9);
      }
      ctx.font = "12px system-ui";
    }

    function drawOrderMarkers() {
      data.forEach((point) => {
        const orders = point.orders || [];
        if (!orders.length) return;
        const buyCount = orders.filter(order => order.side === "BUY").length;
        const sellCount = orders.filter(order => order.side === "SELL").length;
        const x = xForTime(new Date(point.at).getTime());
        const y = yForPrice(point.price);
        if (buyCount) drawMarkerCluster({ x, y: y + 13, color: "#087f5b", direction: "up", label: markerLabel(orders, "BUY") });
        if (sellCount) drawMarkerCluster({ x, y: y - 13, color: "#c92a2a", direction: "down", label: markerLabel(orders, "SELL") });
      });
    }

    function drawMarkerCluster({ x, y, color, direction, label }) {
      ctx.fillStyle = color;
      ctx.beginPath();
      if (direction === "up") {
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x - 6, y + 5);
        ctx.lineTo(x + 6, y + 5);
      } else {
        ctx.moveTo(x, y + 7);
        ctx.lineTo(x - 6, y - 5);
        ctx.lineTo(x + 6, y - 5);
      }
      ctx.closePath();
      ctx.fill();
      if (!label) return;
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = direction === "up" ? "top" : "bottom";
      ctx.fillText(label, x, direction === "up" ? y + 8 : y - 8);
      ctx.font = "12px system-ui";
    }

    function markerLabel(orders, side) {
      const selected = orders.filter(order => order.side === side);
      if (!selected.length) return "";
      const kinds = new Map();
      selected.forEach(order => kinds.set(order.kind, (kinds.get(order.kind) || 0) + 1));
      if (selected.length === 1) return selected[0].kind === "BASE_BUY" ? "B" : selected[0].kind === "AVERAGE_DOWN" ? "D" : "S";
      return Array.from(kinds.entries()).map(([kind, count]) => {
        const short = kind === "BASE_BUY" ? "B" : kind === "AVERAGE_DOWN" ? "D" : kind === "TAKE_PROFIT" ? "S" : kind === "DUST_SELL" ? "DS" : kind;
        return count > 1 ? count + short : short;
      }).join("+");
    }

    function drawLegendMarker(x, y, color, label) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#687386";
      ctx.fillText(label, x + 8, y);
    }

    function xForTime(time) {
      return pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * plotW;
    }

    function yForPrice(price) {
      return pad.top + ((yMax - price) / ySpan) * plotH;
    }
  </script>
</body>
</html>`;
}

function renderBatchesCsv(data) {
  return csv([
    ["id", "status", "quantity", "average_price", "realized_pnl", "realized_pct", "annualized_pct", "dust_quantity", "created_at", "closed_at", "holding_hours", "buys", "sells"],
    ...data.batches.map((batch) => {
      const closed = data.closedStats.find((item) => item.id === batch.id);
      return [
        batch.id,
        batch.status,
        batch.quantity,
        batch.averagePrice,
        closed?.realizedPnl ?? "",
        closed?.realizedPct ?? "",
        closed?.annualizedPct ?? "",
        batch.dustQuantity ?? "",
        batch.createdAt ?? "",
        batch.closedAt ?? "",
        closed?.holdingHours ?? "",
        (batch.buys || []).length,
        (batch.sells || []).length
      ];
    })
  ]);
}

function renderOrdersCsv(data) {
  return csv([
    ["at", "instrument", "kind", "side", "batch_id", "quantity", "price", "base_delta", "quote_delta", "fee_amount", "fee_currency", "skipped", "order_id"],
    ...data.orders.map((order) => [
      order.at,
      order.instrument,
      order.kind,
      order.side,
      order.batchId,
      order.quantity,
      order.price,
      order.baseDelta,
      order.quoteDelta,
      order.fee?.amount ?? "",
      order.fee?.currency ?? "",
      order.skipped,
      order.orderId
    ])
  ]);
}

function renderDailyCsv(data) {
  return csv([
    ["day", "closed_batches", "realized_cash", "dust_quantity", "dust_sold_quantity", "dust_sold_value"],
    ...data.dailySummaries.map((row) => [
      row.day,
      row.closedBatches,
      row.realizedCash,
      row.dustQuantity,
      row.dustSoldQuantity,
      row.dustSoldValue
    ])
  ]);
}

function writeReportIndex(reportDir, indexPath) {
  const dashboards = fs
    .readdirSync(reportDir)
    .filter((name) => /^[a-z0-9]+-[a-z0-9]+-dashboard\.html$/.test(name))
    .sort();
  const generatedAt = new Date().toISOString();
  const rows = dashboards.map((name) => {
    const stats = fs.statSync(path.join(reportDir, name));
    const prefix = name.replace(/-dashboard\.html$/, "");
    const links = [
      link(name, "Dashboard"),
      linkIfExists(reportDir, `${prefix}-batches.csv`, "Batches CSV"),
      linkIfExists(reportDir, `${prefix}-orders.csv`, "Orders CSV"),
      linkIfExists(reportDir, `${prefix}-daily.csv`, "Daily CSV")
    ].filter(Boolean).join(" ");
    return `<tr><td>${escapeHtml(prefix.toUpperCase().replace("-", "/"))}</td><td>${links}</td><td>${escapeHtml(stats.mtime.toISOString())}</td></tr>`;
  });
  fs.writeFileSync(
    indexPath,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bot Reports</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #17202a; }
    main { max-width: 900px; margin: 0 auto; padding: 24px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9dee7; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #d9dee7; text-align: left; }
    th { color: #687386; }
    a { margin-right: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Bot Reports</h1>
    <p>Generated ${escapeHtml(generatedAt)}</p>
    <table><thead><tr><th>Pair</th><th>Files</th><th>Updated</th></tr></thead><tbody>${rows.join("")}</tbody></table>
  </main>
</body>
</html>`,
    "utf8"
  );
}

function link(fileName, label) {
  return `<a href="./${escapeHtml(fileName)}">${escapeHtml(label)}</a>`;
}

function linkIfExists(reportDir, fileName, label) {
  return fs.existsSync(path.join(reportDir, fileName)) ? link(fileName, label) : "";
}

function closedBatchTable(rows) {
  return table(["ID", "P/L", "P/L %", "Holding", "Closed"], rows.map((batch) => [
    batch.id,
    signedMoney(batch.realizedPnl),
    `${fmt(batch.realizedPct, 2)}%`,
    batch.holdingMs === null ? "-" : duration(batch.holdingMs),
    batch.closedAt || "-"
  ]));
}

function table(headers, rows) {
  const body = rows.length
    ? rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")
    : `<tr><td colspan="${headers.length}" class="muted">No data yet.</td></tr>`;
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function metric(label, value, signedValue = null) {
  const className = signedValue === null ? "" : signedValue >= 0 ? " pos" : " neg";
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value${className}">${escapeHtml(value)}</div></div>`;
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function firstDate(values) {
  const dates = values.map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  return dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
}

function lastDate(values) {
  const dates = values.map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()));
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function annualizedPct({ profit, capital, holdingMs }) {
  return ratePct(profit, capitalYears(capital, holdingMs));
}

function capitalYears(capital, holdingMs) {
  if (!Number.isFinite(capital) || capital <= 0) return 0;
  if (!Number.isFinite(holdingMs) || holdingMs <= 0) return 0;
  return capital * (holdingMs / yearMs());
}

function capitalYearsBetween(capital, from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return 0;
  return capitalYears(capital, toDate.getTime() - fromDate.getTime());
}

function ratePct(profit, capitalYearsValue) {
  if (!Number.isFinite(profit)) return null;
  if (!Number.isFinite(capitalYearsValue) || capitalYearsValue <= 0) return null;
  return (profit / capitalYearsValue) * 100;
}

function yearMs() {
  return 365 * 24 * 60 * 60 * 1000;
}

function duration(ms) {
  if (!Number.isFinite(ms)) return "-";
  const hours = ms / 36e5;
  if (hours < 24) return `${fmt(hours, 1)}h`;
  return `${fmt(hours / 24, 1)}d`;
}

function fmt(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  });
}

function money(value) {
  return `$${fmt(value, 4)}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${fmt(value, 2)}%`;
}

function signedMoney(value) {
  return money(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeJs(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  generateReport();
}
