import { telegram } from "../lib/telegram.js";

export default async function handler(req, res) {
  const key = String(req.query?.key || "");
  const expected = process.env.WEBHOOK_SETUP_KEY;

  if (!expected || key !== expected) {
    return res.status(401).json({
      ok: false,
      error: "WEBHOOK_SETUP_KEY salah atau belum diisi."
    });
  }

  const base = String(process.env.PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  if (!base.startsWith("https://")) {
    return res.status(500).json({
      ok: false,
      error: "PUBLIC_BASE_URL harus berupa URL https:// deployment Vercel."
    });
  }

  const webhookUrl = `${base}/api/telegram`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secret) {
    return res.status(500).json({
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET belum diisi."
    });
  }

  try {
    const result = await telegram("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false
    });

    return res.status(200).json({
      ok: true,
      webhook: webhookUrl,
      telegram: result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
