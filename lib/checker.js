import crypto from "node:crypto";

const DEFAULT_ALLOWED = ["google.com", "g.co", "goo.gle"];

const USED_PATTERNS = [
  "offer already redeemed",
  "already been redeemed",
  "already redeemed",
  "offer has already been redeemed",
  "this offer has already been redeemed",
  "sudah ditukarkan",
  "sudah digunakan",
  "telah ditukarkan",
  "telah digunakan"
];

const EXPIRED_PATTERNS = [
  "offer has expired",
  "offer expired",
  "this offer has expired",
  "offer is expired",
  "promotion has expired",
  "promo has expired",
  "offer period has ended",
  "redemption period has ended",
  "penawaran telah berakhir",
  "penawaran sudah berakhir",
  "masa penukaran telah berakhir",
  "promo telah berakhir",
  "the original offer isn’t available",
  "the original offer isn't available",
  "original offer isn’t available",
  "original offer isn't available",
  "this promotion is no longer available",
  "offer is no longer available",
  "offer no longer available",
  "penawaran ini sudah tidak tersedia"
];

const INVALID_PATTERNS = [
  "invalid offer",
  "invalid redemption",
  "invalid redeem",
  "invalid link",
  "offer not found",
  "promotion not found",
  "page not found",
  "the requested url was not found",
  "this offer is not available",
  "offer is not available",
  "penawaran tidak tersedia",
  "tautan tidak valid"
];

const VALID_STRONG_PATTERNS = [
  "claim this offer",
  "redeem this offer",
  "claim your offer",
  "redeem your offer",
  "accept this offer",
  "start your trial",
  "start free trial",
  "try google ai pro at no extra cost",
  "get google ai pro at no extra cost",
  "continue to redeem",
  "lanjutkan untuk menukarkan",
  "tukarkan penawaran ini",
  "klaim penawaran ini"
];

function envInt(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function getLimits() {
  return {
    maxLinks: envInt("MAX_LINKS_PER_REQUEST", 100, 1, 500),
    concurrency: envInt("CHECK_CONCURRENCY", 5, 1, 15),
    timeoutMs: envInt("CHECK_TIMEOUT_MS", 10000, 2000, 30000)
  };
}

function allowedSuffixes() {
  return (process.env.ALLOWED_HOST_SUFFIXES || DEFAULT_ALLOWED.join(","))
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedSuffixes().some(
    suffix => host === suffix || host.endsWith(`.${suffix}`)
  );
}

function cleanToken(raw) {
  return raw
    .trim()
    .replace(/^[<("'`]+/, "")
    .replace(/[>)"'`,.;!?]+$/, "");
}

export function extractLinks(text) {
  const found = [];
  const seen = new Set();

  const httpMatches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const raw of httpMatches) {
    const value = cleanToken(raw);
    if (value && !seen.has(value)) {
      seen.add(value);
      found.push(value);
    }
  }

  // Juga menerima link Google tanpa https://
  for (const tokenRaw of text.split(/\s+/)) {
    let token = cleanToken(tokenRaw);
    if (!token || /^https?:\/\//i.test(token)) continue;

    if (
      /^(?:[a-z0-9-]+\.)*(?:google\.com|g\.co|goo\.gle)\//i.test(token)
    ) {
      token = `https://${token}`;
      if (!seen.has(token)) {
        seen.add(token);
        found.push(token);
      }
    }
  }

  return found;
}

function hashLink(link) {
  return crypto.createHash("sha256").update(link).digest("hex");
}

function containsAny(text, patterns) {
  return patterns.some(p => text.includes(p));
}

function looksRedeemLike(url) {
  const hay = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  return [
    "offer",
    "redeem",
    "promo",
    "promotion",
    "benefit",
    "trial",
    "gemini",
    "googleone",
    "google-one"
  ].some(x => hay.includes(x));
}

async function readTextLimited(response, maxBytes = 700_000) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });

      if (total >= maxBytes) {
        try { await reader.cancel(); } catch {}
        break;
      }
    }
    text += decoder.decode();
    return text;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function fetchWithRedirects(startUrl, timeoutMs) {
  let current = new URL(startUrl);
  const chain = [];

  for (let hop = 0; hop < 9; hop += 1) {
    if (!hostAllowed(current.hostname)) {
      return {
        kind: "invalid",
        reason: `Host tidak diizinkan: ${current.hostname}`,
        finalUrl: current.toString(),
        redirectChain: chain
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          "accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,id;q=0.8",
          "cache-control": "no-cache",
          "pragma": "no-cache"
        }
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === "AbortError") {
        return {
          kind: "error",
          reason: "Timeout saat membuka link",
          finalUrl: current.toString(),
          redirectChain: chain
        };
      }
      return {
        kind: "error",
        reason: `Network error: ${error?.message || "unknown"}`,
        finalUrl: current.toString(),
        redirectChain: chain
      };
    } finally {
      clearTimeout(timer);
    }

    chain.push({ url: current.toString(), status: res.status });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return {
          kind: "error",
          reason: `Redirect HTTP ${res.status} tanpa Location`,
          httpStatus: res.status,
          finalUrl: current.toString(),
          redirectChain: chain
        };
      }

      let next;
      try {
        next = new URL(location, current);
      } catch {
        return {
          kind: "invalid",
          reason: "Redirect URL tidak valid",
          httpStatus: res.status,
          finalUrl: current.toString(),
          redirectChain: chain
        };
      }

      if (!["http:", "https:"].includes(next.protocol)) {
        return {
          kind: "invalid",
          reason: `Protocol redirect tidak didukung: ${next.protocol}`,
          httpStatus: res.status,
          finalUrl: next.toString(),
          redirectChain: chain
        };
      }

      current = next;
      continue;
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const body = contentType.includes("text") || contentType.includes("html")
      ? (await readTextLimited(res)).toLowerCase()
      : "";

    return {
      kind: "response",
      response: res,
      body,
      finalUrl: current.toString(),
      redirectChain: chain
    };
  }

  return {
    kind: "error",
    reason: "Terlalu banyak redirect",
    finalUrl: current.toString(),
    redirectChain: chain
  };
}

