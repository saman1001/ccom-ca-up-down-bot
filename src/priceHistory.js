import fs from "node:fs";
import path from "node:path";
import { appendPriceHistorySqlite } from "./sqliteStore.js";

const JSONL_NAME = "price-history.jsonl";
const CSV_NAME = "price-history.csv";

export function appendPriceHistory(logDir, sample) {
  const price = Number(sample.price);
  if (!Number.isFinite(price) || price <= 0) return { written: false, reason: "invalid_price" };

  fs.mkdirSync(logDir, { recursive: true });
  const at = sample.at || new Date().toISOString();
  const hour = utcHour(at);
  const row = {
    at,
    hour,
    instrument: sample.instrument || "",
    price,
    quoteAsset: sample.quoteAsset || "",
    source: sample.source || "ticker"
  };

  const jsonlPath = path.join(logDir, JSONL_NAME);
  const last = readLastJsonl(jsonlPath);
  if (last?.hour === row.hour && last?.instrument === row.instrument) {
    appendPriceHistorySqlite(logDir, row);
    return { written: false, reason: "hour_already_recorded", path: jsonlPath };
  }

  fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`);
  appendPriceCsv(path.join(logDir, CSV_NAME), row);
  appendPriceHistorySqlite(logDir, row);
  return { written: true, path: jsonlPath };
}

function appendPriceCsv(filePath, row) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "at,hour,instrument,price,quote_asset,source\n");
  }
  fs.appendFileSync(filePath, [
    csvCell(row.at),
    csvCell(row.hour),
    csvCell(row.instrument),
    csvCell(row.price),
    csvCell(row.quoteAsset),
    csvCell(row.source)
  ].join(",") + "\n");
}

function readLastJsonl(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    return null;
  }
}

function utcHour(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 13);
  return date.toISOString().slice(0, 13);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
