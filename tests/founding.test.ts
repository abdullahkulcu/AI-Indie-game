import assert from "node:assert/strict";
import test from "node:test";
import { applyActions } from "../engine/actions";
import { MAX_BUILDING_LEVEL, catalog, materialScaleOf } from "../engine/catalog";
import {
  PROTECTION_DAYS, STARTING_BUILDINGS, STARTING_POPULATION, STARTING_RESOURCES_BASE,
  foundKingdom, startingResources,
} from "../engine/founding";
import { affordable, buildOptions, capacityFor, keep, keepCostFor } from "../engine/tick";
import type { Game, Key } from "../engine/types";
import { CAPS, startingState, validateGameSave } from "../server/save-validation";

const NOW = 1_800_000_000_000;
const SPEEDS = [1, 4, 24];

const newKingdom = (speed: number, terrain: Game["terrain"] = "plain") =>
  foundKingdom({
    kingdomName: "Demirkale", rulerName: "Alaric",
    channel: "Standart Sezon I", channelId: "standard", speed, terrain,
  }, NOW);

/**
 * Kralın çekirdeği: kuruluşun ilk emri bunlardan HERHANGİ BİRİ olabilmeli.
 * Hepsi aynı anda değil — Kral zaten istemedi; her biri ayrı ayrı verilebilsin.
 */
const CORE = [
  { type: "granary", label: "Ambar" },
  { type: "warehouse", label: "Depo" },
  { type: "quarry", label: "Taş Ocağı" },
  { type: "apple_orchard", label: "Elma Bahçesi" },
  { type: "wheat_farm", label: "Buğday Tarlası Sv.2" },
  { type: "lumberjack", label: "Oduncu Kulübesi Sv.2" },
];

/** General'in açık teyit eşiği (`engine/actions.ts` majorSpend) ile birebir aynı kural. */
const majorSpend = (cost: Partial<Record<Key, number>>, resources: Game["resources"]) =>
  Object.entries(cost).some(([key, value]) => (value ?? 0) > Math.max(1, resources[key as Key]) * .65);

test("hız 1'de kuruluş bit bit eskisi gibi kalır", () => {
  // Çarpan orada zaten 1; hâlihazırda oynayan kayıtların dünyası değişmemeli.
  assert.deepEqual(startingResources(1), STARTING_RESOURCES_BASE);
  const game = newKingdom(1);
  assert.deepEqual(game.resources, { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 });
  assert.equal(game.population, 100);
  assert.equal(game.capacity, 150);
  assert.equal(game.protectionEndsAt, NOW + 4 * 86_400_000);
});

test("başlangıç stoğunda yalnızca malzeme channel hızıyla ölçeklenir", () => {
  for (const speed of SPEEDS) {
    const resources = startingResources(speed);
    const scale = materialScaleOf(speed);
    // Maliyet tarafında da yalnızca bunlar çarpılıyor; simetri budur.
    assert.equal(resources.wood, STARTING_RESOURCES_BASE.wood * scale, `hız ${speed} odun`);
    assert.equal(resources.stone, STARTING_RESOURCES_BASE.stone * scale, `hız ${speed} taş`);
    assert.equal(resources.iron, STARTING_RESOURCES_BASE.iron * scale, `hız ${speed} demir`);
    // Altın, yiyecek ve bira maliyet tarafında çarpılmıyor; burada da çarpılmaz.
    assert.equal(resources.gold, STARTING_RESOURCES_BASE.gold, `hız ${speed} altın`);
    assert.equal(resources.food, STARTING_RESOURCES_BASE.food, `hız ${speed} yiyecek`);
    assert.equal(resources.ale, STARTING_RESOURCES_BASE.ale, `hız ${speed} bira`);
  }
});

test("üç hızda da çekirdek binalar kuruluşun ilk emri olarak karşılanabilir", () => {
  for (const speed of SPEEDS) {
    const game = newKingdom(speed);
    for (const core of CORE) {
      const option = buildOptions(game).find(item => item.type === core.type);
      assert.ok(option, `hız ${speed}: ${core.label} seçenek listesinde yok`);
      assert.ok(affordable(game.resources, option.cost),
        `hız ${speed}: ${core.label} kuruluşta karşılanamıyor — ${JSON.stringify(option.cost)} / ${JSON.stringify(game.resources)}`);
    }
  }
});

