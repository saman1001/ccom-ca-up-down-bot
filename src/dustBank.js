import fs from "node:fs";
import path from "node:path";

function dustBankPath(logDir) {
  return path.join(logDir, "dust-bank.json");
}

export function loadDustBank(logDir) {
  const filePath = dustBankPath(logDir);
  if (!fs.existsSync(filePath)) {
    return {
      asset: null,
      quantity: 0,
      entries: []
    };
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function saveDustBank(logDir, dustBank) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(dustBankPath(logDir), `${JSON.stringify(dustBank, null, 2)}\n`);
}

export function addDust(dustBank, { asset, quantity, price, sourceBatchId, reason, at }) {
  const dustQuantity = Number(quantity);
  if (!Number.isFinite(dustQuantity) || dustQuantity <= 0) return;

  dustBank.asset ||= asset;
  dustBank.quantity = Number(((dustBank.quantity || 0) + dustQuantity).toFixed(12));
  dustBank.entries ||= [];
  dustBank.entries.push({
    at,
    asset,
    quantity: dustQuantity,
    price,
    sourceBatchId,
    reason
  });
}

export function subtractDust(dustBank, { quantity, price, orderId, at }) {
  const soldQuantity = Number(quantity);
  if (!Number.isFinite(soldQuantity) || soldQuantity <= 0) return;

  dustBank.quantity = Math.max(0, Number(((dustBank.quantity || 0) - soldQuantity).toFixed(12)));
  dustBank.sells ||= [];
  dustBank.sells.push({
    at,
    quantity: soldQuantity,
    price,
    orderId
  });
}
