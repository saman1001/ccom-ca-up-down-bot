export const DEFAULT_INSTRUMENT_RULES = {
  quantityDecimals: 8,
  priceDecimals: 8,
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
      priceDecimals: numberField(row, ["price_decimals", "price_decimal"], DEFAULT_INSTRUMENT_RULES.priceDecimals),
      minQuantity: numberField(row, ["min_quantity", "min_qty", "quantity_tick_size"], DEFAULT_INSTRUMENT_RULES.minQuantity),
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
