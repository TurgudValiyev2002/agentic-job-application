import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExtractedText } from "./normalize-extracted-text.ts";

test("repairs the real extracted name artifact", () => {
  assert.equal(
    normalizeExtractedText("S ¨ULEYMAN EMIRHAN DONCU"),
    "SÜLEYMAN EMIRHAN DONCU",
  );
});

test("repairs the real Universität artifact", () => {
  assert.equal(normalizeExtractedText("Universit¨at Innsbruck"), "Universität Innsbruck");
});

test("composes supported spacing diacritics before their base letters", () => {
  assert.equal(
    normalizeExtractedText("´e `a ˆo ˜n ¸c ˚a"),
    "é à ô ñ ç å",
  );
});

test("leaves already-correct Unicode text unchanged", () => {
  const correct = "SÜLEYMAN — Universität Innsbruck — déjà vu";
  assert.equal(normalizeExtractedText(correct), correct);
});
