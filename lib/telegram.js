const API_BASE = "https://api.telegram.org";

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diisi.");
  return token;
}

export async function telegram(method, payload = {}) {
  const res = await fetch(`${API_BASE}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    throw new Error(
      `Telegram ${method} gagal: ${data?.description || `HTTP ${res.status}`}`
    );
  }

  return data.result;
}

export async function sendMessage(chatId, html, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

export async function editMessage(chatId, messageId, html, extra = {}) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

export async function getTelegramTextFile(fileId) {
  const file = await telegram("getFile", { file_id: fileId });

  if (!file?.file_path) {
    throw new Error("Telegram tidak memberikan file_path.");
  }

  const res = await fetch(
    `${API_BASE}/file/bot${botToken()}/${file.file_path}`
  );

  if (!res.ok) {
    throw new Error(`Gagal download file Telegram: HTTP ${res.status}`);
  }

  return res.text();
}
