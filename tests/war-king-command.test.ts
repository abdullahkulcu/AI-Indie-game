import assert from "node:assert/strict";
import test from "node:test";
import { KING_LEADS_MORALE_BONUS, kingAbsencePenalty } from "../engine/war";

test("Kralın cephe komutası tek doğru moral değeri taşır", () => {
  assert.equal(KING_LEADS_MORALE_BONUS, 6);
});

test("başkent rızası yalnız uzun süren kral seferinde aşınır", () => {
  assert.equal(kingAbsencePenalty(false, 100), 0);
  assert.equal(kingAbsencePenalty(true, 23.9), 0);
  assert.equal(kingAbsencePenalty(true, 24), 1);
  assert.equal(kingAbsencePenalty(true, 240), 8);
});
