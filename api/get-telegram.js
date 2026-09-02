// /api/get-telegram.js
// Devuelve el telegram_url de la agency solicitada desde random-contact.

import { readFile } from "node:fs/promises";
import path from "node:path";

const CONFIG = {
  TIMEOUT_MS: 2500,
  MAX_RETRIES: 2,
  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
  MANUAL_TELEGRAM_PATH: path.join(process.cwd(), "config", "telegram.json"),
};

let LAST_GOOD_BY_AGENCY = Object.create(null);

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalizeTelegram(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value.startsWith("https://t.me/")) return value;
  if (value.startsWith("http://t.me/")) return value.replace("http://", "https://");

  const username = value.replace(/^@/, "").trim();
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) return null;

  return `https://t.me/${username}?start=hola`;
}

async function loadManualTelegramRows() {
  try {
    const raw = await readFile(CONFIG.MANUAL_TELEGRAM_PATH, "utf8");
    const config = JSON.parse(raw);

    if (Array.isArray(config)) return config;
    if (Array.isArray(config?.grupos)) return config.grupos;
    if (Array.isArray(config?.groups)) return config.groups;

    return [];
  } catch {
    return [];
  }
}

async function getManualTelegramUrl(agencyId) {
  const rows = await loadManualTelegramRows();
  const row = rows.find((item) => {
    if (item?.enabled === false) return false;

    const agencyIds = Array.isArray(item?.agency_ids)
      ? item.agency_ids
      : [item?.agency_id];

    return agencyIds.some((id) => Number(id) === Number(agencyId));
  });

  return normalizeTelegram(row?.telegram_url || row?.telegram || row?.username);
}

function pickTelegram(data) {
  const list =
    (Array.isArray(data?.load?.telegram) && data.load.telegram) ||
    (Array.isArray(data?.telegram) && data.telegram) ||
    [];

  for (const item of list) {
    const url = normalizeTelegram(item);
    if (url) return url;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const agencyId = Number(req.query.agency);

  if (!Number.isInteger(agencyId) || agencyId <= 0) {
    return res.status(400).json({
      error: "AGENCY_REQUIRED",
      message: "Debe enviarse ?agency=<id>",
    });
  }

  const cacheKey = String(agencyId);
  const lastGood = LAST_GOOD_BY_AGENCY[cacheKey] || null;
  const apiUrl = `${CONFIG.UPSTREAM_BASE}/agency/${agencyId}/random-contact`;

  try {
    let data = null;
    let lastError = null;

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES && !data; attempt++) {
      try {
        data = await fetchJsonWithTimeout(apiUrl, CONFIG.TIMEOUT_MS);
      } catch (err) {
        lastError = err;
      }
    }

    if (!data) throw lastError || new Error("Upstream no respondio");

    const telegramUrl = pickTelegram(data);
    if (telegramUrl) {
      LAST_GOOD_BY_AGENCY[cacheKey] = telegramUrl;

      return res.status(200).json({
        agency_id: agencyId,
        telegram_url: telegramUrl,
        source: "api",
      });
    }

    const manualTelegramUrl = await getManualTelegramUrl(agencyId);
    if (manualTelegramUrl) {
      LAST_GOOD_BY_AGENCY[cacheKey] = manualTelegramUrl;

      return res.status(200).json({
        agency_id: agencyId,
        telegram_url: manualTelegramUrl,
        source: "config/telegram.json",
      });
    }

    throw new Error("Telegram no disponible");
  } catch (err) {
    const manualTelegramUrl = await getManualTelegramUrl(agencyId);
    if (manualTelegramUrl) {
      LAST_GOOD_BY_AGENCY[cacheKey] = manualTelegramUrl;

      return res.status(200).json({
        agency_id: agencyId,
        telegram_url: manualTelegramUrl,
        source: "config/telegram.json",
        fallback: true,
        error: err?.message,
      });
    }

    return res.status(200).json({
      agency_id: agencyId,
      telegram_url: lastGood,
      cache: Boolean(lastGood),
      error: err?.message,
    });
  }
}
