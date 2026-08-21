import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyActions } from "../engine/actions";
import {
  DEMAND_NOTICE_HOURS, MAX_OPEN_DEMANDS, VOICE_THRESHOLDS, type VoiceSignals,
  demandsSatisfiedBy, derivePopulaceDemands, garrisonMood, garrisonRefusal,
  garrisonVetoes, openDemands, renderDemands,
} from "../engine/populace-voice";
import { SOLDIER_THRESHOLDS } from "../engine/populace";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

/**
 * İyi yönetilen krallık: rıza 65 (ölçülen dinlenme noktası), tam istihkak, normal
 * fiyat, düşük vergi, boş konut var, garnizon maaşını almış.
 */
const good = (overrides: Partial<VoiceSignals> = {}): VoiceSignals => ({
  servedFood: 100,
  livingCost: 1,
  taxRate: 15,
  popularity: 65,
  population: 120,
  capacity: 230,
  soldierUnrest: 0,
  army: 20,
  buildings: [
    { type: "keep", level: 1 },
    { type: "town_square", level: 1 },
  ],
  ...overrides,
});

const kinds = (signals: VoiceSignals) => derivePopulaceDemands(signals).map(demand => demand.kind);

// --- Katalog ve eşikler ----------------------------------------------------

test("iyi yönetilen krallıkta halkın hiçbir talebi açılmaz", () => {
  assert.deepEqual(derivePopulaceDemands(good()), []);
});

test("rıza 62-67 bandının tamamında talep açılmaz", () => {
  for (let mood = 62; mood <= 67; mood += 1) {
    assert.deepEqual(kinds(good({ popularity: mood })), [], `rıza ${mood}`);
  }
});

test("istihkak eşiğin altına inince ekmek talebi doğar", () => {
  const demand = derivePopulaceDemands(good({ servedFood: 70 })).find(item => item.kind === "bread");
  assert.ok(demand);
  assert.equal(demand.voice, "commons");
  assert.equal(demand.severity, "normal");
  assert.equal(demand.minGameHours, VOICE_THRESHOLDS.bread.hours);
  assert.match(demand.text, /%70/);
});

test("eşiğin tam üstünde talep açılmaz, tam altında açılır", () => {
  assert.ok(!kinds(good({ servedFood: VOICE_THRESHOLDS.bread.ration })).includes("bread"));
  assert.ok(kinds(good({ servedFood: VOICE_THRESHOLDS.bread.ration - 1 })).includes("bread"));
});

test("aç halk şenlik istemez: joy talebi istihkak eşiğine bağlıdır", () => {
  // Değirmen dersi: karnı aç halka şenlik boş masraftır, talep hiç açılmaz.
  assert.ok(!kinds(good({ popularity: 20, servedFood: 50 })).includes("joy"));
  assert.ok(kinds(good({ popularity: 20, servedFood: 95 })).includes("joy"));
});

test("kapasite tavana dayanmışsa konut talebi açılmaz", () => {
  const full = { population: 100, capacity: 100 };
  assert.ok(kinds(good({ ...full })).includes("roof"));
  // Meydan ve Kale tavanda: halkın istediği şey yapılamaz, istemesi de anlamsız.
  assert.ok(!kinds(good({
    ...full,
    buildings: [{ type: "keep", level: 6 }, { type: "town_square", level: 6 }],
  })).includes("roof"));
});

test("vergi talebi hem orana hem rızaya bağlıdır", () => {
  assert.ok(!kinds(good({ taxRate: 35 })).includes("tax"), "rıza yüksekse yüksek vergiye ses çıkmaz");
  assert.ok(kinds(good({ taxRate: 35, popularity: 30 })).includes("tax"));
});

test("geçim endeksi eşiği aşınca fiyat talebi doğar", () => {
  assert.ok(!kinds(good({ livingCost: VOICE_THRESHOLDS.price.index })).includes("price"));
  assert.ok(kinds(good({ livingCost: 1.6 })).includes("price"));
});

