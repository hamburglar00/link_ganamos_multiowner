// /api/get-telegram.js
// Devuelve el telegram_url de la agency solicitada desde random-contact.

const CONFIG = {
  TIMEOUT_MS: 2500,
  MAX_RETRIES: 2,
  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
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
    if (!telegramUrl) throw new Error("Telegram no disponible");

    LAST_GOOD_BY_AGENCY[cacheKey] = telegramUrl;

    return res.status(200).json({
      agency_id: agencyId,
      telegram_url: telegramUrl,
    });
  } catch (err) {
    return res.status(200).json({
      agency_id: agencyId,
      telegram_url: lastGood,
      cache: Boolean(lastGood),
      error: err?.message,
    });
  }
}