test("üç hızda da çekirdek emirler General'den açık teyit istemez", () => {
  // Aksi hâlde Kral "bina kur" der, General "emin misin?" diye sorar ve oyunun
  // ilk dakikası yine takılır. Şart: çekirdeğin en çok yarısı teyit istesin.
  for (const speed of SPEEDS) {
    const game = newKingdom(speed);
    let asking = 0;
    for (const core of CORE) {
      const option = buildOptions(game).find(item => item.type === core.type)!;
      if (majorSpend(option.cost, game.resources)) asking++;
      // Uçtan uca: emir gerçekten uygulanıyor mu? (confirmed_risk verilmeden)
      const applied = applyActions(game, [{
        name: "build_structure",
        arguments: { building_type: core.type, target_level: option.nextLevel },
      }], NOW);
      assert.ok(applied.results[0]?.startsWith("✓"),
        `hız ${speed}: ${core.label} emri uygulanmadı — ${applied.results[0]}`);
    }
    assert.ok(asking * 2 <= CORE.length,
      `hız ${speed}: çekirdeğin ${asking}/${CORE.length} binası teyit istiyor`);
  }
});

test("Kale Sv.2 üç hızda da kuruluşta karşılanamaz", () => {
  // Kale maliyeti de malzeme çarpanını yer. Yemeseydi hız 24'te 7.200 taşla
  // 400 taşlık yükseltme ilk dakikada alınır, tier-2 binalar (Pazar, Bira Evi)
  // sezonun ilk dakikasında açılırdı.
  for (const speed of SPEEDS) {
    const game = newKingdom(speed);
    const option = buildOptions(game).find(item => item.type === "keep")!;
    assert.deepEqual(option.cost, keepCostFor(1, materialScaleOf(speed)));
    assert.equal(affordable(game.resources, option.cost), false,
      `hız ${speed}: Kale Sv.2 kuruluşta karşılanabiliyor — ${JSON.stringify(option.cost)}`);
    assert.equal(option.cost.gold, 300, "Kale altını çarpanla büyümez");
  }
});

test("üç hızda da kuruluş kaydı buluta kabul edilir", () => {
  for (const speed of SPEEDS) {
    const game = newKingdom(speed);
    // Tel üzerinden gittiği hâliyle: JSON'a çevrilip geri okunur.
    const payload = JSON.parse(JSON.stringify(game));
    const accepted = validateGameSave(payload, {
      previous: null, previousUpdatedAt: null, channelSpeed: speed,
      channelName: game.channel, now: NOW,
    });
    assert.equal(accepted.ok, true,
      `hız ${speed}: kuruluş kaydı reddedildi — ${accepted.ok ? "" : accepted.error}`);

    // Yarış hâli: `found()` channel üyeliğini yazan isteği beklemiyor, ilk PUT
    // üyelik satırından önce gelebiliyor ve o an sunucu channel hızını 1 görüyor.
    // Kuruluş kaydı bu yüzden reddedilmemeli.
    const raced = validateGameSave(payload, {
      previous: null, previousUpdatedAt: null, channelSpeed: 1, channelName: null, now: NOW,
    });
    assert.equal(raced.ok, true,
      `hız ${speed}: channel üyeliği yazılmadan gelen kuruluş kaydı reddedildi — ${raced.ok ? "" : raced.error}`);
  }
});

test("ilk kayıt tavanı hâlâ ısırır", () => {
  const game = newKingdom(24);
  const cheating = JSON.parse(JSON.stringify(game));
  cheating.resources.wood = startingResources(24).wood + 50_000;
  const result = validateGameSave(cheating, {
    previous: null, previousUpdatedAt: null, channelSpeed: 24, channelName: game.channel, now: NOW,
  });
  assert.equal(result.ok, false);
});

