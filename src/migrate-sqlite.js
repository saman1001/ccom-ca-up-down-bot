import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import {
  appendOrderEventSqlite,
  appendPriceHistorySqlite,
  appendSnapshotSqlite,
  saveStateSqlite,
  sqliteStats
} from "./sqliteStore.js";

function migrateSqlite() {
  const config = loadConfig();
  const logDir = config.logDir;

  const snapshots = readJsonl(path.join(logDir, "snapshots.jsonl"));
  for (const snapshot of snapshots) {
    appendSnapshotSqlite(logDir, snapshot);
  }

  const orderEvents = readJsonl(path.join(logDir, "orders.jsonl"));
  for (const event of orderEvents) {
    appendOrderEventSqlite(logDir, event);
  }

  const priceRows = readPriceHistoryCsv(path.join(logDir, "price-history.csv"));
  for (const row of priceRows) {
    appendPriceHistorySqlite(logDir, row);
  }

  saveStateSqlite(logDir, "batches", readJson(path.join(logDir, "batches.json"), []));
  saveStateSqlite(logDir, "dust_bank", readJson(path.join(logDir, "dust-bank.json"), { quantity: 0, entries: [], sells: [] }));

  const stats = sqliteStats(logDir);
  console.log(JSON.stringify({
    logDir,
    sqlite: stats,
    imported: {
      snapshots: snapshots.length,
      orderEvents: orderEvents.length,
      priceHistory: priceRows.length
    }
  }, null, 2));
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

function readPriceHistoryCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1)
    .map(parsePriceHistoryCsvLine)
    .filter(Boolean);
}

function parsePriceHistoryCsvLine(line) {
  const cells = parseCsvLine(line);
  if (cells.length < 6) return null;
  return {
    at: cells[0],
    hour: cells[1],
    instrument: cells[2],
    price: Number(cells[3]),
    quoteAsset: cells[4],
    source: cells[5]
  };
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

migrateSqlite();
