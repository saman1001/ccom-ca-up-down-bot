import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Run the real reporting CLI with an in-memory filesystem and mail transport.
// No env files, exchange APIs, real email delivery or trading processes are used.
const scriptUrl = new URL('./nmr-email-fallback.mjs', import.meta.url);
const source = fs.readFileSync(scriptUrl, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(scriptUrl.href));
const now = '2026-11-09T01:00:00.000Z';
const today = now.slice(0, 10);
const htmlError = 'Invalid JSON response (524): <!DOCTYPE html>\n<html><head><title>Timeout</title></head><body><script>privateDiagnostic()</script></body></html>';
const snapshot = {
  at: '2026-11-09T00:40:00.000Z', price: 0.04779,
  portfolio: { totalQuoteValue: 123.4567890123, quoteAvailable: 45.6789012345 },
  openBatchesAfter: 2, nextSellPrice: 0.051182759052750285
};

function run({ pair = 'cro-usd', state = {}, latest = snapshot, events = [], marker = {}, preview = true, status = 0, enabled = true } = {}) {
  const config = {
    instrument: pair.replace('-', '_').toUpperCase(), logDir: '/fake-logs',
    emailReportTo: 'reader@example.test', emailReportFrom: 'Bot <bot@example.test>',
    dailyReportEnabled: enabled, sendmailPath: 'fake-sendmail'
  };
  const files = new Map([
    ['notification-state.json', JSON.stringify(state)],
    ['snapshots.jsonl', JSON.stringify(latest) + '\n'],
    ['notifications.jsonl', events.map(e => JSON.stringify(e)).join('\n')],
    ['email-fallback-state.json', JSON.stringify(marker)]
  ].map(([name, content]) => [path.join(config.logDir, name), content]));
  const output = [], sent = [], writes = [];
  let exitCode = 0;
  const exit = Symbol('exit');
  const context = vm.createContext({
    fs: {
      existsSync: p => files.has(p),
      readFileSync: p => { assert.ok(files.has(p), `Unexpected file read ${p}`); return files.get(p); },
      writeFileSync: (p, data) => { files.set(p, data); writes.push(p); }
    }, path, fileURLToPath,
    loadConfig: () => config,
    process: { argv: ['node', 'script', pair, ...(preview ? ['--preview'] : [])], env: {}, chdir() {}, exit(code) { exitCode = code; throw exit; } },
    console: { log: text => output.push(text), error: text => output.push(text) },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
    spawnSync: (command, args, options) => { sent.push({ command, args, ...options }); return { status }; }
  });
  try { vm.runInContext(source, context); } catch (error) { if (error !== exit) throw error; }
  return { output: output.join('\n'), sent, writes, files, exitCode };
}

for (const pair of ['cro-usd', 'btc-usd', 'nmr-usd']) {
  const result = run({ pair, state: { consecutiveFailures: 0, lastErrorAt: '2026-10-19T18:40:19Z', lastErrorMessage: htmlError } });
  assert.doesNotMatch(result.output, /Invalid JSON|DOCTYPE|<html|privateDiagnostic|Last recorded bot error/);
  assert.match(result.output, /MIME-Version: 1\.0/);
  assert.match(result.output, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(result.output, /Portfolio value: 123\.46 USD/);
  assert.match(result.output, /USD available: 45\.68 USD/);
  assert.match(result.output, /Next sell price: 0\.05118276 USD/);
  assert.equal(result.sent.length, 0);
  assert.equal(result.writes.length, 0);
}

const active = run({ state: { consecutiveFailures: 2, lastErrorAt: now, lastErrorMessage: htmlError } });
assert.match(active.output, /Current bot error .*Invalid JSON response \(524\).*HTML response omitted/);
assert.doesNotMatch(active.output.split('\n\n').slice(1).join('\n\n'), /<|>|privateDiagnostic/);
const longError = run({ state: { consecutiveFailures: 1, lastErrorMessage: 'Failed\r\n' + 'x'.repeat(5000) } });
assert.ok(longError.output.split('\n').find(line => line.startsWith('Current bot error')).length < 300);
const stale = run({ latest: { ...snapshot, at: '2026-11-08T00:00:00Z' } });
assert.match(stale.output, /STALE DATA \/ BOT BLOCKED/);
assert.match(stale.output, /WARNING: These are historical values/);
const unknown = run({ latest: { ...snapshot, price: null, nextSellPrice: null, portfolio: {} } });
assert.match(unknown.output, /Price: n\/a USD/);
assert.match(unknown.output, /Portfolio value: n\/a USD/);
assert.match(unknown.output, /Next sell price: n\/a USD/);

const report = { type: 'DAILY_REPORT', at: '2026-11-09T00:30:00Z' };
const failure = { type: 'EMAIL_ERROR', at: '2026-11-09T00:31:00Z', data: { notificationType: 'DAILY_REPORT' } };
assert.equal(run({ events: [report], preview: false }).sent.length, 0);
assert.equal(run({ events: [{ ...report, at: '2026-11-09T00:59:00Z' }], preview: false }).sent.length, 0);
assert.equal(run({ marker: { sentDate: today }, preview: false }).sent.length, 0);
assert.equal(run({ enabled: false, preview: false }).sent.length, 0);
const delivered = run({ events: [report, failure], preview: false });
assert.equal(delivered.sent.length, 1);
assert.equal(delivered.writes.length, 1);
assert.equal(JSON.parse(delivered.files.get(path.join('/fake-logs', 'email-fallback-state.json'))).sentDate, today);
const rejected = run({ preview: false, status: 1 });
assert.equal(rejected.exitCode, 1);
assert.equal(rejected.writes.length, 0);
assert.equal(run({ preview: false }).sent.length, 1);
console.log('PASS: all reporting pairs, recovered/active errors, HTML omission, bounded errors, MIME headers, numbers, stale/missing values, preview, deduplication and mail retry.');
