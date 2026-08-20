import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRedeemLink } from "../lib/public-checker.js";

test("accepts Google serviceactivation new token", () => {
  const token = "AQCpiI" + "AbCdEf0123_-".repeat(24) + "==";
  const result = normalizeRedeemLink(
    `https://serviceactivation.google.com/subscription/new/${token}`
  );

  assert.equal(result.ok, true);
  assert.equal(result.kind, "serviceactivation");
  assert.equal(result.intent, "new");
  assert.match(result.code, /^SA-[A-F0-9]{10}$/);
  assert.equal(result.canonicalUrl.includes("/subscription/new/"), true);
});

test("accepts Google serviceactivation entitle token", () => {
  const token = "AQCpiI" + "ZyXwVu9876_-".repeat(24) + "==";
  const result = normalizeRedeemLink(
    `https://serviceactivation.google.com/subscription/entitle/${token}`
  );

  assert.equal(result.ok, true);
  assert.equal(result.kind, "serviceactivation");
  assert.equal(result.intent, "entitle");
});

test("rejects malformed serviceactivation URL", () => {
  const result = normalizeRedeemLink(
    "https://serviceactivation.google.com/subscription/new/abc"
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid");
});
