import {
  connectAuthorizedUser,
  testGoCheckerConversation,
  targetUsername
} from "../lib/userbot.js";

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

    const result = await testGoCheckerConversation(client, 30000);

    return res.status(result.ok ? 200 : 504).json({
      ...result,
      target: `@${targetUsername()}`,
      engine: "4.3-userbot-bridge"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      target: `@${targetUsername()}`,
      error: error.message
    });
  } finally {
    try { if (client) await client.disconnect(); } catch {}
  }
}
