import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const pair = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'nmr-usd';
if (!['nmr-usd', 'btc-usd', 'cro-usd'].includes(pair)) throw new Error('Unsupported reporting pair');
process.env.ENV_FILE = `.env.${pair}`;
const config = loadConfig();
if (config.instrument !== pair.replace('-', '_').toUpperCase()) throw new Error('Reporting configuration does not match the requested pair');
if (!config.emailReportTo || !config.dailyReportEnabled) process.exit(0);
const now = new Date();
const today = now.toISOString().slice(0, 10);
const marker = path.join(config.logDir, 'email-fallback-state.json');
const readJson = (p, fallback) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
if (readJson(marker, {}).sentDate === today) process.exit(0);
const eventsPath = path.join(config.logDir, 'notifications.jsonl');
const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : [];
const report = events.filter(e => e.type === 'DAILY_REPORT' && e.at?.startsWith(today)).at(-1);
// Allow the normal sender time to finish before checking its error event.
if (report && now - new Date(report.at) < 120000) process.exit(0);
const failed = report && events.some(e => e.type === 'EMAIL_ERROR' && e.data?.notificationType === 'DAILY_REPORT' && e.at >= report.at);
if (report && !failed) { console.log('Normal daily report generated without a logged email error; fallback skipped.'); process.exit(0); }
const state = readJson(path.join(config.logDir, 'notification-state.json'), {});
const snapshots = fs.readFileSync(path.join(config.logDir, 'snapshots.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
const snapshot = JSON.parse(snapshots.at(-1));
const stale = now - new Date(snapshot.at) > 90 * 60000;
const header = s => String(s).replace(/[\r\n]/g, ' ');
const failures = Number(state.consecutiveFailures) || 0;
const message = [
  `To: ${header(config.emailReportTo)}`,
  `From: ${header(config.emailReportFrom)}`,
  `Subject: ${header(config.instrument)} daily bot report${stale ? ' - STALE DATA / BOT BLOCKED' : ''}`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit', '',
  `Report date (UTC): ${today}`,
  `Last successful snapshot (UTC): ${snapshot.at}`,
  stale ? 'WARNING: These are historical values, not current balances or prices.' : 'Values from the latest completed bot snapshot.',
  `Price: ${formatNumber(snapshot.price)} USD`,
  `Portfolio value: ${formatNumber(snapshot.portfolio?.totalQuoteValue, 2)} USD`,
  `USD available: ${formatNumber(snapshot.portfolio?.quoteAvailable, 2)} USD`,
  `Open batches: ${snapshot.openBatchesAfter ?? snapshot.openBatchesBefore ?? 'unknown'}`,
  `Next sell price: ${formatNumber(snapshot.nextSellPrice)} USD`,
  `Consecutive failed runs: ${failures}`,
  ...(failures > 0 ? [`Current bot error (${header(state.lastErrorAt || 'n/a')}): ${summarizeError(state.lastErrorMessage)}`] : []),
  'Fallback email delivery. Trading settings have not been changed.', ''
].join('\n');
if (process.argv.includes('--preview')) { console.log(message); process.exit(0); }
const result = spawnSync(config.sendmailPath, ['-t'], { input: message, encoding: 'utf8', timeout: 60000 });
if (result.error || result.status !== 0) { console.error('Email delivery failed; the next timer run will retry.'); process.exit(1); }
fs.writeFileSync(marker, JSON.stringify({ sentDate: today, sentAt: now.toISOString(), snapshotAt: snapshot.at }) + '\n', { mode: 0o600 });
console.log(`${config.instrument} fallback report accepted by mail transport.`);

function formatNumber(value, maximumFractionDigits = 8) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits }) : 'n/a';
}

function summarizeError(value) {
  let text = String(value || 'Unknown error');
  // Old notification state can contain a complete upstream HTML error page.
  const htmlStart = text.search(/<!doctype\b|<\/?[a-z][^>]*>/i);
  if (htmlStart >= 0) {
    const reason = text.slice(0, htmlStart).trim().replace(/:\s*$/, '');
    text = `${reason || 'Upstream error'} (HTML response omitted)`;
  }
  text = text.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}
