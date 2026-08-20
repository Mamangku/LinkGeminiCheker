import crypto from "node:crypto";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export const ENGINE_VERSION = "3.1-public-evidence";

const STATUS = Object.freeze({
  VALID: "valid",
  USED: "used",
  EXPIRED: "expired",
  INVALID: "invalid",
  ERROR: "error"
});

const ALLOWED_HOSTS = [
  "g.co",
  "google.com",
  "one.google.com",
  "accounts.google.com",
  "consent.google.com"
];

const ACCOUNT_PATTERNS = [
  "this or a similar offer has already been redeemed on this google account",
  "you are unable to redeem this offer because this or a similar offer has already been redeemed on this google account",
  "you already have google one",
  "you are not eligible for this promotion",
  "your account is not eligible for this promotion",
  "your account isn't eligible for this promotion",
  "switch to another google account",
  "account_not_eligible",
  "user_not_eligible",
  "similar_offer_redeemed"
];

const REGION_PATTERNS = [
  "offer is not available in your country",
  "offer isn't available in your country",
  "offer is not available in your region",
  "offer isn't available in your region",
  "not available in your country",
  "not available in your region",
  "billing location",
  "country association"
];

const USED_PATTERNS = [
  "this code has already been redeemed",
  "this offer code has already been redeemed",
  "this referral has already been redeemed",
  "this invite has already been redeemed",
  "promo code has already been used",
  "promotion code has already been used",
  "code has already been used",
  "redemption limit has been reached",
  "redemption limit reached",
  "maximum number of redemptions",
  "maximum number of times this offer can be redeemed",
  "no remaining invites",
  "no invites remaining",
  "all invites have been used",
  "all spots have been used",
  "invite limit reached",
  "referral limit reached",
  "already_redeemed",
  "redemption_limit_reached",
  "max_redemptions_reached"
];

const AMBIGUOUS_EXHAUSTED_PATTERNS = [
  "the original offer isn't available",
  "the original offer isn’t available",
  "the original offer is not available",
  "the original offer is no longer available",
  "original offer isn't available",
  "original offer isn’t available",
  "original offer is no longer available"
];

const EXPIRED_PATTERNS = [
  "offer has expired",
  "offer expired",
  "this offer has expired",
  "promotion has expired",
  "promo has expired",
  "invite has expired",
  "invitation has expired",
  "referral has expired",
  "offer has ended",
  "promotion has ended",
  "offer period has ended",
  "redemption period has ended",
  "link is no longer valid",
  "offer_expired",
  "promotion_expired",
  "redemption_period_ended"
];

const INVALID_PATTERNS = [
  "invalid referral code",
  "invalid offer code",
  "invalid promotion code",
  "invalid redeem code",
  "invalid redemption link",
  "invalid link",
  "offer not found",
  "promotion not found",
  "referral not found",
  "page not found",
  "requested url was not found",
  "invalid_referral_code",
  "invalid_offer_code",
  "offer_not_found"
];

const TEMP_ERROR_PATTERNS = [
  "something went wrong",
  "unable to load this page",
  "temporarily unavailable",
  "try again later",
  "too many requests",
  "unusual traffic",
  "verify you are human",
  "captcha"
];

const VALID_ACTION_PATTERNS = [
  "get offer",
  "claim offer",
  "claim this offer",
  "redeem offer",
  "redeem this offer",
  "claim your offer",
  "redeem your offer",
  "continue to redeem",
  "start free trial",
  "start your trial",
  "special invite offer"
];

const GENERIC_FALLBACK_PATTERNS = [
  "you can still sign up for google one",
  "sign up for google one",
  "choose a google one plan",
  "upgrade to google one"
];

