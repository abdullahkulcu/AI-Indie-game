import assert from "node:assert/strict";
import test from "node:test";
import { propagandaPrompt } from "../server/propaganda-narrator";

test("propaganda promptu hedefin gizli sayılarıyla ya da gönderen adıyla kurulmaz", () => {
  const prompt = propagandaPrompt({ kind: "gold_commons", persona: "isyankar" });
  assert.match(prompt, /çarşıda yabancı bir el/i);
  assert.match(prompt, /SÖYLENTİ/);
  assert.doesNotMatch(prompt, /ambar|istihkak|gönderen|Demirkale/i);
});
