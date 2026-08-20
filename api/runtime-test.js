import { apiCredentials, getTeleprotoRuntime } from "../lib/userbot.js";

export default async function handler(req, res) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.query?.key || "");

  if (!expected || actual !== expected) {
    return res.status(401).json({
      ok: false,
      error: "WEBHOOK_SETUP_KEY salah atau belum diisi."
    });
  }

  try {
    const { apiId, apiHash } = apiCredentials();
    const runtime = await getTeleprotoRuntime();

    return res.status(200).json({
      ok: true,
      engine: "4.3-userbot-bridge",
      apiCredentialsReadable: Boolean(apiId && apiHash),
      teleprotoImport: true,
      exports: {
        TelegramClient: Boolean(runtime.TelegramClient),
        Api: Boolean(runtime.Api),
        StringSession: Boolean(runtime.StringSession)
      },
      reason: "Runtime MTProto berhasil dimuat."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      engine: "4.3-userbot-bridge",
      stage: "teleproto_runtime",
      error: error?.message || String(error)
    });
  }
}