function envInt(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function getPublicLimits() {
  return {
    concurrency: envInt("CHECK_CONCURRENCY", 4, 1, 6),
    timeoutMs: envInt("CHECK_TIMEOUT_MS", 18000, 5000, 45000),
    settleMs: envInt("CHECK_SETTLE_MS", 1400, 300, 5000),
    expectedMonths: envInt("EXPECTED_REFERRAL_MONTHS", 4, 1, 24),
    ambiguousUnavailableAsUsed: String(process.env.AMBIGUOUS_UNAVAILABLE_AS_USED || "").toLowerCase() === "true"
  };
}

function normalizeText(value = "") {
  return String(value)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function containsAny(text, patterns) {
  return patterns.some(pattern => text.includes(normalizeText(pattern)));
}

function hashLink(link) {
  return crypto.createHash("sha256").update(String(link)).digest("hex");
}

function isAllowedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return ALLOWED_HOSTS.some(base => host === base || host.endsWith(`.${base}`));
}

function extractCodeFromUrl(url, depth = 0) {
  if (depth > 3) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === "g.co") {
    const match = path.match(/^\/g1referral\/([a-z0-9]{8})\/?$/i);
    return match?.[1]?.toUpperCase() || null;
  }

  if (host === "one.google.com") {
    const match = path.match(/^\/referral\/redeem\/([a-z0-9]{8})\/?$/i);
    return match?.[1]?.toUpperCase() || null;
  }

  if (host === "accounts.google.com") {
    for (const key of ["continue", "followup"]) {
      const nested = url.searchParams.get(key);
      if (!nested) continue;
      try {
        const code = extractCodeFromUrl(new URL(nested), depth + 1);
        if (code) return code;
      } catch {}
    }
  }

  return null;
}

export function normalizeRedeemLink(rawLink) {
  let url;
  try {
    url = new URL(String(rawLink).trim());
  } catch {
    return { ok: false, status: STATUS.INVALID, reason: "Format URL tidak valid" };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, status: STATUS.INVALID, reason: "Protocol link harus http/https" };
  }

  if (!isAllowedHost(url.hostname)) {
    return { ok: false, status: STATUS.INVALID, reason: "Bukan domain Google referral yang didukung" };
  }

  const code = extractCodeFromUrl(url);
  if (!code) {
    return {
      ok: false,
      status: STATUS.INVALID,
      reason: "Format kode referral Gemini tidak sesuai (diharapkan 8 karakter huruf/angka)"
    };
  }

  return {
    ok: true,
    code,
    originalUrl: url.toString(),
    canonicalUrl: `https://one.google.com/referral/redeem/${code}`,
    shortUrl: `https://g.co/g1referral/${code}`
  };
}

function isLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "accounts.google.com" && /signin|servicelogin|accountchooser|rejected/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isConsentUrl(value) {
  try {
    return new URL(value).hostname === "consent.google.com";
  } catch {
    return false;
  }
}

async function readTextLimited(response, maxBytes = 350_000) {
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

async function fetchChain(startUrl, timeoutMs, userAgent) {
  const hops = [];
  let current = new URL(startUrl);
  let loginGate = false;
  let consentGate = false;

  for (let i = 0; i < 8; i += 1) {
    if (!isAllowedHost(current.hostname)) {
      return { hops, loginGate, consentGate, error: `Redirect keluar domain Google: ${current.hostname}` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": userAgent,
          "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,id;q=0.7",
          "cache-control": "no-cache",
          "pragma": "no-cache"
        }
      });
    } catch (error) {
      clearTimeout(timer);
      return {
        hops,
        loginGate,
        consentGate,
        error: error?.name === "AbortError" ? "Timeout HTTP probe" : `HTTP probe error: ${error?.message || "unknown"}`
      };
    } finally {
      clearTimeout(timer);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    let body = "";
    if (/text|html|json|javascript/.test(contentType)) {
      body = await readTextLimited(response).catch(() => "");
    }

    const location = response.headers.get("location");
    hops.push({
      url: current.toString(),
      status: response.status,
      location,
      body
    });

    if (response.status >= 300 && response.status < 400 && location) {
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return { hops, loginGate, consentGate, error: "Location redirect tidak valid" };
      }

      if (isLoginUrl(next.toString())) {
        loginGate = true;
        hops.push({ url: next.toString(), status: null, location: null, body: "" });
        break;
      }

      if (isConsentUrl(next.toString())) {
        consentGate = true;
        break;
      }

      current = next;
      continue;
    }

    break;
  }

  return { hops, loginGate, consentGate, error: null };
}

