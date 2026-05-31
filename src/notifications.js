import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function notificationLogPath(logDir) {
  return path.join(logDir, "notifications.jsonl");
}

function notificationStatePath(logDir) {
  return path.join(logDir, "notification-state.json");
}

export async function notify(config, notification, options = {}) {
  const now = new Date().toISOString();
  const event = {
    at: now,
    instrument: config.instrument,
    type: notification.type || "INFO",
    title: notification.title || "Bot notification",
    message: notification.message || "",
    data: notification.data || {}
  };

  fs.mkdirSync(config.logDir, { recursive: true });
  const state = readState(config.logDir);
  const key = options.key || `${event.type}:${event.title}`;
  const cooldownMinutes = Math.max(0, Number(options.cooldownMinutes ?? config.notificationCooldownMinutes ?? 60));
  if (isInCooldown(state, key, cooldownMinutes)) {
    return { logged: false, sent: false, skipped: "cooldown" };
  }

  fs.appendFileSync(notificationLogPath(config.logDir), `${JSON.stringify(event)}\n`);
  state.lastSent = state.lastSent || {};
  state.lastSent[key] = now;
  writeState(config.logDir, state);

  const skipped = [];
  let telegramSent = false;
  let emailSent = false;

  if (config.telegramBotToken && config.telegramChatId) {
    try {
      await sendTelegram(config, formatTelegramMessage(event));
      telegramSent = true;
    } catch (error) {
      appendNotificationError(config, "TELEGRAM_ERROR", `${config.instrument} Telegram notification failed`, error, event);
      skipped.push("telegram_error");
    }
  } else {
    skipped.push("telegram_not_configured");
  }

  if (options.email) {
    if (config.emailReportTo) {
      try {
        await sendEmail(config, event);
        emailSent = true;
      } catch (error) {
        appendNotificationError(config, "EMAIL_ERROR", `${config.instrument} email notification failed`, error, event);
        skipped.push("email_error");
      }
    } else {
      skipped.push("email_not_configured");
    }
  }

  return {
    logged: true,
    sent: telegramSent || emailSent,
    telegramSent,
    emailSent,
    skipped: skipped.join(",")
  };
}

export async function notifySale(config, { action, fill }) {
  await notify(
    config,
    {
      type: "SALE",
      title: `${config.instrument} batch sold`,
      message: `Sold ${formatNumber(fill.quantity)} ${config.baseAsset} at about ${formatNumber(fill.price)} ${config.quoteAsset}.`,
      data: {
        batchId: action.batchId || "",
        quantity: fill.quantity,
        price: fill.price,
        orderId: fill.orderId || ""
      }
    },
    { key: `sale:${config.instrument}:${fill.orderId || action.batchId || Date.now()}`, cooldownMinutes: 0 }
  );
}

export async function notifyLowQuoteBalanceIfNeeded(config, portfolio) {
  const threshold = Math.max(0, Number(config.lowQuoteBalanceAlert || 0));
  if (threshold <= 0 || Number(portfolio.quoteAvailable || 0) >= threshold) return;

  await notify(
    config,
    {
      type: "LOW_QUOTE_BALANCE",
      title: `${config.instrument} low ${config.quoteAsset} balance`,
      message: `${config.quoteAsset} available is ${formatNumber(portfolio.quoteAvailable)}, below alert threshold ${formatNumber(threshold)}.`,
      data: {
        quoteAvailable: portfolio.quoteAvailable,
        threshold
      }
    },
    { key: `low_quote:${config.instrument}`, cooldownMinutes: config.notificationCooldownMinutes }
  );
}

export async function notifyDailyReportIfNeeded(config, result) {
  if (!config.dailyReportEnabled) return;

  const today = new Date().toISOString().slice(0, 10);
  await notify(
    config,
    {
      type: "DAILY_REPORT",
      title: `${config.instrument} daily bot report`,
      message: [
        `Price: ${formatNumber(result.price)} ${config.quoteAsset}`,
        `Next sell price: ${formatNumber(result.nextSellPrice)} ${config.quoteAsset}`,
        `${config.quoteAsset} balance: ${formatNumber(result.portfolio?.quoteAvailable)} available / ${formatNumber(result.portfolio?.quoteTotal)} total`,
        `Portfolio value: ${formatNumber(result.portfolio?.totalQuoteValue)} ${config.quoteAsset}`,
        `Open batches: ${result.openBatchesAfter ?? result.openBatchesBefore ?? "n/a"}`
      ].join("\n"),
      data: {
        price: result.price,
        nextSellPrice: result.nextSellPrice ?? null,
        quoteAvailable: result.portfolio?.quoteAvailable ?? null,
        quoteTotal: result.portfolio?.quoteTotal ?? null,
        portfolioValue: result.portfolio?.totalQuoteValue,
        openBatches: result.openBatchesAfter ?? result.openBatchesBefore ?? null
      }
    },
    { key: `daily:${config.instrument}:${today}`, cooldownMinutes: 24 * 60, email: true }
  );
}

