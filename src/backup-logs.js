import fs from "node:fs";
import path from "node:path";

const source = path.resolve(process.argv[2] || "logs");
const backupRoot = path.resolve(process.argv[3] || "backups");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const target = path.join(backupRoot, `logs-${stamp}`);

if (!fs.existsSync(source)) {
  console.error(`Missing source directory: ${source}`);
  process.exit(1);
}

fs.mkdirSync(backupRoot, { recursive: true });
fs.cpSync(source, target, { recursive: true, errorOnExist: true });
console.log(target);
