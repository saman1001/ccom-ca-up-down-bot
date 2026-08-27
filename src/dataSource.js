import fs from "node:fs";
import path from "node:path";
import { openSqlite, readCashFlowsSqlite, sqlitePath } from "./sqliteStore.js";

const DEFAULT_DUST_BANK = { quantity: 0, entries: [], sells: [] };

export function readBotDataSource(config, options = {}) {
  const mode = normalizeMode(options.mode || process.env.BOT_DATA_SOURCE || "auto");

  if (mode === "logs") {
    return readBotDataSourceLogs(config, "logs");
  }

  const sqlite = readBotDataSourceSqlite(config);
  if (sqlite && (mode === "sqlite" || sqlite.snapshots.length)) {
    return sqlite;
  }

  if (mode === "sqlite") {
    return sqlite || emptySqliteSource(config, "sqlite-unavailable");
  }

  return readBotDataSourceLogs(config, "logs-fallback");
}

export function readBotDataSourceSqlite(config) {
  try {
    const db = openSqlite(config.logDir);
    if (!db) return null;
    const snapshots = db.prepare("SELECT snapshot_json FROM snapshots ORDER BY at").all().map((row) => JSON.parse(row.snapshot_json));
    const orderEvents = db.prepare("SELECT event_json FROM order_events ORDER BY at, id").all().map((row) => JSON.parse(row.event_json));
    const priceHistory = db.prepare("SELECT at, instrument, price, quote_asset, source FROM price_history ORDER BY at").all().map((row) => ({
      at: row.at,
      instrument: row.instrument,
      price: Number(row.price),
      quoteAsset: row.quote_asset,
      source: row.source
    }));
    return {
      source: "sqlite",
      sqlitePath: sqlitePath(config.logDir),
      batches: readStateFromDb(db, "batches", []),
      dustBank: readStateFromDb(db, "dust_bank", DEFAULT_DUST_BANK),
      snapshots,
      priceHistory,
      orderEvents,
      cashFlows: readCashFlowsSqlite(config.logDir)
    };
  } catch (error) {
    if (normalizeMode(process.env.BOT_DATA_SOURCE || "") === "sqlite") {
      console.error(`[data] sqlite source failed for ${config.instrument}: ${error.message}`);
    }
    return null;
  }
}

export function readBotDataSourceLogs(config, source = "logs") {
  return {
    source,
    sqlitePath: null,
    batches: readJson(path.join(config.logDir, "batches.json"), []),
    dustBank: readJson(path.join(config.logDir, "dust-bank.json"), DEFAULT_DUST_BANK),
    snapshots: readJsonl(path.join(config.logDir, "snapshots.jsonl")),
    priceHistory: readPriceHistoryCsv(path.join(config.logDir, "price-history.csv")),
    orderEvents: readJsonl(path.join(config.logDir, "orders.jsonl")),
    cashFlows: []
  };
}

function emptySqliteSource(config, source) {
  return {
    source,
    sqlitePath: sqlitePath(config.logDir),
    batches: [],
    dustBank: DEFAULT_DUST_BANK,
    snapshots: [],
    priceHistory: [],
    orderEvents: [],
    cashFlows: []
  };
}

function readStateFromDb(db, name, fallback) {
  const row = db.prepare("SELECT json FROM state WHERE name = ?").get(name);
  return row ? JSON.parse(row.json) : fallback;
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

function readPriceHistoryCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [at, , instrument, price, quoteAsset, source] = line.split(",");
      const parsedPrice = Number(price);
      if (!at || !Number.isFinite(parsedPrice) || parsedPrice <= 0) return null;
      return { at, instrument, price: parsedPrice, quoteAsset, source };
    })
    .filter(Boolean);
}

function normalizeMode(value) {
  const mode = String(value || "auto").toLowerCase();
  return ["auto", "sqlite", "logs"].includes(mode) ? mode : "auto";
}
