import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./config.js";
import { buildDashboardPayload } from "./webData.js";

loadDotEnv(path.resolve(".env.web"));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "web");
const host = process.env.WEB_BIND_HOST || "127.0.0.1";
const port = Number(process.env.WEB_PORT || 8787);
const sessionHours = Number(process.env.WEB_SESSION_HOURS || 8);
const sessions = new Map();

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Read-only bot web dashboard listening on http://${host}:${port}`);
  if (!webPassword()) {
    console.log("WEB_PASSWORD is not set. Create .env.web before logging in.");
  }
});

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/login") {
    return sendHtml(res, loginPage({ error: url.searchParams.get("error") || "" }));
  }

  if (req.method === "GET" && pathname === "/login-hero.png") {
    return sendFile(res, path.join(publicDir, "login-hero.png"));
  }

  if (req.method === "POST" && pathname === "/login") {
    return handleLogin(req, res);
  }

  if (req.method === "POST" && pathname === "/logout") {
    clearSessionCookie(res);
    return redirect(res, "/login");
  }

  if (!isAuthenticated(req)) {
    if (pathname.startsWith("/api/")) return sendJson(res, 401, { error: "Not authenticated" });
    return redirect(res, "/login");
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    return sendJson(res, 200, buildDashboardPayload());
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return sendFile(res, path.join(publicDir, "index.html"));
  }

  if (req.method === "GET") {
    const filePath = path.resolve(publicDir, pathname.replace(/^\/+/, ""));
    if (!filePath.startsWith(publicDir + path.sep)) return sendText(res, 403, "Forbidden");
    return sendFile(res, filePath);
  }

  sendText(res, 405, "Method not allowed");
}

async function handleLogin(req, res) {
  const password = webPassword();
  if (!password) return redirect(res, "/login?error=missing-password");

  const body = await readBody(req);
  const fields = new URLSearchParams(body);
  const username = fields.get("username") || "";
  const submitted = fields.get("password") || "";
  if (!safeEqual(username, webUsername()) || !safeEqual(submitted, password)) {
    return redirect(res, "/login?error=bad-password");
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionHours * 60 * 60 * 1000;
  sessions.set(token, expiresAt);
  setSessionCookie(res, token);
  redirect(res, "/");
}

function isAuthenticated(req) {
  const cookie = parseCookies(req.headers.cookie || "").bot_session;
  if (!cookie) return false;
  const [token, signature] = cookie.split(".");
  if (!token || !signature) return false;
  if (!safeEqual(signature, sign(token))) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(res, token) {
  const maxAge = Math.round(sessionHours * 60 * 60);
  const secure = process.env.WEB_COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `bot_session=${token}.${sign(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "bot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function sessionSecret() {
  return process.env.WEB_SESSION_SECRET || webPassword() || "missing-local-secret";
}

function webPassword() {
  return process.env.WEB_PASSWORD || "";
}

function webUsername() {
  return process.env.WEB_USERNAME || "admin";
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, 404, "Not found");
  }
  res.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function loginPage({ error }) {
  const missingPassword = !webPassword();
  const message = missingPassword
    ? "WEB_PASSWORD nie je nastavene. Vytvor lokalny subor .env.web podla .env.web.example."
    : error === "bad-password"
      ? "Nespravne heslo."
      : "";

  return `<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Batch Bot Login</title>
  <style>
    :root { color-scheme: dark; --bg:#040916; --panel:rgba(8,15,31,.84); --text:#f7fbff; --muted:#a7b4ca; --line:rgba(122,149,190,.28); --danger:#ffb4ab; --blue:#22a7ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 20%, rgba(18,72,150,.24), transparent 34%), var(--bg); color: var(--text); font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body::before { content: ""; position: fixed; inset: 0; background: url("/login-hero.png") center / min(920px, 92vw) auto no-repeat; opacity: .42; filter: saturate(1.05); }
    body::after { content: ""; position: fixed; inset: 0; background: linear-gradient(90deg, rgba(4,9,22,.92), rgba(4,9,22,.68) 46%, rgba(4,9,22,.88)); }
    main { position: relative; z-index: 1; width: min(430px, calc(100vw - 32px)); background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.44); backdrop-filter: blur(14px); }
    h1 { margin: 0; font-size: 24px; letter-spacing: -.01em; }
    p { color: var(--muted); line-height: 1.5; margin: 8px 0 22px; }
    label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 7px; }
    input { width: 100%; height: 43px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; font: inherit; margin-bottom: 12px; background: rgba(255,255,255,.08); color: var(--text); }
    input:focus { outline: 2px solid rgba(34,167,255,.38); border-color: rgba(34,167,255,.7); }
    button { width: 100%; height: 43px; margin-top: 14px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #19b8ff, #126dff); color: #fff; font: inherit; font-weight: 700; cursor: pointer; box-shadow: 0 10px 28px rgba(18,109,255,.32); }
    button:disabled, input:disabled { opacity: .6; cursor: not-allowed; }
    .msg { color: var(--danger); font-size: 13px; margin: 0 0 14px; }
    .mark { width: 34px; height: 34px; border-radius: 9px; background: #fff; color: #081022; display: grid; place-items: center; font: 700 13px ui-monospace, monospace; margin-bottom: 14px; }
    .hero-mini { width: 100%; aspect-ratio: 16 / 7; border-radius: 10px; background: url("/login-hero.png") center / cover; border: 1px solid var(--line); margin-bottom: 18px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
  </style>
</head>
<body>
  <main>
    <div class="hero-mini" aria-hidden="true"></div>
    <div class="mark">BB</div>
    <h1>Batch Bot</h1>
    <p>Privatny read-only dashboard pre Crypto.com bota.</p>
    ${message ? `<div class="msg">${escapeHtml(message)}</div>` : ""}
    <form method="post" action="/login">
      <label for="username">Meno</label>
      <input id="username" name="username" type="text" autocomplete="username" value="${escapeHtml(webUsername())}" ${missingPassword ? "disabled" : ""}>
      <label for="password">Heslo</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus ${missingPassword ? "disabled" : ""}>
      <button type="submit" ${missingPassword ? "disabled" : ""}>Prihlasit sa</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
