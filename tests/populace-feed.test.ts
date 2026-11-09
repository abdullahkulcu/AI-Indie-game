import assert from "node:assert/strict";
import test from "node:test";
import { deriveFeedCue, feedSourceKey, FEED_REFRESH_MS } from "../engine/populace-feed";
import { feedNarrationPrompt } from "../server/populace-feed-narrator";
import { coalitionPrompt } from "../server/faction-coalition-narrator";

const calm = {
  foodRate: 4,
  constructionName: null,
  soldierUnrest: 0,
  factionPressure: 0,
  worldEvent: { phase: "warning" as const, label: "—" },
  neighborWhisper: null,
};

test("halk güncesi yalnız anlamlı bir gündem varsa konu üretir", () => {
  assert.equal(deriveFeedCue(calm), null);
  assert.equal(deriveFeedCue({ ...calm, constructionName: "Pazar" })?.kind, "construction");
  assert.equal(deriveFeedCue({ ...calm, neighborWhisper: "worse" })?.kind, "neighbor");
});

test("acil geçim kaygısı kamusal güncede en yüksek önceliği alır", () => {
  const cue = deriveFeedCue({ ...calm, foodRate: -1, soldierUnrest: 80, factionPressure: 90 });
  assert.equal(cue?.kind, "food");
  assert.match(cue?.subject ?? "", /yiyecek/i);
});

test("aynı saatlik pencere cron yarışında aynı kaynak anahtarını üretir", () => {
  const cue = deriveFeedCue({ ...calm, constructionName: "Pazar" })!;
  assert.equal(feedSourceKey(cue, FEED_REFRESH_MS + 99), feedSourceKey(cue, FEED_REFRESH_MS + 5_000));
  assert.notEqual(feedSourceKey(cue, FEED_REFRESH_MS - 1), feedSourceKey(cue, FEED_REFRESH_MS));
});

test("feed promptu talep, sayı ve özel isim istemez", () => {
  const prompt = feedNarrationPrompt({ kind: "neighbor", subject: "Adsız sancaklardan söylenti geliyor.", persona: "zeki_istekli" });
  assert.ok(prompt.includes("Adsız sancaklardan"));
  assert.ok(!prompt.includes("altın") && !prompt.includes("ambar"));
});

test("koalisyon anlatıcısı yalnız motorun verdiği konuyu ve ret sertliğini görür", () => {
  const prompt = coalitionPrompt({ kind: "tax_relief", policy: { key: "taxRate", value: 20 }, subject: "Meydan verginin hafiflemesini istiyor." }, 2, "isyankar");
  assert.match(prompt, /verginin hafiflemesini/i);
  assert.match(prompt, /2 kez/i);
  assert.ok(!prompt.includes("policyKey"));
});
