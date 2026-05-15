import fs from "node:fs";
import path from "node:path";

function orderLedgerPath(logDir) {
  return path.join(logDir, "orders.jsonl");
}

export function loadOrderLedger(logDir) {
  const filePath = orderLedgerPath(logDir);
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function appendOrderEvent(logDir, event) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(orderLedgerPath(logDir), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

export function latestOrderEventByClientOid(events, clientOid) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.clientOid === clientOid) return events[index];
  }
  return null;
}

export function isTerminalOrderStatus(status) {
  return ["FILLED", "SKIPPED", "RECONCILED"].includes(status || "");
}
