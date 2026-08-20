import test from "node:test";
import assert from "node:assert/strict";
import { parseGoCheckerSummary } from "../lib/gochecker-parser.js";

test("parses normal GoChecker summary", () => {
  const result = parseGoCheckerSummary(`
✨ Checking Complete: 1 Links

✅ Valid: 0
🛍 Used: 1
😵 Expired: 0
❌ Invalid: 0
💔 Error: 0
  `);

  assert.deepEqual(
    {
      total: result.total,
      valid: result.valid,
      used: result.used,
      expired: result.expired,
      invalid: result.invalid,
      error: result.error
    },
    {
      total: 1,
      valid: 0,
      used: 1,
      expired: 0,
      invalid: 0,
      error: 0
    }
  );
});

test("rejects incomplete result", () => {
  assert.equal(
    parseGoCheckerSummary("Checking Complete: 1 Links\nValid: 1"),
    null
  );
});

test("rejects inconsistent total", () => {
  assert.equal(
    parseGoCheckerSummary(`
Checking Complete: 2 Links
Valid: 1
Used: 0
Expired: 0
Invalid: 0
Error: 0
    `),
    null
  );
});
