import { loadConfig } from "./config.js";
import { CryptoComClient } from "./cryptoComClient.js";
import { extractBalances, extractTickerPrice, portfolioValue } from "./portfolio.js";
import { buildOrder, decide } from "./strategy.js";
import { appendSnapshot, ensureLogDir, readPreviousSnapshot } from "./storage.js";

async function runOnce() {
  const config = loadConfig();
  ensureLogDir(config.logDir);

  const client = new CryptoComClient(config);

  const ticker = await client.publicGet("public/get-tickers", {
    instrument_name: config.instrument
  });
  const price = extractTickerPrice(ticker, config.instrument);

  const balanceResponse = await client.privatePost("private/user-balance", {});
  const balances = extractBalances(balanceResponse);
  const portfolio = portfolioValue({
    balances,
    baseAsset: config.baseAsset,
    quoteAsset: config.quoteAsset,
    price
  });

  const previous = readPreviousSnapshot(config.logDir);
  const snapshot = {
    at: new Date().toISOString(),
    instrument: config.instrument,
    price,
    portfolio
  };
  const signal = decide({ current: snapshot, previous, config });
  const order = buildOrder({ signal, snapshot, config });

  const result = {
    ...snapshot,
    signal,
    order,
    dryRun: config.dryRun,
    tradingEnabled: config.enableTrading
  };

  if (order && !config.dryRun && config.enableTrading) {
    result.orderResult = await client.privatePost("private/create-order", order);
  }

  appendSnapshot(config.logDir, result);
  console.log(JSON.stringify(result, null, 2));
}

async function watch() {
  const config = loadConfig();
  const intervalMs = Math.max(1, config.checkIntervalMinutes) * 60 * 1000;

  await runOnce();
  setInterval(() => {
    runOnce().catch((error) => {
      console.error(`[${new Date().toISOString()}] ${error.stack || error.message}`);
    });
  }, intervalMs);
}

function checkConfig() {
  const config = loadConfig();
  const safeConfig = {
    ...config,
    apiKey: config.apiKey ? "(set)" : "(missing)",
    apiSecret: config.apiSecret ? "(set)" : "(missing)"
  };
  console.log(JSON.stringify(safeConfig, null, 2));
}

const command = process.argv[2] || "once";

try {
  if (command === "watch") {
    await watch();
  } else if (command === "check") {
    checkConfig();
  } else {
    await runOnce();
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
