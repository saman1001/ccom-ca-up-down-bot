import fs from "node:fs";
import path from "node:path";

function batchFilePath(logDir) {
  return path.join(logDir, "batches.json");
}

export function loadBatches(logDir) {
  const filePath = batchFilePath(logDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function saveBatches(logDir, batches) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(batchFilePath(logDir), `${JSON.stringify(batches, null, 2)}\n`);
}

export function buildBatchPlan({ batches, price, config, now = new Date().toISOString() }) {
  const batchQuantity = config.batchQuantity;
  const averageDownMultiplier = 1 - Math.abs(config.averageDownDropPct) / 100;
  const takeProfitMultiplier = 1 + Math.abs(config.takeProfitRisePct) / 100;
  const actions = [];

  for (const batch of batches.filter((item) => item.status === "OPEN")) {
    if (price <= batch.averagePrice * averageDownMultiplier) {
      const remainingCapacity = Math.max(0, config.maxBatchQuantity - batch.quantity);
      const quantityToBuy = Math.min(batchQuantity, remainingCapacity);
      if (quantityToBuy <= 0) {
        actions.push({
          kind: "HOLD_MAX_SIZE",
          batchId: batch.id,
          order: null,
          reason: `Batch already reached max size of ${config.maxBatchQuantity} ${config.baseAsset}.`
        });
        continue;
      }

      actions.push({
        kind: "AVERAGE_DOWN",
        batchId: batch.id,
        order: {
          instrument_name: config.instrument,
          side: "BUY",
          type: "MARKET",
          quantity: trimQuantity(quantityToBuy)
        },
        reason: `Current price is at least ${config.averageDownDropPct}% below batch average.`
      });
    } else if (price >= batch.averagePrice * takeProfitMultiplier) {
      actions.push({
        kind: "TAKE_PROFIT",
        batchId: batch.id,
        order: {
          instrument_name: config.instrument,
          side: "SELL",
          type: "MARKET",
          quantity: trimQuantity(batch.quantity)
        },
        reason: `Current price is at least ${config.takeProfitRisePct}% above batch average.`
      });
    }
  }

  if (config.buyBaseBatchEveryRun) {
    const lastBaseBuy = findLastBaseBuy(batches);
    const cooldownMs = Math.max(0, config.baseBuyCooldownMinutes) * 60 * 1000;
    const lastBaseBuyAt = lastBaseBuy ? new Date(lastBaseBuy.at).getTime() : 0;
    const nowMs = new Date(now).getTime();

    if (lastBaseBuy && Number.isFinite(lastBaseBuyAt) && nowMs - lastBaseBuyAt < cooldownMs) {
      actions.push({
        kind: "SKIP_BASE_BUY_COOLDOWN",
        batchId: null,
        order: null,
        reason: `Last base buy is newer than ${config.baseBuyCooldownMinutes} minutes.`
      });
    } else {
      actions.push({
        kind: "BASE_BUY",
        batchId: null,
        order: {
          instrument_name: config.instrument,
          side: "BUY",
          type: "MARKET",
          quantity: String(batchQuantity)
        },
        reason: "Scheduled base batch buy."
      });
    }
  }

  return {
    at: now,
    actions
  };
}

function findLastBaseBuy(batches) {
  let latest = null;
  for (const batch of batches) {
    for (const buy of batch.buys || []) {
      if (buy.reason !== "BASE_BUY") continue;
      if (!latest || new Date(buy.at).getTime() > new Date(latest.at).getTime()) {
        latest = buy;
      }
    }
  }
  return latest;
}

export function applyFilledBatchAction({ batches, action, fillPrice, filledQuantity, now }) {
  if (action.kind === "BASE_BUY") {
    batches.push({
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
      quantity: filledQuantity,
      averagePrice: fillPrice,
      buys: [
        {
          at: now,
          quantity: filledQuantity,
          price: fillPrice,
          reason: action.kind
        }
      ],
      sells: []
    });
    return;
  }

  const batch = batches.find((item) => item.id === action.batchId);
  if (!batch || batch.status !== "OPEN") return;

  if (action.kind === "AVERAGE_DOWN") {
    const oldCost = batch.quantity * batch.averagePrice;
    const newCost = filledQuantity * fillPrice;
    batch.quantity += filledQuantity;
    batch.averagePrice = (oldCost + newCost) / batch.quantity;
    batch.updatedAt = now;
    batch.buys.push({
      at: now,
      quantity: filledQuantity,
      price: fillPrice,
      reason: action.kind
    });
    return;
  }

  if (action.kind === "TAKE_PROFIT") {
    batch.status = "CLOSED";
    batch.closedAt = now;
    batch.updatedAt = now;
    batch.sells.push({
      at: now,
      quantity: filledQuantity,
      price: fillPrice,
      reason: action.kind
    });
  }
}

export function applyDryRunBatchPlan({ batches, plan, price, now }) {
  const simulated = JSON.parse(JSON.stringify(batches));
  for (const action of plan.actions) {
    if (!action.order) continue;
    applyFilledBatchAction({
      batches: simulated,
      action,
      fillPrice: price,
      filledQuantity: Number(action.order.quantity),
      now
    });
  }
  return simulated;
}

function trimQuantity(quantity) {
  return Number(quantity).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}