const CHROMIUM_VERSION = "149.0.0";
let cachedExecutablePath = null;
let executablePathPromise = null;

function chromiumPackUrl() {
  const explicit = String(process.env.CHROMIUM_PACK_URL || "").trim();
  if (explicit) return explicit;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_VERSION}/chromium-v${CHROMIUM_VERSION}-pack.${arch}.tar`;
}

async function getChromiumExecutablePath() {
  if (cachedExecutablePath) return cachedExecutablePath;
  if (!executablePathPromise) {
    executablePathPromise = chromium.executablePath(chromiumPackUrl())
      .then(path => {
        cachedExecutablePath = path;
        return path;
      })
      .catch(error => {
        executablePathPromise = null;
        throw error;
      });
  }
  return executablePathPromise;
}

async function launchRuntime() {
  chromium.setGraphicsMode = false;

  // Chromium 149 + Puppeteer 25: gunakan defaultArgs() yang sekarang async.
  // Jangan membuat BrowserContext baru di serverless karena dapat memicu
  // Protocol error (Target.createTarget): Target closed.
  const launchArgs = await puppeteer.defaultArgs({
    args: [
      ...chromium.args,
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run"
    ],
    headless: "shell"
  });

  const browser = await puppeteer.launch({
    args: launchArgs,
    defaultViewport: {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: false,
      isMobile: false
    },
    executablePath: await getChromiumExecutablePath(),
    headless: "shell",
    protocolTimeout: 30000
  });

  // Tidak membuat BrowserContext baru pada serverless. browser.newPage()
  // otomatis memakai default browser context.
  return { browser };
}

async function browserProbe(browser, normalized, options) {
  const page = await browser.newPage();
  const responses = [];
  const requestUrls = [];
  let blockedLogin = false;
  let blockedConsent = false;
  let navigationStatus = null;

  page.setDefaultNavigationTimeout(options.timeoutMs);
  page.setDefaultTimeout(options.timeoutMs);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9,id;q=0.7" });
  await page.setRequestInterception(true);

  page.on("request", request => {
    const url = request.url();
    if (requestUrls.length < 120 && /google\.com|g\.co/i.test(url)) requestUrls.push(url);

    if (request.isNavigationRequest() && isLoginUrl(url)) {
      blockedLogin = true;
      request.abort("blockedbyclient").catch(() => {});
      return;
    }
    if (request.isNavigationRequest() && isConsentUrl(url)) {
      blockedConsent = true;
      request.abort("blockedbyclient").catch(() => {});
      return;
    }

    if (["image", "media", "font"].includes(request.resourceType())) {
      request.abort().catch(() => {});
    } else {
      request.continue().catch(() => {});
    }
  });

  page.on("response", async response => {
    try {
      if (responses.length >= 30) return;
      const url = response.url();
      const parsed = new URL(url);
      if (!isAllowedHost(parsed.hostname)) return;

      const headers = response.headers();
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const relevant = /referral|redeem|offer|benefit|subscription|batchexecute|rpc|one\.google\.com/i.test(url);
      if (!relevant && response.request().resourceType() !== "document") return;

      let body = "";
      const length = Number(headers["content-length"] || 0);
      if (/text|html|json|javascript/.test(contentType) && (!length || length < 450_000)) {
        body = await response.text().catch(() => "");
        if (body.length > 450_000) body = body.slice(0, 450_000);
      }

      responses.push({ url, status: response.status(), body });
    } catch {}
  });

  const url = `${normalized.canonicalUrl}?g1_landing_page=5&hl=en&otzr=1`;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    navigationStatus = response?.status?.() ?? null;
  } catch (error) {
    if (!blockedLogin && !blockedConsent && error?.name === "TimeoutError") {
      // We still inspect any public responses collected before timeout.
    }
  }

  await Promise.race([
    page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(options.timeoutMs, 4500) }).catch(() => null),
    new Promise(resolve => setTimeout(resolve, options.settleMs))
  ]);
  await new Promise(resolve => setTimeout(resolve, Math.min(options.settleMs, 1200)));

  let snapshot = { bodyText: "", html: "", buttons: [], url: page.url() };
  try {
    snapshot = await page.evaluate(() => ({
      bodyText: document.body?.innerText || "",
      html: (document.documentElement?.innerHTML || "").slice(0, 650000),
      buttons: Array.from(document.querySelectorAll("button, [role='button'], a"))
        .map(el => (el.innerText || el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 150),
      url: location.href
    }));
  } catch {}

  await page.close().catch(() => {});
  return { responses, requestUrls, blockedLogin, blockedConsent, navigationStatus, snapshot };
}

function parseDurationMonths(text) {
  const raw = normalizeText(text);
  const patterns = [
    /\b(\d{1,2})\s*months?\b[^.]{0,70}\b(?:free|no charge|at no extra cost|special invite offer)\b/i,
    /\b(?:free|no charge|at no extra cost|special invite offer)\b[^.]{0,70}\b(\d{1,2})\s*months?\b/i,
    /\bfor\s+(\d{1,2})\s*months?\b/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseDeadline(text) {
  const raw = String(text || "");
  const regexes = [
    /offer expires(?: and must be redeemed)? by\s+([^.<\n]{6,100})/ig,
    /must be redeemed by\s+([^.<\n]{6,100})/ig,
    /offer valid until\s+([^.<\n]{6,100})/ig,
    /expires on\s+([^.<\n]{6,100})/ig
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const timestamp = Date.parse(match[1].trim());
      if (Number.isFinite(timestamp)) return { raw: match[1].trim(), timestamp };
    }
  }
  return null;
}

function hasStructuredUsed(text) {
  return /(?:already[_ -]?redeemed|redemption[_ -]?limit[_ -]?(?:reached|exceeded)|max(?:imum)?[_ -]?redemptions?[_ -]?(?:reached|exceeded)|remaining[_ -]?redemptions?\s*["']?\s*[:=]\s*0|remaining[_ -]?invites?\s*["']?\s*[:=]\s*0)/i.test(text);
}

function hasStructuredExpired(text) {
  return /(?:offer|promotion|promo|referral|invite)[_ -]?(?:is[_ -]?)?(?:expired|ended)|redemption[_ -]?period[_ -]?(?:expired|ended)/i.test(text);
}

function hasStructuredInvalid(text) {
  return /(?:invalid[_ -]?(?:referral|offer|promotion|promo|redeem|redemption)[_ -]?(?:code|link)?|(?:offer|referral|promotion)[_ -]?not[_ -]?found)/i.test(text);
}

function hasStructuredAvailable(text) {
  return /(?:offer|referral|invite)[_ -]?(?:status[_ -]?)?["']?\s*[:=]\s*["']?(?:available|active|eligible)|remaining[_ -]?(?:redemptions|invites)\s*["']?\s*[:=]\s*[1-9]\d*/i.test(text);
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function buildEvidence(httpProbes, browser) {
  const bodies = [];
  const urls = [];
  const statuses = [];
  const primaryStatuses = [];
  let loginGate = Boolean(browser?.blockedLogin);
  let consentGate = Boolean(browser?.blockedConsent);

  for (const probe of httpProbes) {
    loginGate ||= Boolean(probe.loginGate);
    consentGate ||= Boolean(probe.consentGate);
    for (const hop of probe.hops || []) {
      if (hop.body) bodies.push(hop.body);
      if (hop.url) urls.push(hop.url);
      if (hop.location) urls.push(hop.location);
      if (Number.isFinite(hop.status)) {
        statuses.push(hop.status);
        primaryStatuses.push(hop.status);
      }
    }
  }

  for (const response of browser?.responses || []) {
    if (response.body) bodies.push(response.body);
    if (response.url) urls.push(response.url);
    if (Number.isFinite(response.status)) statuses.push(response.status);
  }

  if (Number.isFinite(browser?.navigationStatus)) primaryStatuses.push(browser.navigationStatus);

  if (browser?.snapshot?.bodyText) bodies.push(browser.snapshot.bodyText);
  if (browser?.snapshot?.html) bodies.push(browser.snapshot.html);
  for (const button of browser?.snapshot?.buttons || []) bodies.push(button);
  for (const url of browser?.requestUrls || []) urls.push(url);

  const corpus = normalizeText(bodies.join("\n"));
  return {
    corpus,
    rawBodies: bodies,
    urls: dedupe(urls),
    statuses,
    primaryStatuses,
    loginGate,
    consentGate,
    finalUrl: browser?.snapshot?.url || urls.at(-1) || null,
    navigationStatus: browser?.navigationStatus ?? null
  };
}

export function classifyEvidence(evidence, options = {}) {
  const text = normalizeText(evidence.corpus || "");
  const expectedMonths = Number.isFinite(options.expectedMonths) ? options.expectedMonths : 4;
  const signals = [];
  const deadline = parseDeadline(text);
  const duration = parseDurationMonths(text);

  const accountSignal = containsAny(text, ACCOUNT_PATTERNS);
  const regionSignal = containsAny(text, REGION_PATTERNS);
  const tempError = containsAny(text, TEMP_ERROR_PATTERNS);
  const invalidSignal = containsAny(text, INVALID_PATTERNS) || hasStructuredInvalid(text);
  const expiredSignal = containsAny(text, EXPIRED_PATTERNS) || hasStructuredExpired(text);
  const usedSignal = containsAny(text, USED_PATTERNS) || hasStructuredUsed(text);
  const unavailableSignal = containsAny(text, AMBIGUOUS_EXHAUSTED_PATTERNS);
  const fallbackSignal = containsAny(text, GENERIC_FALLBACK_PATTERNS);
  const validAction = containsAny(text, VALID_ACTION_PATTERNS);
  const structuredAvailable = hasStructuredAvailable(text);

  if (invalidSignal) signals.push("explicit_invalid");
  if (expiredSignal) signals.push("explicit_expired");
  if (usedSignal) signals.push("explicit_used");
  if (unavailableSignal) signals.push("original_offer_unavailable");
  if (fallbackSignal) signals.push("generic_fallback_plan");
  if (validAction) signals.push("redeem_action");
  if (structuredAvailable) signals.push("structured_available");
  if (accountSignal) signals.push("account_eligibility");
  if (regionSignal) signals.push("region_mismatch");
  if (tempError) signals.push("temporary_google_error");
  if (evidence.loginGate) signals.push("login_gate");
  if (evidence.consentGate) signals.push("consent_gate");
  if (duration !== null) signals.push(`duration_${duration}_months`);

  // Link-level explicit states outrank login redirects that may appear later.
  if (invalidSignal || (evidence.primaryStatuses || []).includes(404)) {
    return { status: STATUS.INVALID, confidence: "high", reason: "Google menandai kode/link tidak valid atau tidak ditemukan", signals };
  }

  if (expiredSignal || (evidence.primaryStatuses || []).includes(410) || (deadline && Date.now() > deadline.timestamp)) {
    return {
      status: STATUS.EXPIRED,
      confidence: "high",
      reason: deadline && Date.now() > deadline.timestamp
        ? `Offer sudah melewati batas redeem (${deadline.raw})`
        : "Google menandai offer/referral sudah expired",
      signals
    };
  }

  if (usedSignal) {
    return { status: STATUS.USED, confidence: "high", reason: "Google menandai kode/slot referral sudah digunakan atau limit tercapai", signals };
  }

  // Account/region responses are not proof of the link's own status.
  if (accountSignal) {
    return { status: STATUS.ERROR, confidence: "high", reason: "Respons yang terbaca adalah eligibility akun, bukan status link", signals };
  }
  if (regionSignal) {
    return { status: STATUS.ERROR, confidence: "high", reason: "Respons dibatasi region/billing; status link tidak dapat dipastikan", signals };
  }
  if (tempError || (evidence.primaryStatuses || []).includes(429) || (evidence.primaryStatuses || []).some(s => s >= 500)) {
    return { status: STATUS.ERROR, confidence: "high", reason: "Google memberi rate-limit/error sementara/anti-bot", signals };
  }

  // Strong public-positive signal: an actual referral CTA plus non-zero referral benefit.
  if ((structuredAvailable || validAction) && duration !== null && duration >= Math.max(2, expectedMonths - 1)) {
    return {
      status: STATUS.VALID,
      confidence: "high",
      reason: `Offer referral aktif dan benefit ${duration} bulan masih ditampilkan`,
      signals
    };
  }

  if (structuredAvailable && validAction && duration !== 0) {
    return { status: STATUS.VALID, confidence: "medium", reason: "Google masih menampilkan status offer aktif dan aksi redeem", signals };
  }

  // "Original offer isn't available" generally means the referral benefit itself is gone.
  // It is only mapped to Used when there is a fallback-plan signal and no explicit expiry.
  if (unavailableSignal && fallbackSignal) {
    if (options.ambiguousUnavailableAsUsed === true) {
      return {
        status: STATUS.USED,
        confidence: "medium",
        reason: "Benefit referral asli sudah tidak tersedia dan Google hanya menampilkan plan fallback (mode agresif)",
        signals
      };
    }
    return {
      status: STATUS.ERROR,
      confidence: "high",
      reason: "Google mengatakan original offer tidak tersedia, tetapi sinyal ini dapat berarti link habis, eligibility, region, atau error Google; bot tidak menebak",
      signals
    };
  }

  if (unavailableSignal && duration !== null && duration > 0 && duration < expectedMonths) {
    if (options.ambiguousUnavailableAsUsed === true) {
      return {
        status: STATUS.USED,
        confidence: "medium",
        reason: `Referral ${expectedMonths} bulan tidak lagi diterapkan; halaman hanya menampilkan benefit ${duration} bulan (mode agresif)`,
        signals
      };
    }
    return {
      status: STATUS.ERROR,
      confidence: "high",
      reason: `Benefit referral ${expectedMonths} bulan tidak muncul dan hanya ada ${duration} bulan, tetapi penyebabnya tidak dapat dipastikan tanpa konteks akun`,
      signals
    };
  }

  if (evidence.loginGate) {
    return {
      status: STATUS.ERROR,
      confidence: "high",
      reason: "Google meminta login sebelum membuka status offer; tidak ada bukti publik yang cukup untuk menebak",
      signals
    };
  }

  if (evidence.consentGate) {
    return { status: STATUS.ERROR, confidence: "medium", reason: "Google berhenti pada consent page sehingga status belum terbaca", signals };
  }

  return { status: STATUS.ERROR, confidence: "high", reason: "Tidak ada bukti publik yang cukup untuk menentukan status dengan aman", signals };
}

function makeResult(rawLink, normalized, classification, extra = {}) {
  return {
    link: rawLink,
    linkHash: hashLink(rawLink),
    code: normalized?.code || null,
    status: classification.status,
    confidence: classification.confidence || "high",
    reason: classification.reason,
    engine: ENGINE_VERSION,
    evidence: {
      signals: classification.signals || [],
      loginGate: Boolean(extra.loginGate),
      consentGate: Boolean(extra.consentGate),
      statuses: dedupe((extra.statuses || []).map(String)).slice(0, 12),
      hosts: dedupe((extra.urls || []).map(safeHost)).filter(Boolean).slice(0, 12)
    },
    ...extra,
    urls: undefined,
    statuses: undefined,
    primaryStatuses: undefined,
    loginGate: undefined,
    consentGate: undefined
  };
}

async function checkOne(browser, rawLink, options) {
  const started = Date.now();
  const normalized = normalizeRedeemLink(rawLink);
  if (!normalized.ok) {
    return makeResult(rawLink, null, {
      status: normalized.status,
      confidence: "high",
      reason: normalized.reason,
      signals: ["format_invalid"]
    }, { durationMs: Date.now() - started });
  }

  const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  const mobileUA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36";

  const publicUrl = `${normalized.canonicalUrl}?g1_landing_page=5&hl=en&otzr=1`;
  const [shortProbe, directProbe, mobileProbe, browserResult] = await Promise.all([
    fetchChain(normalized.shortUrl, options.timeoutMs, desktopUA),
    fetchChain(publicUrl, options.timeoutMs, desktopUA),
    fetchChain(`${normalized.canonicalUrl}?pli=1&g1_landing_page=5&hl=en`, options.timeoutMs, mobileUA),
    browserProbe(browser, normalized, options)
  ]);

  const evidence = buildEvidence([shortProbe, directProbe, mobileProbe], browserResult);
  const classification = classifyEvidence(evidence, options);

  const allErrors = [shortProbe.error, directProbe.error, mobileProbe.error].filter(Boolean);
  if (allErrors.length === 3 && classification.status === STATUS.ERROR && !evidence.corpus) {
    classification.reason = allErrors[0];
    classification.signals = dedupe([...(classification.signals || []), "all_http_probes_failed"]);
  }

  return makeResult(rawLink, normalized, classification, {
    finalUrl: evidence.finalUrl,
    httpStatus: browserResult.navigationStatus ?? evidence.statuses.find(Number.isFinite) ?? null,
    durationMs: Date.now() - started,
    loginGate: evidence.loginGate,
    consentGate: evidence.consentGate,
    statuses: evidence.statuses,
    primaryStatuses: evidence.primaryStatuses,
    urls: evidence.urls
  });
}

export async function checkRedeemLinks(rawLinks) {
  const options = getPublicLimits();
  let runtime;

  try {
    runtime = await launchRuntime();
  } catch (error) {
    return rawLinks.map(link => makeResult(link, normalizeRedeemLink(link), {
      status: STATUS.ERROR,
      confidence: "high",
      reason: `Chromium Vercel gagal dijalankan: ${error?.message || "unknown"}`,
      signals: ["browser_launch_failed"]
    }, { durationMs: 0 }));
  }

  const results = new Array(rawLinks.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= rawLinks.length) return;
      try {
        results[index] = await checkOne(runtime.browser, rawLinks[index], options);
      } catch (error) {
        results[index] = makeResult(rawLinks[index], normalizeRedeemLink(rawLinks[index]), {
          status: STATUS.ERROR,
          confidence: "high",
          reason: `Checker error: ${error?.message || "unknown"}`,
          signals: ["checker_exception"]
        }, { durationMs: 0 });
      }
    }
  }

  try {
    const workers = Math.min(options.concurrency, rawLinks.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return results;
  } finally {
    await runtime.browser.close().catch(() => {});
  }
}

export async function testPublicEngine() {
  const started = Date.now();
  let runtime;
  let page;
  let stage = "resolve_chromium";
  let browserVersion = null;
  let executablePath = null;

  try {
    executablePath = await getChromiumExecutablePath();
    stage = "launch_browser";
    runtime = await launchRuntime();

    stage = "browser_version";
    browserVersion = await runtime.browser.version().catch(() => null);

    stage = "create_page";
    page = await runtime.browser.newPage();
    page.setDefaultNavigationTimeout(15000);

    stage = "open_google_one";
    let status = null;
    try {
      const response = await page.goto("https://one.google.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15000
      });
      status = response?.status?.() ?? null;
    } catch {}

    return {
      ok: true,
      engine: ENGINE_VERSION,
      chromium: CHROMIUM_VERSION,
      browserVersion,
      executablePathReady: Boolean(executablePath),
      googleHttpStatus: status,
      reason: "Chromium anonim berhasil dijalankan dengan default browser context",
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      ok: false,
      engine: ENGINE_VERSION,
      chromium: CHROMIUM_VERSION,
      stage,
      browserVersion,
      executablePathReady: Boolean(executablePath),
      reason: error?.message || "Engine test failed",
      durationMs: Date.now() - started
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (runtime?.browser) await runtime.browser.close().catch(() => {});
  }
}