test("askeri olmayan krallıkta maaş talebi doğmaz", () => {
  assert.ok(!kinds(good({ army: 0, soldierUnrest: 90 })).includes("wage"));
  assert.ok(kinds(good({ army: 10, soldierUnrest: 40 })).includes("wage"));
});

test("maaş talebinin sesi garnizondur, halk değil", () => {
  const demand = derivePopulaceDemands(good({ soldierUnrest: 40 })).find(item => item.kind === "wage");
  assert.equal(demand?.voice, "garrison");
});

// --- Spam frenleri ---------------------------------------------------------

test("süre şartı dolmadan talep açılmaz", () => {
  const candidates = derivePopulaceDemands(good({ servedFood: 70 }));
  assert.deepEqual(openDemands(candidates, { bread: 3.9 }), []);
  assert.equal(openDemands(candidates, { bread: 4 }).length, 1);
});

test("aynı anda en fazla iki talep açık kalır", () => {
  const candidates = derivePopulaceDemands(good({
    servedFood: 40, livingCost: 2.2, taxRate: 40, popularity: 20,
    population: 100, capacity: 100, soldierUnrest: 90,
  }));
  assert.ok(candidates.length > MAX_OPEN_DEMANDS, "beş kalem birden eşiği aşmalı");
  const open = openDemands(candidates, { bread: 99, price: 99, tax: 99, roof: 99, joy: 99, wage: 99 });
  assert.equal(open.length, MAX_OPEN_DEMANDS);
  // Tavan en acil talepleri keser değil korur.
  assert.ok(open.every(demand => demand.severity === "urgent"));
});

test("bildirim aralığı sabiti tek yerde durur", () => {
  assert.equal(DEMAND_NOTICE_HOURS, 6);
});

// --- Kapatma ve gösterim ---------------------------------------------------

test("istihkak emri ekmek talebini kapatır, vergi emri kapatmaz", () => {
  const open = derivePopulaceDemands(good({ servedFood: 70 }));
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "set_food_ration", arguments: { percent: 100 } }]), ["bread"]);
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "set_tax_rate", arguments: { rate_percent: 10 } }]), []);
});

test("yanlış yapı emri konut talebini kapatmaz", () => {
  const open = derivePopulaceDemands(good({ population: 100, capacity: 100 })).filter(d => d.kind === "roof");
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "build_structure", arguments: { building_type: "quarry" } }]), []);
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "build_structure", arguments: { building_type: "town_square" } }]), ["roof"]);
});

test("gösterim sesi ayırır ve acil talebi işaretler", () => {
  const text = renderDemands([
    { text: "Ekmek yok.", severity: "urgent", voice: "commons" },
    { text: "Maaş yok.", severity: "normal", voice: "garrison" },
  ]);
  assert.equal(text, "- [ACİL] Halk: Ekmek yok.\n- Garnizon: Maaş yok.");
  assert.equal(renderDemands([]), "");
});

// --- Garnizon vetosu -------------------------------------------------------

test("veto eşikleri motorun asker eşikleriyle aynı yerden gelir", () => {
  assert.deepEqual(garrisonVetoes(0, 20), []);
  assert.deepEqual(garrisonVetoes(SOLDIER_THRESHOLDS.demand, 20), ["train_unit"]);
  assert.deepEqual(garrisonVetoes(SOLDIER_THRESHOLDS.desertion, 20), ["train_unit", "raise_watch"]);
  assert.deepEqual(garrisonVetoes(SOLDIER_THRESHOLDS.mutiny, 20), ["train_unit", "raise_watch", "set_soldier_pay"]);
});

test("askeri olmayan krallıkta veto yoktur", () => {
  assert.deepEqual(garrisonVetoes(100, 0), []);
  assert.equal(garrisonRefusal("train_unit", 100, 0), null);
  assert.equal(garrisonMood(100, 0).id, "absent");
});

