import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_NAME = "bot.sqlite";
const connections = new Map();

export function sqliteEnabled() {
  return String(process.env.ENABLE_SQLITE || "true").toLowerCase() !== "false";
}

export function sqlitePath(logDir) {
  return process.env.SQLITE_DB_PATH
    ? path.resolve(process.env.SQLITE_DB_PATH)
    : path.join(logDir, DB_NAME);
}

export function openSqlite(logDir) {
  if (!sqliteEnabled()) return null;
  const filePath = sqlitePath(logDir);
  if (connections.has(filePath)) return connections.get(filePath);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  createSchema(db);
  connections.set(filePath, db);
  return db;
}

export function appendSnapshotSqlite(logDir, snapshot) {
  runSqliteSafely(logDir, (db) => {
    db.prepare(`
      INSERT OR REPLACE INTO snapshots
        (at, instrument, price, portfolio_json, snapshot_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      snapshot.at || new Date().toISOString(),
      snapshot.instrument || "",
      Number(snapshot.price || 0),
      JSON.stringify(snapshot.portfolio || {}),
      JSON.stringify(snapshot)
    );
  });
}

export function appendOrderEventSqlite(logDir, event) {
  runSqliteSafely(logDir, (db) => {
    const eventJson = JSON.stringify(event);
    db.prepare(`
      INSERT OR IGNORE INTO order_events
        (event_hash, at, instrument, client_oid, order_id, status, action_json, order_detail_json, fill_json, cancel_result_json, event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hash(eventJson),
      event.at || new Date().toISOString(),
      event.instrument || "",
      event.clientOid || "",
      event.orderId || "",
      event.status || "",
      JSON.stringify(event.action || null),
      JSON.stringify(event.orderDetail || null),
      JSON.stringify(event.fill || null),
      JSON.stringify(event.cancelResult || null),
      eventJson
    );
  });
}

export function appendPriceHistorySqlite(logDir, row) {
  runSqliteSafely(logDir, (db) => {
    db.prepare(`
      INSERT OR IGNORE INTO price_history
        (hour, instrument, at, price, quote_asset, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      row.hour || "",
      row.instrument || "",
      row.at || new Date().toISOString(),
      Number(row.price || 0),
      row.quoteAsset || row.quote_asset || "",
      row.source || "ticker"
    );
  });
}

export function saveStateSqlite(logDir, name, value) {
  runSqliteSafely(logDir, (db) => {
    db.prepare(`
      INSERT OR REPLACE INTO state (name, updated_at, json)
      VALUES (?, ?, ?)
    `).run(name, new Date().toISOString(), JSON.stringify(value));
  });
}

export function readStateSqlite(logDir, name, fallback = null) {
  const db = openSqlite(logDir);
  if (!db) return fallback;
  const row = db.prepare("SELECT json FROM state WHERE name = ?").get(name);
  return row ? JSON.parse(row.json) : fallback;
}

export function sqliteStats(logDir) {
  const db = openSqlite(logDir);
  if (!db) return { enabled: false };
  return {
    enabled: true,
    path: sqlitePath(logDir),
    snapshots: countRows(db, "snapshots"),
    orderEvents: countRows(db, "order_events"),
    priceHistory: countRows(db, "price_history"),
    stateRows: countRows(db, "state")
  };
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      at TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      price REAL NOT NULL,
      portfolio_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_hash TEXT NOT NULL UNIQUE,
      at TEXT NOT NULL,
      instrument TEXT NOT NULL,
      client_oid TEXT,
      order_id TEXT,
      status TEXT,
      action_json TEXT,
      order_detail_json TEXT,
      fill_json TEXT,
      cancel_result_json TEXT,
      event_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_events_client_oid ON order_events(client_oid);
    CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_events_at ON order_events(at);

    CREATE TABLE IF NOT EXISTS price_history (
      hour TEXT NOT NULL,
      instrument TEXT NOT NULL,
      at TEXT NOT NULL,
      price REAL NOT NULL,
      quote_asset TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (instrument, hour)
    );

    CREATE TABLE IF NOT EXISTS state (
      name TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
  `);
}

function runSqliteSafely(logDir, callback) {
  if (!sqliteEnabled()) return;
  try {
    callback(openSqlite(logDir));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] sqlite write failed: ${error.message}`);
  }
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
