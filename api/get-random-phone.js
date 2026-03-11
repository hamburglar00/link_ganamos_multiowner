// /api/get-random-phone.js
// ✅ API GENÉRICA
// ✅ agency ES OBLIGATORIO (?agency=XX)
// ❌ NO defaults
// ✅ Plan A/B/C/D
// ✅ Lee desde load.whatsapp

const CONFIG = {
  BRAND_NAME: "Ganamos",

  // Soporte (Plan D)
  SUPPORT_FALLBACK_ENABLED: false,
  SUPPORT_FALLBACK_NUMBER: "",

  TIMEOUT_MS: 2500,
  MAX_RETRIES: 2,

  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
};

// Cache por agency (memoria serverless)
let LAST_GOOD_BY_AGENCY = Object.create(null);

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function normalizePhone(raw) {
  let phone = String(raw || "").replace(/\D+/g, "");
  if (phone.length === 10) phone = "54" + phone; // AR
  if (!phone || phone.length < 8) return null;
  return phone;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
      signal: ctrl.signal,
    });

    const ms = Date.now() - started;

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.http_status = res.status;
      err.ms = ms;
      throw err;
    }

    const json = await res.json();
    return { json, ms, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const agencyId = Number(req.query.agency);

  if (!Number.isInteger(agencyId) || agencyId <= 0) {
    return res.status(400).json({
      error: "AGENCY_REQUIRED",
      message: "Debe enviarse ?agency=<id>",
    });
  }

  const lastGood = LAST_GOOD_BY_AGENCY[String(agencyId)] || null;

  try {
    const API_URL = `${CONFIG.UPSTREAM_BASE}/agency/${agencyId}/random-contact`;

    let data = null;
    let upstreamMeta = { attempts: 0, last_error: null };

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES && !data; attempt++) {
      upstreamMeta.attempts = attempt;
      try {
        const r = await fetchJsonWithTimeout(API_URL, CONFIG.TIMEOUT_MS);
        data = r.json;
        upstreamMeta.ms = r.ms;
        upstreamMeta.status = r.status;
      } catch (e) {
        upstreamMeta.last_error = e?.message || "unknown";
      }
    }

    if (!data) throw new Error("Upstream no respondió");

    // PLAN B: load.whatsapp
    const normalList = Array.isArray(data?.load?.whatsapp) ? data.load.whatsapp : [];
    if (!normalList.length) throw new Error("load.whatsapp vacío");

    const rawPhone = pickRandom(normalList);
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new Error("Número inválido");

    const meta = {
      agency_id: agencyId,
      source: "load.whatsapp",
      ts: new Date().toISOString(),
      normal_len: normalList.length,
    };

    LAST_GOOD_BY_AGENCY[String(agencyId)] = { number: phone, meta };

    return res.status(200).json({
      number: phone,
      name: CONFIG.BRAND_NAME,
      agency_id: agencyId,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    if (lastGood?.number) {
      return res.status(200).json({
        number: lastGood.number,
        name: "LastGoodCache",
        agency_id: agencyId,
        cache: true,
        error: err?.message,
        ms: Date.now() - startedAt,
      });
    }

    if (CONFIG.SUPPORT_FALLBACK_ENABLED) {
      return res.status(200).json({
        number: CONFIG.SUPPORT_FALLBACK_NUMBER,
        name: "SupportFallback",
        agency_id: agencyId,
        fallback: true,
        error: err?.message,
        ms: Date.now() - startedAt,
      });
    }

    return res.status(503).json({
      error: "NO_NUMBER_AVAILABLE",
      agency_id: agencyId,
      details: err?.message,
    });
  }
}
