import fs from "node:fs";
import path from "node:path";
import { appendSnapshotSqlite } from "./sqliteStore.js";

export function ensureLogDir(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
}

export function readPreviousSnapshot(logDir) {
  const filePath = path.join(logDir, "snapshots.jsonl");
  if (!fs.existsSync(filePath)) return null;

  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;

  return JSON.parse(lines[lines.length - 1]);
}

export function appendSnapshot(logDir, snapshot) {
  ensureLogDir(logDir);
  const filePath = path.join(logDir, "snapshots.jsonl");
  fs.appendFileSync(filePath, `${JSON.stringify(snapshot)}\n`);
  appendSnapshotSqlite(logDir, snapshot);
}
