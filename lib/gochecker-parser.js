function numberAfter(text, label) {
  const rx = new RegExp(
    String.raw`(?:^|\n)[^\n]*\b${label}\b\s*:?\s*(\d+)`,
    "i"
  );
  const match = text.match(rx);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function parseGoCheckerSummary(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").trim();
  if (!text) return null;

  const complete = text.match(
    /Checking\s+Complete\s*:\s*(\d+)\s*Links?/i
  );

  const valid = numberAfter(text, "Valid");
  const used = numberAfter(text, "Used");
  const expired = numberAfter(text, "Expired");
  const invalid = numberAfter(text, "Invalid");
  const error = numberAfter(text, "Error");

  const counts = [valid, used, expired, invalid, error];
  if (!complete && counts.some(v => v === null)) return null;
  if (counts.some(v => v === null)) return null;

  const sum = valid + used + expired + invalid + error;
  const total = complete ? Number.parseInt(complete[1], 10) : sum;

  // Toleransi jika bot target menulis total header sedikit berbeda,
  // tetapi jangan menerima hasil yang jelas tidak konsisten.
  if (sum !== total) return null;

  return {
    total,
    valid,
    used,
    expired,
    invalid,
    error,
    sourceText: text
  };
}

export function formatSummaryHtml(summary) {
  return [
    `✨ <b>Checking Complete: ${summary.total} Links</b>`,
    "",
    `✅ <b>Valid:</b> ${summary.valid}`,
    `🛍 <b>Used:</b> ${summary.used}`,
    `😵 <b>Expired:</b> ${summary.expired}`,
    `❌ <b>Invalid:</b> ${summary.invalid}`,
    `💔 <b>Error:</b> ${summary.error}`
  ].join("\n");
}