export async function recordBotSuccess(config) {
  const state = readState(config.logDir);
  state.consecutiveFailures = 0;
  state.lastSuccessAt = new Date().toISOString();
  writeState(config.logDir, state);
}

export async function recordBotError(config, error) {
  const state = readState(config.logDir);
  state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
  state.lastErrorAt = new Date().toISOString();
  state.lastErrorMessage = error.message || String(error);
  writeState(config.logDir, state);

  await notify(
    config,
    {
      type: "BOT_ERROR",
      title: `${config.instrument} bot error`,
      message: trimMessage(error.message || String(error)),
      data: {
        consecutiveFailures: state.consecutiveFailures
      }
    },
    { key: `error:${config.instrument}:${trimMessage(error.message || String(error), 80)}`, cooldownMinutes: config.notificationCooldownMinutes }
  );

  const threshold = Math.max(1, Number(config.repeatedFailureAlertCount || 3));
  if (state.consecutiveFailures >= threshold) {
    await notify(
      config,
      {
        type: "REPEATED_FAILURES",
        title: `${config.instrument} repeated bot failures`,
        message: `Bot failed ${state.consecutiveFailures} times in a row. Last error: ${trimMessage(error.message || String(error))}`,
        data: {
          consecutiveFailures: state.consecutiveFailures
        }
      },
      { key: `repeated_failures:${config.instrument}`, cooldownMinutes: config.notificationCooldownMinutes }
    );
  }
}

function readState(logDir) {
  const filePath = notificationStatePath(logDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(logDir, state) {
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(notificationStatePath(logDir), `${JSON.stringify(state, null, 2)}\n`);
}

function isInCooldown(state, key, cooldownMinutes) {
  if (cooldownMinutes <= 0) return false;
  const lastSentAt = state.lastSent?.[key];
  if (!lastSentAt) return false;
  const elapsedMs = Date.now() - new Date(lastSentAt).getTime();
  return Number.isFinite(elapsedMs) && elapsedMs < cooldownMinutes * 60 * 1000;
}

async function sendTelegram(config, text) {
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram notification failed (${response.status}): ${body}`);
  }
}

async function sendEmail(config, event) {
  const email = [
    `To: ${config.emailReportTo}`,
    `From: ${config.emailReportFrom}`,
    `Subject: ${sanitizeHeader(event.title)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    formatEmailMessage(event)
  ].join("\n");

  await sendmailWithInput(config.sendmailPath || "/usr/sbin/sendmail", email);
}

function sendmailWithInput(sendmailPath, email) {
  return new Promise((resolve, reject) => {
    const child = spawn(sendmailPath, ["-t"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("sendmail timed out after 15000ms"));
    }, 15000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`sendmail failed with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}: ${trimMessage(stderr || stdout || "no output", 500)}`));
    });
    child.stdin.end(email);
  });
}

function appendNotificationError(config, type, title, error, event) {
  fs.appendFileSync(
    notificationLogPath(config.logDir),
    `${JSON.stringify({
      at: new Date().toISOString(),
      instrument: config.instrument,
      type,
      title,
      message: trimMessage(error.message || String(error)),
      data: {
        notificationType: event.type
      }
    })}\n`
  );
}

function formatTelegramMessage(event) {
  return [`${event.title}`, "", event.message].filter(Boolean).join("\n");
}

function formatEmailMessage(event) {
  return [
    event.title,
    "",
    event.message,
    "",
    `Instrument: ${event.instrument}`,
    `Generated: ${event.at}`
  ].join("\n");
}

function sanitizeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").slice(0, 180);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function trimMessage(message, maxLength = 300) {
  const text = String(message || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
