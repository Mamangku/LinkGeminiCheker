import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseGoCheckerSummary } from "./gochecker-parser.js";

function apiCredentials() {
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();

  if (!Number.isFinite(apiId) || !apiId || !apiHash) {
    throw new Error("TELEGRAM_API_ID / TELEGRAM_API_HASH belum diisi.");
  }
  return { apiId, apiHash };
}

export function targetUsername() {
  return String(process.env.GOCHECKER_USERNAME || "GoChecker_Bot")
    .trim()
    .replace(/^@/, "");
}

export function makeUserClient(sessionString = process.env.TELEGRAM_USER_SESSION || "") {
  const { apiId, apiHash } = apiCredentials();
  return new TelegramClient(
    new StringSession(String(sessionString || "")),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      floodSleepThreshold: 30
    }
  );
}

export async function connectAuthorizedUser() {
  const session = String(process.env.TELEGRAM_USER_SESSION || "").trim();
  if (!session) {
    throw new Error(
      "TELEGRAM_USER_SESSION belum diisi. Buka /setup-userbot.html untuk membuatnya."
    );
  }

  const client = makeUserClient(session);
  await client.connect();

  const authorized = await client.checkAuthorization();
  if (!authorized) {
    await client.disconnect();
    throw new Error(
      "TELEGRAM_USER_SESSION tidak valid / sudah logout. Buat session baru."
    );
  }

  const me = await client.getMe();
  if (me?.bot) {
    await client.disconnect();
    throw new Error("Session harus akun Telegram biasa, bukan bot.");
  }

  return { client, me };
}

function messageText(message) {
  return String(message?.message || message?.text || "").trim();
}

function messageId(message) {
  const id = Number(message?.id || 0);
  return Number.isFinite(id) ? id : 0;
}

function isOutgoing(message) {
  return Boolean(message?.out);
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForGoCheckerResult(
  client,
  sentMessageId,
  {
    timeoutMs = Number.parseInt(process.env.GOCHECKER_TIMEOUT_MS || "120000", 10),
    pollMs = Number.parseInt(process.env.GOCHECKER_POLL_MS || "1800", 10)
  } = {}
) {
  const target = targetUsername();
  const deadline = Date.now() + Math.max(10_000, timeoutMs);
  let lastIncoming = "";

  while (Date.now() < deadline) {
    const messages = await client.getMessages(target, {
      limit: 30,
      minId: sentMessageId
    });

    for (const msg of messages) {
      if (!msg) continue;
      if (isOutgoing(msg)) continue;
      if (messageId(msg) <= sentMessageId) continue;

      const text = messageText(msg);
      if (!text) continue;
      lastIncoming = text;

      const summary = parseGoCheckerSummary(text);
      if (summary) {
        return {
          summary,
          resultMessageId: messageId(msg),
          sourceText: text
        };
      }
    }

    await sleep(Math.max(800, pollMs));
  }

  const suffix = lastIncoming
    ? ` Balasan terakhir: ${lastIncoming.slice(0, 300)}`
    : "";
  throw new Error(`Timeout menunggu Checking Complete dari @${target}.${suffix}`);
}

export async function sendPayloadToGoChecker(client, payload, jobId, { forceFile = false } = {}) {
  const target = targetUsername();
  const clean = String(payload || "").trim();
  if (!clean) throw new Error("Payload checker kosong.");

  // Penting: formattingEntities: [] menjaga token/link dengan "_" tidak
  // diinterpretasikan sebagai Markdown oleh client MTProto.
  if (!forceFile && clean.length <= 3500) {
    const sent = await client.sendMessage(target, {
      message: clean,
      formattingEntities: [],
      linkPreview: false
    });

    return {
      sentMessageId: messageId(sent),
      mode: "text"
    };
  }

  const safeId = String(jobId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = path.join(os.tmpdir(), `gemini-check-${safeId}.txt`);

  try {
    await fs.writeFile(filePath, clean + "\n", "utf8");

    const sent = await client.sendMessage(target, {
      message: "",
      file: filePath,
      forceDocument: true,
      formattingEntities: []
    });

    return {
      sentMessageId: messageId(sent),
      mode: "txt"
    };
  } finally {
    try { await fs.unlink(filePath); } catch {}
  }
}

export async function testGoCheckerConversation(client, timeoutMs = 30000) {
  const target = targetUsername();
  const sent = await client.sendMessage(target, {
    message: "/start",
    formattingEntities: []
  });

  const sentId = messageId(sent);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await client.getMessages(target, {
      limit: 20,
      minId: sentId
    });

    const incoming = messages.find(
      msg => msg && !isOutgoing(msg) && messageId(msg) > sentId && messageText(msg)
    );

    if (incoming) {
      return {
        ok: true,
        sentMessageId: sentId,
        replyMessageId: messageId(incoming),
        replyPreview: messageText(incoming).slice(0, 500)
      };
    }

    await sleep(1500);
  }

  return {
    ok: false,
    sentMessageId: sentId,
    reason: `@${target} tidak membalas /start dalam ${Math.round(timeoutMs/1000)} detik`
  };
}

export { Api, apiCredentials };
