export default function handler(req, res) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.query?.key || "");

  if (!expected || actual !== expected) {
    return res.status(401).json({
      ok: false,
      error: "WEBHOOK_SETUP_KEY salah atau belum diisi."
    });
  }

  const apiIdRaw = String(process.env.TELEGRAM_API_ID || "").trim();
  const apiHashRaw = String(process.env.TELEGRAM_API_HASH || "").trim();
  const apiId = Number.parseInt(apiIdRaw, 10);

  const checks = {
    TELEGRAM_API_ID: Boolean(apiIdRaw) && Number.isFinite(apiId) && apiId > 0,
    TELEGRAM_API_HASH: /^[a-fA-F0-9]{16,64}$/.test(apiHashRaw),
    SUPABASE_URL: /^https:\/\/.+\.supabase\.co\/?$/.test(
      String(process.env.SUPABASE_URL || "").trim()
    ),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(
      String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
    ),
    PUBLIC_BASE_URL: /^https:\/\//.test(
      String(process.env.PUBLIC_BASE_URL || "").trim()
    ),
    BRIDGE_WORKER_SECRET: Boolean(
      String(process.env.BRIDGE_WORKER_SECRET || "").trim()
    )
  };

  const missingOrInvalid = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return res.status(missingOrInvalid.length ? 500 : 200).json({
    ok: missingOrInvalid.length === 0,
    engine: "4.3-userbot-bridge",
    checks,
    missingOrInvalid,
    note:
      "Endpoint ini hanya menunjukkan apakah variable terbaca/valid secara bentuk; nilainya tidak ditampilkan."
  });
}
