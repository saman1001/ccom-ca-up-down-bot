import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual scheduler without importing the trading CLI or contacting an exchange.
const source = fs.readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8');
const watch = source.slice(source.indexOf('async function watch()'), source.indexOf('async function checkConfig()'));
let runs = 0;
let notifications = 0;
let callback;
let interval;
const context = vm.createContext({
  loadConfig: () => ({ checkIntervalMinutes: 60 }),
  runOnce: async () => { runs++; if (runs !== 2) throw new Error('Blocked by price guard'); },
  notifyErrorSafely: async () => { notifications++; },
  console: { error() {} },
  setInterval: (fn, ms) => { callback = fn; interval = ms; }
});
await vm.runInContext(watch + '\nwatch()', context);
assert.equal(runs, 1);
assert.equal(notifications, 1);
assert.equal(interval, 3600000);
await callback();
assert.equal(runs, 2);
assert.equal(notifications, 1);
await callback();
assert.equal(runs, 3);
assert.equal(notifications, 2);
console.log('PASS: startup failure preserves hourly schedule; subsequent success and failure handled.');
