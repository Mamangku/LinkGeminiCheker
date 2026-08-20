export default async function handler(req, res) {
  const setupKey = process.env.WEBHOOK_SETUP_KEY;

  if (!setupKey || req.query.key !== setupKey) {
    return res.status(401).json({
      ok: false,
      error: "WEBHOOK_SETUP_KEY salah."
    });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return res.status(500).json({
      ok: false,
      error: "TELEGRAM_BOT_TOKEN belum diisi."
    });
  }

  const testLink =
    "https://serviceactivation.google.com/subscription/new/TEST";

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: "@GoChecker_Bot",
          text: testLink
        })
      }
    );

    const data = await response.json();

    if (data.ok) {
      return res.status(200).json({
        ok: true,
        target: "@GoChecker_Bot",
        messageSent: true,
        messageId: data.result?.message_id,
        info: "Pesan berhasil dikirim ke GoChecker."
      });
    }

    return res.status(200).json({
      ok: false,
      target: "@GoChecker_Bot",
      telegramError: data.description,
      errorCode: data.error_code
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
