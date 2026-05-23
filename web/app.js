const state = {
  data: null,
  view: "overview",
  pair: "BTC_USD",
  batchTab: "open",
  chartRange: "7d"
};

const CHART_RANGES = ["24h", "3d", "7d", "30d", "year", "all"];

const app = document.getElementById("app");

init();

async function init() {
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (response.status === 401) {
      location.href = "/login";
      return;
    }
    state.data = await response.json();
    state.pair = state.data.pairs[0]?.instrument || "BTC_USD";
    render();
  } catch (error) {
    app.innerHTML = `<div class="loading">Dashboard sa nepodarilo nacitat: ${escapeHtml(error.message)}</div>`;
  }
}

function render() {
  app.innerHTML = `
    <div class="shell">
      ${sidebar()}
      <main class="main">
        ${topbar()}
        ${mobilePairBar()}
        <section class="page">${page()}</section>
        ${mobileBottomNav()}
      </main>
    </div>
  `;
  bindEvents();
}

function mobilePairBar() {
  return `
    <div class="mobile-pair-bar">
      ${state.data.pairs.map((pair) => `
        <button data-view="pair" data-pair="${pair.instrument}" class="${state.pair === pair.instrument ? "active" : ""}">
          <span class="dot ${pair.status === "running" ? "" : pair.status}"></span>
          <span>${pair.instrument.replace("_", " / ")}</span>
          <strong>${money(pair.lastPrice, priceDigits(pair))}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function mobileBottomNav() {
  return `
    <nav class="mobile-bottom-nav">
      <button data-view="overview" class="${state.view === "overview" ? "active" : ""}"><span>⌂</span>Prehlad</button>
      <button data-view="pair" data-pair="${state.pair}" class="${state.view === "pair" ? "active" : ""}"><span>◇</span>Par</button>
      <button data-view="alerts" class="${state.view === "alerts" ? "active" : ""}"><span>!</span>Alerts</button>
      <button data-view="settings" class="${state.view === "settings" ? "active" : ""}"><span>⚙</span>Settings</button>
    </nav>
  `;
}

function sidebar() {
  const pairs = state.data.pairs;
  const alertCount = state.data.alerts.length;
  const lastTick = newest(pairs.map((pair) => pair.latestSnapshotAt));
  const healthy = pairs.every((pair) => pair.status === "running");
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">BB</div>
        <div>
          <div class="brand-name">Batch Bot</div>
          <div class="brand-sub">Crypto.com DCA strategy</div>
        </div>
      </div>

      <div>
        <div class="section-label">Workspace</div>
        <nav class="nav">
          ${navButton("overview", "Prehlad")}
          ${navButton("alerts", `Zdravie / chyby <span class="count">${alertCount}</span>`)}
        </nav>
      </div>

      <div>
        <div class="section-label">Trading pary</div>
        <nav class="nav">
          ${pairs.map((pair) => pairButton(pair)).join("")}
        </nav>
      </div>

      <div>
        <div class="section-label">System</div>
        <nav class="nav">
          ${navButton("settings", "Nastavenia")}
        </nav>
      </div>

      <div class="side-foot">
        <div><span class="dot ${healthy ? "" : "warn"}"></span> <strong>${healthy ? "Sluzby vyzeraju OK" : "Skontroluj upozornenia"}</strong></div>
        <div style="margin-top:8px">Last tick <span class="mono" style="float:right;color:var(--text)">${shortDate(lastTick)}</span></div>
        <div style="margin-top:8px">Rezim <span class="mono" style="float:right;color:var(--text)">read-only</span></div>
      </div>
    </aside>
  `;
}

function navButton(view, label) {
  return `<button data-view="${view}" class="${state.view === view ? "active" : ""}">${label}</button>`;
}

function pairButton(pair) {
  const active = state.view === "pair" && state.pair === pair.instrument;
  return `
    <button data-view="pair" data-pair="${pair.instrument}" class="${active ? "active" : ""}">
      <span class="dot ${pair.status === "running" ? "" : pair.status}"></span>
      ${pair.instrument.replace("_", " / ")}
      <span class="count">${pair.openBatches}</span>
    </button>
  `;
}

function topbar() {
  const title = state.view === "pair"
    ? state.pair.replace("_", " / ")
    : state.view === "settings"
      ? "Nastavenia"
      : state.view === "alerts"
        ? "Zdravie / chyby"
        : "Prehlad";
  const anyLiveTrading = state.data.pairs.some((pair) => String(pair.safeSettings.ENABLE_TRADING).toLowerCase() === "true");
  return `
    <div class="topbar">
      <div class="crumbs">Workspace / <strong>${title}</strong></div>
      <div class="top-actions">
        <span class="chip">Read-only <strong>ON</strong></span>
        <span class="chip">Data <strong>${dataSourceLabel()}</strong></span>
        <span class="chip">Trading <strong class="${anyLiveTrading ? "neg" : ""}">${anyLiveTrading ? "ENABLED" : "OFF"}</strong></span>
        <span class="chip">Generated <strong>${shortTime(state.data.generatedAt)}</strong></span>
        <button class="btn" data-refresh>Refresh</button>
        <form method="post" action="/logout" style="margin:0"><button class="btn" type="submit">Odhlasit</button></form>
      </div>
    </div>
  `;
}

function dataSourceLabel() {
  const sources = Array.from(new Set((state.data?.pairs || []).map((pair) => pair.dataSource || "logs")));
  return sources.length === 1 ? sources[0].toUpperCase() : "MIXED";
}

function page() {
  if (state.view === "pair") return pairDetail(pairByInstrument(state.pair));
  if (state.view === "settings") return settingsPage();
  if (state.view === "alerts") return alertsPage();
  return overviewPage();
}

function overviewPage() {
  const totals = state.data.totals;
  const alerts = state.data.alerts;
  return `
    ${alerts.length ? banner("warn", `${alerts.length} upozorneni na kontrolu`, alerts.slice(0, 2).map((a) => `${a.instrument}: ${a.title}`).join(" | ")) : banner("info", "Dashboard je read-only", "Zobrazuje logy a stav. Neposiela ordery, nemeni nastavenia ani nerestartuje sluzby.")}
    <div class="kpi-row">
      ${kpi("Total portfolio", money(totals.portfolioValue), "Podla poslednych snapshotov")}
      ${kpi("Today P/L", signedMoney(totals.todayRealizedPnl), "realized dnes", totals.todayRealizedPnl)}
      ${kpi("Realized incl. dust", signedMoney(totals.realizedInclDust), `${totals.closedBatches} uzavretych davok`, totals.realizedInclDust)}
      ${kpi("Unrealized P/L", signedMoney(totals.unrealized), `${totals.openBatches} otvorenych davok`, totals.unrealized)}
      ${kpi("Cash P/L only", signedMoney(state.data.pairs.reduce((sum, pair) => sum + Number(pair.realizedCash || 0), 0)), "bez dust value", state.data.pairs.reduce((sum, pair) => sum + Number(pair.realizedCash || 0), 0))}
    </div>
    <div class="grid-2">
      ${state.data.pairs.map(pairCard).join("")}
    </div>
    <div class="grid-2">
      ${systemStatusCard()}
      ${dailySummaryCard()}
    </div>
  `;
}

function pairCard(pair) {
  return `
    <article class="pair-card" data-open-pair="${pair.instrument}">
      <div class="pair-head">
        <span class="dot ${pair.status === "running" ? "" : pair.status}"></span>
        <div class="pair-title">${pair.instrument.replace("_", " / ")}</div>
        <span class="pill ${pair.status}">${statusLabel(pair.status)}</span>
      </div>
      <div class="pair-card-main">
        <div>
          <div class="kpi-label">Last price</div>
          <div class="kpi-value">${money(pair.lastPrice, priceDigits(pair))}</div>
          <div class="kpi-foot">Next sell ${pair.nextSellPrice ? money(pair.nextSellPrice, priceDigits(pair)) : "-"}</div>
        </div>
        ${miniChart(pair.recentSnapshots)}
      </div>
      <div class="pair-grid">
        ${metric("Realized", signedMoney(pair.realizedInclDust), pair.realizedInclDust)}
        ${metric("Unrealized", signedMoney(pair.unrealized), pair.unrealized)}
        ${metric("Open", pair.openBatches)}
        ${metric("Closed", pair.closedBatches)}
        ${metric("Quote", money(pair.portfolio?.quoteTotal || 0))}
        ${metric("Base", `${fmt(pair.portfolio?.baseTotal || 0, pair.baseAsset === "BTC" ? 8 : 2)} ${pair.baseAsset}`)}
        ${metric("Maker fill", pair.makerStats?.total ? `${fmt(pair.makerStats.fillRatePct || 0, 1)}%` : "-")}
        ${metric("Avg holding", pair.avgHoldingDays === null ? "-" : `${fmt(pair.avgHoldingDays, 1)}d`)}
      </div>
    </article>
  `;
}

function pairDetail(pair) {
  if (!pair) return `<div class="empty">Par sa nenasiel.</div>`;
  const rows = state.batchTab === "closed" ? closedBatchesTable(pair.closedBatchRows) : openBatchesTable(pair.openBatchRows, pair);
  return `
    ${pair.alerts.length ? pair.alerts.map((alert) => banner(alert.level, alert.title, alert.text)).join("") : banner("info", "Bez vaznych upozorneni", "Posledne dostupne data pre tento par su nacitane.")}
    <div class="kpi-row pair-hero">
      ${kpi(`${pair.instrument} last price`, money(pair.lastPrice, priceDigits(pair)), `Next sell at ${pair.nextSellPrice ? money(pair.nextSellPrice, priceDigits(pair)) : "-"} · Avg open ${money(pair.avgOpenPrice, priceDigits(pair))}`)}
      ${kpi("Realized incl. dust", signedMoney(pair.realizedInclDust), `Cash ${signedMoney(pair.realizedCash)}`, pair.realizedInclDust)}
      ${kpi("Unrealized P/L", signedMoney(pair.unrealized), `${pair.openBatches} otvorenych davok`, pair.unrealized)}
      ${kpi("Quote balance", money(pair.portfolio?.quoteTotal || 0), pair.quoteAsset)}
      ${kpi("Base balance", fmt(pair.portfolio?.baseTotal || 0, pair.baseAsset === "BTC" ? 8 : 2), pair.baseAsset)}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Price · buys and sells</h2><span class="sub">${pair.instrument} · ${pair.recentSnapshots.length} ticks</span>
        <div class="head-right chart-tools">
          <div class="chart-legend"><span class="legend-dot price"></span> price <span class="legend-triangle buy"></span> BUY <span class="legend-triangle sell"></span> SELL</div>
          <div class="tabs">${CHART_RANGES.map((range) => `<button data-chart-range="${range}" class="${state.chartRange === range ? "active" : ""}">${range}</button>`).join("")}</div>
        </div>
      </div>
      <div class="card-body">${priceChart(pair)}</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <h2>Batches</h2>
          <div class="head-right tabs">
            <button data-batch-tab="open" class="${state.batchTab === "open" ? "active" : ""}">Open ${pair.openBatches}</button>
            <button data-batch-tab="closed" class="${state.batchTab === "closed" ? "active" : ""}">Closed ${pair.closedBatches}</button>
          </div>
        </div>
        <div class="card-body flush">${rows}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent orders</h2><span class="sub">poslednych ${pair.recentOrders.length}</span></div>
        <div class="card-body flush">${ordersTable(pair.recentOrders, pair)}</div>
      </div>
    </div>

    <div class="grid-3">
      ${makerStatsCard(pair)}
      ${feesCard(pair)}
      ${dustCard(pair)}
    </div>
  `;
}

function settingsPage() {
  return `
    ${banner("info", "Nastavenia su zatial iba na citanie", "Editacia .env, restart sluzieb a ovladanie bota su odlozene do dalsich faz.")}
    <div class="grid-2">
      ${state.data.pairs.map((pair) => `
        <div class="card">
          <div class="card-head"><h2>${pair.instrument.replace("_", " / ")}</h2><span class="sub">${escapeHtml(pair.envFile)}</span></div>
          <div class="card-body">
            <div class="settings-list">
              ${Object.entries(pair.safeSettings).map(([key, value]) => `
                <div class="setting"><span>${escapeHtml(key)}</span><span>${escapeHtml(String(value ?? ""))}</span></div>
              `).join("")}
            </div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function alertsPage() {
  const alerts = state.data.alerts;
  const errorCount = alerts.filter((alert) => alert.level === "error").length;
  const warnCount = alerts.filter((alert) => alert.level === "warn").length;
  const staleOrders = state.data.pairs.reduce((sum, pair) => sum + Number(pair.health?.staleMakerOrders || 0), 0);
  const recentErrors = state.data.pairs.reduce((sum, pair) => sum + Number(pair.health?.recentErrors?.length || 0), 0);
  return `
    <div class="kpi-row">
      ${kpi("Health", alerts.length ? `${errorCount} err / ${warnCount} warn` : "OK", "read-only kontrola", errorCount ? -1 : warnCount ? 0 : 1)}
      ${kpi("Services running", `${state.data.pairs.filter((p) => p.serviceActive !== false).length} / ${state.data.pairs.length}`, "systemd active")}
      ${kpi("Oldest tick", oldestSnapshotText(), "max age kontrola")}
      ${kpi("Stale maker", fmt(staleOrders, 0), "active po timeoute", staleOrders ? -1 : 1)}
      ${kpi("Log errors", fmt(recentErrors, 0), "posledne journal riadky", recentErrors ? -1 : 1)}
    </div>
    ${alerts.length ? `<div class="alert-stack">${alerts.map(alertRow).join("")}</div>` : banner("info", "Ziadne otvorene upozornenia", "Sluzby, tick data a zakladne kontroly vyzeraju v poriadku.")}
    <div class="grid-2">
      ${state.data.pairs.map(healthPairCard).join("")}
    </div>
    ${systemStatusCard()}
  `;
}

function systemStatusCard() {
  return `
    <div class="card">
      <div class="card-head"><h2>System status</h2><span class="sub">read-only</span></div>
      <div class="card-body flush">
        <table>
          <thead><tr><th>Par</th><th>Sluzba</th><th>Status</th><th class="right">PID</th><th class="right">Tick age</th></tr></thead>
          <tbody>${state.data.pairs.map((pair) => `
            <tr>
              <td>${pair.instrument}</td>
              <td class="mono">${escapeHtml(pair.serviceName)}</td>
              <td><span class="pill ${pair.status}">${serviceLabel(pair.serviceActive)}</span></td>
              <td class="right mono">${pair.health?.service?.mainPid || "-"}</td>
              <td class="right mono">${pair.snapshotAgeMinutes === null ? "-" : `${fmt(pair.snapshotAgeMinutes, 1)}m`}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function alertRow(alert) {
  return `
    <div class="banner ${alert.level}">
      <span class="dot ${alert.level === "error" ? "error" : alert.level === "warn" ? "warn" : ""}"></span>
      <div>
        <div class="banner-title">${escapeHtml(alert.instrument)}: ${escapeHtml(alert.title)}</div>
        <div class="banner-sub">${escapeHtml(alert.text)}</div>
      </div>
    </div>
  `;
}

function healthPairCard(pair) {
  const health = pair.health || {};
  const service = health.service || {};
  const lastErrors = health.recentErrors || [];
  return `
    <div class="card health-card">
      <div class="card-head">
        <h2>${pair.instrument.replace("_", " / ")}</h2>
        <span class="pill ${pair.status}">${statusLabel(pair.status)}</span>
        <span class="sub">${escapeHtml(pair.serviceName)}</span>
      </div>
      <div class="card-body">
        <div class="health-grid">
          ${healthMetric("Service", service.activeState || serviceLabel(pair.serviceActive), service.subState || "")}
          ${healthMetric("PID", service.mainPid || "-", service.activeEnterTimestamp ? `since ${shortDate(service.activeEnterTimestamp)}` : "")}
          ${healthMetric("Last tick", shortDate(health.lastSnapshotAt), health.snapshotAgeMinutes === null ? "" : `${fmt(health.snapshotAgeMinutes, 1)} min ago`)}
          ${healthMetric("Snapshots", fmt(health.snapshotCount || 0, 0), health.dataSource === "sqlite" ? "SQLite" : "Logs")}
          ${healthMetric("Maker active", fmt(health.activeMakerOrders || 0, 0), `${fmt(health.staleMakerOrders || 0, 0)} stale`)}
          ${healthMetric("Trading", health.tradingEnabled ? "ENABLED" : "OFF", health.dryRun ? "DRY_RUN on" : "DRY_RUN off")}
        </div>
        <div class="mini-section">
          <div class="mini-title">Recent log errors</div>
          ${lastErrors.length ? `<ul class="log-list">${lastErrors.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : `<div class="empty compact">Ziadne posledne error riadky.</div>`}
        </div>
        <div class="mini-section">
          <div class="mini-title">Latest orders</div>
          ${ordersTable((pair.recentOrders || []).slice(0, 5), pair)}
        </div>
      </div>
    </div>
  `;
}

function healthMetric(label, value, note = "") {
  return `
    <div class="health-metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(String(value ?? "-"))}</div>
      ${note ? `<div class="metric-note">${escapeHtml(note)}</div>` : ""}
    </div>
  `;
}

function dailySummaryCard() {
  const rows = combinedDailyPnlRows();
  return `
    <div class="card">
      <div class="card-head">
        <h2>P/L by day</h2><span class="sub">last 7 days · both pairs</span>
        <div class="head-right tabs"><button class="active">7d</button><button disabled>30d</button><button disabled>All</button></div>
      </div>
      <div class="card-body">
        ${rows.length ? dailyBars(rows) : `<div class="empty">Zatial nie su denne P/L data.</div>`}
      </div>
    </div>
  `;
}

function combinedDailyPnlRows() {
  const rows = new Map();
  for (const pair of state.data.pairs) {
    for (const row of pair.dailySummaries || []) {
      const current = rows.get(row.day) || { day: row.day, realizedCash: 0, closedBatches: 0 };
      current.realizedCash += Number(row.realizedCash || 0);
      current.closedBatches += Number(row.closedBatches || 0);
      rows.set(row.day, current);
    }
  }
  return Array.from(rows.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-7);
}

function dailyBars(rows) {
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.realizedCash || 0))), 1);
  return `<div class="bars" aria-label="P/L by day">
    <div class="bar-zero"></div>
    ${rows.map((row) => {
      const value = Number(row.realizedCash || 0);
      const height = Math.max(4, Math.round((Math.abs(value) / max) * 72));
      const style = value >= 0
        ? `height:${height}px; bottom:50%;`
        : `height:${height}px; top:50%;`;
      return `<div class="bar-col">
        <div class="bar-value ${tone(value)}">${value === 0 ? "$0" : signedMoney(value)}</div>
        <div class="bar ${value >= 0 ? "positive" : "negative"}" style="${style}"></div>
        <div class="bar-label">${shortDay(row.day)}</div>
      </div>`;
    }).join("")}
  </div>`;
}

function openBatchesTable(rows, pair) {
  if (!rows.length) return `<div class="empty">Ziadne otvorene davky.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>Created</th><th class="right">Qty</th><th class="right">Avg</th><th class="right">Next sell</th><th class="right">P/L</th><th class="right">Buys</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td class="mono">${shortId(row.id)}</td>
      <td class="mono">${shortDate(row.createdAt)}</td>
      <td class="right num">${fmt(row.quantity, pair.baseAsset === "BTC" ? 8 : 2)}</td>
      <td class="right num">${money(row.averagePrice, priceDigits(pair))}</td>
      <td class="right num">${money(row.nextSellPrice, priceDigits(pair))}</td>
      <td class="right num ${tone(row.unrealized)}">${signedMoney(row.unrealized)}</td>
      <td class="right num">${row.buys}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function closedBatchesTable(rows) {
  if (!rows.length) return `<div class="empty">Ziadne uzavrete davky.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>Closed</th><th class="right">P/L incl. dust</th><th class="right">%</th><th class="right">Hold</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td class="mono">${shortId(row.id)}</td>
      <td class="mono">${shortDate(row.closedAt)}</td>
      <td class="right num ${tone(row.realizedPnlInclDust)}">${signedMoney(row.realizedPnlInclDust)}</td>
      <td class="right num ${tone(row.realizedPctInclDust)}">${signedPct(row.realizedPctInclDust)}</td>
      <td class="right num">${row.holdingHours === null ? "-" : `${fmt(row.holdingHours / 24, 1)}d`}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function ordersTable(rows, pair) {
  if (!rows.length) return `<div class="empty">Ziadne ordery v logoch.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Time</th><th>Kind</th><th>Side</th><th>Status</th><th class="right">Qty</th><th class="right">Price</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td class="mono">${shortDate(row.at)}</td>
      <td>${escapeHtml(row.kind || "-")}</td>
      <td class="${row.side === "BUY" ? "side-buy" : row.side === "SELL" ? "side-sell" : ""}">${escapeHtml(row.side || "-")}</td>
      <td><span class="status ${statusClass(row.fillStatus)}">${escapeHtml(row.fillStatus || "-")}</span></td>
      <td class="right num">${fmt(row.quantity || 0, pair.baseAsset === "BTC" ? 8 : 2)}</td>
      <td class="right num">${row.price ? money(row.price, priceDigits(pair)) : "-"}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function makerStatsCard(pair) {
  const stats = pair.makerStats || {};
  return `
    <div class="card">
      <div class="card-head"><h3>Maker stats</h3><span class="sub">ak sa pouziva maker rezim</span></div>
      <div class="card-body">
        ${metric("Limit orders", fmt(stats.total || 0, 0))}
        ${metric("Filled", `${fmt(stats.filled || 0, 0)} (${fmt(stats.fillRatePct || 0, 1)}%)`)}
        ${metric("Canceled", `${fmt(stats.canceled || 0, 0)} (${fmt(stats.cancelRatePct || 0, 1)}%)`)}
        ${metric("Active", fmt(stats.active || 0, 0))}
      </div>
    </div>
  `;
}

function feesCard(pair) {
  return `
    <div class="card">
      <div class="card-head"><h3>Fees</h3><span class="sub">summary</span></div>
      <div class="card-body">
        ${pair.feeStats.length ? pair.feeStats.map((fee) => metric(fee.currency, `${fmt(fee.amount, 8)} (${fee.count})`)).join("") : `<div class="empty">Ziadne fee riadky.</div>`}
      </div>
    </div>
  `;
}

function dustCard(pair) {
  return `
    <div class="card">
      <div class="card-head"><h3>Dust bank</h3><span class="sub">${pair.baseAsset}</span></div>
      <div class="card-body">
        ${metric(`Dust ${pair.baseAsset}`, fmt(pair.dustBankQuantity, pair.baseAsset === "BTC" ? 8 : 4))}
        ${metric("Dust value", money(pair.dustBankValue, 4))}
        ${metric("Data source", pair.dataSource === "sqlite" ? "SQLite" : "Logs")}
        ${metric("Log dir", escapeHtml(pair.logDir))}
      </div>
    </div>
  `;
}

function priceChart(pair) {
  const points = filterChartPoints(pair.recentSnapshots, state.chartRange);
  if (points.length < 2) return `<div class="empty">Zatial malo cenovych bodov na graf.</div>`;
  const w = 960;
  const h = 260;
  const pad = { l: 70, r: 20, t: 20, b: 36 };
  const prices = points.map((p) => Number(p.price || 0)).filter((p) => p > 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max * 0.01 || 1;
  const yMin = min - span * 0.1;
  const yMax = max + span * 0.1;
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const x = (i) => pad.l + (i * plotW) / (points.length - 1);
  const y = (price) => pad.t + ((yMax - price) / (yMax - yMin)) * plotH;
  const poly = points.map((point, i) => `${x(i).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const xTicks = chartXTicks(points, 7);
  const ticks = [0, .25, .5, .75, 1].map((ratio) => {
    const value = yMax - (yMax - yMin) * ratio;
    const yy = pad.t + plotH * ratio;
    return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy}" y2="${yy}" stroke="#eef0f2" stroke-dasharray="${ratio === 0 || ratio === 1 ? "" : "2 3"}"/><text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7385" font-family="IBM Plex Mono, ui-monospace, monospace">${money(value, priceDigits(pair))}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Price buys and sells chart">
    ${ticks}
    <polyline points="${poly}" fill="none" stroke="#131618" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((point, i) => {
      const px = x(i);
      const py = y(point.price);
      const marks = [];
      if (point.buyCount) {
        marks.push(`<polygon points="${px},${py + 17} ${px - 6},${py + 8} ${px + 6},${py + 8}" fill="oklch(56% 0.13 150)"><title>${point.buyCount} BUY</title></polygon>`);
        if (point.buyCount > 1) marks.push(`<text x="${px}" y="${py + 31}" text-anchor="middle" font-size="10" fill="oklch(56% 0.13 150)" font-family="IBM Plex Mono, ui-monospace, monospace" font-weight="700">${point.buyCount}</text>`);
      }
      if (point.sellCount) {
        marks.push(`<polygon points="${px},${py - 17} ${px - 6},${py - 8} ${px + 6},${py - 8}" fill="oklch(57% 0.18 27)"><title>${point.sellCount} SELL</title></polygon>`);
        if (point.sellCount > 1) marks.push(`<text x="${px}" y="${py - 20}" text-anchor="middle" font-size="10" fill="oklch(57% 0.18 27)" font-family="IBM Plex Mono, ui-monospace, monospace" font-weight="700">${point.sellCount}</text>`);
      }
      return marks.join("");
    }).join("")}
    <circle cx="${x(points.length - 1)}" cy="${y(points.at(-1).price)}" r="3.5" fill="#131618"/>
    <line x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}" stroke="#d4d7dc"/>
    ${xTicks.map((tick, tickIndex) => `<text x="${x(tick.index)}" y="${h - 12}" font-size="11" fill="#6b7385" font-family="IBM Plex Mono, ui-monospace, monospace" text-anchor="${tickIndex === 0 ? "start" : tickIndex === xTicks.length - 1 ? "end" : "middle"}">${chartTickLabel(tick.at)}</text>`).join("")}
  </svg>`;
}

function chartXTicks(points, maxTicks) {
  if (points.length <= maxTicks) return points.map((point, index) => ({ index, at: point.at }));
  const used = new Set();
  const ticks = [];
  for (let i = 0; i < maxTicks; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (maxTicks - 1));
    if (used.has(index)) continue;
    used.add(index);
    ticks.push({ index, at: points[index].at });
  }
  return ticks;
}

function chartTickLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("sk-SK", { month: "2-digit", day: "2-digit" });
}

function filterChartPoints(points, range) {
  if (range === "all") return points;
  const last = points.at(-1);
  const lastMs = new Date(last?.at || "").getTime();
  if (!Number.isFinite(lastMs)) return points;
  const durationMs = {
    "24h": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  }[range];
  if (!durationMs) return points;
  const cutoff = lastMs - durationMs;
  const filtered = points.filter((point) => {
    const ms = new Date(point.at || "").getTime();
    return Number.isFinite(ms) && ms >= cutoff;
  });
  return filtered.length >= 2 ? filtered : points.slice(-2);
}

function miniChart(points) {
  if (points.length < 2) return `<div class="empty">No chart</div>`;
  const w = 280;
  const h = 80;
  const prices = points.map((p) => Number(p.price || 0));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const poly = points.map((point, i) => {
    const x = (i * w) / (points.length - 1);
    const y = h - ((point.price - min) / span) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:80px"><polyline points="${poly}" fill="none" stroke="#131618" stroke-width="2"/></svg>`;
}

function kpi(label, value, foot = "", numberTone = null) {
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${numberTone === null ? "" : tone(numberTone)}">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

function metric(label, value, numericTone = null) {
  return `<div><div class="metric-label">${label}</div><div class="metric-value ${numericTone === null ? "" : tone(numericTone)}">${value}</div></div>`;
}

function banner(level, title, text) {
  return `<div class="banner ${level}"><span class="dot ${level === "error" ? "error" : level === "warn" ? "warn" : ""}"></span><div><div class="banner-title">${escapeHtml(title)}</div><div class="banner-sub">${escapeHtml(text)}</div></div></div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (button.dataset.pair) state.pair = button.dataset.pair;
      render();
    });
  });
  document.querySelectorAll("[data-open-pair]").forEach((card) => {
    card.addEventListener("click", () => {
      state.view = "pair";
      state.pair = card.dataset.openPair;
      state.batchTab = "open";
      render();
    });
  });
  document.querySelectorAll("[data-batch-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.batchTab = button.dataset.batchTab;
      render();
    });
  });
  document.querySelectorAll("[data-chart-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chartRange = button.dataset.chartRange;
      render();
    });
  });
  document.querySelector("[data-refresh]")?.addEventListener("click", init);
}

function pairByInstrument(instrument) {
  return state.data.pairs.find((pair) => pair.instrument === instrument);
}

function statusLabel(status) {
  if (status === "running") return "Running";
  if (status === "warn") return "Warning";
  if (status === "error") return "Error";
  return "Unknown";
}

function serviceLabel(value) {
  if (value === true) return "running";
  if (value === false) return "inactive";
  return "unknown";
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("fill")) return "filled";
  if (value.includes("active")) return "active";
  if (value.includes("cancel") || value.includes("fail") || value.includes("reject")) return "canceled";
  return "";
}

function oldestSnapshotText() {
  const ages = state.data.pairs.map((pair) => pair.snapshotAgeMinutes).filter((age) => age !== null);
  if (!ages.length) return "-";
  return `${fmt(Math.max(...ages), 1)}m`;
}

function newest(values) {
  const times = values.map((value) => new Date(value || "").getTime()).filter(Number.isFinite);
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function priceDigits(pair) {
  return pair.baseAsset === "BTC" ? 2 : 4;
}

function money(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `$${fmt(number, digits)}`;
}

function signedMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}$${fmt(Math.abs(number), 2)}`;
}

function signedPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${fmt(number, 2)}%`;
}

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function tone(value) {
  const number = Number(value);
  if (number > 0) return "pos";
  if (number < 0) return "neg";
  return "";
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("sk-SK", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortDay(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value.slice(5);
  return date.toLocaleDateString("sk-SK", { month: "2-digit", day: "2-digit" });
}

function shortId(value) {
  const text = String(value || "");
  if (text.length <= 18) return escapeHtml(text || "-");
  return escapeHtml(`${text.slice(0, 12)}...${text.slice(-5)}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
