import { botApi } from "../lib/telegram-bot.js";

export default async function handler(req, res) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.query?.key || "");

  if (!expected || actual !== expected) {
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
      error: "PUBLIC_BASE_URL harus URL https:// Vercel."
    });
  }

  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return res.status(500).json({
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET belum diisi."
    });
  }

  try {
    const webhook = `${base}/api/telegram`;
    const result = await botApi("setWebhook", {
      url: webhook,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false
    });

    return res.status(200).json({
      ok: true,
      webhook,
      telegram: result
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
