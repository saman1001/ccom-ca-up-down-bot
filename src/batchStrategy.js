import fs from "node:fs";
import path from "node:path";
import { formatOrderQuantity, roundDownQuantity } from "./instrumentRules.js";

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

export function buildBatchPlan({ batches, dustBank, instrumentRules, price, config, now = new Date().toISOString() }) {
  const batchQuantity = config.batchQuantity;
  const averageDownMultiplier = 1 - Math.abs(config.averageDownDropPct) / 100;
  const takeProfitMultiplier = 1 + Math.abs(config.takeProfitRisePct) / 100;
  const openBatchCount = batches.filter((item) => item.status === "OPEN").length;
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
      const sellQuantity = roundDownQuantity(batch.quantity, instrumentRules);
      const dustQuantity = cleanQuantity(batch.quantity - sellQuantity);
      if (sellQuantity <= 0) {
        actions.push({
          kind: "HOLD_UNSELLABLE_DUST",
          batchId: batch.id,
          order: null,
          dustQuantity,
          reason: "Batch quantity is below the tradable instrument quantity."
        });
        continue;
      }
      if (isBelowMinNotional(sellQuantity, price, instrumentRules)) {
        actions.push({
          kind: "HOLD_BELOW_MIN_NOTIONAL",
          batchId: batch.id,
          order: null,
          reason: "Batch sell value is below the instrument minimum notional."
        });
        continue;
      }

      actions.push({
        kind: "TAKE_PROFIT",
        batchId: batch.id,
        order: {
          instrument_name: config.instrument,
          side: "SELL",
          type: "MARKET",
          quantity: formatOrderQuantity(sellQuantity, instrumentRules)
        },
        dustQuantity,
        reason: `Current price is at least ${config.takeProfitRisePct}% above batch average.`
      });
    }
  }

  if (dustBank?.quantity >= config.dustSellQuantity) {
    const dustSellQuantity = roundDownQuantity(dustBank.quantity, instrumentRules);
    if (dustSellQuantity >= config.dustSellQuantity && !isBelowMinNotional(dustSellQuantity, price, instrumentRules)) {
      actions.push({
        kind: "DUST_SELL",
        batchId: null,
        order: {
          instrument_name: config.instrument,
          side: "SELL",
          type: "MARKET",
          quantity: formatOrderQuantity(dustSellQuantity, instrumentRules)
        },
        reason: `Dust bank reached at least ${config.dustSellQuantity} ${config.baseAsset}.`
      });
    }
  }

  if (config.buyBaseBatchEveryRun) {
    const lastBaseBuy = findLastBaseBuy(batches);
    const cooldownMs = Math.max(0, config.baseBuyCooldownMinutes) * 60 * 1000;
    const lastBaseBuyAt = lastBaseBuy ? new Date(lastBaseBuy.at).getTime() : 0;
    const nowMs = new Date(now).getTime();
    const maxOpenBatches = Math.max(0, Number(config.maxOpenBatches || 0));
    const dailyBaseBuyLimit = Math.max(0, Number(config.dailyBaseBuyLimit || 0));
    const baseBuysToday = countBaseBuysSince(batches, startOfUtcDayMs(nowMs));

    if (maxOpenBatches > 0 && openBatchCount >= maxOpenBatches) {
      actions.push({
        kind: "SKIP_BASE_BUY_MAX_OPEN_BATCHES",
        batchId: null,
        order: null,
        reason: `Open batch count ${openBatchCount} reached limit of ${maxOpenBatches}.`
      });
    } else if (dailyBaseBuyLimit > 0 && baseBuysToday >= dailyBaseBuyLimit) {
      actions.push({
        kind: "SKIP_BASE_BUY_DAILY_LIMIT",
        batchId: null,
        order: null,
        reason: `Base buys today ${baseBuysToday} reached daily limit of ${dailyBaseBuyLimit}.`
      });
    } else if (lastBaseBuy && Number.isFinite(lastBaseBuyAt) && nowMs - lastBaseBuyAt < cooldownMs) {
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

function isBelowMinNotional(quantity, price, instrumentRules) {
  const minNotional = Number(instrumentRules.minNotional || 0);
  return minNotional > 0 && quantity * price < minNotional;
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

function countBaseBuysSince(batches, startMs) {
  let count = 0;
  for (const batch of batches) {
    for (const buy of batch.buys || []) {
      if (buy.reason !== "BASE_BUY") continue;
      const atMs = new Date(buy.at).getTime();
      if (Number.isFinite(atMs) && atMs >= startMs) {
        count += 1;
      }
    }
  }
  return count;
}

function startOfUtcDayMs(nowMs) {
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime())) return 0;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
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
    batch.dustQuantity = Math.max(0, Number((batch.quantity - filledQuantity).toFixed(12)));
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
  const value = Number(quantity).toFixed(8);
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function cleanQuantity(quantity) {
  return Math.max(0, Number(Number(quantity).toFixed(12)));
}
