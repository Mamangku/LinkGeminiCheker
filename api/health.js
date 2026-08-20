import { ENGINE_VERSION } from "../lib/public-checker.js";

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "gemini-redeem-checker-bot",
    engine: ENGINE_VERSION,
    googleCookieRequired: false,
    time: new Date().toISOString()
  });
}
