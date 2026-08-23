/**
 * HALKIN SESİNİN KENDİ TURU.
 *
 * Halkın talepleri bugüne kadar YALNIZCA `app/api/general` içinden, yani Kral
 * General'e bir mesaj gönderdiğinde eşitleniyordu ve istemciye de yalnızca o
 * cevapla ulaşıyordu. İki sonucu vardı, ikincisi ağır:
 *
 *   1. Kral uzun süre konuşmazsa halk susuyordu.
 *   2. GENERAL'İ HİÇ BAĞLAMAYAN Kral halkın sesini HİÇ duymuyordu — kuruluş
 *      akışı "General sessizken başla" seçeneğini açıkça sunduğu için bu
 *      istisnai bir durum değil, desteklenen bir oyun biçimi. O biçimde oyunun
 *      kalbi olan halk tamamen görünmezdi.
 *
 * Plan belgesindeki karar da "saatlik cron turu" diyordu; tur o kararın gereği.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { voiceSignalsOf } from "../engine/populace-voice";
import { livingCost, commonsOf, commonsReference } from "../engine/market";
import { factionPressureOf } from "../engine/faction";
import { servedRations } from "../engine/tick";
import type { Game } from "../engine/types";

const T0 = 1_700_000_000_000;
const round = readFileSync(new URL("../server/populace-round.ts", import.meta.url), "utf8");
const cron = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");
const world = readFileSync(new URL("../app/api/world/route.ts", import.meta.url), "utf8");
const voice = readFileSync(new URL("../server/populace-voice.ts", import.meta.url), "utf8");

function game(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "S", channelId: "s",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0,
    resources: { gold: 900, food: 400, stone: 300, wood: 300, iron: 100, ale: 0 },
    population: 120, capacity: 200, popularity: 42.6, reputation: 50, loyalty: 75,
    taxRate: 30, quota: 6, quotaAt: T0, foodRation: 65, aleRation: 0, soldierPay: 80,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }],
    units: { spearman: 4 }, queue: null, notices: [], provider: null, model: null,
    generalConnected: false, ...overrides,
  } as Game;
}

test("sinyaller kayıttan türetiliyor — veritabanı okumadan, saf", () => {
  const signals = voiceSignalsOf(game(), { channelSpeed: 4, comparison: null });
  assert.equal(signals.taxRate, 30);
  assert.equal(signals.population, 120);
  assert.equal(signals.channelSpeed, 4);
  assert.equal(signals.comparison, undefined, "kıyas girdisi yoksa alan boş kalmalı");
  // Aynı girdi iki kez aynı sonucu vermeli.
  assert.deepEqual(signals, voiceSignalsOf(game(), { channelSpeed: 4, comparison: null }));
});

test("sinyaller İSTEMCİ bağlamıyla AYNI sayıları üretir", () => {
  // İki yol aynı sayıyı üretmek zorunda: farklı üretirlerse aynı krallık için
  // talep bir yolda açılıp ötekinde açılmaz. İstemci bağlamı bu değerleri
  // `servedRations(g)`, `factionPressureOf(g)` ve pazarın geçim endeksinden
  // yuvarlayarak alıyor; burada birebir aynısı yapılır.
  const g = game();
  const signals = voiceSignalsOf(g, { channelSpeed: 1, comparison: null });
  const served = servedRations(g);
  assert.equal(signals.servedFood, Math.round(served.food));
  assert.equal(signals.servedPay, Math.round(served.pay));
  assert.equal(signals.nominalFood, 65, "ilan edilen pay kayıttan okunmalı");
  assert.equal(signals.nominalPay, 80);
  assert.equal(signals.factionPressure, Math.round(factionPressureOf(g)));
  assert.equal(signals.popularity, Math.round(g.popularity), "rıza istemcideki gibi yuvarlanmalı");
  assert.equal(signals.livingCost, livingCost(commonsOf(g), commonsReference(g.population)));
});

test("sayılar YUVARLANIR — istemci bağlamı da yuvarlıyor", () => {
  // Mutasyon denemesinde ilk senaryomda `served.food` tesadüfen tam sayıydı ve
  // yuvarlamayı kaldırmak testi kırmıyordu. Senaryo hesaplanarak seçildi:
  // ambarda 1 yiyecekle fiilî pay %23,81 çıkıyor, yani kesirli.
  const kismi = voiceSignalsOf(
    game({ resources: { gold: 7, food: 1, stone: 0, wood: 0, iron: 0, ale: 0 }, units: { spearman: 9 } }),
    { channelSpeed: 1, comparison: null },
  );
  assert.ok(Number.isInteger(kismi.servedFood), `servedFood yuvarlanmamış: ${kismi.servedFood}`);
  assert.ok(Number.isInteger(kismi.servedPay ?? 0), `servedPay yuvarlanmamış: ${kismi.servedPay}`);
  assert.ok(Number.isInteger(kismi.factionPressure ?? 0), "factionPressure yuvarlanmamış");
  assert.ok(Number.isInteger(kismi.popularity), "popularity yuvarlanmamış");
  // Senaryonun gerçekten kesirli bir ham değer ürettiğini de doğrula, yoksa
  // iddia yine boşa döner.
  const g = game({ resources: { gold: 7, food: 1, stone: 0, wood: 0, iron: 0, ale: 0 }, units: { spearman: 9 } });
  const ham = servedRations(g);
  assert.ok(!Number.isInteger(ham.food) || !Number.isInteger(ham.pay),
    "senaryo kesirli bir ham değer üretmiyor; yuvarlama iddiası boş kalır");
});

test("ilan edilen ile fiilen dağıtılan pay AYRI taşınır (makasın iki tarafı)", () => {
  // Ambar yetmezse fiilî pay ilan edilenin altına düşer; makas bir sinyaldir.
  const dar = game({ resources: { gold: 0, food: 0, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const s = voiceSignalsOf(dar, { channelSpeed: 1, comparison: null });
  assert.ok(s.nominalFood !== undefined && s.servedFood <= s.nominalFood,
    "fiilî pay ilan edilenin üstüne çıkamaz");
  assert.ok(s.servedFood < (s.nominalFood ?? 0), "boş ambarda makas açılmalı");
});

test("tur MODEL ÇAĞIRMAZ — saatlik bir tur her oyuncu için token yakamaz", () => {
  assert.match(round, /voiceSignalsOf\(/, "tura anlatıcı veriliyor; token harcar");
  assert.equal(/populaceNarrator|callProvider|populaceCredentialFor/.test(round), false,
    "halk turu bir sağlayıcı yoluna dokunuyor");
});

test("cron turu SARILI: düşerse diğer turları etkilemez", () => {
  assert.match(cron, /try \{ populaceRound = await refreshPopulaceVoice\(now\); \}/);
  assert.match(cron, /catch \(error\) \{ populaceRound =/, "tur sarılmamış");
  assert.match(cron, /populace: populaceRound,/, "tur rapora yazılmıyor");
});

test("dünya ucu halkın sesini SALT OKUR — orada eşitleme yapılmaz", () => {
  assert.match(world, /populaceDemands: await loadOpenDemands\(user\.id\)/, "dünya ucu halkın sesini taşımıyor");
  assert.equal(/syncPopulaceDemands/.test(world), false,
    "10 saniyede bir dönen yoklamaya eşitleme konmuş; defteri döver ve token yakar");
});

test("salt okuma yolu AÇILMAMIŞ talebi göstermez", () => {
  // Süre şartını geçmemiş aday Kral'a gösterilmez; eşik kararı eşitleme
  // turunda verilir, okuma yolunda yeniden verilmez.
  assert.match(voice, /export async function loadOpenDemands/);
  assert.match(voice, /filter\(row => row\.openedAt !== null\)/, "açılmamış aday süzülmüyor");
});
