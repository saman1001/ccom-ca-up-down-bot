import fs from "node:fs";
import path from "node:path";

export function assertMarketDataSafe({ price, portfolio, previous, config, now = Date.now() }) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Suspicious market data: invalid ${config.instrument} price ${price}.`);
  }
  for (const [name, value] of Object.entries(portfolio)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Suspicious balance data: ${name} is ${value}.`);
    }
  }
  const previousPrice = Number(previous?.price || 0);
  const limit = Number(config.maxSuspiciousPriceMovePct || 0);
  const timeoutHours = Number(config.maxSuspiciousPriceBlockHours || 0);
  const statePath = path.join(config.logDir, "price-guard-state.json");
  const movePct = previousPrice > 0 ? Math.abs((price - previousPrice) / previousPrice) * 100 : 0;
  if (!(previousPrice > 0 && limit > 0 && movePct > limit)) {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    return;
  }
  if (Number.isFinite(timeoutHours) && timeoutHours > 0) {
    const reference = JSON.stringify([config.instrument, previous.at, previousPrice, limit]);
    let state;
    try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    if (state?.reference !== reference || !Number.isFinite(state?.firstBlockedAt) || state.firstBlockedAt > now) {
      state = { reference, firstBlockedAt: now };
      fs.mkdirSync(config.logDir, { recursive: true });
      fs.writeFileSync(statePath + ".tmp", JSON.stringify(state) + "\n", { mode: 0o600 });
      fs.renameSync(statePath + ".tmp", statePath);
    }
    // Keep the expired state until a successful snapshot provides a new reference.
    if (now - state.firstBlockedAt >= timeoutHours * 3600000) return;
  }
  throw new Error(`Suspicious market data: ${config.instrument} price moved ${movePct.toFixed(2)}% since last snapshot, above ${limit}%.`);
}
