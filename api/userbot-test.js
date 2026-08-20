import { connectAuthorizedUser, targetUsername } from "../lib/userbot.js";

export default async function handler(req, res) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.query?.key || "");

  if (!expected || actual !== expected) {
    return res.status(401).json({
      ok: false,
      error: "WEBHOOK_SETUP_KEY salah atau belum diisi."
    });
  }

  let client;
  try {
    const connected = await connectAuthorizedUser();
    client = connected.client;
    const me = connected.me;

    const target = targetUsername();
    const entity = await client.getEntity(target);

    return res.status(200).json({
      ok: true,
      engine: "4.0-userbot-bridge",
      account: {
        id: String(me?.id || ""),
        username: me?.username || null,
        firstName: me?.firstName || null
      },
      target: {
        username: `@${target}`,
        resolved: Boolean(entity)
      },
      reason: "Session akun checker valid dan target dapat di-resolve."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      engine: "4.0-userbot-bridge",
      error: error.message
    });
  } finally {
    try { if (client) await client.disconnect(); } catch {}
  }
}
