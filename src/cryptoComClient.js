import crypto from "node:crypto";

function isPlainObject(value) {
  return value !== null && value !== undefined && value.constructor === Object;
}

function isArray(value) {
  return Array.isArray(value);
}

function arrayToString(items) {
  return items.reduce((result, item) => {
    if (isPlainObject(item)) return result + objectToString(item);
    if (isArray(item)) return result + arrayToString(item);
    return result + String(item);
  }, "");
}

function objectToString(obj) {
  if (obj == null) return "";

  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      const value = obj[key];
      if (isArray(value)) return result + key + arrayToString(value);
      if (isPlainObject(value)) return result + key + objectToString(value);
      if (value === null || value === undefined) return result + key + "null";
      return result + key + String(value);
    }, "");
}

export class CryptoComClient {
  constructor({ apiKey, apiSecret, baseUrl }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.requestId = 1;
  }

  async publicGet(method, params = {}) {
    const url = new URL(`${this.baseUrl}/${method}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ccom-ca-up-down-bot/0.1"
      }
    });

    return this.parseResponse(response);
  }

  async privatePost(method, params = {}) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Missing CCOM_API_KEY or CCOM_API_SECRET.");
    }

    const body = {
      id: this.requestId++,
      method,
      api_key: this.apiKey,
      params,
      nonce: Date.now()
    };
    body.sig = this.sign(body);

    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ccom-ca-up-down-bot/0.1"
      },
      body: JSON.stringify(body)
    });

    return this.parseResponse(response);
  }

  sign(body) {
    const payload =
      body.method +
      body.id +
      this.apiKey +
      objectToString(body.params) +
      body.nonce;

    return crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
  }

  async parseResponse(response) {
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Invalid JSON response (${response.status}): ${text}`);
    }

    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
      const message = data.message || data.msg || response.statusText;
      throw new Error(`Crypto.com API error ${data.code ?? response.status}: ${message}`);
    }

    return data;
  }
}
