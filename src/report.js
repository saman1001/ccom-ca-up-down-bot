import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";

const config = loadConfig();
const logDir = config.logDir;
const reportDir = path.resolve("reports");
const reportPath = path.join(reportDir, "dashboard.html");

const batches = readJson(path.join(logDir, "batches.json"), []);
const dustBank = readJson(path.join(logDir, "dust-bank.json"), { quantity: 0 });
const snapshots = readJsonl(path.join(logDir, "snapshots.jsonl"));
const openBatches = batches.filter((batch) => batch.status === "OPEN");
const closedBatches = batches.filter((batch) => batch.status === "CLOSED");
const latest = snapshots.at(-1) || null;

const lastPrice = latest?.price ?? 0;
const realizedCash = closedBatches.reduce((sum, batch) => sum + realizedPnl(batch), 0);
const closedBatchDustQuantity = closedBatches.reduce((sum, batch) => sum + Number(batch.dustQuantity || 0), 0);
const closedBatchDustValue = closedBatchDustQuantity * lastPrice;
const dustBankValue = (dustBank.quantity || 0) * lastPrice;
const realizedWithClosedDust = realizedCash + closedBatchDustValue;
const unrealized = openBatches.reduce((sum, batch) => {
  return sum + batch.quantity * (lastPrice - batch.averagePrice);
}, 0);
const totalOpenQuantity = openBatches.reduce((sum, batch) => sum + batch.quantity, 0);
const totalOpenCost = openBatches.reduce((sum, batch) => sum + batch.quantity * batch.averagePrice, 0);
const avgOpenPrice = totalOpenQuantity > 0 ? totalOpenCost / totalOpenQuantity : 0;
const recentSnapshots = snapshots.slice(-240);
const recentOrders = snapshots
  .flatMap((snapshot) => {
    return (snapshot.orderResults || []).map((result) => ({
      at: snapshot.at,
      kind: result.action?.kind,
      side: result.action?.order?.side,
      quantity: result.fill?.quantity,
      price: result.fill?.price,
      skipped: result.skipped || false
    }));
  })
  .slice(-50)
  .reverse();

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, renderHtml(), "utf8");
console.log(reportPath);

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
  const buyCost = (batch.buys || []).reduce((sum, buy) => sum + buy.quantity * buy.price, 0);
  const sellValue = (batch.sells || []).reduce((sum, sell) => sum + sell.quantity * sell.price, 0);
  return sellValue - buyCost;
}

function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  });
}

function money(value) {
  return `$${fmt(value, 4)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHtml() {
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CRO Bot Dashboard</title>
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
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header, main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    header { padding-bottom: 8px; }
    h1 { margin: 0 0 6px; font-size: 28px; font-weight: 750; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    .muted { color: var(--muted); }
    .grid { display: grid; gap: 14px; }
    .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .metric, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .metric .value { margin-top: 8px; font-size: 24px; font-weight: 740; }
    .pos { color: var(--green); }
    .neg { color: var(--red); }
    .two { grid-template-columns: 1.4fr .9fr; align-items: start; }
    canvas {
      width: 100%;
      height: 320px;
      display: block;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
    }
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
    <h1>CRO Bot Dashboard</h1>
    <div class="muted">Generated ${escapeHtml(new Date().toISOString())}. Latest bot tick: ${escapeHtml(latest?.at || "none")}.</div>
  </header>
  <main class="grid">
    <div class="grid metrics">
      ${metric("Portfolio", latest ? money(latest.portfolio?.totalQuoteValue || 0) : "-")}
      ${metric("Open Batches", String(openBatches.length))}
      ${metric("Open CRO", fmt(totalOpenQuantity, 4))}
      ${metric("Avg Open Price", avgOpenPrice ? money(avgOpenPrice) : "-")}
      ${metric("USD Balance", latest ? money(latest.portfolio?.quoteTotal || 0) : "-")}
      ${metric("CRO Balance", latest ? fmt(latest.portfolio?.baseTotal || 0, 4) : "-")}
      ${metric("Dust Bank", fmt(dustBank.quantity || 0, 4))}
      ${metric("Dust Value", money(dustBankValue))}
      ${metric("Realized Cash P/L", money(realizedCash), realizedCash)}
      ${metric("Realized Incl. Dust", money(realizedWithClosedDust), realizedWithClosedDust)}
      ${metric("Unrealized P/L", money(unrealized), unrealized)}
    </div>

    <section>
      <h2>Price, Buys And Sells</h2>
      <canvas id="chart" width="1100" height="320"></canvas>
    </section>

    <div class="grid two">
      <section>
        <h2>Open Batches</h2>
        <div class="scroll">
          <table>
            <thead><tr><th>ID</th><th>Qty</th><th>Avg Price</th><th>P/L</th><th>Created</th><th>Buys</th></tr></thead>
            <tbody>
              ${openBatches
                .slice()
                .reverse()
                .map((batch) => {
                  const pnl = batch.quantity * (lastPrice - batch.averagePrice);
                  return `<tr><td>${escapeHtml(batch.id)}</td><td>${fmt(batch.quantity, 4)}</td><td>${money(batch.averagePrice)}</td><td class="${pnl >= 0 ? "pos" : "neg"}">${money(pnl)}</td><td>${escapeHtml(batch.createdAt)}</td><td>${(batch.buys || []).length}</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Recent Orders</h2>
        <div class="scroll">
          <table>
            <thead><tr><th>Time</th><th>Kind</th><th>Side</th><th>Qty</th><th>Price</th></tr></thead>
            <tbody>
              ${recentOrders
                .map((order) => `<tr><td>${escapeHtml(order.at)}</td><td>${escapeHtml(order.kind || "-")}</td><td>${escapeHtml(order.side || "-")}</td><td>${fmt(order.quantity || 0, 4)}</td><td>${order.price ? money(order.price) : "-"}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>
  <script>
    const data = ${JSON.stringify(chartData)};
    const canvas = document.getElementById("chart");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const pad = { left: 72, right: 22, top: 30, bottom: 54 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const times = data.map(point => new Date(point.at).getTime()).filter(value => Number.isFinite(value));
    const prices = data.map(point => point.price).filter(value => Number.isFinite(value));
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

    const xTickCount = times.length ? 6 : 0;
    for (let i = 0; i < xTickCount; i++) {
      const time = minTime + ((maxTime - minTime) * i) / Math.max(1, xTickCount - 1);
      const x = xForTime(time);
      ctx.strokeStyle = "#edf0f5";
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, h - pad.bottom);
      ctx.stroke();
      ctx.fillStyle = "#687386";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(formatTime(time), x, h - pad.bottom + 12);
    }

    ctx.strokeStyle = "#17202a";
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();

    drawPriceLine();
    drawOrderMarkers();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1c5d99";
    ctx.fillText(latest?.instrument || "Price", pad.left, 18);
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

    function formatTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString("sk-SK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
  </script>
</body>
</html>`;
}

function metric(label, value, signedValue = null) {
  const className = signedValue === null ? "" : signedValue >= 0 ? " pos" : " neg";
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value${className}">${escapeHtml(value)}</div></div>`;
}
