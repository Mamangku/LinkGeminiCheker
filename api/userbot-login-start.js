import crypto from "node:crypto";
import { getSupabase } from "../lib/supabase.js";
import { makeUserClient, apiCredentials } from "../lib/userbot.js";

function checkKey(req) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.body?.setupKey || "");
  return expected && actual === expected;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!checkKey(req)) {
    return res.status(401).json({ ok: false, error: "Setup key salah." });
  }

  const phone = String(req.body?.phone || "").trim().replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(phone)) {
    return res.status(400).json({
      ok: false,
      error: "Nomor harus format internasional, contoh +628123456789."
    });
  }

  let client;

  try {
    const { apiId, apiHash } = apiCredentials();
    client = makeUserClient("");

    await client.connect();

    const result = await client.sendCode(
      { apiId, apiHash },
      phone,
      false
    );

    const loginId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const supabase = getSupabase();
    const { error } = await supabase
      .from("gemini_checker_login_sessions")
      .insert({
        id: loginId,
        phone,
        temp_session: client.session.save(),
        phone_code_hash: result.phoneCodeHash,
        is_code_via_app: Boolean(result.isCodeViaApp),
        needs_2fa: false,
        expires_at: expiresAt
      });

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      loginId,
      sentViaApp: Boolean(result.isCodeViaApp),
      expiresAt,
      message: result.isCodeViaApp
        ? "Kode dikirim ke aplikasi Telegram."
        : "Kode login dikirim oleh Telegram."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.errorMessage || error.message || String(error)
    });
  } finally {
    try { if (client) await client.disconnect(); } catch {}
  }
}
