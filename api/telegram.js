import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import {
  editMessage,
  getTelegramTextFile,
  sendMessage
} from "../lib/telegram.js";
import {
  extractLinks,
  getLimits,
  mapConcurrent,
  checkRedeemLink,
  summarize
} from "../lib/checker.js";

function htmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatSummary(s) {
  return [
    `✨ <b>Checking Complete: ${s.total} Links</b>`,
    "",
    `✅ <b>Valid:</b> ${s.valid}`,
    `🛍 <b>Used:</b> ${s.used}`,
    `😵 <b>Expired:</b> ${s.expired}`,
    `❌ <b>Invalid:</b> ${s.invalid}`,
    `💔 <b>Error:</b> ${s.error}`
  ].join("\n");
}

async function upsertUser(from) {
  if (!from?.id) return;
  const supabase = getSupabase();

  const { error } = await supabase
    .from("gemini_checker_users")
    .upsert(
      {
        telegram_user_id: from.id,
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "telegram_user_id" }
    );

  if (error) throw error;
}

async function saveCheck({ from, inputType, results, durationMs }) {
  const supabase = getSupabase();
  const s = summarize(results);

  const { data: rows, error } = await supabase
    .from("gemini_checker_checks")
    .insert({
      telegram_user_id: from?.id || null,
      input_type: inputType,
      total: s.total,
      valid: s.valid,
      used: s.used,
      expired: s.expired,
      invalid: s.invalid,
      error: s.error,
      duration_ms: durationMs
    })
    .select("id")
    .limit(1);

  if (error) throw error;

  const checkId = rows?.[0]?.id;
  if (!checkId) return;

  const saveRaw = String(process.env.SAVE_RAW_LINKS || "")
    .toLowerCase() === "true";

  const payload = results.map((item, index) => ({
    check_id: checkId,
    position: index + 1,
    link_hash: item.linkHash,
    raw_link: saveRaw ? item.link : null,
    status: item.status,
    reason: item.reason || null,
    http_status: item.httpStatus ?? null,
    final_url: item.finalUrl || null,
    duration_ms: item.durationMs ?? null
  }));

  const { error: itemError } = await supabase
    .from("gemini_checker_items")
    .insert(payload);

  if (itemError) throw itemError;
}

async function readInput(message) {
  if (message?.document) {
    const name = String(message.document.file_name || "").toLowerCase();
    const mime = String(message.document.mime_type || "").toLowerCase();

    if (!name.endsWith(".txt") && mime !== "text/plain") {
      return {
        error:
          "❌ Kirim file <b>.txt</b> yang berisi link, atau kirim link langsung ke bot."
      };
    }

    const text = await getTelegramTextFile(message.document.file_id);
    return { text, inputType: "txt" };
  }

  if (message?.text) {
    return { text: message.text, inputType: "text" };
  }

  return {
    error:
      "❌ Kirim link redeem Gemini/Google One atau file <b>.txt</b> yang berisi link."
  };
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const from = message.from;

  if (!chatId) return;

  if (message.text === "/start") {
    await upsertUser(from);
    await sendMessage(
      chatId,
      [
        "👋 <b>Gemini Redeem Link Checker</b>",
        "",
        "Kirim satu atau banyak link redeem Gemini/Google One.",
        "Kamu juga bisa mengirim file <b>.txt</b> berisi link.",
        "",
        "Bot hanya mengecek halaman/redirect dan <b>tidak melakukan redeem</b>."
      ].join("\n")
    );
    return;
  }

  let input;
  try {
    input = await readInput(message);
  } catch (error) {
    await sendMessage(
      chatId,
      `💔 Gagal membaca input: <code>${htmlEscape(error.message)}</code>`
    );
    return;
  }

  if (input.error) {
    await sendMessage(chatId, input.error);
    return;
  }

  const { maxLinks, concurrency } = getLimits();
  const links = extractLinks(input.text);

  if (!links.length) {
    await sendMessage(
      chatId,
      "❌ Tidak menemukan link yang bisa diperiksa. Pastikan file/teks berisi URL Google redeem yang lengkap."
    );
    return;
  }

  if (links.length > maxLinks) {
    await sendMessage(
      chatId,
      `❌ Terlalu banyak link. Maksimal <b>${maxLinks}</b> link per sekali cek.`
    );
    return;
  }

  await upsertUser(from);

  const progress = await sendMessage(
    chatId,
    `🔎 <b>Checking ${links.length} Links...</b>\nMohon jangan kirim batch yang sama berulang kali.`
  );

  const started = Date.now();
  const results = await mapConcurrent(
    links,
    concurrency,
    link => checkRedeemLink(link)
  );
  const elapsed = Date.now() - started;
  const summary = summarize(results);

  try {
    await saveCheck({
      from,
      inputType: input.inputType,
      results,
      durationMs: elapsed
    });
  } catch (error) {
    console.error("Supabase save failed:", error);
    // Hasil tetap dikirim walau pencatatan database gagal.
  }

  const output = formatSummary(summary);

  try {
    await editMessage(chatId, progress.message_id, output);
  } catch {
    await sendMessage(chatId, output);
  }
}

async function processUpdate(update) {
  try {
    if (update?.message) {
      await handleMessage(update.message);
    }
  } catch (error) {
    console.error(error);

    try {
      const chatId = update?.message?.chat?.id;
      if (chatId) {
        await sendMessage(
          chatId,
          `💔 Terjadi error server: <code>${htmlEscape(error.message)}</code>`
        );
      }
    } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, service: "telegram-webhook" });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const actual = req.headers["x-telegram-bot-api-secret-token"];

  if (expected && actual !== expected) {
    return res.status(401).json({ ok: false, error: "invalid webhook secret" });
  }

  const update = req.body || {};

  // Telegram menerima HTTP 200 segera, sementara pekerjaan tetap hidup
  // melalui waitUntil sampai selesai atau sampai batas maxDuration Vercel.
  waitUntil(processUpdate(update));

  return res.status(200).json({ ok: true });
}
