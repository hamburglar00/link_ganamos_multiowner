// /api/get-telegram.js
// Devuelve SOLO el telegram_url de la agency solicitada

const TELEGRAM_MAP = {
  "8": "https://t.me/dianawin01bot?start=hola",
  "17": "https://t.me/Geraldina_bot?start=hola",
  "23": "https://t.me/TotiLolaBot?start=hola"
};

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const agencyId = String(req.query.agency || "").trim();

  if (!agencyId) {
    return res.status(400).json({
      error: "AGENCY_REQUIRED"
    });
  }

  const url = TELEGRAM_MAP[agencyId] || null;

  // Validación básica
  const valid = typeof url === "string" && url.startsWith("https://t.me/");

  return res.status(200).json({
    agency_id: agencyId,
    telegram_url: valid ? url : null
  });
}
