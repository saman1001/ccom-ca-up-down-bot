import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);

export function generateTaxExport(options = {}) {
  const config = options.config || loadConfig();
  const year = options.year ?? parseYearArg(process.argv.slice(2));
  const reportDir = path.resolve("reports");
  const prefix = slugify(config.instrument);
  const batches = readJson(path.join(config.logDir, "batches.json"), []);
  const dustBank = readJson(path.join(config.logDir, "dust-bank.json"), { quantity: 0, entries: [], sells: [] });

  const taxEvents = filterByYear(buildTaxEvents({ batches, dustBank, config }), year);
  const ledgerRows = filterByYear(buildAccountingLedger({ batches, dustBank, config }), year);
  const summaryRows = summarizeTaxEvents(taxEvents);

  fs.mkdirSync(reportDir, { recursive: true });
  const taxEventsCsvPath = path.join(reportDir, `${prefix}-tax-events.csv`);
  const taxSummaryCsvPath = path.join(reportDir, `${prefix}-tax-summary.csv`);
  const accountingLedgerCsvPath = path.join(reportDir, `${prefix}-accounting-ledger.csv`);

  fs.writeFileSync(taxEventsCsvPath, renderTaxEventsCsv(taxEvents), "utf8");
  fs.writeFileSync(taxSummaryCsvPath, renderTaxSummaryCsv(summaryRows), "utf8");
  fs.writeFileSync(accountingLedgerCsvPath, renderAccountingLedgerCsv(ledgerRows), "utf8");

  const result = {
    instrument: config.instrument,
    year: year || "all",
    taxEvents: taxEvents.length,
    ledgerRows: ledgerRows.length,
    taxEventsCsvPath,
    taxSummaryCsvPath,
    accountingLedgerCsvPath,
    note: "Informative export only. Review with an accountant or tax advisor before filing."
  };

  if (!options.quiet) {
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

function buildTaxEvents({ batches, dustBank, config }) {
  return [
    ...buildBatchDisposals({ batches, config }),
    ...buildDustDisposals({ dustBank, config })
  ].sort((a, b) => a.disposedAt.localeCompare(b.disposedAt));
}

function buildBatchDisposals({ batches, config }) {
  const rows = [];
  for (const batch of batches) {
    const lots = (batch.buys || [])
      .map((buy) => ({
        at: buy.at || batch.createdAt || "",
        remaining: Number(buy.quantity || 0),
        price: Number(buy.price || 0),
        orderId: buy.orderId || "",
        feeAmount: buy.feeAmount ?? "",
        feeCurrency: buy.feeCurrency || ""
      }))
      .filter((lot) => lot.remaining > 0 && lot.price > 0);

    for (const sell of batch.sells || []) {
      const quantity = Number(sell.quantity || 0);
      const price = Number(sell.price || 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;
      const allocation = allocateLots(lots, quantity);
      const proceeds = cleanNumber(quantity * price);
      const costBasis = cleanNumber(allocation.costBasis);
      rows.push({
        year: yearFromAt(sell.at),
        instrument: config.instrument,
        asset: config.baseAsset,
        eventType: "BATCH_SELL",
        batchId: batch.id || "",
        disposedAt: sell.at || batch.closedAt || "",
        firstAcquiredAt: allocation.firstAcquiredAt,
        lastAcquiredAt: allocation.lastAcquiredAt,
        holdingDays: holdingDays(allocation.firstAcquiredAt, sell.at || batch.closedAt || ""),
        quantity: cleanNumber(quantity),
        proceedsQuote: proceeds,
        costBasisQuote: costBasis,
        feeAmount: sell.feeAmount ?? "",
        feeCurrency: sell.feeCurrency || "",
        realizedPnlQuote: cleanNumber(proceeds - costBasis),
        orderId: sell.orderId || "",
        source: "batches.json",
        acquisitionLots: allocation.lotCount,
        note: allocation.shortfall > 0 ? `Cost basis shortfall for ${cleanNumber(allocation.shortfall)} ${config.baseAsset}` : ""
      });
    }
  }
  return rows;
}

function buildDustDisposals({ dustBank, config }) {
  const rows = [];
  const lots = (dustBank.entries || [])
    .map((entry) => ({
      at: entry.at || "",
      remaining: Number(entry.quantity || 0),
      price: Number(entry.price || 0),
      orderId: entry.orderId || "",
      feeAmount: entry.feeAmount ?? "",
      feeCurrency: entry.feeCurrency || ""
    }))
    .filter((lot) => lot.remaining > 0 && lot.price > 0);

  for (const sell of dustBank.sells || []) {
    const quantity = Number(sell.quantity || 0);
    const price = Number(sell.price || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;
    const allocation = allocateLots(lots, quantity);
    const proceeds = cleanNumber(quantity * price);
    const costBasis = cleanNumber(allocation.costBasis);
    rows.push({
      year: yearFromAt(sell.at),
      instrument: config.instrument,
      asset: config.baseAsset,
      eventType: "DUST_SELL",
      batchId: "",
      disposedAt: sell.at || "",
      firstAcquiredAt: allocation.firstAcquiredAt,
      lastAcquiredAt: allocation.lastAcquiredAt,
      holdingDays: holdingDays(allocation.firstAcquiredAt, sell.at || ""),
      quantity: cleanNumber(quantity),
      proceedsQuote: proceeds,
      costBasisQuote: costBasis,
      feeAmount: sell.feeAmount ?? "",
      feeCurrency: sell.feeCurrency || "",
      realizedPnlQuote: cleanNumber(proceeds - costBasis),
      orderId: sell.orderId || "",
      source: "dust-bank.json",
      acquisitionLots: allocation.lotCount,
      note: allocation.shortfall > 0 ? `Cost basis shortfall for ${cleanNumber(allocation.shortfall)} ${config.baseAsset}` : ""
    });
  }
  return rows;
}

function buildAccountingLedger({ batches, dustBank, config }) {
  const rows = [];
  for (const batch of batches) {
    for (const buy of batch.buys || []) {
      rows.push(accountingRow({
        at: buy.at || batch.createdAt || "",
        instrument: config.instrument,
        asset: config.baseAsset,
        type: "BUY",
        batchId: batch.id || "",
        quantity: buy.quantity,
        price: buy.price,
        quoteValue: Number(buy.quantity || 0) * Number(buy.price || 0),
        feeAmount: buy.feeAmount,
        feeCurrency: buy.feeCurrency,
        orderId: buy.orderId,
        source: "batches.json"
      }));
    }
    for (const sell of batch.sells || []) {
      rows.push(accountingRow({
        at: sell.at || batch.closedAt || "",
        instrument: config.instrument,
        asset: config.baseAsset,
        type: "SELL",
        batchId: batch.id || "",
        quantity: sell.quantity,
        price: sell.price,
        quoteValue: Number(sell.quantity || 0) * Number(sell.price || 0),
        feeAmount: sell.feeAmount,
        feeCurrency: sell.feeCurrency,
        orderId: sell.orderId,
        source: "batches.json"
      }));
    }
  }

  for (const entry of dustBank.entries || []) {
    rows.push(accountingRow({
      at: entry.at || "",
      instrument: config.instrument,
      asset: config.baseAsset,
      type: "DUST_IN",
      batchId: entry.sourceBatchId || "",
      quantity: entry.quantity,
      price: entry.price,
      quoteValue: Number(entry.quantity || 0) * Number(entry.price || 0),
      feeAmount: entry.feeAmount,
      feeCurrency: entry.feeCurrency,
      orderId: entry.orderId,
      source: "dust-bank.json"
    }));
  }

  for (const sell of dustBank.sells || []) {
    rows.push(accountingRow({
      at: sell.at || "",
      instrument: config.instrument,
      asset: config.baseAsset,
      type: "DUST_SELL",
      batchId: "",
      quantity: sell.quantity,
      price: sell.price,
      quoteValue: Number(sell.quantity || 0) * Number(sell.price || 0),
      feeAmount: sell.feeAmount,
      feeCurrency: sell.feeCurrency,
      orderId: sell.orderId,
      source: "dust-bank.json"
    }));
  }

  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

function accountingRow(row) {
  return {
    at: row.at || "",
    year: yearFromAt(row.at),
    instrument: row.instrument,
    asset: row.asset,
    type: row.type,
    batchId: row.batchId || "",
    quantity: cleanNumber(Number(row.quantity || 0)),
    priceQuote: cleanNumber(Number(row.price || 0)),
    quoteValue: cleanNumber(Number(row.quoteValue || 0)),
    feeAmount: row.feeAmount ?? "",
    feeCurrency: row.feeCurrency || "",
    orderId: row.orderId || "",
    source: row.source
  };
}

function allocateLots(lots, quantity) {
  let remaining = quantity;
  let costBasis = 0;
  let lotCount = 0;
  const timestamps = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    if (lot.remaining <= 0) continue;
    const used = Math.min(lot.remaining, remaining);
    lot.remaining = cleanNumber(lot.remaining - used);
    remaining = cleanNumber(remaining - used);
    costBasis += used * lot.price;
    lotCount += 1;
    if (lot.at) timestamps.push(lot.at);
  }

  timestamps.sort();
  return {
    costBasis: cleanNumber(costBasis),
    firstAcquiredAt: timestamps[0] || "",
    lastAcquiredAt: timestamps.at(-1) || "",
    lotCount,
    shortfall: cleanNumber(Math.max(0, remaining))
  };
}

function summarizeTaxEvents(events) {
  const rows = new Map();
  for (const event of events) {
    const key = `${event.year}|${event.instrument}|${event.asset}`;
    const row = rows.get(key) || {
      year: event.year,
      instrument: event.instrument,
      asset: event.asset,
      disposals: 0,
      quantitySold: 0,
      proceedsQuote: 0,
      costBasisQuote: 0,
      realizedPnlQuote: 0,
      deductibleExpenseCappedAtIncome: 0,
      indicativeTaxBaseQuote: 0
    };
    row.disposals += 1;
    row.quantitySold += Number(event.quantity || 0);
    row.proceedsQuote += Number(event.proceedsQuote || 0);
    row.costBasisQuote += Number(event.costBasisQuote || 0);
    row.realizedPnlQuote += Number(event.realizedPnlQuote || 0);
    rows.set(key, row);
  }

  return Array.from(rows.values())
    .map((row) => {
      const expense = Math.min(row.proceedsQuote, row.costBasisQuote);
      return {
        ...row,
        quantitySold: cleanNumber(row.quantitySold),
        proceedsQuote: cleanNumber(row.proceedsQuote),
        costBasisQuote: cleanNumber(row.costBasisQuote),
        realizedPnlQuote: cleanNumber(row.realizedPnlQuote),
        deductibleExpenseCappedAtIncome: cleanNumber(expense),
        indicativeTaxBaseQuote: cleanNumber(Math.max(0, row.proceedsQuote - expense))
      };
    })
    .sort((a, b) => String(a.year).localeCompare(String(b.year)) || a.instrument.localeCompare(b.instrument));
}

function renderTaxEventsCsv(rows) {
  return csv([
    [
      "year",
      "instrument",
      "asset",
      "event_type",
      "batch_id",
      "disposed_at",
      "first_acquired_at",
      "last_acquired_at",
      "holding_days",
      "quantity",
      "proceeds_quote",
      "cost_basis_quote",
      "realized_pnl_quote",
      "fee_amount",
      "fee_currency",
      "order_id",
      "source",
      "acquisition_lots",
      "note"
    ],
    ...rows.map((row) => [
      row.year,
      row.instrument,
      row.asset,
      row.eventType,
      row.batchId,
      row.disposedAt,
      row.firstAcquiredAt,
      row.lastAcquiredAt,
      row.holdingDays,
      row.quantity,
      row.proceedsQuote,
      row.costBasisQuote,
      row.realizedPnlQuote,
      row.feeAmount,
      row.feeCurrency,
      row.orderId,
      row.source,
      row.acquisitionLots,
      row.note
    ])
  ]);
}

function renderTaxSummaryCsv(rows) {
  return csv([
    [
      "year",
      "instrument",
      "asset",
      "disposals",
      "quantity_sold",
      "proceeds_quote",
      "cost_basis_quote",
      "realized_pnl_quote",
      "deductible_expense_capped_at_income",
      "indicative_tax_base_quote",
      "note"
    ],
    ...rows.map((row) => [
      row.year,
      row.instrument,
      row.asset,
      row.disposals,
      row.quantitySold,
      row.proceedsQuote,
      row.costBasisQuote,
      row.realizedPnlQuote,
      row.deductibleExpenseCappedAtIncome,
      row.indicativeTaxBaseQuote,
      "Informative export only; review with accountant/tax advisor."
    ])
  ]);
}

function renderAccountingLedgerCsv(rows) {
  return csv([
    [
      "at",
      "year",
      "instrument",
      "asset",
      "type",
      "batch_id",
      "quantity",
      "price_quote",
      "quote_value",
      "fee_amount",
      "fee_currency",
      "order_id",
      "source"
    ],
    ...rows.map((row) => [
      row.at,
      row.year,
      row.instrument,
      row.asset,
      row.type,
      row.batchId,
      row.quantity,
      row.priceQuote,
      row.quoteValue,
      row.feeAmount,
      row.feeCurrency,
      row.orderId,
      row.source
    ])
  ]);
}

function filterByYear(rows, year) {
  if (!year) return rows;
  return rows.filter((row) => Number(row.year) === Number(year));
}

function parseYearArg(args) {
  const yearArg = args.find((arg) => arg.startsWith("--year="));
  if (!yearArg) return 0;
  const year = Number(yearArg.slice("--year=".length));
  return Number.isInteger(year) && year >= 2009 && year <= 2100 ? year : 0;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function yearFromAt(at) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : "";
}

function holdingDays(from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return "";
  return cleanNumber((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function cleanNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(Number(value).toFixed(12));
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  generateTaxExport();
}
