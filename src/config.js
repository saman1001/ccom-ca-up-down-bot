import fs from "node:fs";
import path from "node:path";

export function loadDotEnv(filePath = ".env") {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "y"].includes(raw.toLowerCase());
}

function numberEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

export function loadConfig() {
  const envFile = process.env.ENV_FILE || ".env";
  loadDotEnv(path.resolve(envFile));

  const env = process.env.CCOM_ENV || "production";
  const baseUrl =
    env === "uat"
      ? "https://uat-api.3ona.co/exchange/v1"
      : "https://api.crypto.com/exchange/v1";

  return {
    apiKey: process.env.CCOM_API_KEY || "",
    apiSecret: process.env.CCOM_API_SECRET || "",
    envFile,
    baseUrl,
    dryRun: boolEnv("DRY_RUN", true),
    enableTrading: boolEnv("ENABLE_TRADING", false),
    instrument: process.env.INSTRUMENT || "BTC_USD",
    baseAsset: process.env.BASE_ASSET || "BTC",
    quoteAsset: process.env.QUOTE_ASSET || "USD",
    strategy: process.env.STRATEGY || "updown",
    buyDropPct: numberEnv("BUY_DROP_PCT", 3),
    sellRisePct: numberEnv("SELL_RISE_PCT", 4),
    tradeNotional: numberEnv("TRADE_NOTIONAL", 25),
    batchQuantity: numberEnv("BATCH_QUANTITY", 20),
    maxBatchQuantity: numberEnv("MAX_BATCH_QUANTITY", 500),
    averageDownDropPct: numberEnv("AVERAGE_DOWN_DROP_PCT", 10),
    takeProfitRisePct: numberEnv("TAKE_PROFIT_RISE_PCT", 5),
    buyBaseBatchEveryRun: boolEnv("BUY_BASE_BATCH_EVERY_RUN", true),
    baseBuyCooldownMinutes: numberEnv("BASE_BUY_COOLDOWN_MINUTES", numberEnv("CHECK_INTERVAL_MINUTES", 60)),
    dustSellQuantity: numberEnv("DUST_SELL_QUANTITY", 20),
    checkIntervalMinutes: numberEnv("CHECK_INTERVAL_MINUTES", 60),
    logDir: path.resolve(process.env.LOG_DIR || "logs")
  };
}
