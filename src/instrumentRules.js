export const DEFAULT_INSTRUMENT_RULES = {
  quantityDecimals: 8,
  priceDecimals: 8,
  priceTickSize: 0,
  quantityTickSize: 0,
  minQuantity: 0,
  minNotional: 0
};

export async function loadInstrumentRules(client, instrument) {
  try {
    const response = await client.publicGet("public/get-instruments", {});
    const rows = normalizeRows(response.result?.data);
    const row = rows.find((item) => {
      return item.instrument_name === instrument || item.symbol === instrument || item.i === instrument;
    });

    if (!row) return DEFAULT_INSTRUMENT_RULES;

    return {
      quantityDecimals: numberField(row, ["quantity_decimals", "quantity_decimal", "qty_decimals"], DEFAULT_INSTRUMENT_RULES.quantityDecimals),
      priceDecimals: numberField(row, ["price_decimals", "price_decimal", "quote_decimals"], DEFAULT_INSTRUMENT_RULES.priceDecimals),
      priceTickSize: numberField(row, ["price_tick_size", "tick_size"], DEFAULT_INSTRUMENT_RULES.priceTickSize),
      quantityTickSize: numberField(row, ["qty_tick_size", "quantity_tick_size"], DEFAULT_INSTRUMENT_RULES.quantityTickSize),
      minQuantity: numberField(row, ["min_quantity", "min_qty", "qty_tick_size", "quantity_tick_size"], DEFAULT_INSTRUMENT_RULES.minQuantity),
      minNotional: numberField(row, ["min_notional", "min_order_value", "min_order_amount"], DEFAULT_INSTRUMENT_RULES.minNotional)
    };
  } catch {
    return DEFAULT_INSTRUMENT_RULES;
  }
}

export function formatOrderQuantity(quantity, rules, mode = "floor") {
  const decimals = Math.max(0, Number(rules.quantityDecimals ?? DEFAULT_INSTRUMENT_RULES.quantityDecimals));
  const factor = 10 ** decimals;
  const scaled = Number(quantity) * factor;
  const rounded = mode === "ceil" ? Math.ceil(scaled) : Math.floor(scaled);
  const value = rounded / factor;

  if (!Number.isFinite(value) || value <= 0) return null;
  if (rules.minQuantity && value < rules.minQuantity) return null;

  return trimQuantity(value, decimals);
}

export function roundDownQuantity(quantity, rules) {
  const formatted = formatOrderQuantity(quantity, rules, "floor");
  return formatted ? Number(formatted) : 0;
}

export function formatOrderPrice(price, rules, mode = "floor") {
  const value = roundByTickOrDecimals({
    value: Number(price),
    tickSize: Number(rules.priceTickSize || 0),
    decimals: Math.max(0, Number(rules.priceDecimals ?? DEFAULT_INSTRUMENT_RULES.priceDecimals)),
    mode
  });

  if (!Number.isFinite(value) || value <= 0) return null;
  return trimQuantity(value, Math.max(0, Number(rules.priceDecimals ?? DEFAULT_INSTRUMENT_RULES.priceDecimals)));
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.instruments)) return data.instruments;
  if (data) return [data];
  return [];
}

function numberField(row, names, fallback) {
  for (const name of names) {
    const value = Number(row[name]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function trimQuantity(quantity, decimals) {
  const value = Number(quantity).toFixed(decimals);
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function roundByTickOrDecimals({ value, tickSize, decimals, mode }) {
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (Number.isFinite(tickSize) && tickSize > 0) {
    const scaled = value / tickSize;
    const rounded = mode === "ceil" ? Math.ceil(scaled) : Math.floor(scaled);
    return rounded * tickSize;
  }

  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = mode === "ceil" ? Math.ceil(scaled) : Math.floor(scaled);
  return rounded / factor;
}
