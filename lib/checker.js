export function extractLinks(text) {
  const found = [];
  const seen = new Set();
  const source = String(text || "");

  const candidates = source.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (let raw of candidates) {
    raw = raw
      .trim()
      .replace(/^[<(\[{\"'`]+/, "")
      .replace(/[>)\]}\"'`,.;!?]+$/, "");
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    found.push(raw);
  }

  for (const tokenRaw of source.split(/\s+/)) {
    let token = tokenRaw.trim().replace(/[>)\]}\"'`,.;!?]+$/, "");
    if (!token || /^https?:\/\//i.test(token)) continue;

    if (/^(?:g\.co\/g1referral\/|one\.google\.com\/referral\/redeem\/)/i.test(token)) {
      token = `https://${token}`;
      if (!seen.has(token)) {
        seen.add(token);
        found.push(token);
      }
    }
  }

  return found;
}

export function getLimits() {
  const maxLinks = Number.parseInt(process.env.MAX_LINKS_PER_REQUEST || "100", 10);
  return {
    maxLinks: Number.isFinite(maxLinks) ? Math.max(1, Math.min(maxLinks, 150)) : 100
  };
}

export function summarize(results) {
  const summary = {
    total: results.length,
    valid: 0,
    used: 0,
    expired: 0,
    invalid: 0,
    error: 0
  };

  for (const item of results) {
    if (Object.prototype.hasOwnProperty.call(summary, item.status)) {
      summary[item.status] += 1;
    } else {
      summary.error += 1;
    }
  }

  return summary;
}
