export function decide({ current, previous, config }) {
  if (!previous) {
    return {
      action: "HOLD",
      reason: "No previous snapshot yet.",
      priceChangePct: 0
    };
  }

  const priceChangePct = ((current.price - previous.price) / previous.price) * 100;

  if (priceChangePct <= -Math.abs(config.buyDropPct)) {
    return {
      action: "BUY",
      reason: `Price dropped ${priceChangePct.toFixed(2)}%.`,
      priceChangePct
    };
  }

  if (priceChangePct >= Math.abs(config.sellRisePct)) {
    return {
      action: "SELL",
      reason: `Price rose ${priceChangePct.toFixed(2)}%.`,
      priceChangePct
    };
  }

  return {
    action: "HOLD",
    reason: `Price changed ${priceChangePct.toFixed(2)}%, inside thresholds.`,
    priceChangePct
  };
}

export function buildOrder({ signal, snapshot, config }) {
  if (signal.action === "BUY") {
    const notional = Math.min(config.tradeNotional, snapshot.portfolio.quoteAvailable);
    if (notional <= 0) return null;

    return {
      instrument_name: config.instrument,
      side: "BUY",
      type: "MARKET",
      notional: notional.toFixed(2)
    };
  }

  if (signal.action === "SELL") {
    const quantity = Math.min(config.tradeNotional / snapshot.price, snapshot.portfolio.baseAvailable);
    if (quantity <= 0) return null;

    return {
      instrument_name: config.instrument,
      side: "SELL",
      type: "MARKET",
      quantity: quantity.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")
    };
  }

  return null;
}
