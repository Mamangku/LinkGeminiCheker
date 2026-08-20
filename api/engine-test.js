import { testPublicEngine } from "../lib/public-checker.js";

export default async function handler(req, res) {
  const key = String(req.query?.key || "");
  const expected = process.env.WEBHOOK_SETUP_KEY;
  if (!expected || key !== expected) {
    return res.status(401).json({ ok: false, error: "WEBHOOK_SETUP_KEY salah." });
  }
  const result = await testPublicEngine();
  return res.status(result.ok ? 200 : 503).json(result);
}
