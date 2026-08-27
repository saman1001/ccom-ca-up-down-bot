import crypto from "node:crypto";
import { upsertCashFlowSqlite } from "./sqliteStore.js";

const JOURNAL_TYPES = ["DEPOSIT", "WITHDRAW"];
const MAX_PAGES = 20;

export async function syncCashFlows(client, config, options = {}) {
  const endTime = Number(options.endTime || Date.now());
  const startTime = Number(options.startTime || endTime - 370 * 24 * 60 * 60 * 1000);
  let imported = 0;

  for (const journalType of JOURNAL_TYPES) {
    let pageEnd = endTime;
    for (let page = 0; page < MAX_PAGES && pageEnd > startTime; page += 1) {
      const response = await client.privatePost("private/get-transactions", {
        journal_type: journalType,
        start_time: startTime,
        end_time: pageEnd,
        limit: 100
      });
      const rows = Array.isArray(response.result?.data) ? response.result.data : [];
      for (const row of rows) {
        const flow = normalizeApiCashFlow(row, config);
        if (flow && upsertCashFlowSqlite(config.logDir, flow)) imported += 1;
      }
      if (rows.length < 100) break;
      const oldest = Math.min(...rows.map(apiTimestamp).filter(Number.isFinite));
      if (!Number.isFinite(oldest) || oldest >= pageEnd) break;
      pageEnd = oldest;
    }
  }

  return { imported };
}

function normalizeApiCashFlow(row, config) {
  const journalType = String(row.journal_type || "").toUpperCase();
  if (!JOURNAL_TYPES.includes(journalType)) return null;
  const amount = Math.abs(Number(row.transaction_qty || 0));
  const timestamp = apiTimestamp(row);
  const asset = String(row.instrument_name || "").toUpperCase();
  if (!Number.isFinite(timestamp) || amount <= 0 || !asset) return null;
  const quoteValue = asset === String(config.quoteAsset || "").toUpperCase() ? amount : null;
  const stableId = row.journal_id || row.event_timestamp_ns || `${journalType}:${asset}:${amount}:${timestamp}`;
  return {
    externalId: `crypto.com:${stableId}`,
    at: new Date(timestamp).toISOString(),
    direction: journalType === "DEPOSIT" ? "DEPOSIT" : "WITHDRAWAL",
    asset,
    amount,
    quoteValue,
    source: "crypto.com",
    note: "Imported from Crypto.com transaction history",
    raw: null
  };
}

function apiTimestamp(row) {
  const value = Number(row.event_timestamp_ms || 0);
  return value > 0 ? value : NaN;
}

export function manualCashFlowId(flow) {
  return `manual:${crypto.randomUUID()}:${flow.at}`;
}
