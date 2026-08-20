import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { sendMessage, getTelegramTextFile } from "../lib/telegram-bot.js";
import { extractLinks, maxLinks } from "../lib/input.js";
import { enqueueJob } from "../lib/queue.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function upsertUser(from) {
  if (!from?.id) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("gemini_checker_users")
    .upsert({
      telegram_user_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "telegram_user_id" });
  if (error) throw error;
}

async function readInput(message) {
  if (message?.document) {
    const name = String(message.document.file_name || "").toLowerCase();
    const mime = String(message.document.mime_type || "").toLowerCase();

    if (!name.endsWith(".txt") && mime !== "text/plain") {
      return {
        error: "❌ Kirim file <b>.txt</b> berisi link, atau kirim link langsung."
      };
    }

    return {
      text: await getTelegramTextFile(message.document.file_id),
      inputType: "txt"
    };
  }

  if (message?.text) {
    return { text: message.text, inputType: "text" };
  }

  return {
    error: "❌ Kirim link redeem atau file <b>.txt</b>."
  };
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const from = message.from;
  if (!chatId) return;

  const text = String(message.text || "");
  const debugMode = /^\/debug(?:@\w+)?\b/i.test(text);

  if (/^\/start(?:@\w+)?$/i.test(text)) {
    await upsertUser(from);
    await sendMessage(chatId, [
      "👋 <b>Gemini Redeem Checker</b>",
      "",
      "Kirim satu/banyak link atau file <b>.txt</b>.",
      "Checker menggunakan akun Telegram bridge untuk meminta hasil dari checker tujuan.",
      "",
      "Engine: <code>4.4-userbot-bridge-hobby</code>"
    ].join("\n"));
    return;
  }

  if (/^\/engine(?:@\w+)?$/i.test(text)) {
    await sendMessage(
      chatId,
      "⚙️ Engine aktif: <code>4.4-userbot-bridge-hobby</code>"
    );
    return;
  }

  let input;
  try {
    input = await readInput(message);
  } catch (error) {
    await sendMessage(
      chatId,
      `💔 Gagal membaca input: <code>${esc(error.message)}</code>`
    );
    return;
  }

  if (input.error) {
    await sendMessage(chatId, input.error);
    return;
  }

  const links = extractLinks(input.text);
  if (!links.length) {
    await sendMessage(chatId, "❌ Tidak menemukan URL pada pesan/file.");
    return;
  }

  if (links.length > maxLinks()) {
    await sendMessage(
      chatId,
      `❌ Maksimal <b>${maxLinks()}</b> link per permintaan.`
    );
    return;
  }

  await upsertUser(from);

  const progress = await sendMessage(
    chatId,
    [
      `🔎 <b>Checking ${links.length} Links...</b>`,
      "Permintaan dimasukkan ke antrean checker."
    ].join("\n")
  );

  const job = await enqueueJob({
    telegramUserId: from?.id,
    chatId,
    inputType: input.inputType,
    payload: links.join("\n"),
    linkCount: links.length,
    progressMessageId: progress.message_id,
    debugMode
  });

  // Start worker tanpa menahan webhook Telegram.
  waitUntil(
    kickBridgeWorker().catch(error => {
      console.error("kickBridgeWorker failed:", error);
    })
  );

  console.log(`Queued checker job ${job.id}`);
}

async function processUpdate(update) {
  try {
    if (update?.message) await handleMessage(update.message);
  } catch (error) {
    console.error(error);
    try {
      const chatId = update?.message?.chat?.id;
      if (chatId) {
        await sendMessage(
          chatId,
          `💔 Terjadi error server: <code>${esc(error.message)}</code>`
        );
      }
    } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook",
      engine: "4.4-userbot-bridge-hobby"
    });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const actual = req.headers["x-telegram-bot-api-secret-token"];

  if (expected && actual !== expected) {
    return res.status(401).json({ ok: false, error: "invalid webhook secret" });
  }

  waitUntil(processUpdate(req.body || {}));
  return res.status(200).json({ ok: true });
}
