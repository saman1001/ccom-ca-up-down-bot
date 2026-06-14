import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./config.js";
import { buildDashboardPayload } from "./webData.js";

loadDotEnv(path.resolve(".env.web"));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "web");
const reportsDir = path.resolve("reports");
const host = process.env.WEB_BIND_HOST || "127.0.0.1";
const port = Number(process.env.WEB_PORT || 8787);
const sessionHours = Number(process.env.WEB_SESSION_HOURS || 8);
const sessions = new Map();
const EDITABLE_SETTING_KEYS = new Set([
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
]);
const BOOLEAN_SETTING_KEYS = new Set(["BUY_BASE_BATCH_EVERY_RUN"]);
const PAIR_CREATE_NUMERIC_KEYS = [
  "BATCH_QUANTITY",
  "AVERAGE_DOWN_QUANTITY",
  "MAX_BATCH_QUANTITY",
  "MAX_OPEN_BATCHES",
  "DAILY_BASE_BUY_LIMIT",
  "FORCE_BASE_BUY_WEEKLY_LIMIT",
  "BASE_BUY_COOLDOWN_MINUTES",
  "AVERAGE_DOWN_DROP_PCT",
  "TAKE_PROFIT_RISE_PCT",
  "DUST_SELL_QUANTITY",
  "MIN_QUOTE_BALANCE",
  "MAX_SUSPICIOUS_PRICE_MOVE_PCT",
  "CHECK_INTERVAL_MINUTES",
  "MAKER_BOOK_LEVEL",
  "MAKER_MAX_SPREAD_PCT",
  "MAKER_ORDER_TIMEOUT_MINUTES",
  "MAKER_REPRICE_AFTER_MINUTES"
];
const PAIR_CREATE_DEFAULTS = {
  STRATEGY: "batches",
  ORDER_MODE: "maker",
  BATCH_QUANTITY: "",
  AVERAGE_DOWN_QUANTITY: "",
  MAX_BATCH_QUANTITY: "",
  MAX_OPEN_BATCHES: "0",
  DAILY_BASE_BUY_LIMIT: "0",
  FORCE_BASE_BUY_WEEKLY_LIMIT: "0",
  BASE_BUY_COOLDOWN_MINUTES: "60",
  AVERAGE_DOWN_DROP_PCT: "5",
  TAKE_PROFIT_RISE_PCT: "5",
  BUY_BASE_BATCH_EVERY_RUN: "true",
  DUST_SELL_QUANTITY: "",
  MIN_QUOTE_BALANCE: "25",
  MAX_SUSPICIOUS_PRICE_MOVE_PCT: "25",
  CHECK_INTERVAL_MINUTES: "60",
  MAKER_BOOK_LEVEL: "3",
  MAKER_MAX_SPREAD_PCT: "0",
  MAKER_ORDER_TIMEOUT_MINUTES: "15",
  MAKER_REPRICE_AFTER_MINUTES: "0"
};

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.status ? error.message : "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Read-only bot web dashboard listening on http://${host}:${port}`);
  if (!webPassword()) {
    console.log("WEB_PASSWORD is not set. Create .env.web before logging in.");
  }
});

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/login") {
    return sendHtml(res, loginPage({ error: url.searchParams.get("error") || "" }));
  }

  if (req.method === "GET" && pathname === "/login-hero.png") {
    return sendFile(res, path.join(publicDir, "login-hero.png"));
  }

  if (req.method === "GET" && (pathname === "/favicon.ico" || pathname === "/favicon.png")) {
    return sendFile(res, path.join(publicDir, "favicon.png"));
  }

  if (req.method === "POST" && pathname === "/login") {
    return handleLogin(req, res);
  }

  if (req.method === "POST" && pathname === "/logout") {
    clearSessionCookie(res);
    return redirect(res, "/login");
  }

  if (!isAuthenticated(req)) {
    if (pathname.startsWith("/api/")) return sendJson(res, 401, { error: "Not authenticated" });
    return redirect(res, "/login");
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    return sendJson(res, 200, buildDashboardPayload());
  }

  if (req.method === "GET" && pathname === "/api/reports") {
    return sendJson(res, 200, buildReportsPayload());
  }

  if (req.method === "POST" && pathname === "/api/pairs/create") {
    return handlePairCreate(req, res);
  }

  if (req.method === "GET" && pathname === "/api/reports/download") {
    return handleReportDownload(url, res);
  }

  if (req.method === "POST" && pathname === "/api/service/control") {
    return handleServiceControl(req, res);
  }

  if (req.method === "POST" && pathname === "/api/settings/preview") {
    return handleSettingsPreview(req, res);
  }

  if (req.method === "POST" && pathname === "/api/settings/apply") {
    return handleSettingsApply(req, res);
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return sendFile(res, path.join(publicDir, "index.html"));
  }

  if (req.method === "GET") {
    const filePath = path.resolve(publicDir, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(publicDir + path.sep)) return sendText(res, 403, "Forbidden");
    return sendFile(res, filePath);
  }

  sendText(res, 405, "Method not allowed");
}

