import fs from "node:fs";
import path from "node:path";

const keepLines = Number(process.env.ROTATE_KEEP_SNAPSHOT_LINES || process.argv[2] || 5000);
const logDirs = process.argv.slice(3);
const dirs = logDirs.length ? logDirs : findLogDirs(path.resolve("logs"));

for (const dir of dirs) {
  rotateSnapshotFile(path.resolve(dir), keepLines);
}

function findLogDirs(root) {
  if (!fs.existsSync(root)) return [];
  const candidates = [root];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(root, entry.name));
  }
  return candidates.filter((dir) => fs.existsSync(path.join(dir, "snapshots.jsonl")));
}

function rotateSnapshotFile(logDir, keep) {
  const filePath = path.join(logDir, "snapshots.jsonl");
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length <= keep) {
    console.log(`${filePath}: kept ${lines.length}, no rotation needed`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const archivePath = path.join(logDir, `snapshots-${stamp}.jsonl`);
  const archiveLines = lines.slice(0, Math.max(0, lines.length - keep));
  const keptLines = lines.slice(-keep);

  fs.writeFileSync(archivePath, `${archiveLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf8");
  console.log(`${filePath}: archived ${archiveLines.length} lines to ${archivePath}, kept ${keptLines.length}`);
}
