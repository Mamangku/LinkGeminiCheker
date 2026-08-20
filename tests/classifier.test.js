import test from "node:test";
import assert from "node:assert/strict";
import { classifyEvidence, normalizeRedeemLink } from "../lib/public-checker.js";

function ev(corpus, extra = {}) {
  return { corpus, statuses: [], loginGate: false, consentGate: false, ...extra };
}

test("normalizes supported Google referral links", () => {
  const r = normalizeRedeemLink("https://g.co/g1referral/AB12CD34");
  assert.equal(r.ok, true);
  assert.equal(r.code, "AB12CD34");
});

test("rejects malformed referral codes", () => {
  const r = normalizeRedeemLink("https://g.co/g1referral/ABC");
  assert.equal(r.ok, false);
  assert.equal(r.status, "invalid");
});

test("classifies explicit used", () => {
  const r = classifyEvidence(ev("Redemption limit has been reached"), { expectedMonths: 4 });
  assert.equal(r.status, "used");
  assert.equal(r.confidence, "high");
});

test("classifies explicit expired", () => {
  const r = classifyEvidence(ev("This offer has expired"), { expectedMonths: 4 });
  assert.equal(r.status, "expired");
});

test("classifies explicit invalid", () => {
  const r = classifyEvidence(ev("Invalid referral code"), { expectedMonths: 4 });
  assert.equal(r.status, "invalid");
});

test("classifies strong active 4 month offer", () => {
  const r = classifyEvidence(ev("Special invite offer. Get offer. Free for 4 months."), { expectedMonths: 4 });
  assert.equal(r.status, "valid");
});

test("account eligibility is error, not used", () => {
  const r = classifyEvidence(ev("This or a similar offer has already been redeemed on this Google Account"), { expectedMonths: 4 });
  assert.equal(r.status, "error");
});

test("ambiguous original offer unavailable is strict error", () => {
  const r = classifyEvidence(ev("The original offer isn't available, but you can still sign up for Google One"), { expectedMonths: 4, ambiguousUnavailableAsUsed: false });
  assert.equal(r.status, "error");
});

test("ambiguous original offer unavailable can be medium used in aggressive mode", () => {
  const r = classifyEvidence(ev("The original offer isn't available, but you can still sign up for Google One"), { expectedMonths: 4, ambiguousUnavailableAsUsed: true });
  assert.equal(r.status, "used");
  assert.equal(r.confidence, "medium");
});

test("login gate without status is error", () => {
  const r = classifyEvidence(ev("", { loginGate: true }), { expectedMonths: 4 });
  assert.equal(r.status, "error");
});
