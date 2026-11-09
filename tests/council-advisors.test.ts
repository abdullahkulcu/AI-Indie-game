import assert from "node:assert/strict";
import test from "node:test";
import { completedCouncilVoices, fallbackVoice, generalCouncilPrompt, publicAdvisorPrompt, publicCouncilCues, sanitizeCouncilThought } from "../server/council-advisors";
import { councilCallMinimumGapMs, councilSourceKey, councilCycleMs, COUNCIL_CALL_MINIMUM_REAL_HOURS, COUNCIL_CYCLE_REAL_HOURS } from "../server/council-schedule";
import { compatibleSamplingOptions, describeProviderFailure } from "../server/llm-provider";
import { aiGuidedSystemPrompt } from "../server/ai-guides";

test("Halk ve garnizon aynı durumda farklı çıkarları savunur", () => {
  const cues = publicCouncilCues({ popularity: 20, taxRate: 35, population: 100, populace: { servedFood: 50, capacity: 100, army: 20, soldierUnrest: 65, soldierPay: 40 } });
  assert.equal(cues.commons.id, "bread-urgent");
  assert.equal(cues.commons.priority, "urgent");
  assert.equal(cues.garrison.id, "desertion");
  assert.equal(cues.garrison.priority, "urgent");
  assert.notEqual(cues.commons.fallback, cues.garrison.fallback);
});

test("iyi yönetilen krallıkta iki kamara da sakin ama ayrı konuşur", () => {
  const snapshot = { popularity: 63, taxRate: 15, population: 400, populace: { servedFood: 125, livingCost: 1, capacity: 590, army: 35, soldierUnrest: 0, soldierPay: 100 }, defense: { watchRatio: 60, recentRaids: [] } };
  assert.equal(publicCouncilCues(snapshot).commons.id, "content");
  assert.equal(publicCouncilCues(snapshot).garrison.id, "ready");
  assert.equal(fallbackVoice("commons", snapshot).mode, "rules");
});

test("channel AI promptu krallığın sayılarını veya özel adını taşımaz", () => {
  const cue = publicCouncilCues({ popularity: 12, taxRate: 41, population: 999, populace: { servedFood: 51, army: 80, soldierUnrest: 72 } }).commons;
  const prompt = JSON.stringify(publicAdvisorPrompt("commons", cue));
  assert.doesNotMatch(prompt, /999|51|41|12|72/);
  assert.doesNotMatch(prompt, /KRALLIK_DURUMU/);
});

test("General kendi anahtarıyla kesin durumu görebilir", () => {
  const prompt = generalCouncilPrompt({ popularity: 63, resources: { food: 140719 }, populace: { army: 35 } });
  assert.match(prompt.user, /140719/);
  assert.match(prompt.user, /"army":35/);
});

test("Divan metni yalnızca tamamlanmış son cümlede biter", () => {
  const clean = sanitizeCouncilThought(`# **Birinci satır.**\n${"x".repeat(600)}`);
  assert.equal(clean.includes("\n"), false);
  assert.equal(clean, "Birinci satır.");
  assert.equal(sanitizeCouncilThought("Bu yarım kalan bir cümle"), "");
});

test("eski önbellekteki yarım Divan sesi gösterilmez", () => {
  assert.deepEqual(completedCouncilVoices([
    { role: "commons", speaker: "HALK MECLİSİ", text: "Bizim için tam bir görüş.", priority: "watch", mode: "ai" },
    { role: "garrison", speaker: "GARNİZON", text: "Nöbetçiler henüz", priority: "watch", mode: "ai" },
  ]), [
    { role: "commons", speaker: "HALK MECLİSİ", text: "Bizim için tam bir görüş.", priority: "watch", mode: "ai" },
  ]);
});

test("her AI çağrısı için rol ve ortak rehber tek bir sistem metninde birleşir", () => {
  const prompt = aiGuidedSystemPrompt("garrison", "Yalnızca nöbet durumunu değerlendir.");
  assert.match(prompt, /DEMIRKALE_AI_REHBERI/);
  assert.match(prompt, /kışladaki garnizonun sesisin/i);
  assert.match(prompt, /Yalnızca nöbet durumunu değerlendir/);
});

test("sağlayıcı HTTP hataları anahtar sızdırmadan yönlendirici nedene dönüşür", () => {
  assert.deepEqual(describeProviderFailure(new Error("anthropic 401")), {
    ok: false, code: "authentication", message: "API anahtarı sağlayıcı tarafından reddedildi.",
  });
  assert.deepEqual(describeProviderFailure(new Error("anthropic 404")), {
    ok: false, code: "model", message: "Model adı sağlayıcıda bulunamadı.",
  });
  assert.deepEqual(describeProviderFailure(new Error("openai 429")), {
    ok: false, code: "quota", message: "Sağlayıcı kotası veya hız sınırı aşıldı.",
  });
});

test("Anthropic arka plan çağrıları uyarlamalı düşünmeye aykırı sıcaklık göndermez", () => {
  assert.deepEqual(compatibleSamplingOptions("anthropic", 0.55), {});
  assert.deepEqual(compatibleSamplingOptions("openai", 0.55), { temperature: 0.55 });
});

test("Divan gündemi kaynak stoğundaki küçük oynamaya değil karar bağlamına bakar", () => {
  const safe = { popularity: 63, population: 400, hourlyRates: { food: 20 }, resources: { food: 1 }, populace: { servedFood: 125, capacity: 590, army: 35, soldierUnrest: 0, soldierPay: 100 }, defense: { watchRatio: 60, recentRaids: [] } };
  assert.equal(councilSourceKey(safe), councilSourceKey({ ...safe, resources: { food: 999999 } }));
  assert.notEqual(councilSourceKey(safe), councilSourceKey({ ...safe, populace: { ...safe.populace, servedFood: 50 } }));
  assert.equal(COUNCIL_CYCLE_REAL_HOURS, 12);
  assert.equal(COUNCIL_CALL_MINIMUM_REAL_HOURS, 12);
  assert.equal(councilCycleMs(1), 12 * 3_600_000);
  assert.equal(councilCycleMs(24), 12 * 3_600_000);
  assert.equal(councilCallMinimumGapMs(1), 12 * 3_600_000);
  assert.equal(councilCallMinimumGapMs(24), 12 * 3_600_000);
});
