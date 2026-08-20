const API_BASE = "https://api.telegram.org";

function token() {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("TELEGRAM_BOT_TOKEN belum diisi.");
  return value;
}

export async function botApi(method, payload = {}) {
  const response = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(
      `Telegram ${method} gagal: ${data?.description || `HTTP ${response.status}`}`
    );
  }
  return data.result;
}

export async function sendMessage(chatId, html, extra = {}) {
  return botApi("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

export async function editMessage(chatId, messageId, html, extra = {}) {
  return botApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

export async function getTelegramTextFile(fileId) {
  const info = await botApi("getFile", { file_id: fileId });
  if (!info?.file_path) throw new Error("Telegram tidak memberikan file_path.");

  const response = await fetch(
    `${API_BASE}/file/bot${token()}/${info.file_path}`
  );
  if (!response.ok) {
    throw new Error(`Gagal download file Telegram: HTTP ${response.status}`);
  }

  const maxBytes = Number.parseInt(process.env.MAX_TXT_BYTES || "1048576", 10);
  const length = Number(response.headers.get("content-length") || 0);
  if (length && length > maxBytes) {
    throw new Error(`File TXT terlalu besar. Maksimal ${maxBytes} byte.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`File TXT terlalu besar. Maksimal ${maxBytes} byte.`);
  }
  return buffer.toString("utf8");
}
