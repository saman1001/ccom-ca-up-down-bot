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
    total: snapshot.portfolio?.totalQuoteValue,
    base: snapshot.portfolio?.baseTotal,
    quote: snapshot.portfolio?.quoteTotal
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
      <h2>Price And Portfolio</h2>
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
    const pad = 42;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "12px system-ui";
    ctx.strokeStyle = "#d9dee7";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - pad * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }
    drawSeries(data.map(d => d.price), "#1c5d99", "Price");
    drawSeries(data.map(d => d.total), "#087f5b", "Portfolio");
    ctx.fillStyle = "#1c5d99";
    ctx.fillText("Price", pad, 18);
    ctx.fillStyle = "#087f5b";
    ctx.fillText("Portfolio value", pad + 60, 18);

    function drawSeries(values, color) {
      const clean = values.filter(v => Number.isFinite(v));
      if (clean.length < 2) return;
      const min = Math.min(...clean);
      const max = Math.max(...clean);
      const span = max - min || 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = pad + ((w - pad * 2) * index) / Math.max(1, values.length - 1);
        const y = h - pad - ((value - min) / span) * (h - pad * 2);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  </script>
</body>
</html>`;
}

function metric(label, value, signedValue = null) {
  const className = signedValue === null ? "" : signedValue >= 0 ? " pos" : " neg";
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value${className}">${escapeHtml(value)}</div></div>`;
}
