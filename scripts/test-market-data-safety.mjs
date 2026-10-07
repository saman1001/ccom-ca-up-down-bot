import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertMarketDataSafe } from '../src/marketDataSafety.js';
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'price-guard-test-'));
const config = { instrument: 'NMR_USD', logDir, maxSuspiciousPriceMovePct: 25, maxSuspiciousPriceBlockHours: 24 };
const start = Date.parse('2026-10-07T00:00:00Z');
const input = { price: 140, portfolio: { quoteTotal: 500 }, previous: { at: '2026-10-06T23:00:00Z', price: 100 }, config };
try {
  assert.throws(() => assertMarketDataSafe({ ...input, now: start }), /price moved/);
  assert.throws(() => assertMarketDataSafe({ ...input, now: start + 86400000 - 1 }), /price moved/);
  // State is read from disk on each call, including after process restart.
  assert.doesNotThrow(() => assertMarketDataSafe({ ...input, now: start + 86400000 }));
  assert.throws(() => assertMarketDataSafe({ ...input, price: NaN, now: start + 86400000 }), /invalid/);
  assert.throws(() => assertMarketDataSafe({ ...input, portfolio: { quoteTotal: -1 }, now: start + 86400000 }), /balance/);
  assert.throws(() => assertMarketDataSafe({ ...input, price: 200, previous: { at: '2026-10-08T00:00:00Z', price: 140 }, now: start + 86400001 }), /price moved/);
  assert.doesNotThrow(() => assertMarketDataSafe({ ...input, price: 125, now: start + 86400002 }));
  assert.equal(fs.existsSync(path.join(logDir, 'price-guard-state.json')), false);
  assert.throws(() => assertMarketDataSafe({ ...input, config: { ...config, maxSuspiciousPriceBlockHours: 0 }, now: start + 864000000 }), /price moved/);
  console.log('PASS: 24h boundary, persistent timer, renewed protection, valid-price recovery, disabled expiry, invalid data checks.');
} finally { fs.rmSync(logDir, { recursive: true, force: true }); }
