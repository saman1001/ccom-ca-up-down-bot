import { formatOrderPrice } from "./instrumentRules.js";

export async function applyMakerPricesToPlan({ client, plan, config, instrumentRules }) {
  if (config.orderMode !== "maker") return plan;

  const level = Math.max(1, Math.floor(Number(config.makerBookLevel || 3)));
  const book = await loadOrderBook({ client, instrument: config.instrument, depth: Math.max(level, 5) });
  const spreadPct = calculateSpreadPct(book);
  const maxSpreadPct = Math.max(0, Number(config.makerMaxSpreadPct || 0));

  if (maxSpreadPct > 0 && spreadPct > maxSpreadPct) {
    return {
      ...plan,
      makerBook: sanitizeBookSummary(book, level, spreadPct),
      actions: plan.actions.map((action) => {
        if (!action.order) return action;
        return {
          kind: "SKIP_MAKER_SPREAD_GUARD",
          batchId: action.batchId || null,
          order: null,
          originalKind: action.kind,
          reason: `Maker order skipped because spread ${spreadPct.toFixed(4)}% is above MAKER_MAX_SPREAD_PCT=${maxSpreadPct}.`
        };
      })
    };
  }

  return {
    ...plan,
    makerBook: sanitizeBookSummary(book, level, spreadPct),
    actions: plan.actions.map((action) => applyMakerPriceToAction({ action, book, level, config, instrumentRules }))
  };
}

async function loadOrderBook({ client, instrument, depth }) {
  const response = await client.publicGet("public/get-book", {
    instrument_name: instrument,
    depth
  });
  const row = response.result?.data?.[0] || response.result?.data || response.result || {};
  return {
    bids: normalizeLevels(row.bids),
    asks: normalizeLevels(row.asks)
  };
}

function applyMakerPriceToAction({ action, book, level, config, instrumentRules }) {
  if (!action.order || action.order.type !== "MARKET") return action;

  const side = action.order.side;
  const levels = side === "BUY" ? book.bids : book.asks;
  const selected = levels[level - 1];

  if (!selected) {
    return {
      kind: "SKIP_MAKER_BOOK_LEVEL",
      batchId: action.batchId || null,
      order: null,
      originalKind: action.kind,
      reason: `Maker order skipped because order book does not have level ${level} on ${side}.`
    };
  }

  const price = formatOrderPrice(selected.price, instrumentRules, side === "BUY" ? "floor" : "ceil");
  if (!price) {
    return {
      kind: "SKIP_MAKER_PRICE_RULES",
      batchId: action.batchId || null,
      order: null,
      originalKind: action.kind,
      reason: "Maker order skipped because selected book price cannot be formatted for this instrument."
    };
  }

  return {
    ...action,
    order: {
      ...action.order,
      type: "LIMIT",
      price,
      exec_inst: [config.makerPostOnlyMode === "POST_ONLY" ? "POST_ONLY" : "SMART_POST_ONLY"],
      time_in_force: "GOOD_TILL_CANCEL"
    },
    maker: {
      bookLevel: level,
      selectedPrice: selected.price,
      selectedQuantity: selected.quantity
    },
    reason: `${action.reason} Maker limit order uses ${side === "BUY" ? "bid" : "ask"} level ${level}.`
  };
}

function normalizeLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => ({
      price: Number(level[0]),
      quantity: Number(level[1])
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity) && level.quantity > 0);
}

function calculateSpreadPct(book) {
  const bestBid = book.bids[0]?.price || 0;
  const bestAsk = book.asks[0]?.price || 0;
  if (bestBid <= 0 || bestAsk <= 0) return 0;
  return ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100;
}

function sanitizeBookSummary(book, level, spreadPct) {
  return {
    level,
    bestBid: book.bids[0]?.price || 0,
    bestAsk: book.asks[0]?.price || 0,
    selectedBid: book.bids[level - 1]?.price || 0,
    selectedAsk: book.asks[level - 1]?.price || 0,
    spreadPct
  };
}