test("kuruluş durumu tek kaynaktan gelir", () => {
  // `STARTING_STATE` üç ayrı yerde elle yazılınca sessizce sapıyordu; bu proje
  // aynı hatayı dokuz kez yaşadı.
  for (const speed of SPEEDS) {
    const state = startingState(speed);
    const game = newKingdom(speed);
    assert.deepEqual(state.resources, game.resources);
    assert.deepEqual(state.resources, startingResources(speed));
    assert.equal(state.population, STARTING_POPULATION);
    assert.equal(state.population, game.population);
    assert.equal(state.buildings, STARTING_BUILDINGS.length);
    assert.equal(state.buildings, game.buildings.length);
    assert.equal(state.protectionDays, PROTECTION_DAYS);
    assert.equal(game.protectionEndsAt - game.foundedAt, PROTECTION_DAYS * 86_400_000);
  }
  // Kapasite de elle "150" değil, motorun formülünden gelir.
  assert.equal(newKingdom(1).capacity, capacityFor([...STARTING_BUILDINGS]));
  // Kayıt şemasının bina tavanı motorun tavanından türer.
  assert.equal(CAPS.buildingLevel, MAX_BUILDING_LEVEL);
});

test("foundKingdom saftır: aynı now ile iki çağrı birebir aynı sonucu verir", () => {
  for (const terrain of ["plain", "forest", "mountain", "riverbank"] as const) {
    const first = newKingdom(4, terrain);
    const second = newKingdom(4, terrain);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  }
  // `now` dışarıdan gelir; motor saat okumaz.
  const later = foundKingdom({
    kingdomName: "Demirkale", rulerName: "Alaric",
    channel: "Standart Sezon I", channelId: "standard", speed: 4, terrain: "plain",
  }, NOW + 1_000);
  assert.equal(later.foundedAt, NOW + 1_000);
  assert.equal(later.lastTickAt, NOW + 1_000);
});

test("buildOptions seviye tavanının üstünü önermez", () => {
  // Tavan yokken Sv.6'daki binaya Sv.7 öneriliyordu; kayıt şeması `level` > 6
  // olan kaydın TAMAMINI reddediyor ve Kralın ilerlemesi sessizce kayboluyordu.
  const game = newKingdom(1);
  const maxed: Game = {
    ...game,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 3 },
      { type: "granary", name: "Ambar", category: "Ekonomi", level: MAX_BUILDING_LEVEL },
      { type: "warehouse", name: "Depo", category: "Ekonomi", level: MAX_BUILDING_LEVEL - 1 },
    ],
    resources: { gold: 5_000_000, food: 500, stone: 5_000_000, wood: 5_000_000, iron: 5_000_000, ale: 0 },
  };
  const options = buildOptions(maxed);
  assert.equal(options.find(option => option.type === "granary"), undefined, "tavandaki Ambar listede kalmamalı");
  assert.equal(options.find(option => option.type === "warehouse")?.nextLevel, MAX_BUILDING_LEVEL);
  for (const option of options) {
    assert.ok(option.nextLevel <= MAX_BUILDING_LEVEL, `${option.type} Sv.${option.nextLevel} öneriliyor`);
  }
  // Katalogdaki her bina için tavan gerçekten uygulanıyor mu?
  for (const item of catalog) {
    const full: Game = {
      ...maxed,
      buildings: [
        { type: "keep", name: "Kale", category: "Yönetim", level: 6 },
        { type: item.type, name: item.name, category: item.category, level: MAX_BUILDING_LEVEL },
      ],
    };
    assert.equal(buildOptions(full).find(option => option.type === item.type), undefined,
      `${item.name} tavandayken hâlâ öneriliyor`);
  }
});

test("tavan üstü inşa emri reddedilir", () => {
  const game = newKingdom(1);
  const maxed: Game = {
    ...game,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 3 },
      { type: "granary", name: "Ambar", category: "Ekonomi", level: MAX_BUILDING_LEVEL },
    ],
    resources: { gold: 5_000_000, food: 5_000, stone: 5_000_000, wood: 5_000_000, iron: 5_000_000, ale: 0 },
  };
  const rejected = applyActions(maxed, [{
    name: "build_structure",
    arguments: { building_type: "granary", target_level: MAX_BUILDING_LEVEL + 1, confirmed_risk: true },
  }], NOW);
  assert.ok(rejected.results[0]?.startsWith("✕"), rejected.results[0]);
  assert.match(rejected.results[0], /tavan/i);
  assert.equal(rejected.game.queue, null);
  assert.equal(keep(rejected.game), 3);
});
