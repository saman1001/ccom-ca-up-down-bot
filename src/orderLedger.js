import fs from "node:fs";
import path from "node:path";
import { appendOrderEventSqlite } from "./sqliteStore.js";

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
  const row = { at: new Date().toISOString(), ...event };
  fs.appendFileSync(orderLedgerPath(logDir), `${JSON.stringify(row)}\n`);
  appendOrderEventSqlite(logDir, row);
}

export function latestOrderEventByClientOid(events, clientOid) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.clientOid === clientOid) return events[index];
  }
  return null;
}

export function isTerminalOrderStatus(status) {
  return [
    "FILLED",
    "FILLED_ALREADY_APPLIED",
    "SKIPPED",
    "RECONCILED",
    "CANCELED",
    "CANCELLED",
    "CANCEL_REQUESTED",
    "REJECTED",
    "EXPIRED",
    "FAILED"
  ].includes(status || "");
}

export function latestActiveOrderEventForAction(events, action) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (!isSameAction(event.action, action)) continue;
    if (isTerminalOrderStatus(event.status)) return null;
    return {
      ...event,
      firstActiveAt: firstActiveOrderTime(events, event, action)
    };
  }
  return null;
}

export function latestActiveMakerOrderEvents(events, instrument) {
  const byClientOid = new Map();

  for (const event of events) {
    const clientOid = event?.clientOid || event?.action?.order?.client_oid;
    if (!clientOid) continue;
    byClientOid.set(clientOid, event);
  }

  const activeEvents = [];
  for (const latestEvent of byClientOid.values()) {
    if (!latestEvent || isTerminalOrderStatus(latestEvent.status)) continue;
    const action = latestEvent.action;
    if (!action?.order || action.order.type !== "LIMIT") continue;
    if (instrument && action.order.instrument_name !== instrument) continue;
    activeEvents.push({
      ...latestEvent,
      firstActiveAt: firstActiveOrderTime(events, latestEvent, action)
    });
  }

  return activeEvents;
}

function firstActiveOrderTime(events, latestEvent, action) {
  let firstAt = latestEvent.at || "";
  for (const event of events) {
    if (!event || isTerminalOrderStatus(event.status)) continue;
    if (!isSameAction(event.action, action)) continue;
    if (latestEvent.clientOid && event.clientOid !== latestEvent.clientOid) continue;
    if (latestEvent.orderId && event.orderId && event.orderId !== latestEvent.orderId) continue;
    firstAt = event.at || firstAt;
    break;
  }
  return firstAt;
}

function isSameAction(left, right) {
  if (!left || !right) return false;
  return (
    left.kind === right.kind &&
    (left.batchId || null) === (right.batchId || null) &&
    left.order?.instrument_name === right.order?.instrument_name &&
    left.order?.side === right.order?.side
  );
}
