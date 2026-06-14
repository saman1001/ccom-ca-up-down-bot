const state = {
  data: null,
  reports: { files: [] },
  view: "overview",
  pair: "BTC_USD",
  batchTab: "open",
  chartRange: "7d",
  dailyRange: "7d",
  settingsPair: "BTC_USD",
  settingsPreview: null,
  settingsMessage: null,
  serviceMessage: null,
  pairCreateMessage: null,
  instrumentRules: null
};

const CHART_RANGES = ["24h", "3d", "7d", "30d", "year", "all"];
const DAILY_RANGES = ["7d", "30d", "all"];
const EDITABLE_SETTINGS = [
  "AVERAGE_DOWN_DROP_PCT",
  "TAKE_PROFIT_RISE_PCT",
  "BUY_BASE_BATCH_EVERY_RUN",
  "DRY_RUN",
  "ENABLE_TRADING",
  "BASE_BUY_COOLDOWN_MINUTES",
  "DAILY_BASE_BUY_LIMIT",
  "FORCE_BASE_BUY_WEEKLY_LIMIT",
  "MAX_OPEN_BATCHES",
  "MIN_QUOTE_BALANCE",
  "BATCH_QUANTITY",
  "AVERAGE_DOWN_QUANTITY",
  "MAX_BATCH_QUANTITY",
  "ORDER_MODE",
  "MAKER_BOOK_LEVEL",
  "MAKER_MAX_SPREAD_PCT",
  "MAKER_ORDER_TIMEOUT_MINUTES",
  "MAKER_REPRICE_AFTER_MINUTES",
  "DUST_SELL_QUANTITY",
  "CHECK_INTERVAL_MINUTES",
  "MAX_SUSPICIOUS_PRICE_MOVE_PCT"
];
const READONLY_SETTINGS = [
  "INSTRUMENT",
  "BASE_ASSET",
  "QUOTE_ASSET",
  "LOG_DIR",
  "STRATEGY",
  "API_KEY_CONFIGURED",
  "API_SECRET_CONFIGURED",
  "SERVICE_NAME"
];
const SETTINGS_GROUPS = [
  {
    title: "Trading rezim",
    note: "Live obchodovanie je aktivne iba ked DRY_RUN=false a ENABLE_TRADING=true.",
    keys: ["DRY_RUN", "ENABLE_TRADING"]
  },
  {
    title: "Najcastejsie",
    note: "Percenta zisku/dokupu a limity novych zakladnych nakupov.",
    keys: [
      "AVERAGE_DOWN_DROP_PCT",
      "TAKE_PROFIT_RISE_PCT",
      "BUY_BASE_BATCH_EVERY_RUN",
      "BASE_BUY_COOLDOWN_MINUTES",
      "DAILY_BASE_BUY_LIMIT",
      "FORCE_BASE_BUY_WEEKLY_LIMIT",
      "MAX_OPEN_BATCHES",
      "MIN_QUOTE_BALANCE"
    ]
  },
  {
    title: "Davky",
    note: "Velkost jednej davky a jej maximalny rast dokupmi.",
    keys: ["BATCH_QUANTITY", "AVERAGE_DOWN_QUANTITY", "MAX_BATCH_QUANTITY"]
  },
  {
    title: "Ordery a maker rezim",
    note: "Ako bot zadava ordery a kedy prehadzuje maker limit order.",
    keys: ["ORDER_MODE", "MAKER_BOOK_LEVEL", "MAKER_MAX_SPREAD_PCT", "MAKER_ORDER_TIMEOUT_MINUTES", "MAKER_REPRICE_AFTER_MINUTES"]
  },
  {
    title: "Ostatne ochrany",
    note: "Menej caste nastavenia pre dust, interval a podozrive ceny.",
    keys: ["DUST_SELL_QUANTITY", "CHECK_INTERVAL_MINUTES", "MAX_SUSPICIOUS_PRICE_MOVE_PCT"]
  },
  {
    title: "Read-only",
    note: "Informacne polia, ktore sa cez web nemenia.",
    keys: READONLY_SETTINGS
  }
];
const BOOLEAN_SETTINGS = new Set(["BUY_BASE_BATCH_EVERY_RUN", "DRY_RUN", "ENABLE_TRADING"]);
const SETTING_OPTIONS = {
  ORDER_MODE: [
    { value: "maker", label: "maker limit" },
    { value: "market", label: "market / taker" }
  ]
};
const DEFAULT_SETTING_VALUES = {
  ORDER_MODE: "market",
  MAX_OPEN_BATCHES: "0",
  DAILY_BASE_BUY_LIMIT: "0",
  FORCE_BASE_BUY_WEEKLY_LIMIT: "0",
  BASE_BUY_COOLDOWN_MINUTES: "0",
  BUY_BASE_BATCH_EVERY_RUN: "false",
  DRY_RUN: "true",
  ENABLE_TRADING: "false",
  MIN_QUOTE_BALANCE: "0",
  MAX_SUSPICIOUS_PRICE_MOVE_PCT: "0",
  CHECK_INTERVAL_MINUTES: "60",
  MAKER_BOOK_LEVEL: "1",
  MAKER_MAX_SPREAD_PCT: "0",
  MAKER_ORDER_TIMEOUT_MINUTES: "15",
  MAKER_REPRICE_AFTER_MINUTES: "0"
};
const SETTING_HELP = {
  INSTRUMENT: "Obchodny par na burze, pre ktory tato sluzba bezi.",
  BASE_ASSET: "Minca, ktoru bot nakupuje a predava.",
  QUOTE_ASSET: "Mena, v ktorej sa cena a zostatok rataju.",
  LOG_DIR: "Adresar s logmi, SQLite databazou a stavom tohto paru.",
  STRATEGY: "Strategia, ktoru bot pouziva; aktualne hlavne davkova strategia.",
  ORDER_MODE: "Typ orderov, ktore bot pouziva, napr. maker limit rezim.",
  DRY_RUN: "Ak je true, bot iba simuluje a neposiela realne obchody.",
  ENABLE_TRADING: "Ak je true, bot moze realne obchodovat podla strategie.",
  API_KEY_CONFIGURED: "Bezpecny stav API key; samotny kluc sa nikdy nezobrazuje.",
  API_SECRET_CONFIGURED: "Bezpecny stav API secret; samotny secret sa nikdy nezobrazuje.",
  SERVICE_NAME: "Systemd sluzba, ktora spusta tento konkretny par.",
  BATCH_QUANTITY: "Velkost zakladnej davky, ktoru bot kupi pri beznom base buy.",
  AVERAGE_DOWN_QUANTITY: "Velkost dokupu pri poklese ceny; ak je prazdna, pouzije sa zakladna davka.",
  MAX_BATCH_QUANTITY: "Maximalne mnozstvo, kam moze jedna otvorena davka narast dokupmi.",
  MAX_OPEN_BATCHES: "Maximalny pocet otvorenych davok; 0 znamena bez limitu.",
  DAILY_BASE_BUY_LIMIT: "Maximalny pocet zakladnych nakupov za jeden UTC den; 0 znamena bez limitu.",
  FORCE_BASE_BUY_WEEKLY_LIMIT: "Minimalny pocet zakladnych nakupov za UTC tyzden, ktory ma bot skusit dodrzat.",
  BASE_BUY_COOLDOWN_MINUTES: "Minimalna pauza medzi zakladnymi nakupmi, aby restart nespravil extra nakup.",
  AVERAGE_DOWN_DROP_PCT: "Pokles pod priemer davky v percentach, pri ktorom bot dokupi do tejto davky.",
  TAKE_PROFIT_RISE_PCT: "Rast nad priemer davky v percentach, pri ktorom bot preda celu davku.",
  BUY_BASE_BATCH_EVERY_RUN: "Ci sa bot pri kazdom ticku moze pokusit otvorit novu zakladnu davku.",
  DUST_SELL_QUANTITY: "Minimalne mnozstvo dustu, pri ktorom sa bot moze pokusit dust predat.",
  MIN_QUOTE_BALANCE: "Minimalny USD zostatok, pod ktorym bot prestane robit nove nakupy.",
  MAX_SUSPICIOUS_PRICE_MOVE_PCT: "Maximalny povoleny skok ceny medzi tickmi; vacsi pohyb bot vyhodnoti ako podozrivy.",
  CHECK_INTERVAL_MINUTES: "Ako casto ma watch rezim spustat kontrolu a obchodnu logiku.",
  MAKER_BOOK_LEVEL: "Uroven order booku, z ktorej bot vybera maker limit cenu.",
  MAKER_MAX_SPREAD_PCT: "Maximalny spread v percentach, pri ktorom je maker order este povoleny.",
  MAKER_ORDER_TIMEOUT_MINUTES: "Po kolkych minutach sa aktivny maker order povazuje za prilis stary.",
  MAKER_REPRICE_AFTER_MINUTES: "Po kolkych minutach moze bot zrusit a prehodit maker order na novu cenu."
};

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
    state.reports = await fetchReports();
    state.pair = state.data.pairs[0]?.instrument || "BTC_USD";
    state.settingsPair = pairByInstrument(state.settingsPair)?.instrument || state.pair;
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
        <div class="mark"><img src="/favicon.png" alt="Batch Bot"></div>
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
          ${navButton("new-pair", "Novy par")}
          ${navButton("exports", "Export reportov")}
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
      : state.view === "new-pair"
        ? "Novy par"
      : state.view === "exports"
        ? "Export reportov"
      : state.view === "alerts"
        ? "Zdravie / chyby"
        : "Prehlad";
  const anyLiveTrading = state.data.pairs.some((pair) => String(pair.safeSettings.ENABLE_TRADING).toLowerCase() === "true");
  return `
    <div class="topbar">
      <div class="crumbs">Workspace / <strong>${title}</strong></div>
      <div class="top-actions">
        <span class="chip">Orders <strong>read-only</strong></span>
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
  if (state.view === "new-pair") return newPairPage();
  if (state.view === "exports") return exportsPage();
  if (state.view === "alerts") return alertsPage();
  return overviewPage();
}

function overviewPage() {
  const totals = state.data.totals;
  const alerts = state.data.alerts;
  return `
    ${alerts.length ? banner("warn", `${alerts.length} upozorneni na kontrolu`, alerts.slice(0, 2).map((a) => `${a.instrument}: ${a.title}`).join(" | ")) : banner("info", "Dashboard je bez manualnych orderov", "Zobrazuje logy a stav. Nastavenia vie menit iba cez whitelist s diffom, zalohou a restartom sluzby.")}
    <div class="kpi-row">
      ${kpi("Total portfolio", money(totals.portfolioValue), "Podla poslednych snapshotov")}
      ${kpi("Today P/L", signedMoney(totals.todayRealizedPnl), "realized dnes", totals.todayRealizedPnl)}
      ${kpi("Realized incl. dust", signedMoney(totals.realizedInclDust), `${totals.closedBatches} uzavretych davok`, totals.realizedInclDust)}
      ${kpi("Unrealized P/L", signedMoney(totals.unrealized), `${totals.openBatches} otvorenych davok`, totals.unrealized)}
      ${kpi("P/L p.a. incl. dust", pct(totals.annualizedStats?.annualizedInclSoldDustPct), "sold dust included", totals.annualizedStats?.annualizedInclSoldDustPct)}
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
        ${metric("P/L p.a. incl. dust", pct(pair.annualizedStats?.annualizedInclSoldDustPct), pair.annualizedStats?.annualizedInclSoldDustPct)}
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
      ${kpi("P/L p.a. incl. dust", pct(pair.annualizedStats?.annualizedInclSoldDustPct), "sold dust included", pair.annualizedStats?.annualizedInclSoldDustPct)}
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
      ${annualizedCard(pair)}
      ${dustCard(pair)}
    </div>
  `;
}

function settingsPage() {
  const activePair = pairByInstrument(state.settingsPair) || state.data.pairs[0];
  return `
    ${banner("warn", "Nastavenia menia realny bot", "Upravovat sa daju iba whitelist polia. API kluce, emaily, LOG_DIR a pary sa cez web nemenia. Trading rezim sa meni cez DRY_RUN/ENABLE_TRADING s diffom, varovaniami, zalohou .env a restartom sluzby.")}
    ${state.settingsMessage ? banner(state.settingsMessage.level, state.settingsMessage.title, state.settingsMessage.text) : ""}
    <div class="settings-pair-tabs tabs">
      ${state.data.pairs.map((pair) => `<button data-settings-pair="${pair.instrument}" class="${activePair?.instrument === pair.instrument ? "active" : ""}">${pair.instrument.replace("_", " / ")}</button>`).join("")}
    </div>
    ${activePair ? settingsCard(activePair) : `<div class="empty">Par sa nenasiel.</div>`}
  `;
}

async function fetchReports() {
  try {
    const response = await fetch("/api/reports", { cache: "no-store" });
    if (!response.ok) return { files: [] };
    return await response.json();
  } catch {
    return { files: [] };
  }
}

function settingsCard(pair) {
  const preview = state.settingsPreview?.instrument === pair.instrument ? state.settingsPreview : null;
  return `
    <div class="card">
      <div class="card-head">
        <h2>${pair.instrument.replace("_", " / ")}</h2>
        <span class="sub">${escapeHtml(pair.envFile)} · ${escapeHtml(pair.serviceName)}</span>
      </div>
      <div class="card-body">
        <form class="settings-form" data-settings-form="${pair.instrument}">
          ${SETTINGS_GROUPS.map((group) => settingsGroup(group, pair)).join("")}
          <div class="settings-actions">
            <button class="btn" type="submit">Review changes</button>
            <button class="btn" type="button" data-settings-reset="${pair.instrument}">Reset</button>
          </div>
        </form>
        ${preview ? settingsPreview(pair, preview) : ""}
        ${apiAccessCard(pair)}
        <details class="readonly-settings">
          <summary>Co znamena oznacenie</summary>
          <div class="settings-list">
            <div class="setting"><span>editable</span><span>da sa menit cez diff a restart</span></div>
            <div class="setting muted"><span>read-only</span><span>informacne pole, cez web nemenit</span></div>
            <div class="setting muted"><span>not set</span><span>v .env nie je nastavene, pouziva sa default alebo sa nepouziva</span></div>
          </div>
        </details>
      </div>
    </div>
  `;
}

function apiAccessCard(pair) {
  return `
    <section class="settings-group api-access">
      <div class="settings-group-head">
        <h3>API access</h3>
        <p>Vymena API key/secret pre tento par. Hodnoty sa nikdy nezobrazia naspat v UI.</p>
      </div>
      <div class="settings-list">
        <div class="setting"><span>API key</span><span>${escapeHtml(pair.safeSettings.API_KEY_CONFIGURED || "missing")}</span></div>
        <div class="setting"><span>API secret</span><span>${escapeHtml(pair.safeSettings.API_SECRET_CONFIGURED || "missing")}</span></div>
      </div>
      <form class="credentials-form" data-credentials-form="${pair.instrument}">
        <div class="settings-edit-list">
          ${newPairField("apiKey", "New API key", "", "Novy API key z Crypto.com pre tento par.", "text", "off")}
          ${newPairField("apiSecret", "New API secret", "", "Novy API secret. Po ulozeni sa uz nezobrazi.", "password", "new-password")}
        </div>
        <div class="settings-actions">
          <label class="setting-enable"><input type="checkbox" name="pauseTrading" checked> <span>Po vymene prepnut par do DRY_RUN=true / ENABLE_TRADING=false</span></label>
          <button class="btn btn-danger" type="submit">Replace API keys & restart</button>
        </div>
      </form>
    </section>
  `;
}

function settingsGroup(group, pair) {
  return `
    <section class="settings-group">
      <div class="settings-group-head">
        <h3>${escapeHtml(group.title)}</h3>
        <p>${escapeHtml(group.note)}</p>
      </div>
      <div class="settings-edit-list">
        ${group.keys.map((key) => settingsField(key, pair.safeSettings[key], pair)).join("")}
      </div>
    </section>
  `;
}

function settingsField(key, value, pair) {
  const help = SETTING_HELP[key] || "Bezpecne whitelist nastavenie strategie pre tento par.";
  const isSet = Object.prototype.hasOwnProperty.call(pair.safeSettings, key) && value !== undefined && value !== "";
  const editable = EDITABLE_SETTINGS.includes(key);
  const readonly = READONLY_SETTINGS.includes(key);
  const status = !isSet ? "not set / default" : readonly ? "read-only" : "editable";
  const disabled = editable && !readonly && isSet ? "" : "disabled";
  const fieldClass = `setting-field ${editable && !readonly ? "" : "is-muted"} ${!isSet && editable ? "is-unset" : ""}`;
  const fieldValue = isSet ? String(value ?? "") : defaultSettingValue(key, pair);
  const enableControl = !isSet && editable
    ? `<div class="setting-enable"><input type="checkbox" data-enable-setting="${escapeHtml(key)}"> <span>Use this setting</span></div>`
    : "";
  if (SETTING_OPTIONS[key]) {
    const selected = fieldValue || SETTING_OPTIONS[key][0].value;
    return `
      <label class="${fieldClass}">
        <span>${escapeHtml(key)} <em>${escapeHtml(status)}</em></span>
        ${enableControl}
        <select name="${escapeHtml(key)}" data-setting-input="${escapeHtml(key)}" ${disabled}>
          ${SETTING_OPTIONS[key].map((option) => `<option value="${escapeHtml(option.value)}" ${selected === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
        </select>
        <small>${escapeHtml(help)}</small>
      </label>
    `;
  }
  if (BOOLEAN_SETTINGS.has(key)) {
    const normalized = fieldValue.toLowerCase() === "true" ? "true" : "false";
    return `
      <label class="${fieldClass}">
        <span>${escapeHtml(key)} <em>${escapeHtml(status)}</em></span>
        ${enableControl}
        <select name="${escapeHtml(key)}" data-setting-input="${escapeHtml(key)}" ${disabled}>
          <option value="true" ${normalized === "true" ? "selected" : ""}>true</option>
          <option value="false" ${normalized === "false" ? "selected" : ""}>false</option>
        </select>
        <small>${escapeHtml(help)}</small>
      </label>
    `;
  }
  return `
    <label class="${fieldClass}">
      <span>${escapeHtml(key)} <em>${escapeHtml(status)}</em></span>
      ${enableControl}
      <input name="${escapeHtml(key)}" data-setting-input="${escapeHtml(key)}" value="${escapeHtml(fieldValue)}" placeholder="${isSet ? "" : "not set"}" inputmode="decimal" autocomplete="off" ${disabled}>
      <small>${escapeHtml(help)}</small>
    </label>
  `;
}

