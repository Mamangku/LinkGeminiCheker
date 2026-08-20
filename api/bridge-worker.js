import { waitUntil } from "@vercel/functions";
import crypto from "node:crypto";
import {
  connectAuthorizedUser,
  sendPayloadToGoChecker,
  waitForGoCheckerResult,
  targetUsername
} from "../lib/userbot.js";
import {
  claimJob,
  completeJob,
  failJob,
  queuedCount
} from "../lib/queue.js";
import { editMessage, sendMessage } from "../lib/telegram-bot.js";
import { formatSummaryHtml } from "../lib/gochecker-parser.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function authorized(req) {
  const expected = String(process.env.BRIDGE_WORKER_SECRET || "");
  const header = String(req.headers.authorization || "");
  return expected && header === `Bearer ${expected}`;
}

async function sendResultToUser(job, summary, sourceText) {
  let output = formatSummaryHtml(summary);

  if (job.debug_mode) {
    const preview = String(sourceText || "").slice(0, 1200);
    output += [
      "",
      "",
      "<b>Bridge Debug:</b>",
      `Target: <code>@${esc(targetUsername())}</code>`,
      `Job: <code>${esc(job.id)}</code>`,
      preview
        ? `\n<b>Source reply:</b>\n<pre>${esc(preview)}</pre>`
        : ""
    ].join("\n");
  }

  if (job.telegram_progress_message_id) {
    try {
      await editMessage(
        job.telegram_chat_id,
        job.telegram_progress_message_id,
        output
      );
      return;
    } catch (error) {
      console.error("edit progress failed:", error);
    }
  }

  await sendMessage(job.telegram_chat_id, output);
}

async function sendFailureToUser(job, error) {
  const text = [
    "💔 <b>Checker gagal diproses</b>",
    "",
    `<code>${esc(error?.message || String(error))}</code>`,
    "",
    "Coba lagi beberapa saat. Jika berulang, cek /api/userbot-test dan /api/gochecker-test."
  ].join("\n");

  if (job.telegram_progress_message_id) {
    try {
      await editMessage(
        job.telegram_chat_id,
        job.telegram_progress_message_id,
        text
      );
      return;
    } catch {}
  }

  await sendMessage(job.telegram_chat_id, text);
}

async function processOneJob(job) {
  let client;

  try {
    const connected = await connectAuthorizedUser();
    client = connected.client;

    const sent = await sendPayloadToGoChecker(
      client,
      job.input_payload,
      job.id,
      { forceFile: job.input_type === "txt" }
    );

    const result = await waitForGoCheckerResult(
      client,
      sent.sentMessageId
    );

    const saveSource =
      String(process.env.SAVE_BRIDGE_SOURCE_REPLY || "").toLowerCase() === "true";

    const storedResult = {
      ...result.summary,
      bridge: "4.0-userbot-bridge",
      target: `@${targetUsername()}`,
      transport: sent.mode,
      source_reply: saveSource ? result.sourceText : null
    };

    await completeJob(job.id, storedResult, {
      target_sent_message_id: sent.sentMessageId,
      target_result_message_id: result.resultMessageId
    });

    await sendResultToUser(
      job,
      result.summary,
      job.debug_mode ? result.sourceText : ""
    );

    return {
      ok: true,
      jobId: job.id,
      result: result.summary
    };
  } catch (error) {
    console.error("bridge job failed", job.id, error);

    try {
      await failJob(job.id, error.message || String(error));
    } catch (dbError) {
      console.error("failJob update failed:", dbError);
    }

    try {
      await sendFailureToUser(job, error);
    } catch (sendError) {
      console.error("sendFailureToUser failed:", sendError);
    }

    return {
      ok: false,
      jobId: job.id,
      error: error.message || String(error)
    };
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}


async function runWorkerInvocation() {
  const workerId = `vercel-${crypto.randomUUID()}`;
  let job;

  try {
    job = await claimJob(workerId);
  } catch (error) {
    console.error("worker claim failed:", error);
    return;
  }

  if (!job) {
    return;
  }

  await processOneJob(job);

  // Selesai satu job -> trigger invocation baru. Endpoint worker memberi
  // ACK segera, jadi request ini tidak menunggu job berikutnya selesai.
  try {
    if ((await queuedCount()) > 0) {
      await kickBridgeWorker();
    }
  } catch (error) {
    console.error("next worker kick failed:", error);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "invalid worker secret" });
  }

  waitUntil(
    runWorkerInvocation().catch(error => {
      console.error("bridge worker background error:", error);
    })
  );

  return res.status(202).json({
    ok: true,
    accepted: true,
    engine: "4.0-userbot-bridge"
  });
}