export async function checkRedeemLink(rawLink) {
  const started = Date.now();
  let url;

  try {
    url = new URL(rawLink);
  } catch {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "invalid",
      reason: "Format URL tidak valid",
      durationMs: Date.now() - started
    };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "invalid",
      reason: "Protocol URL harus http/https",
      durationMs: Date.now() - started
    };
  }

  if (!hostAllowed(url.hostname)) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "invalid",
      reason: `Host tidak diizinkan: ${url.hostname}`,
      durationMs: Date.now() - started
    };
  }

  const { timeoutMs } = getLimits();
  const result = await fetchWithRedirects(url, timeoutMs);

  if (result.kind === "invalid" || result.kind === "error") {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: result.kind,
      reason: result.reason,
      httpStatus: result.httpStatus ?? null,
      finalUrl: result.finalUrl ?? null,
      durationMs: Date.now() - started
    };
  }

  const { response, body, finalUrl } = result;
  const statusCode = response.status;

  if (statusCode === 429 || statusCode >= 500) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "error",
      reason: `Google/upstream membalas HTTP ${statusCode}`,
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  if (statusCode === 410) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "expired",
      reason: "HTTP 410 Gone",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  if (statusCode === 404) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "invalid",
      reason: "HTTP 404 Not Found",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  if (containsAny(body, USED_PATTERNS)) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "used",
      reason: "Halaman menandai offer sudah pernah diredeem",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  if (containsAny(body, EXPIRED_PATTERNS)) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "expired",
      reason: "Halaman menandai offer/masa redeem sudah berakhir",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  if (containsAny(body, INVALID_PATTERNS)) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "invalid",
      reason: "Halaman menandai offer/link tidak tersedia atau tidak valid",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  const final = new URL(finalUrl);
  const reachable = statusCode >= 200 && statusCode < 400;
  const redeemLike = looksRedeemLike(url) || looksRedeemLike(final);
  const bodyLooksStronglyValid = containsAny(body, VALID_STRONG_PATTERNS);

  // PENTING: redirect ke accounts.google.com BUKAN bukti bahwa offer valid.
  // Link valid, used, maupun expired dapat sama-sama meminta login sebelum
  // Google menampilkan status offer untuk akun tersebut.
  const loginGate =
    final.hostname === "accounts.google.com" ||
    final.hostname.endsWith(".accounts.google.com");

  if (loginGate) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "error",
      reason: "Google meminta login; status offer tidak bisa dibuktikan secara anonim",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  // Strict mode: URL yang sekadar 'terlihat seperti redeem' tidak cukup.
  // Harus ada marker positif yang benar-benar menunjukkan aksi claim/redeem.
  if (reachable && redeemLike && bodyLooksStronglyValid) {
    return {
      link: rawLink,
      linkHash: hashLink(rawLink),
      status: "valid",
      reason: "Halaman menampilkan marker claim/redeem yang aktif",
      httpStatus: statusCode,
      finalUrl,
      durationMs: Date.now() - started
    };
  }

  return {
    link: rawLink,
    linkHash: hashLink(rawLink),
    status: "error",
    reason: `Status offer tidak dapat dibuktikan tanpa login/session Google (HTTP ${statusCode})`,
    httpStatus: statusCode,
    finalUrl,
    durationMs: Date.now() - started
  };
}

export async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        results[index] = {
          link: items[index],
          linkHash: hashLink(items[index]),
          status: "error",
          reason: error?.message || "Unknown checker error"
        };
      }
    }
  }

  const count = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: count }, worker));
  return results;
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