function defaultSettingValue(key, pair) {
  if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTING_VALUES, key)) return DEFAULT_SETTING_VALUES[key];
  if (key === "AVERAGE_DOWN_QUANTITY") return pair.safeSettings.BATCH_QUANTITY || "";
  return "";
}

function settingsPreview(pair, preview) {
  return `
    <div class="settings-preview">
      <div class="mini-title">Diff before apply</div>
      ${preview.warnings?.length ? `
        <div class="risk-box">
          <strong>Skontroluj pred ulozenim</strong>
          <ul>${preview.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${preview.changes.length ? `
        <div class="table-wrap compact"><table>
          <thead><tr><th>Key</th><th>Current</th><th>New</th></tr></thead>
          <tbody>${preview.changes.map((change) => `
            <tr>
              <td class="mono">${escapeHtml(change.key)}</td>
              <td class="mono">${escapeHtml(String(change.from ?? ""))}</td>
              <td class="mono">${escapeHtml(String(change.to ?? ""))}</td>
            </tr>
          `).join("")}</tbody>
        </table></div>
        <div class="settings-actions">
          <button class="btn btn-primary" type="button" data-settings-apply="${pair.instrument}">Apply & restart ${escapeHtml(pair.serviceName)}</button>
          <button class="btn" type="button" data-settings-cancel>Cancel</button>
        </div>
      ` : `<div class="empty compact">Ziadne zmeny na ulozenie.</div>`}
    </div>
  `;
}

function newPairPage() {
  return `
    ${banner("warn", "Novy par vznikne v dry-run rezime", "API key a secret sa ulozia iba do privatneho .env suboru na VPS. UI ich po ulozeni uz nikdy nezobrazi. ENABLE_TRADING ostane false, kym ho vedome nezapneme neskor.")}
    ${state.pairCreateMessage ? banner(state.pairCreateMessage.level, state.pairCreateMessage.title, state.pairCreateMessage.text) : ""}
    <div class="card">
      <div class="card-head"><h2>Pridat obchodny par</h2><span class="sub">samostatne API, .env, SQLite, report a systemd sluzba</span></div>
      <div class="card-body">
        <form class="new-pair-form" data-new-pair-form>
          <section class="settings-group">
            <div class="settings-group-head">
              <h3>Burza a pristup</h3>
              <p>API pristup bude oddeleny pre tento par, aby sa lepsie manazoval cash flow.</p>
            </div>
            <div class="settings-edit-list">
              ${newPairField("instrument", "Instrument", "ETH_USD", "Obchodny par presne ako na Crypto.com Exchange.")}
              ${newPairField("apiKey", "API key", "", "Novy API key z burzy pre tento konkretny par.", "text", "off")}
              ${newPairField("apiSecret", "API secret", "", "API secret sa ulozi len do privatneho .env suboru.", "password", "new-password")}
            </div>
            <div class="settings-actions">
              <button class="btn" type="button" data-check-instrument>Skontrolovat pravidla instrumentu</button>
            </div>
            <div id="instrument-rules-result" class="instrument-rules">
              ${instrumentRulesPanel(state.instrumentRules)}
            </div>
          </section>

          <section class="settings-group">
            <div class="settings-group-head">
              <h3>Zaklad strategie</h3>
              <p>Prve hodnoty. Po vytvoreni ich vies doladit v Nastaveniach paru.</p>
            </div>
            <div class="settings-edit-list">
              ${newPairSettingField("BATCH_QUANTITY", "", "Velkost zakladnej davky pre base buy.")}
              ${newPairSettingField("MAX_BATCH_QUANTITY", "", "Maximalna velkost jednej davky po dokupoch.")}
              ${newPairSettingField("AVERAGE_DOWN_QUANTITY", "", "Volitelne: ina velkost dokupu; prazdne znamena BATCH_QUANTITY.")}
              ${newPairSettingField("AVERAGE_DOWN_DROP_PCT", "5", "Pokles pod priemer davky, kedy bot dokupi.")}
              ${newPairSettingField("TAKE_PROFIT_RISE_PCT", "5", "Rast nad priemer davky, kedy bot predava.")}
              ${newPairSettingField("MIN_QUOTE_BALANCE", "25", "Minimalny USD zostatok, pod ktorym bot nenakupuje.")}
            </div>
          </section>

          <section class="settings-group">
            <div class="settings-group-head">
              <h3>Limity a ordery</h3>
              <p>Bezpecne defaulty pre novy par. Live trading ostava vypnuty.</p>
            </div>
            <div class="settings-edit-list">
              ${newPairSelect("ORDER_MODE", "maker", "Typ orderov pre novy par.", [{ value: "maker", label: "maker limit" }, { value: "market", label: "market / taker" }])}
              ${newPairSettingField("MAX_OPEN_BATCHES", "0", "Max pocet otvorenych davok; 0 znamena bez limitu.")}
              ${newPairSettingField("DAILY_BASE_BUY_LIMIT", "0", "Max zakladnych nakupov za UTC den; 0 znamena bez limitu.")}
              ${newPairSettingField("FORCE_BASE_BUY_WEEKLY_LIMIT", "0", "Vynuteny minimalny pocet base buy za tyzden; 0 vypnute.")}
              ${newPairSettingField("BASE_BUY_COOLDOWN_MINUTES", "60", "Pauza medzi zakladnymi nakupmi.")}
              ${newPairSelect("BUY_BASE_BATCH_EVERY_RUN", "true", "Ci sa bot moze pokusit o base buy pri kazdom ticku.", [{ value: "true", label: "true" }, { value: "false", label: "false" }])}
              ${newPairSettingField("DUST_SELL_QUANTITY", "", "Minimalne mnozstvo dustu na predaj.")}
              ${newPairSettingField("CHECK_INTERVAL_MINUTES", "60", "Interval watch rezimu v minutach.")}
              ${newPairSettingField("MAX_SUSPICIOUS_PRICE_MOVE_PCT", "25", "Ochrana pred podozrivym cenovym skokom.")}
              ${newPairSettingField("MAKER_BOOK_LEVEL", "3", "Uroven order booku pre maker cenu.")}
              ${newPairSettingField("MAKER_MAX_SPREAD_PCT", "0", "Max spread; 0 vypina spread guard.")}
              ${newPairSettingField("MAKER_ORDER_TIMEOUT_MINUTES", "15", "Po kolkych minutach je maker order stale.")}
              ${newPairSettingField("MAKER_REPRICE_AFTER_MINUTES", "0", "Po kolkych minutach sa moze maker order prehodit; 0 vypnute.")}
            </div>
          </section>

          <div class="settings-actions">
            <label class="setting-enable"><input type="checkbox" name="startService" checked> <span>Po vytvoreni spustit dry-run sluzbu</span></label>
            <button class="btn btn-primary" type="submit">Create pair</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function instrumentRulesPanel(info, form = null) {
  if (!info) {
    return `
      <div class="empty compact">
        Najprv zadaj instrument a skontroluj pravidla. Pouziju sa verejne data z Crypto.com, bez API kluca.
      </div>
    `;
  }
  if (info.error) {
    return banner("error", "Instrument rules check failed", info.error);
  }

  const warnings = instrumentQuantityWarnings(info, form);
  return `
    <div class="rules-panel">
      <div class="rules-head">
        <strong>${escapeHtml(info.instrument)}</strong>
        <span class="sub">${escapeHtml(info.baseAsset || "-")} / ${escapeHtml(info.quoteAsset || "-")}</span>
      </div>
      <div class="settings-list">
        ${settingRow("Last price", info.lastPrice ? money(info.lastPrice, 8) : "-")}
        ${settingRow("Recommended min qty", formatAssetQty(info.recommended?.minQuantity))}
        ${settingRow("Min notional", info.rules?.minNotional ? money(info.rules.minNotional, 2) : "-")}
        ${settingRow("Min qty", formatAssetQty(info.rules?.minQuantity))}
        ${settingRow("Qty decimals", fmt(info.rules?.quantityDecimals ?? 0, 0))}
        ${settingRow("Price decimals", fmt(info.rules?.priceDecimals ?? 0, 0))}
        ${settingRow("Qty tick", formatAssetQty(info.rules?.quantityTickSize))}
        ${settingRow("Price tick", formatAssetQty(info.rules?.priceTickSize))}
      </div>
      ${warnings.length ? `
        <div class="risk-box">
          <strong>Skontroluj davky</strong>
          <ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : `<div class="rules-ok"><span class="dot"></span> Davky vo formulari vyzeraju nad odporucanym minimom.</div>`}
      ${info.warnings?.length ? `
        <div class="risk-box">
          <strong>Poznamky z kontroly</strong>
          <ul>${info.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
    </div>
  `;
}

function instrumentQuantityWarnings(info, form = null) {
  const source = form ? Object.fromEntries(new FormData(form).entries()) : {};
  const minimum = Number(info?.recommended?.minQuantity || info?.rules?.minQuantity || 0);
  const warnings = [];
  if (!minimum) {
    warnings.push("Burza nevratila jasne minimum; po vytvoreni nechaj par najprv bezat v dry-run.");
    return warnings;
  }
  for (const key of ["BATCH_QUANTITY", "AVERAGE_DOWN_QUANTITY", "MAX_BATCH_QUANTITY", "DUST_SELL_QUANTITY"]) {
    const raw = String(source[key] || "").trim();
    if (!raw && key === "AVERAGE_DOWN_QUANTITY") continue;
    if (!raw) {
      warnings.push(`${key} este nie je vyplnene.`);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      warnings.push(`${key} musi byt kladne cislo.`);
    } else if (value < minimum) {
      warnings.push(`${key} je pod odporucanym minimom ${formatAssetQty(minimum)}.`);
    }
  }
  const batch = Number(source.BATCH_QUANTITY || 0);
  const maxBatch = Number(source.MAX_BATCH_QUANTITY || 0);
  if (batch > 0 && maxBatch > 0 && maxBatch < batch) {
    warnings.push("MAX_BATCH_QUANTITY je mensie ako BATCH_QUANTITY.");
  }
  return warnings;
}

function newPairField(name, label, value, help, type = "text", autocomplete = "off") {
  return `
    <label class="setting-field">
      <span>${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" value="${escapeHtml(value)}" type="${escapeHtml(type)}" autocomplete="${escapeHtml(autocomplete)}">
      <small>${escapeHtml(help)}</small>
    </label>
  `;
}

function newPairSettingField(key, value, help) {
  return `
    <label class="setting-field">
      <span>${escapeHtml(key)}</span>
      <input name="${escapeHtml(key)}" value="${escapeHtml(value)}" inputmode="decimal" autocomplete="off">
      <small>${escapeHtml(help)}</small>
    </label>
  `;
}

function newPairSelect(key, selected, help, options) {
  return `
    <label class="setting-field">
      <span>${escapeHtml(key)}</span>
      <select name="${escapeHtml(key)}">
        ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${selected === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
      <small>${escapeHtml(help)}</small>
    </label>
  `;
}

function exportsPage() {
  const files = state.reports?.files || [];
  const byPair = groupBy(files, (file) => file.pair || "other");
  const groups = Object.entries(byPair);
  return `
    ${banner("info", "Export reportov", "Stiahnes iba aktualne HTML/CSV subory z reports/. Reporty mozu obsahovat privatne balances a historiu obchodov.")}
    ${files.length ? groups.map(([pair, rows]) => `
      <div class="card">
        <div class="card-head"><h2>${escapeHtml(pair)}</h2><span class="sub">${rows.length} suborov</span></div>
        <div class="card-body flush">
          <table>
            <thead><tr><th>Report</th><th>Typ</th><th class="right">Velkost</th><th class="right">Aktualizovane</th><th class="right">Akcia</th></tr></thead>
            <tbody>${rows.map((file) => `
              <tr>
                <td>${escapeHtml(file.label)}</td>
                <td class="mono">${escapeHtml(file.kind)}</td>
                <td class="right mono">${fileSize(file.size)}</td>
                <td class="right mono">${shortDate(file.mtime)}</td>
                <td class="right"><a class="btn btn-link" href="${escapeHtml(file.url)}">Download</a></td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      </div>
    `).join("") : `<div class="empty">Zatial nie su dostupne reporty v adresari reports/.</div>`}
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
    ${serviceControlsCard()}
    ${systemStatusCard()}
  `;
}

function serviceControlsCard() {
  return `
    <div class="card">
      <div class="card-head"><h2>Service control</h2><span class="sub">start / pause / restart</span></div>
      <div class="card-body">
        ${state.serviceMessage ? banner(state.serviceMessage.level, state.serviceMessage.title, state.serviceMessage.text) : ""}
        <div class="service-control-list">
          ${state.data.pairs.map((pair) => `
            <div class="service-control-row">
              <div>
                <strong>${pair.instrument.replace("_", " / ")}</strong>
                <div class="sub">${escapeHtml(pair.serviceName)} · ${serviceLabel(pair.serviceActive)}</div>
              </div>
              <div class="service-actions">
                <button class="btn" data-service-action="start" data-service-pair="${pair.instrument}">Start</button>
                <button class="btn" data-service-action="restart" data-service-pair="${pair.instrument}">Restart</button>
                <button class="btn btn-danger" data-service-action="stop" data-service-pair="${pair.instrument}">Pause</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
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
        <h2>Daily realized P/L</h2><span class="sub">closed batches + sold dust · UTC</span>
        <div class="head-right tabs">${DAILY_RANGES.map((range) => `<button data-daily-range="${range}" class="${state.dailyRange === range ? "active" : ""}">${range === "all" ? "All" : range}</button>`).join("")}</div>
      </div>
      <div class="card-body">
        ${rows.length ? dailyBars(rows) : `<div class="empty">Zatial nie su denne P/L data.</div>`}
        <div class="chart-note">Open batches are not included here. Days without a closed batch or sold dust are shown as $0.</div>
      </div>
    </div>
  `;
}

function combinedDailyPnlRows() {
  const rows = new Map();
  for (const pair of state.data.pairs) {
    for (const row of pair.dailySummaries || []) {
      const current = rows.get(row.day) || { day: row.day, realizedInclSoldDust: 0, realizedCash: 0, dustSoldValue: 0, closedBatches: 0 };
      current.realizedCash += Number(row.realizedCash || 0);
      current.dustSoldValue += Number(row.dustSoldValue || 0);
      current.realizedInclSoldDust += dailyRealizedInclSoldDust(row);
      current.closedBatches += Number(row.closedBatches || 0);
      rows.set(row.day, current);
    }
  }
  if (state.dailyRange === "all") {
    return Array.from(rows.values()).sort((a, b) => a.day.localeCompare(b.day));
  }
  const count = state.dailyRange === "30d" ? 30 : 7;
  return lastUtcDays(count).map((day) => rows.get(day) || {
    day,
    realizedInclSoldDust: 0,
    realizedCash: 0,
    dustSoldValue: 0,
    closedBatches: 0
  });
}

function dailyBars(rows) {
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.realizedInclSoldDust || 0))), 1);
  return `<div class="bars bars-${state.dailyRange}" aria-label="Daily realized P/L">
    <div class="bar-zero"></div>
    ${rows.map((row) => {
      const value = Number(row.realizedInclSoldDust || 0);
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

function dailyRealizedInclSoldDust(row) {
  return Number(row.realizedCash || 0) + Number(row.dustSoldValue || 0);
}

function lastUtcDays(count) {
  const end = state.data.generatedAt ? new Date(state.data.generatedAt) : new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() - (count - 1 - index));
    return day.toISOString().slice(0, 10);
  });
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
    <thead><tr><th>ID</th><th>Closed</th><th class="right">P/L incl. dust</th><th class="right">%</th><th class="right">P/L p.a.</th><th class="right">Hold</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td class="mono">${shortId(row.id)}</td>
      <td class="mono">${shortDate(row.closedAt)}</td>
      <td class="right num ${tone(row.realizedPnlInclDust)}">${signedMoney(row.realizedPnlInclDust)}</td>
      <td class="right num ${tone(row.realizedPctInclDust)}">${signedPct(row.realizedPctInclDust)}</td>
      <td class="right num ${tone(row.annualizedPct)}">${pct(row.annualizedPct)}</td>
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
        ${metric("Other", fmt(stats.other || 0, 0))}
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

function annualizedCard(pair) {
  const stats = pair.annualizedStats || {};
  return `
    <div class="card">
      <div class="card-head"><h3>Annualized P/L</h3><span class="sub">closed batches</span></div>
      <div class="card-body">
        ${metric("P/L p.a.", pct(stats.batchAnnualizedPct), stats.batchAnnualizedPct)}
        ${metric("Profit", signedMoney(stats.batchProfit || 0), stats.batchProfit || 0)}
        ${metric("Capital-years", fmt(stats.batchCapitalYears || 0, 6))}
        ${metric("P/L p.a. incl. sold dust", pct(stats.annualizedInclSoldDustPct), stats.annualizedInclSoldDustPct)}
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

function settingRow(label, value) {
  return `<div class="setting"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
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
  document.querySelectorAll("[data-daily-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dailyRange = button.dataset.dailyRange;
      render();
    });
  });
  document.querySelectorAll("[data-settings-pair]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsPair = button.dataset.settingsPair;
      state.settingsPreview = null;
      state.settingsMessage = null;
      render();
    });
  });
  document.querySelectorAll("[data-settings-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await reviewSettings(form);
    });
  });
  document.querySelectorAll("[data-enable-setting]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const field = checkbox.closest(".setting-field");
      const input = field?.querySelector(`[data-setting-input="${cssEscape(checkbox.dataset.enableSetting)}"]`);
      if (!input) return;
      input.disabled = !checkbox.checked;
      field.classList.toggle("is-enabled", checkbox.checked);
    });
  });
  document.querySelectorAll("[data-settings-apply]").forEach((button) => {
    button.addEventListener("click", async () => applySettings(button.dataset.settingsApply));
  });
  document.querySelectorAll("[data-settings-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsPreview = null;
      state.settingsMessage = null;
      render();
    });
  });
  document.querySelectorAll("[data-settings-reset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsPreview = null;
      state.settingsMessage = null;
      render();
    });
  });
  document.querySelectorAll("[data-service-action]").forEach((button) => {
    button.addEventListener("click", async () => controlService(button.dataset.servicePair, button.dataset.serviceAction));
  });
  document.querySelector("[data-check-instrument]")?.addEventListener("click", async () => checkInstrumentRules());
  const newPairForm = document.querySelector("[data-new-pair-form]");
  if (newPairForm) {
    newPairForm.querySelectorAll("input[name='BATCH_QUANTITY'], input[name='AVERAGE_DOWN_QUANTITY'], input[name='MAX_BATCH_QUANTITY'], input[name='DUST_SELL_QUANTITY']").forEach((input) => {
      input.addEventListener("input", () => refreshInstrumentRulesPanel(newPairForm));
    });
    newPairForm.querySelector("input[name='instrument']")?.addEventListener("input", () => {
      state.instrumentRules = null;
      refreshInstrumentRulesPanel(newPairForm);
    });
  }
  document.querySelector("[data-new-pair-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createPair(event.currentTarget);
  });
  document.querySelectorAll("[data-credentials-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await replaceCredentials(form);
    });
  });
  document.querySelector("[data-refresh]")?.addEventListener("click", init);
}

async function checkInstrumentRules() {
  const form = document.querySelector("[data-new-pair-form]");
  if (!form) return;
  const instrument = String(new FormData(form).get("instrument") || "").trim().toUpperCase();
  const target = document.getElementById("instrument-rules-result");
  if (!instrument) {
    state.instrumentRules = { error: "Najprv zadaj instrument, napriklad ETH_USD." };
    refreshInstrumentRulesPanel(form);
    return;
  }
  if (target) target.innerHTML = `<div class="empty compact">Kontrolujem ${escapeHtml(instrument)} na Crypto.com...</div>`;
  try {
    const response = await fetch(`/api/instrument-rules?instrument=${encodeURIComponent(instrument)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    state.instrumentRules = data;
  } catch (error) {
    state.instrumentRules = { error: error.message };
  }
  refreshInstrumentRulesPanel(form);
}

function refreshInstrumentRulesPanel(form) {
  const target = document.getElementById("instrument-rules-result");
  if (!target) return;
  target.innerHTML = instrumentRulesPanel(state.instrumentRules, form);
}

async function reviewSettings(form) {
  const instrument = form.dataset.settingsForm;
  state.settingsMessage = null;
  try {
    state.settingsPreview = await postJson("/api/settings/preview", {
      instrument,
      settings: Object.fromEntries(new FormData(form).entries())
    });
  } catch (error) {
    state.settingsPreview = null;
    state.settingsMessage = { level: "error", title: "Settings preview failed", text: error.message };
  }
  render();
}

async function applySettings(instrument) {
  if (!state.settingsPreview || state.settingsPreview.instrument !== instrument) return;
  try {
    const result = await postJson("/api/settings/apply", {
      instrument,
      settings: Object.fromEntries(state.settingsPreview.changes.map((change) => [change.key, change.to])),
      restart: true
    });
    state.settingsPreview = null;
    state.settingsMessage = {
      level: "info",
      title: "Settings saved",
      text: `${result.instrument || instrument}: backup ${result.backupPath || "-"}, restart ${result.restarted ? "OK" : "not requested"}.`
    };
    await init();
  } catch (error) {
    state.settingsMessage = { level: "error", title: "Settings apply failed", text: error.message };
    render();
  }
}

async function controlService(instrument, action) {
  const pair = pairByInstrument(instrument);
  const label = action === "stop" ? "pause" : action;
  if (!pair) return;
  const ok = window.confirm(`${label.toUpperCase()} ${pair.instrument.replace("_", " / ")}?\n\nThis controls systemd service ${pair.serviceName}.`);
  if (!ok) return;
  try {
    const result = await postJson("/api/service/control", { instrument, action });
    state.serviceMessage = {
      level: "info",
      title: "Service control OK",
      text: `${result.instrument}: ${result.action} ${result.serviceName}, active=${result.active ? "yes" : "no"}.`
    };
    await init();
  } catch (error) {
    state.serviceMessage = { level: "error", title: "Service control failed", text: error.message };
    render();
  }
}

async function createPair(form) {
  state.pairCreateMessage = null;
  const values = Object.fromEntries(new FormData(form).entries());
  const settings = {};
  for (const key of [
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
    "MAKER_BOOK_LEVEL",
    "MAKER_MAX_SPREAD_PCT",
    "MAKER_ORDER_TIMEOUT_MINUTES",
    "MAKER_REPRICE_AFTER_MINUTES"
  ]) {
    settings[key] = values[key] || "";
  }
  try {
    const result = await postJson("/api/pairs/create", {
      instrument: values.instrument || "",
      apiKey: values.apiKey || "",
      apiSecret: values.apiSecret || "",
      settings,
      startService: values.startService === "on"
    });
    state.pairCreateMessage = {
      level: "info",
      title: "Pair created",
      text: `${result.instrument}: ${result.envFile}, ${result.serviceName}, dry-run service ${result.serviceActive ? "running" : "created"}.`
    };
    state.instrumentRules = null;
    form.reset();
    await init();
    state.view = "new-pair";
    render();
  } catch (error) {
    state.pairCreateMessage = { level: "error", title: "Pair create failed", text: error.message };
    render();
  }
}

async function replaceCredentials(form) {
  const instrument = form.dataset.credentialsForm;
  const pair = pairByInstrument(instrument);
  if (!pair) return;
  const ok = window.confirm(`Replace API keys for ${pair.instrument.replace("_", " / ")}?\n\nA .env backup will be created and ${pair.serviceName} will be restarted.`);
  if (!ok) return;

  const values = Object.fromEntries(new FormData(form).entries());
  state.settingsMessage = null;
  try {
    const result = await postJson("/api/credentials/replace", {
      instrument,
      apiKey: values.apiKey || "",
      apiSecret: values.apiSecret || "",
      pauseTrading: values.pauseTrading === "on"
    });
    state.settingsMessage = {
      level: "info",
      title: "API keys replaced",
      text: `${result.instrument}: backup ${result.backupPath || "-"}, restart ${result.restarted ? "OK" : "not requested"}, ${result.tradingPaused ? "dry-run enabled" : "trading mode unchanged"}.`
    };
    form.reset();
    await init();
    state.view = "settings";
    state.settingsPair = instrument;
    render();
  } catch (error) {
    state.settingsMessage = { level: "error", title: "API key replace failed", text: error.message };
    render();
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.restartError || `Request failed (${response.status})`);
  }
  return data;
}

function cssEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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
  if (value === "filled" || value === "partially_filled") return "filled";
  if (value === "active") return "active";
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

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

function fileSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${fmt(value / 1024 / 1024, 1)} MB`;
  if (value >= 1024) return `${fmt(value / 1024, 1)} KB`;
  return `${fmt(value, 0)} B`;
}

function priceDigits(pair) {
  return pair.baseAsset === "BTC" ? 2 : 4;
}

function money(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `$${fmt(number, digits)}`;
}

function formatAssetQty(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return number === 0 ? "0" : "-";
  if (Math.abs(number) >= 1) return fmt(number, Math.min(8, number % 1 === 0 ? 0 : 8)).replace(/\.?0+$/, "");
  return number.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 12 }).replace(/\.?0+$/, "");
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

function pct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${fmt(number, 2)}%`;
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
