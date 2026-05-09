export function extractTickerPrice(tickerResponse, instrument) {
  const data = tickerResponse.result?.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows.find((item) => item.i === instrument || item.instrument_name === instrument) || rows[0];
  if (!row) throw new Error(`No ticker data returned for ${instrument}.`);

  const raw = row.a ?? row.last_price ?? row.close ?? row.c;
  const price = Number(raw);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Could not parse ticker price from response: ${JSON.stringify(row)}`);
  }

  return price;
}

export function extractBalances(balanceResponse) {
  const data = balanceResponse.result?.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const accounts = rows.flatMap((row) => row.position_balances || row.balances || row.accounts || []);

  const balances = new Map();
  for (const item of accounts) {
    const asset = item.instrument_name || item.currency || item.asset;
    if (!asset) continue;

    const available = Number(item.quantity ?? item.available ?? item.available_balance ?? 0);
    const total = Number(item.total ?? item.balance ?? item.quantity ?? available);
    balances.set(asset, {
      available: Number.isFinite(available) ? available : 0,
      total: Number.isFinite(total) ? total : 0
    });
  }

  return balances;
}

export function portfolioValue({ balances, baseAsset, quoteAsset, price }) {
  const base = balances.get(baseAsset) || { available: 0, total: 0 };
  const quote = balances.get(quoteAsset) || { available: 0, total: 0 };

  return {
    baseAvailable: base.available,
    baseTotal: base.total,
    quoteAvailable: quote.available,
    quoteTotal: quote.total,
    totalQuoteValue: quote.total + base.total * price
  };
}
