import { test } from "node:test";
import assert from "node:assert/strict";
import { safeUrl, formatDate, errorLabel, LIMITS } from "../src/guestbook.js";
import { labelsFor, LABELS } from "../src/labels.js";

test("visitor links: only real web addresses", () => {
  assert.equal(safeUrl("https://ana.neocities.org"), "https://ana.neocities.org/");
  assert.equal(safeUrl("http://example.com/a?b=1"), "http://example.com/a?b=1");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<b>x</b>"), "");
  assert.equal(safeUrl("not a link"), "");
  assert.equal(safeUrl(""), "");
  assert.equal(safeUrl(null), "");
});

test("dates in both languages, and bad dates", () => {
  assert.equal(formatDate("2026-11-01T18:00:00Z", "en"), "Nov 1, 2026");
  assert.match(formatDate("2026-11-01T18:00:00Z", "es-CO"), /^1 nov\.? 2026$/);
  assert.equal(formatDate("2026-11-01T23:59:00-05:00", "en"), "Nov 2, 2026", "always UTC, so everyone sees the same day");
  assert.equal(formatDate("nonsense", "en"), "");
});

test("refusals from the worker map to a label that exists", () => {
  for (const code of ["check-failed", "too-many", "missing", "server", "origin", undefined]) {
    assert.ok(LABELS.en[errorLabel(code)], `label for ${code}`);
  }
  assert.equal(errorLabel("too-many"), "tooMany");
  assert.equal(errorLabel("anything else"), "failed");
});

test("labels: language, region codes, overrides, fallback", () => {
  assert.equal(labelsFor("es-CO").send, "Firmar");
  assert.equal(labelsFor("fr").send, "Sign");
  assert.equal(labelsFor(null).send, "Sign");
  assert.equal(labelsFor("en", { send: "Leave your mark" }).send, "Leave your mark");
  assert.deepEqual(Object.keys(LABELS.es), Object.keys(LABELS.en), "both languages have the same words");
});

test("the form's limits match the worker's", async () => {
  const fs = await import("node:fs");
  const worker = fs.readFileSync(new URL("../worker/worker.js", import.meta.url), "utf8");
  const m = worker.match(/const LIMITS = \{ name: (\d+), website: (\d+), message: (\d+)/);
  assert.deepEqual({ name: +m[1], website: +m[2], message: +m[3] }, LIMITS);
});
