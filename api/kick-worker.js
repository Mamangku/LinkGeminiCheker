import { kickBridgeWorker } from "../lib/kick-worker.js";

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
    const result = await kickBridgeWorker();
    return res.status(200).json({ ok: true, worker: result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