async function handleServiceControl(req, res) {
  const body = await readJsonBody(req);
  const instrument = String(body.instrument || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const payload = buildDashboardPayload();
  const pair = payload.pairs.find((item) => item.instrument === instrument);
  if (!pair) throw httpError(404, "Pair not found");

  const result = controlService(pair.serviceName, action);
  if (!result.ok) {
    return sendJson(res, 500, {
      ok: false,
      instrument,
      serviceName: pair.serviceName,
      action,
      error: result.error
    });
  }

  return sendJson(res, 200, {
    ok: true,
    instrument,
    serviceName: pair.serviceName,
    action,
    active: serviceIsActive(pair.serviceName)
  });
}

async function handleSettingsPreview(req, res) {
  const body = await readJsonBody(req);
  const result = settingsPlan(body);
  return sendJson(res, 200, {
    ok: true,
    instrument: result.pair.instrument,
    envFile: result.pair.envFile,
    serviceName: result.pair.serviceName,
    changes: result.changes,
    warnings: result.warnings
  });
}

async function handleSettingsApply(req, res) {
  const body = await readJsonBody(req);
  const result = settingsPlan(body);
  if (!result.changes.length) {
    return sendJson(res, 200, { ok: true, message: "No changes", changes: [], restarted: false });
  }

  const backupPath = backupEnvFile(result.envPath);
  writeEnvFile(result.envPath, result.changes);

  let restarted = false;
  let restartError = "";
  if (body.restart !== false) {
    const restart = restartService(result.pair.serviceName);
    restarted = restart.ok;
    restartError = restart.error;
    if (!restart.ok) {
      return sendJson(res, 500, {
        ok: false,
        error: "Settings were saved, but service restart failed.",
        backupPath: displayPath(backupPath),
        changes: result.changes,
        restartError
      });
    }
  }

  return sendJson(res, 200, {
    ok: true,
    message: restarted ? "Settings saved and service restarted." : "Settings saved.",
    instrument: result.pair.instrument,
    envFile: result.pair.envFile,
    serviceName: result.pair.serviceName,
    backupPath: displayPath(backupPath),
    changes: result.changes,
    restarted
  });
}

async function handlePairCreate(req, res) {
  const body = await readJsonBody(req);
  const result = createPair(body);
  return sendJson(res, 200, {
    ok: true,
    instrument: result.instrument,
    envFile: result.envFile,
    logDir: result.logDir,
    serviceName: result.serviceName,
    apiKeyConfigured: true,
    apiSecretConfigured: true,
    webEnvUpdated: result.webEnvUpdated,
    unitCreated: result.unitCreated,
    daemonReloaded: result.daemonReloaded,
    serviceEnabled: result.serviceEnabled,
    serviceStarted: result.serviceStarted,
    serviceActive: result.serviceActive,
    reportGenerated: result.reportGenerated,
    warnings: result.warnings
  });
}

async function handleLogin(req, res) {
  const password = webPassword();
  if (!password) return redirect(res, "/login?error=missing-password");

  const body = await readBody(req);
  const fields = new URLSearchParams(body);
  const username = fields.get("username") || "";
  const submitted = fields.get("password") || "";
  if (!safeEqual(username, webUsername()) || !safeEqual(submitted, password)) {
    return redirect(res, "/login?error=bad-password");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionHours * 60 * 60 * 1000;
  sessions.set(token, expiresAt);
  setSessionCookie(res, token);
  redirect(res, "/");
}

function isAuthenticated(req) {
  const cookie = parseCookies(req.headers.cookie || "").bot_session;
  if (!cookie) return false;
  const [token, signature] = cookie.split(".");
  if (!token || !signature) return false;
  if (!safeEqual(signature, sign(token))) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(res, token) {
  const maxAge = Math.round(sessionHours * 60 * 60);
  const secure = process.env.WEB_COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `bot_session=${token}.${sign(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "bot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function sessionSecret() {
  return process.env.WEB_SESSION_SECRET || webPassword() || "missing-local-secret";
}

function webPassword() {
  return process.env.WEB_PASSWORD || "";
}

function webUsername() {
  return process.env.WEB_USERNAME || "admin";
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await readBody(req);
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function settingsPlan(body) {
  const instrument = String(body.instrument || "").trim();
  const payload = buildDashboardPayload();
  const pair = payload.pairs.find((item) => item.instrument === instrument);
  if (!pair) throw httpError(404, "Pair not found");

  const envPath = resolveEnvFile(pair.envFile);
  const currentEnv = parseEnvFile(envPath);
  const submitted = body.settings && typeof body.settings === "object" ? body.settings : {};
  const changes = [];
  const warnings = [];

  for (const [key, rawValue] of Object.entries(submitted)) {
    if (!EDITABLE_SETTING_KEYS.has(key)) continue;
    const value = normalizeSettingValue(key, rawValue);
    const from = currentEnv[key] ?? "";
    if (key === "ORDER_MODE" && from === "maker" && value === "market" && Number(pair.health?.activeMakerOrders || 0) > 0) {
      throw httpError(409, "ORDER_MODE cannot switch from maker to market while active maker orders exist. Wait for fill/cancel first.");
    }
    if (String(from) !== value) {
      changes.push({ key, from, to: value });
    }
  }

  if (body.settings && Object.keys(submitted).some((key) => !EDITABLE_SETTING_KEYS.has(key))) {
    warnings.push("Some submitted fields were ignored because they are not editable from the web UI.");
  }
  warnings.push(...settingsRiskWarnings(pair, { ...currentEnv, ...Object.fromEntries(changes.map((change) => [change.key, change.to])) }, changes));

  return { pair, envPath, changes, warnings };
}

function resolveEnvFile(envFile) {
  const cwd = process.cwd();
  const fullPath = path.resolve(cwd, envFile);
  if (!fullPath.startsWith(cwd + path.sep)) throw httpError(400, "Invalid env file path");
  if (!fs.existsSync(fullPath)) throw httpError(404, "Env file not found");
  return fullPath;
}

function parseEnvFile(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function normalizeSettingValue(key, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (key === "ORDER_MODE") {
    if (!["market", "maker"].includes(value)) throw httpError(400, "ORDER_MODE must be market or maker");
    return value;
  }
  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (!["true", "false"].includes(value.toLowerCase())) throw httpError(400, `${key} must be true or false`);
    return value.toLowerCase();
  }
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw httpError(400, `${key} must be a number`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw httpError(400, `${key} must be a valid number`);
  if (number < 0) throw httpError(400, `${key} must be zero or greater`);
  if (key === "CHECK_INTERVAL_MINUTES" && number <= 0) throw httpError(400, `${key} must be greater than zero`);
  return value;
}

function settingsRiskWarnings(pair, env, changes) {
  if (!changes.length) return [];
  const warnings = [];
  const changed = new Set(changes.map((change) => change.key));
  const number = (key, fallback = 0) => {
    const value = Number(env[key] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };
  const bool = (key) => String(env[key] ?? "").toLowerCase() === "true";
  const batchQty = number("BATCH_QUANTITY");
  const avgDownQty = env.AVERAGE_DOWN_QUANTITY === undefined || env.AVERAGE_DOWN_QUANTITY === ""
    ? batchQty
    : number("AVERAGE_DOWN_QUANTITY");
  const maxBatchQty = number("MAX_BATCH_QUANTITY");
  const maxOpen = number("MAX_OPEN_BATCHES");
  const dailyLimit = number("DAILY_BASE_BUY_LIMIT");
  const cooldown = number("BASE_BUY_COOLDOWN_MINUTES");
  const forceWeekly = number("FORCE_BASE_BUY_WEEKLY_LIMIT");
  const takeProfit = number("TAKE_PROFIT_RISE_PCT");
  const averageDown = number("AVERAGE_DOWN_DROP_PCT");
  const minQuote = number("MIN_QUOTE_BALANCE");
  const checkInterval = number("CHECK_INTERVAL_MINUTES", 60);
  const makerTimeout = number("MAKER_ORDER_TIMEOUT_MINUTES");
  const makerReprice = number("MAKER_REPRICE_AFTER_MINUTES");
  const orderModeChange = changes.find((change) => change.key === "ORDER_MODE");

  if (orderModeChange?.from === "maker" && orderModeChange.to === "market") {
    warnings.push("ORDER_MODE changes from maker to market/taker; new orders may fill immediately but can pay taker fees and get worse execution price.");
  }
  if (orderModeChange?.from === "market" && orderModeChange.to === "maker") {
    warnings.push("ORDER_MODE changes from market/taker to maker; orders may wait in the order book and can become stale if the price moves away.");
  }

  if (maxBatchQty > 0 && batchQty > maxBatchQty) {
    warnings.push("BATCH_QUANTITY is higher than MAX_BATCH_QUANTITY, so a new base batch may already exceed the per-batch cap.");
  }
  if (maxBatchQty > 0 && avgDownQty > maxBatchQty) {
    warnings.push("AVERAGE_DOWN_QUANTITY is higher than MAX_BATCH_QUANTITY, so an average-down buy may not fit into one batch.");
  }
  if (maxBatchQty > 0 && batchQty + avgDownQty > maxBatchQty) {
    warnings.push("One base buy plus one average-down buy is higher than MAX_BATCH_QUANTITY; a batch may stop averaging down after the first buy.");
  }
  if (bool("BUY_BASE_BATCH_EVERY_RUN") && maxOpen === 0 && dailyLimit === 0 && cooldown === 0) {
    warnings.push("BUY_BASE_BATCH_EVERY_RUN is true with no max-open limit, no daily limit and no cooldown; the bot can try to open a base batch every tick.");
  }
  if (bool("BUY_BASE_BATCH_EVERY_RUN") && cooldown === 0 && dailyLimit === 0) {
    warnings.push("Base buys have no cooldown and no daily limit; consider setting at least one of them to avoid too many new batches.");
  }
  if (forceWeekly > 0 && (cooldown > 0 || dailyLimit > 0 || maxOpen > 0)) {
    warnings.push("FORCE_BASE_BUY_WEEKLY_LIMIT can override cooldown, daily limit and max open batches for the forced weekly base buy.");
  }
  if (takeProfit > 0 && takeProfit < 1) {
    warnings.push("TAKE_PROFIT_RISE_PCT is below 1%; fees and spread may eat most or all of that profit.");
  }
  if (averageDown > 0 && averageDown < 1) {
    warnings.push("AVERAGE_DOWN_DROP_PCT is below 1%; this can average down very often on normal market noise.");
  }
  if (averageDown > 0 && takeProfit > 0 && averageDown < takeProfit / 2) {
    warnings.push("AVERAGE_DOWN_DROP_PCT is much smaller than TAKE_PROFIT_RISE_PCT; the bot may add to losing batches more often than it closes them.");
  }
  if (minQuote === 0 && (changed.has("MIN_QUOTE_BALANCE") || bool("BUY_BASE_BATCH_EVERY_RUN"))) {
    warnings.push("MIN_QUOTE_BALANCE is 0, so the bot has no extra USD reserve guard beyond exchange/order checks.");
  }
  if (checkInterval > 0 && checkInterval < 15) {
    warnings.push("CHECK_INTERVAL_MINUTES is below 15; the bot will check often and may create more maker order churn.");
  }
  if (makerTimeout > 0 && makerReprice > 0 && makerReprice >= makerTimeout) {
    warnings.push("MAKER_REPRICE_AFTER_MINUTES is greater than or equal to MAKER_ORDER_TIMEOUT_MINUTES; repricing may not happen before stale-order timeout.");
  }
  if (pair.baseAsset === "CRO" && batchQty > 0 && batchQty < 1) {
    warnings.push("CRO quantity rules usually require whole CRO amounts; a fractional BATCH_QUANTITY may be rounded by instrument rules.");
  }
  return warnings;
}

function createPair(body) {
  const instrument = normalizeInstrument(body.instrument);
  const [baseAsset, quoteAsset] = instrument.split("_");
  const apiKey = String(body.apiKey || "").trim();
  const apiSecret = String(body.apiSecret || "").trim();
  if (!apiKey) throw httpError(400, "API key is required for a new pair.");
  if (!apiSecret) throw httpError(400, "API secret is required for a new pair.");
  if (/[\r\n]/.test(apiKey) || /[\r\n]/.test(apiSecret)) throw httpError(400, "API credentials must be single-line values.");

  const existing = buildDashboardPayload().pairs.find((pair) => pair.instrument === instrument);
  if (existing) throw httpError(409, `${instrument} already exists.`);

  const slug = slugify(instrument);
  const envFile = `.env.${slug}`;
  const logDir = `logs/${slug}`;
  const serviceName = `ccom-updown-${slug}.service`;
  const envPath = path.resolve(process.cwd(), envFile);
  const logPath = path.resolve(process.cwd(), logDir);
  const unitPath = systemdUnitPath(serviceName);

  if (fs.existsSync(envPath)) throw httpError(409, `${envFile} already exists.`);
  if (unitPath && fs.existsSync(unitPath)) throw httpError(409, `${serviceName} already exists.`);

  const settings = normalizeNewPairSettings(body.settings || {});
  const startService = body.startService !== false;
  const env = {
    CCOM_API_KEY: apiKey,
    CCOM_API_SECRET: apiSecret,
    INSTRUMENT: instrument,
    BASE_ASSET: baseAsset,
    QUOTE_ASSET: quoteAsset,
    LOG_DIR: logDir,
    STRATEGY: "batches",
    ORDER_MODE: settings.ORDER_MODE,
    BATCH_QUANTITY: settings.BATCH_QUANTITY,
    MAX_BATCH_QUANTITY: settings.MAX_BATCH_QUANTITY,
    MAX_OPEN_BATCHES: settings.MAX_OPEN_BATCHES,
    DAILY_BASE_BUY_LIMIT: settings.DAILY_BASE_BUY_LIMIT,
    FORCE_BASE_BUY_WEEKLY_LIMIT: settings.FORCE_BASE_BUY_WEEKLY_LIMIT,
    BASE_BUY_COOLDOWN_MINUTES: settings.BASE_BUY_COOLDOWN_MINUTES,
    AVERAGE_DOWN_DROP_PCT: settings.AVERAGE_DOWN_DROP_PCT,
    TAKE_PROFIT_RISE_PCT: settings.TAKE_PROFIT_RISE_PCT,
    BUY_BASE_BATCH_EVERY_RUN: settings.BUY_BASE_BATCH_EVERY_RUN,
    DUST_SELL_QUANTITY: settings.DUST_SELL_QUANTITY,
    MIN_QUOTE_BALANCE: settings.MIN_QUOTE_BALANCE,
    MAX_SUSPICIOUS_PRICE_MOVE_PCT: settings.MAX_SUSPICIOUS_PRICE_MOVE_PCT,
    CHECK_INTERVAL_MINUTES: settings.CHECK_INTERVAL_MINUTES,
    DRY_RUN: "true",
    ENABLE_TRADING: "false",
    MAKER_BOOK_LEVEL: settings.MAKER_BOOK_LEVEL,
    MAKER_MAX_SPREAD_PCT: settings.MAKER_MAX_SPREAD_PCT,
    MAKER_ORDER_TIMEOUT_MINUTES: settings.MAKER_ORDER_TIMEOUT_MINUTES,
    MAKER_REPRICE_AFTER_MINUTES: settings.MAKER_REPRICE_AFTER_MINUTES
  };
  if (settings.AVERAGE_DOWN_QUANTITY) env.AVERAGE_DOWN_QUANTITY = settings.AVERAGE_DOWN_QUANTITY;

  fs.mkdirSync(logPath, { recursive: true });
  writeNewEnvFile(envPath, env);
  updateWebEnvFiles(envFile);

  const warnings = [
    "New pair is created in DRY_RUN=true and ENABLE_TRADING=false. Review the first ticks before enabling live trading.",
    "API key and secret were written only to the private env file and are not returned by the web API."
  ];
  let unitCreated = false;
  let daemonReloaded = false;
  let serviceEnabled = false;
  let serviceStarted = false;
  let serviceActive = false;
  let reportGenerated = false;

  if (unitPath) {
    fs.writeFileSync(unitPath, renderSystemdUnit({ serviceName, envFile }), "utf8");
    unitCreated = true;
    daemonReloaded = spawnSync("systemctl", ["daemon-reload"], { encoding: "utf8" }).status === 0;
    serviceEnabled = spawnSync("systemctl", ["enable", serviceName], { encoding: "utf8" }).status === 0;
    if (startService) {
      serviceStarted = spawnSync("systemctl", ["restart", serviceName], { encoding: "utf8" }).status === 0;
      serviceActive = serviceIsActive(serviceName);
    }
  } else {
    warnings.push("Systemd unit was not created because this platform is not Linux.");
  }

  const report = spawnSync(process.execPath, ["src/report.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ENV_FILE: envFile }
  });
  reportGenerated = report.status === 0;
  if (!reportGenerated) warnings.push("Initial report generation did not complete yet; it will be created after the first bot tick.");

  return {
    instrument,
    envFile,
    logDir,
    serviceName,
    webEnvUpdated: true,
    unitCreated,
    daemonReloaded,
    serviceEnabled,
    serviceStarted,
    serviceActive,
    reportGenerated,
    warnings
  };
}

function normalizeInstrument(value) {
  const instrument = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,15}_[A-Z0-9]{2,15}$/.test(instrument)) {
    throw httpError(400, "Instrument must look like ETH_USD.");
  }
  return instrument;
}

function normalizeNewPairSettings(rawSettings) {
  const settings = { ...PAIR_CREATE_DEFAULTS };
  for (const [key, value] of Object.entries(rawSettings || {})) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    settings[key] = String(value ?? "").trim();
  }
  if (!["market", "maker"].includes(settings.ORDER_MODE)) throw httpError(400, "ORDER_MODE must be market or maker.");
  if (!["true", "false"].includes(String(settings.BUY_BASE_BATCH_EVERY_RUN).toLowerCase())) {
    throw httpError(400, "BUY_BASE_BATCH_EVERY_RUN must be true or false.");
  }
  settings.BUY_BASE_BATCH_EVERY_RUN = String(settings.BUY_BASE_BATCH_EVERY_RUN).toLowerCase();

  for (const key of PAIR_CREATE_NUMERIC_KEYS) {
    if (key === "AVERAGE_DOWN_QUANTITY" && settings[key] === "") continue;
    if (["BATCH_QUANTITY", "MAX_BATCH_QUANTITY", "DUST_SELL_QUANTITY"].includes(key) && settings[key] === "") {
      throw httpError(400, `${key} is required.`);
    }
    if (settings[key] === "") continue;
    if (!/^-?\d+(\.\d+)?$/.test(settings[key])) throw httpError(400, `${key} must be a number.`);
    const number = Number(settings[key]);
    if (!Number.isFinite(number) || number < 0) throw httpError(400, `${key} must be zero or greater.`);
    if (["BATCH_QUANTITY", "MAX_BATCH_QUANTITY", "DUST_SELL_QUANTITY", "CHECK_INTERVAL_MINUTES"].includes(key) && number <= 0) {
      throw httpError(400, `${key} must be greater than zero.`);
    }
  }
  return settings;
}

function writeNewEnvFile(filePath, env) {
  const secretKeys = new Set(["CCOM_API_KEY", "CCOM_API_SECRET"]);
  const lines = [
    "# Private runtime env. Do not commit this file.",
    "# Created by the protected web UI.",
    ...Object.entries(env).map(([key, value]) => `${key}=${formatEnvValue(value, secretKeys.has(key))}`)
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
}

function formatEnvValue(value, secret) {
  const text = String(value ?? "");
  if (!secret && /^[A-Za-z0-9_./:-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function updateWebEnvFiles(envFile) {
  const webEnvPath = path.resolve(process.cwd(), ".env.web");
  const current = fs.existsSync(webEnvPath) ? parseEnvFile(webEnvPath) : {};
  const configured = String(current.WEB_ENV_FILES || process.env.WEB_ENV_FILES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const existing = configured.length ? configured : discoverPrivateEnvFiles();
  if (!existing.includes(envFile)) existing.push(envFile);
  const value = existing.join(",");
  if (fs.existsSync(webEnvPath)) {
    writeEnvFile(webEnvPath, [{ key: "WEB_ENV_FILES", from: current.WEB_ENV_FILES || "", to: value }]);
  } else {
    fs.writeFileSync(webEnvPath, `WEB_ENV_FILES=${value}\n`, { mode: 0o600 });
  }
  process.env.WEB_ENV_FILES = value;
}

function discoverPrivateEnvFiles() {
  return fs
    .readdirSync(process.cwd())
    .filter((name) => /^\.env\.[a-z0-9-]+$/i.test(name))
    .filter((name) => name !== ".env.web" && !name.includes("backup"))
    .sort();
}

function systemdUnitPath(serviceName) {
  if (process.platform !== "linux") return null;
  return path.join("/etc/systemd/system", serviceName);
}

function renderSystemdUnit({ serviceName, envFile }) {
  const name = serviceName.replace(/\.service$/, "");
  const workdir = process.cwd();
  const envPath = path.join(workdir, envFile);
  return `[Unit]
Description=Crypto.com ${name} batch bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workdir}
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=ENV_FILE=${envPath}
ExecStart=/usr/bin/node src/bot.js watch
Restart=always
RestartSec=15
User=root

[Install]
WantedBy=multi-user.target
`;
}

function buildReportsPayload() {
  const payload = buildDashboardPayload();
  const prefixes = new Set(payload.pairs.map((pair) => slugify(pair.instrument)));
  const files = [];
  if (fs.existsSync(reportsDir)) {
    for (const name of fs.readdirSync(reportsDir)) {
      if (!isAllowedReportFile(name, prefixes)) continue;
      const filePath = path.join(reportsDir, name);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      files.push({
        name,
        label: reportLabel(name),
        pair: reportPair(name, prefixes),
        kind: reportKind(name),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        url: `/api/reports/download?file=${encodeURIComponent(name)}`
      });
    }
  }
  files.sort((left, right) => `${left.pair}:${left.kind}:${left.name}`.localeCompare(`${right.pair}:${right.kind}:${right.name}`));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    files
  };
}

function handleReportDownload(url, res) {
  const name = path.basename(String(url.searchParams.get("file") || ""));
  const payload = buildDashboardPayload();
  const prefixes = new Set(payload.pairs.map((pair) => slugify(pair.instrument)));
  if (!isAllowedReportFile(name, prefixes)) throw httpError(404, "Report file not found");
  const filePath = path.resolve(reportsDir, name);
  if (!filePath.startsWith(reportsDir + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw httpError(404, "Report file not found");
  }
  res.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Content-Disposition": `attachment; filename="${name.replaceAll('"', "")}"`,
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function isAllowedReportFile(name, prefixes) {
  if (!/^[a-z0-9_.-]+\.(html|csv)$/i.test(name)) return false;
  if (name === "index.html") return true;
  for (const prefix of prefixes) {
    if (name.startsWith(`${prefix}-`)) return true;
  }
  return false;
}

function reportPair(name, prefixes) {
  if (name === "index.html") return "portfolio";
  for (const prefix of prefixes) {
    if (name.startsWith(`${prefix}-`)) return prefix.toUpperCase().replace("-", "_");
  }
  return "other";
}

function reportKind(name) {
  if (name === "index.html") return "index";
  return name
    .replace(/^[a-z0-9-]+-/i, "")
    .replace(/\.(html|csv)$/i, "");
}

function reportLabel(name) {
  return name
    .replace(/\.(html|csv)$/i, "")
    .replaceAll("-", " ");
}

function backupEnvFile(filePath) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const backupPath = `${filePath}.backup-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function writeEnvFile(filePath, changes) {
  const changeMap = new Map(changes.map((change) => [change.key, change.to]));
  const seen = new Set();
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
    if (!match || !changeMap.has(match[2])) return line;
    seen.add(match[2]);
    return `${match[1]}${match[2]}${match[3]}${changeMap.get(match[2])}`;
  });
  for (const [key, value] of changeMap) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function restartService(serviceName) {
  return controlService(serviceName, "restart");
}

function controlService(serviceName, action) {
  const normalizedAction = action === "pause" ? "stop" : action;
  if (!["start", "stop", "restart"].includes(normalizedAction)) {
    return { ok: false, error: `Unsupported service action ${action}` };
  }
  if (!/^ccom-updown(?:-[a-z0-9-]+)?(\.service)?$/.test(serviceName)) {
    return { ok: false, error: `Refusing to control unexpected service ${serviceName}` };
  }
  const result = spawnSync("systemctl", [normalizedAction, serviceName], { encoding: "utf8" });
  if (result.status === 0) return { ok: true, error: "" };
  return { ok: false, error: (result.stderr || result.stdout || `systemctl exited ${result.status}`).trim() };
}

function serviceIsActive(serviceName) {
  const result = spawnSync("systemctl", ["is-active", serviceName], { encoding: "utf8" });
  return result.stdout.trim() === "active";
}

function displayPath(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, 404, "Not found");
  }
  res.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function loginPage({ error }) {
  const missingPassword = !webPassword();
  const message = missingPassword
    ? "WEB_PASSWORD nie je nastavene. Vytvor lokalny subor .env.web podla .env.web.example."
    : error === "bad-password"
      ? "Nespravne heslo."
      : "";

  return `<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Batch Bot Login</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    :root { color-scheme: dark; --bg:#040916; --panel:rgba(8,15,31,.84); --text:#f7fbff; --muted:#a7b4ca; --line:rgba(122,149,190,.28); --danger:#ffb4ab; --blue:#22a7ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 20%, rgba(18,72,150,.24), transparent 34%), var(--bg); color: var(--text); font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body::before { content: ""; position: fixed; inset: 0; background: url("/login-hero.png") center / min(920px, 92vw) auto no-repeat; opacity: .42; filter: saturate(1.05); }
    body::after { content: ""; position: fixed; inset: 0; background: linear-gradient(90deg, rgba(4,9,22,.92), rgba(4,9,22,.68) 46%, rgba(4,9,22,.88)); }
    main { position: relative; z-index: 1; width: min(430px, calc(100vw - 32px)); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.44); backdrop-filter: blur(14px); }
    h1 { margin: 0; font-size: 24px; letter-spacing: -.01em; }
    p { color: var(--muted); line-height: 1.5; margin: 8px 0 22px; }
    label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 7px; }
    input { width: 100%; height: 43px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; font: inherit; margin-bottom: 12px; background: rgba(255,255,255,.08); color: var(--text); }
    input:focus { outline: 2px solid rgba(34,167,255,.38); border-color: rgba(34,167,255,.7); }
    button { width: 100%; height: 43px; margin-top: 14px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #19b8ff, #126dff); color: #fff; font: inherit; font-weight: 700; cursor: pointer; box-shadow: 0 10px 28px rgba(18,109,255,.32); }
    button:disabled, input:disabled { opacity: .6; cursor: not-allowed; }
    .msg { color: var(--danger); font-size: 13px; margin: 0 0 14px; }
    .mark { width: 34px; height: 34px; border-radius: 9px; background: #fff; color: #081022; display: grid; place-items: center; font: 700 13px ui-monospace, monospace; margin-bottom: 14px; }
    .hero-mini { display: block; width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--line); margin-bottom: 18px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
  </style>
</head>
<body>
  <main>
    <img class="hero-mini" src="/login-hero.png" alt="CCOM Batch Bot CA Up/Down">
    <div class="mark">BB</div>
    <h1>Batch Bot</h1>
    <p>Privatny read-only dashboard pre Crypto.com bota.</p>
    ${message ? `<div class="msg">${escapeHtml(message)}</div>` : ""}
    <form method="post" action="/login">
      <label for="username">Meno</label>
      <input id="username" name="username" type="text" autocomplete="username" value="${escapeHtml(webUsername())}" ${missingPassword ? "disabled" : ""}>
      <label for="password">Heslo</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus ${missingPassword ? "disabled" : ""}>
      <button type="submit" ${missingPassword ? "disabled" : ""}>Prihlasit sa</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
