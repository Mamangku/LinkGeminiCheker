export function extractLinks(text) {
  const found = [];
  const seen = new Set();

  const matches = String(text || "").match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (let raw of matches) {
    raw = raw.trim().replace(/[),.;!?]+$/, "");
    if (!raw || seen.has(raw)) continue;

    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) continue;
    } catch {
      continue;
    }

    seen.add(raw);
    found.push(raw);
  }

  return found;
}

export function maxLinks() {
  const value = Number.parseInt(process.env.MAX_LINKS_PER_REQUEST || "100", 10);
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(value, 500));
}
