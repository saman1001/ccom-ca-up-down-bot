import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./config.js";

const envFiles = process.argv.slice(2);
const files = envFiles.length ? envFiles : [".env.cro-usd", ".env.btc-usd"].filter((file) => fs.existsSync(file));
const maxSnapshotAgeMinutes = Number(process.env.HEALTH_MAX_SNAPSHOT_AGE_MINUTES || 90);

let hasProblem = false;

if (!files.length) {
  console.log("No env files found. Pass env files, for example: node src/health.js .env.cro-usd .env.btc-usd");
  process.exit(1);
}

for (const envFile of files) {
  const config = withEnvFile(envFile, () => loadConfig());
  const latest = readLatestJsonl(path.join(config.logDir, "snapshots.jsonl"));
  const batches = readJson(path.join(config.logDir, "batches.json"), []);
  const dustBank = readJson(path.join(config.logDir, "dust-bank.json"), { quantity: 0 });
  const reportPath = path.resolve("reports", `${slugify(config.instrument)}-dashboard.html`);
  const ageMinutes = latest?.at ? (Date.now() - new Date(latest.at).getTime()) / 60000 : null;
  const openBatches = batches.filter((batch) => batch.status === "OPEN").length;
  const serviceName = serviceNameForInstrument(config.instrument);
  const serviceActive = systemctlIsActive(serviceName);
  const problems = [];

  if (!latest) problems.push("missing snapshots.jsonl");
  if (ageMinutes !== null && ageMinutes > maxSnapshotAgeMinutes) problems.push(`snapshot age ${ageMinutes.toFixed(1)}m`);
  if (!fs.existsSync(reportPath)) problems.push("missing dashboard");
  if (serviceActive === false) problems.push(`service ${serviceName} inactive`);

  if (problems.length) hasProblem = true;

  console.log(JSON.stringify({
    envFile,
    instrument: config.instrument,
    serviceName,
    serviceActive,
    latestSnapshotAt: latest?.at || null,
    snapshotAgeMinutes: ageMinutes === null ? null : Number(ageMinutes.toFixed(1)),
    price: latest?.price || null,
    openBatches,
    dustBankQuantity: dustBank.quantity || 0,
    reportPath,
    ok: problems.length === 0,
    problems
  }, null, 2));
}

process.exitCode = hasProblem ? 1 : 0;

function withEnvFile(envFile, fn) {
  const previous = snapshotEnv();
  process.env.ENV_FILE = envFile;
  clearConfigEnv();
  try {
    return fn();
  } finally {
    restoreEnv(previous);
  }
}

function snapshotEnv() {
  const keys = ["ENV_FILE", ...configEnvKeys()];
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearConfigEnv() {
  for (const key of configEnvKeys()) {
    delete process.env[key];
  }
}

function configEnvKeys() {
  return [
    "CCOM_API_KEY",
    "CCOM_API_SECRET",
    "CCOM_ENV",
    "DRY_RUN",
    "ENABLE_TRADING",
    "INSTRUMENT",
    "BASE_ASSET",
    "QUOTE_ASSET",
    "LOG_DIR",
    "STRATEGY",
    "BUY_DROP_PCT",
    "SELL_RISE_PCT",
    "TRADE_NOTIONAL",
    "BATCH_QUANTITY",
    "AVERAGE_DOWN_QUANTITY",
    "MAX_BATCH_QUANTITY",
    "AVERAGE_DOWN_DROP_PCT",
    "TAKE_PROFIT_RISE_PCT",
    "BUY_BASE_BATCH_EVERY_RUN",
    "BASE_BUY_COOLDOWN_MINUTES",
    "DUST_SELL_QUANTITY",
    "CHECK_INTERVAL_MINUTES"
  ];
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readLatestJsonl(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines.at(-1));
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

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