test("garnizonun hâli eşiklere göre isimlendirilir", () => {
  assert.equal(garrisonMood(0, 20).id, "steady");
  assert.equal(garrisonMood(30, 20).id, "demanding");
  assert.equal(garrisonMood(60, 20).id, "deserting");
  assert.equal(garrisonMood(85, 20).id, "mutinous");
});

// --- Vetonun motordaki karşılığı ------------------------------------------

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 200, capacity: 300, popularity: 60, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
      { type: "barracks", name: "Kışla", category: "Askeri", level: 1 },
      // Yiyecek üretimi artıda olsun: aksi hâlde eğitim emri veto yüzünden değil
      // yiyecek krizi yüzünden geri çevrilir ve test yanlış şeyi ölçer.
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 3 },
    ],
    units: { spearman: 20 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    watchRatio: 50, soldierPay: 0,
    ...overrides,
  };
}

const lines = (game: Game, name: string, args: Record<string, unknown>) =>
  applyActions(game, [{ name, arguments: args }], T0).results;

test("huzursuzluk 30'da eğitim emri reddedilir", () => {
  const refused = lines(newGame({ soldierUnrest: 30 }), "train_unit", { unit_type: "spearman", count: 5 });
  assert.match(refused[0], /^✕/);
  assert.match(refused[0], /yeni asker almayı reddetti/);
  // Eşiğin bir puan altında emir yürür.
  assert.match(lines(newGame({ soldierUnrest: 29 }), "train_unit", { unit_type: "spearman", count: 5 })[0], /^✓/);
});

test("Kralın teyidi garnizon vetosunu AŞMAZ", () => {
  const refused = lines(newGame({ soldierUnrest: 40 }), "train_unit", { unit_type: "spearman", count: 5, confirmed_risk: true });
  assert.match(refused[0], /^✕/);
});

test("huzursuzluk 60'ta nöbet yükseltilemez ama indirilebilir", () => {
  const game = newGame({ soldierUnrest: 60, watchRatio: 50 });
  assert.match(lines(game, "set_watch_ratio", { percent: 70 })[0], /^✕/);
  assert.match(lines(game, "set_watch_ratio", { percent: 70 })[0], /nöbeti uzatmayı reddetti/);
  assert.match(lines(game, "set_watch_ratio", { percent: 40 })[0], /^✓/);
});

test("huzursuzluk 85'te asker maaşı da değiştirilemez — Kral çıkışsız kalabilir", () => {
  const game = newGame({ soldierUnrest: 85 });
  const refused = lines(game, "set_soldier_pay", { percent: 100 });
  assert.match(refused[0], /^✕/);
  assert.match(refused[0], /isyan hâlinde/);
  // 84'te maaş hâlâ yürür: kilit tam eşikte kapanır.
  assert.match(lines(newGame({ soldierUnrest: 84 }), "set_soldier_pay", { percent: 100 })[0], /^✓/);
});

test("veto yalnızca ilgili emirleri kapatır; istihkak ve vergi serbest kalır", () => {
  const game = newGame({ soldierUnrest: 95 });
  assert.match(lines(game, "set_food_ration", { percent: 100 })[0], /^✓/);
  assert.match(lines(game, "set_tax_rate", { rate_percent: 10 })[0], /^✓/);
});

// --- Sıfır ek model çağrısı ------------------------------------------------

test("halkın sesi hiçbir yeni model çağrısı açmaz", () => {
  // Mekaniğin taşıyıcı ilkesi: motor karar verir (bedava), model yalnızca ses
  // verir ve o ses Kralın ZATEN başlattığı turun promptuna biner. Bu yüzden yeni
  // kod yollarının hiçbiri sağlayıcıya gitmemeli; kaynak dosya bunu kanıtlar.
  const files = ["engine/populace-voice.ts", "server/populace-voice.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["fetch(", "callProvider", "decryptByok", "api.openai.com", "api.anthropic.com"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});
