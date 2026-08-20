export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "gemini-redeem-checker-bot",
    time: new Date().toISOString()
  });
}
