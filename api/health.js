export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    engine: "4.3-userbot-bridge",
    userbotSessionConfigured: Boolean(process.env.TELEGRAM_USER_SESSION),
    apiIdConfigured: Boolean(process.env.TELEGRAM_API_ID),
    apiHashConfigured: Boolean(process.env.TELEGRAM_API_HASH),
    target: `@${String(process.env.GOCHECKER_USERNAME || "GoChecker_Bot").replace(/^@/, "")}`,
    time: new Date().toISOString()
  });
}
