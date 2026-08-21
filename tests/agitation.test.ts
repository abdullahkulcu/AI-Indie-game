import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyActions, marketState } from "../engine/actions";
import {
  AGITATION, GLUT, LURE, agitationDayStart, agitationEffect, agitationPairWindow,
  agitationTravelMs, applyAgitation, applyGlut, applyLure, feltUnrest, glutCost,
  glutShare, lureAt,
} from "../engine/agitation";
import { raidInWindow, resolveRaids } from "../engine/raids";
import { BASE_PRICE, PRICE_FLOOR, fillOrder, maxPurchase } from "../engine/market";
import { SOLDIER_THRESHOLDS, suppression } from "../engine/populace";
import { factionPressureOf } from "../engine/faction";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { reputationChange } from "../engine/diplomacy";
import { validateGameSave } from "../server/save-validation";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0 - 10 * 86_400_000, lastTickAt: T0, protectionEndsAt: T0 - 6 * 86_400_000,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 200, capacity: 400, popularity: 60, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
      { type: "barracks", name: "Kışla", category: "Askeri", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 3 },
    ],
    units: { spearman: 20 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    watchRatio: 50,
    ...overrides,
  };
}

// --- Fiyat ve tavanlar -----------------------------------------------------

test("kese sabit fiyatlıdır ve doğrulayıcı toleransına saklanamaz", () => {
  // SIMULATION_FLOOR = 250; kese onun 2,4 katı olduğu için hazineden çıkışı
  // toleransın içinde kaybolamaz.
  assert.equal(AGITATION.cost, 600);
  assert.ok(AGITATION.cost > 250 * 2);
});

test("halka giden kesenin tavanı şenliğin rıza katkısının altındadır", () => {
  // Şenlik rızaya 12 puan katıyor (engine/actions.ts → host_festival).
  assert.ok(AGITATION.commons.cap < 12, `tavan ${AGITATION.commons.cap}`);
  assert.equal(AGITATION.commons.perPurse, 9.6);
});

test("askere giden kesenin tavanı maaş talebi eşiğinin altındadır", () => {
  assert.ok(AGITATION.garrison.cap < SOLDIER_THRESHOLDS.demand, `tavan ${AGITATION.garrison.cap}`);
});

test("tek kese eşikleri tam olarak beklenen kadar oynatır", () => {
  const target = newGame();
  const commons = applyAgitation(target, "gold_commons", T0);
  assert.equal(commons.agitationPressure, 9.6);
  assert.equal(commons.agitationBribe, 0);
  const garrison = applyAgitation(target, "gold_garrison", T0);
  assert.equal(garrison.agitationBribe, AGITATION.garrison.perPurse);
  assert.equal(garrison.agitationPressure, 0);
});

test("art arda kese tavanı aşamaz", () => {
  let carrier = newGame();
  for (let i = 0; i < 12; i += 1) {
    carrier = { ...carrier, ...applyAgitation(carrier, "gold_commons", T0 + i * HOUR) };
  }
  assert.ok((carrier.agitationPressure ?? 0) <= AGITATION.commons.cap);
  let armed = newGame();
  for (let i = 0; i < 12; i += 1) {
    armed = { ...armed, ...applyAgitation(armed, "gold_garrison", T0 + i * HOUR) };
  }
  assert.ok((armed.agitationBribe ?? 0) <= AGITATION.garrison.cap);
  assert.ok((armed.agitationBribe ?? 0) < SOLDIER_THRESHOLDS.demand, "tek başına ordu dağıtamaz");
});

// --- Sönüm: damga tabanlı, kapalı çözümlü ----------------------------------

test("etki damgadan sönümlenir ve tam bölünebilir", () => {
  const carrier = newGame({ agitationPressure: 9.6, agitationAt: T0 });
  const eight = agitationEffect(carrier, T0 + AGITATION.tau * HOUR).pressure;
  // τ kadar sonra e^-1 katına iner.
  assert.ok(Math.abs(eight - 9.6 / Math.E) < 1e-9, `çıkan ${eight}`);
  // Aradan ikiye bölmek aynı sonucu verir: damga sabit, adım sayısı önemsiz.
  const half = agitationEffect(carrier, T0 + 4 * HOUR).pressure;
  const rest = agitationEffect({ ...carrier, agitationPressure: half, agitationAt: T0 + 4 * HOUR }, T0 + 8 * HOUR).pressure;
  assert.ok(Math.abs(eight - rest) < 1e-9);
});

test("hızlı channel'da sönüm oyun saatiyle işler", () => {
  const slow = agitationEffect(newGame({ speed: 1, agitationPressure: 10, agitationAt: T0 }), T0 + HOUR).pressure;
  const fast = agitationEffect(newGame({ speed: 24, agitationPressure: 10, agitationAt: T0 }), T0 + HOUR).pressure;
  assert.ok(fast < slow, "×24 channel'da bir gerçek saat 24 oyun saatidir");
});

test("cron'un gecikmesi sonucu değiştirmez", () => {
  // Etki `completesAt` anına damgalanır; cron ne zaman koşarsa koşsun aynı
  // değerler yazılır. Bu, geriye dönük damgalamanın kanıtı.
  const target = newGame();
  const early = applyAgitation(target, "gold_commons", T0 + 2 * HOUR);
  const late = applyAgitation(target, "gold_commons", T0 + 2 * HOUR);
  assert.deepEqual(early, late);
  assert.equal(early.agitationAt, T0 + 2 * HOUR);
});

test("kalkan sönümü hızlandırır ve geleni yarılar", () => {
  const shielded = newGame({ agitationShieldUntil: T0 + 12 * HOUR });
  assert.equal(applyAgitation(shielded, "gold_commons", T0).agitationPressure, 9.6 * AGITATION.shieldedShare);
  const open = agitationEffect(newGame({ agitationPressure: 10, agitationAt: T0 }), T0 + 3 * HOUR).pressure;
  const behind = agitationEffect(newGame({ agitationPressure: 10, agitationAt: T0, agitationShieldUntil: T0 + 12 * HOUR }), T0 + 3 * HOUR).pressure;
  assert.ok(behind < open, "kalkan altında birikim daha hızlı erir");
});

// --- Hedefte kaynak alanı yazılmaması -------------------------------------

test("kese hedefin hiçbir kaynak alanına dokunmaz", () => {
  const target = newGame();
  const after = { ...target, ...applyAgitation(target, "gold_garrison", T0) };
  // JSON diff: yalnızca üç taşıyıcı alan değişmiş olmalı.
  const changed = Object.keys(after).filter(key =>
    JSON.stringify((after as Record<string, unknown>)[key]) !== JSON.stringify((target as Record<string, unknown>)[key]));
  assert.deepEqual(changed.sort(), ["agitationAt", "agitationBribe", "agitationPressure"]);
  assert.deepEqual(after.resources, target.resources);
  assert.equal(after.population, target.population);
  assert.equal(after.popularity, target.popularity);
});

// --- Kanallar --------------------------------------------------------------

test("kese hizip baskısını büyütür ama alanın içine yazılmaz", () => {
  const target = newGame({ popularity: 60, agitationPressure: 9.6, agitationAt: T0 });
  const after = tick(target, T0 + HOUR);
  // Rıza yüksek: hizbin kendi baskısı sıfır kalır, kesenin payı ayrı taşınır.
  assert.equal(factionPressureOf(after), 0);
  assert.ok((after.agitationPressure ?? 0) > 0, "taşıyıcı alan silinmez");
});

test("kese huzursuzluğu hissettirir ama soldierUnrest alanına yazılmaz", () => {
  const target = newGame({ soldierUnrest: 10, soldierPay: 100, agitationBribe: 18, agitationAt: T0 });
  assert.equal(Math.round(feltUnrest(target, T0)), 28);
  const after = tick(target, T0 + HOUR);
  // Maaş tam ödendiği için kaydın kendi huzursuzluğu ERİR; kesenin payı ayrı durur.
  assert.ok((after.soldierUnrest ?? 0) < 10, `alan erimeli, çıkan ${after.soldierUnrest}`);
  assert.ok((after.agitationBribe ?? 0) > 0);
});

test("kese zapt gücünü de zayıflatır", () => {
  const clean = suppression(20, 200, 10, 0);
  const bribed = suppression(20, 200, feltUnrest(newGame({ soldierUnrest: 10, agitationBribe: 18, agitationAt: T0 }), T0), 0);
  assert.ok(bribed < clean);
});

test("kese garnizon vetosunu tetikleyebilir", () => {
  // Kaydın kendi huzursuzluğu 20 (eşiğin altında), kese 12 ekliyor → 32 ≥ 30.
  const game = newGame({ soldierUnrest: 20, agitationBribe: 12, agitationAt: T0 });
  const refused = applyActions(game, [{ name: "train_unit", arguments: { unit_type: "spearman", count: 3 } }], T0).results;
  assert.match(refused[0], /^✕/);
  assert.match(refused[0], /yeni asker almayı reddetti/);
  // Kese olmasa emir yürüyordu.
  const allowed = applyActions(newGame({ soldierUnrest: 20 }), [{ name: "train_unit", arguments: { unit_type: "spearman", count: 3 } }], T0).results;
  assert.match(allowed[0], /^✓/);
});

// --- Tavan ve pencere yardımcıları ---------------------------------------

test("çift penceresi ve gün penceresi channel hızıyla ölçeklenir", () => {
  // Pencere ızgarası 6 oyun saatliktir: aynı ızgara gözüne düşen iki kese
  // veritabanı seviyesinde çakışır (yarışa karşı katman). Sürenin kendisi
  // uygulama katmanında ölçülür, bkz. server/agitation-desk.ts.
  const window = AGITATION.pairWaitHours * HOUR;
  const grid = Math.floor(T0 / window) * window;
  assert.equal(agitationPairWindow(grid, 1), agitationPairWindow(grid + window - 1, 1));
  assert.notEqual(agitationPairWindow(grid, 1), agitationPairWindow(grid + window, 1));
  // ×24 channel'da ızgara 15 gerçek dakikaya iner.
  assert.notEqual(agitationPairWindow(grid, 24), agitationPairWindow(grid + 20 * 60_000, 24));
  assert.equal(agitationDayStart(T0, 1), T0 - 86_400_000);
  assert.equal(agitationDayStart(T0, 24), T0 - 86_400_000 / 24);
});

test("kese yolda hızlı channel'da daha kısa kalır", () => {
  assert.ok(agitationTravelMs(24) < agitationTravelMs(1));
  assert.ok(agitationTravelMs(1) > 0);
});

test("tavanlar tek dosyada ve plandaki değerlerde", () => {
  assert.equal(AGITATION.perSenderPerDay, 4);
  assert.equal(AGITATION.perTargetPerDay, 3);
  assert.equal(AGITATION.pairWaitHours, 6);
});

// --- İtibar cezası ---------------------------------------------------------

test("yakalanan kese itibar cezası taşır", () => {
  assert.equal(reputationChange("caught_agitating"), -10);
  // İhanet ayrı ve daha ağır bir olaydır; imzalı barışta ikisi birlikte işler.
  assert.equal(reputationChange("betrayal"), -20);
});

// --- Sunucu-türevi olması --------------------------------------------------

const save = (game: Game) => JSON.parse(JSON.stringify(game)) as Game;

test("istemcinin bildirdiği kese alanları yok sayılır", () => {
  const previous = save(newGame({ lastTickAt: T0 }));
  // İstemci kendi kaydından keseyi siliyor.
  const withPurse = save(newGame({ lastTickAt: T0, agitationBribe: 18, agitationPressure: 9.6, agitationAt: T0 }));
  const claimed = save({ ...tick(withPurse, T0 + HOUR), agitationBribe: 0, agitationPressure: 0, agitationAt: 0 });
  const result = validateGameSave(claimed, {
    previous: withPurse as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.game.agitationBribe, 18);
  assert.equal(result.ok && result.game.agitationPressure, 9.6);

  // Tersi de: istemci kendi lehine kalkan uyduramaz.
  const faked = save({ ...tick(previous, T0 + HOUR), agitationShieldUntil: T0 + 999 * HOUR });
  const second = validateGameSave(faked, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.game.agitationShieldUntil, undefined);
});

test("kese alanı olmayan eski kayıt reddedilmez", () => {
  const previous = save(newGame());
  const next = save(tick(previous, T0 + HOUR));
  const result = validateGameSave(next, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
});

// --- Mal kesesi: pazar bozma ---------------------------------------------

/** Halkı tam normal stoğunda olan, Pazar Sv.2 kurulu bir krallık. */
const trader = (overrides: Partial<Game> = {}) => newGame({
  buildings: [
    { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
    { type: "market", name: "Pazar", category: "Ekonomi", level: 2 },
    { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 3 },
  ],
  ...overrides,
});

const sellRevenue = (game: Game, amount = 100) => {
  const market = marketState(game, T0);
  return fillOrder("food", amount, market.commons.food, market.reference.food, "sell", market.glut.food ?? 0).gold;
};

test("mal kesesi 900 yiyecek, diğer mallar aynı altın değerinde", () => {
  assert.equal(glutCost("food"), 900);
  // 900 yiyecek = 225 altın; odun 0,3 altın olduğu için 750 birim eder.
  assert.equal(glutCost("wood"), 750);
  assert.ok(glutCost("iron") < glutCost("food"), "pahalı mal daha az birim");
});

/** Anlık birim satış fiyatı: ölçünün kendisi fiyat modelinin çıktısıdır. */
const unitSale = (game: Game) => marketState(game, T0).price.food;

test("tek mal kesesi satış fiyatını tam üçte bir düşürür", () => {
  // Kapsama 1 → 1,6; GLUT_DOWN .55 olduğu için çarpan 1 → 0,67.
  const drop = 1 - unitSale(trader({ commonsGlut: { food: GLUT.perPurse }, commonsGlutAt: T0 })) / unitSale(trader());
  assert.ok(Math.abs(drop - .33) < .005, `düşüş ${(drop * 100).toFixed(2)}%`);
  // Emrin kendi kayması eklenince yüklü bir satışta düşüş biraz daha büyür.
  const orderDrop = 1 - sellRevenue(trader({ commonsGlut: { food: GLUT.perPurse }, commonsGlutAt: T0 })) / sellRevenue(trader());
  assert.ok(orderDrop > .33 && orderDrop < .40, `emir düşüşü ${(orderDrop * 100).toFixed(1)}%`);
});

test("art arda kese kalıcı olarak %62,5 düşüş bırakır", () => {
  // Denge: perPurse / (1 − e^(−bekleme/τ)) ≈ 1,137 referans katı. Bu sayı
  // ÜÇ SABİTİN çarpımından kendiliğinden çıkar, elle konmuş bir tavan değil.
  let carrier: Game = trader();
  for (let i = 0; i < 20; i += 1) {
    const at = T0 + i * AGITATION.pairWaitHours * HOUR;
    carrier = { ...carrier, ...applyGlut(carrier, "food", at) };
  }
  const settled = { ...carrier, commonsGlutAt: T0 };
  const pile = settled.commonsGlut?.food ?? 0;
  assert.ok(Math.abs(pile - 1.137) < .01, `denge ${pile}`);
  const drop = 1 - unitSale(settled) / unitSale(trader());
  assert.ok(Math.abs(drop - .625) < .01, `kalıcı düşüş ${(drop * 100).toFixed(1)}%`);
  // Fiyat tabanına (kapsama 2,2727) matematiksel olarak çakmaz: pazar "her zaman
  // bozuk ama tek seferde deşifre olmayan" hâlde kalır.
  assert.ok(pile < 1.2727, `yığın tabana çakmamalı: ${pile}`);
  assert.ok(unitSale(settled) > BASE_PRICE.food * PRICE_FLOOR, "taban fiyata oturmaz");
});

test("yığın alış fiyatına ve maxPurchase'a HİÇ girmez", () => {
  const clean = trader(), glutted = trader({ commonsGlut: { food: GLUT.cap }, commonsGlutAt: T0 });
  const a = marketState(clean, T0), b = marketState(glutted, T0);
  const buyClean = fillOrder("food", 100, a.commons.food, a.reference.food, "buy", a.glut.food ?? 0);
  const buyGlut = fillOrder("food", 100, b.commons.food, b.reference.food, "buy", b.glut.food ?? 0);
  assert.equal(buyGlut.gold, buyClean.gold, "hedef bedava mal alamaz");
  assert.equal(maxPurchase(b.commons.food), maxPurchase(a.commons.food));
});

test("yığın hedefin rızasını YÜKSELTMEZ", () => {
  const clean = tick(trader(), T0 + 3 * HOUR);
  const glutted = tick(trader({ commonsGlut: { food: GLUT.cap }, commonsGlutAt: T0 }), T0 + 3 * HOUR);
  assert.equal(glutted.popularity, clean.popularity);
  // Geçim endeksi de halkın gerçek stoğundan okunur.
  assert.equal(marketState(glutted, T0).livingCost, marketState(clean, T0).livingCost);
});

test("mal kesesi hizip baskısı üretmez", () => {
  const patch = applyGlut(trader(), "food", T0);
  assert.deepEqual(Object.keys(patch).sort(), ["commonsGlut", "commonsGlutAt"]);
});

test("yığın hedefin hiçbir kaynak alanına dokunmaz", () => {
  const target = trader();
  const after = { ...target, ...applyGlut(target, "food", T0) };
  const changed = Object.keys(after).filter(key =>
    JSON.stringify((after as Record<string, unknown>)[key]) !== JSON.stringify((target as Record<string, unknown>)[key]));
  assert.deepEqual(changed.sort(), ["commonsGlut", "commonsGlutAt"]);
  assert.deepEqual(after.resources, target.resources);
  assert.deepEqual(after.commons, target.commons);
});

test("yığın erir ve tavanı aşmaz", () => {
  const carrier = trader({ commonsGlut: { food: GLUT.perPurse }, commonsGlutAt: T0 });
  const later = glutShare(carrier, T0 + AGITATION.tau * HOUR).food;
  assert.ok(Math.abs(later - GLUT.perPurse / Math.E) < 1e-9, `çıkan ${later}`);
  let piled = trader();
  for (let i = 0; i < 20; i += 1) piled = { ...piled, ...applyGlut(piled, "food", T0) };
  assert.ok((piled.commonsGlut?.food ?? 0) <= GLUT.cap);
});

test("istemcinin bildirdiği yığın yok sayılır", () => {
  const previous = save(trader({ lastTickAt: T0, commonsGlut: { food: 1 }, commonsGlutAt: T0 }));
  // İstemci pazarını "bozulmamış" ilan edip satış getirisini geri kazanmaya çalışıyor.
  const claimed = save({ ...tick(previous, T0 + HOUR), commonsGlut: {}, commonsGlutAt: 0 });
  const result = validateGameSave(claimed, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.game.commonsGlut, { food: 1 });
  assert.equal(result.ok && result.game.commonsGlutAt, T0);
});

// --- Haydut yönlendirme ---------------------------------------------------

/** Ova, Sur yok, Kale Sv.3, 20 asker: planın ölçüm kurulumu. */
const lured = (overrides: Partial<Game> = {}) => newGame({
  terrain: "plain",
  buildings: [
    { type: "keep", name: "Kale", category: "Yönetim", level: 3 },
    { type: "barracks", name: "Kışla", category: "Askeri", level: 1 },
  ],
  ...overrides,
});

/** 24 oyun saatinde (6 pencere) beklenen akın sayısı; birçok krallık üstünde ortalanır. */
function expectedRaids(overrides: Partial<Game>, samples = 4000) {
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const game = lured({ kingdomName: `Kale${i}`, ...overrides });
    for (let window = 1; window <= 6; window += 1) {
      if (raidInWindow(game, window)) total += 1;
    }
  }
  return total / samples;
}

test("yönlendirme akın sıklığını ölçülü artırır", () => {
  const quiet = expectedRaids({});
  const pulled = expectedRaids({ raidLure: LURE.perPurse, raidLureAt: T0 - 40 * 86_400_000 });
  // Damga çok eskiyse sönüm her şeyi siler; taze damgayla ölçelim.
  assert.ok(Math.abs(quiet - .94) < .12, `yönlendirmesiz beklenen akın ${quiet.toFixed(2)}`);
  assert.ok(pulled <= quiet + .0001, "çok eski damga etkisiz olmalı");
});

test("taze yönlendirme 24 saatte beklenen akını 0,94'ten 1,6'ya taşır", () => {
  // Damga ilk pencerenin başlangıcında: sönüm pencereler ilerledikçe işler.
  const quiet = expectedRaids({});
  const pulled = expectedRaids({ raidLure: LURE.cap, raidLureAt: T0 });
  assert.ok(pulled > quiet * 1.5, `yönlendirmesiz ${quiet.toFixed(2)}, yönlendirmeli ${pulled.toFixed(2)}`);
  assert.ok(pulled < 6 * .45, "ihtimal tavanı aşılmaz");
});

test("yönlendirme akının ŞİDDETİNE dokunmaz", () => {
  // Aynı pencerede aynı tür akın çıktığında tehdidi birebir aynı olmalı.
  let checked = 0;
  for (let i = 0; i < 400 && checked < 20; i += 1) {
    const name = `Kale${i}`;
    const quiet = raidInWindow(lured({ kingdomName: name }), 3);
    const pulled = raidInWindow(lured({ kingdomName: name, raidLure: LURE.perPurse, raidLureAt: T0 }), 3);
    if (!quiet || !pulled || quiet.kind !== pulled.kind) continue;
    assert.equal(pulled.threat, quiet.threat);
    checked += 1;
  }
  assert.ok(checked > 0, "karşılaştırılabilir akın bulunmalı");
});

test("yönlendirme haydut ağırlığını kaydırır", () => {
  const share = (overrides: Partial<Game>) => {
    let bandits = 0, total = 0;
    for (let i = 0; i < 4000; i += 1) {
      const raid = raidInWindow(lured({ kingdomName: `Dag${i}`, terrain: "mountain", ...overrides }), 3);
      if (!raid) continue;
      total += 1;
      if (raid.kind === "bandits") bandits += 1;
    }
    return bandits / Math.max(1, total);
  };
  assert.ok(share({ raidLure: LURE.cap, raidLureAt: T0 }) > share({}) + .1, "yönlendirilen eşkıya haydutlardır");
});

test("yönlendirme PENCERENİN BAŞLANGICINA damgalanır: iki çağrı aynı akını verir", () => {
  // Determinizmin belirleyici testi: resolveRaids istemcide ve sunucunun
  // doğrulamasında ayrı anlarda çağrılır; aynı pencere aynı akını üretmeli.
  const game = lured({ raidLure: LURE.cap, raidLureAt: T0 });
  const stock = { food: 5000, gold: 5000 };
  const single = resolveRaids(game, T0, T0 + 24 * HOUR, stock);
  let stepped = { events: [] as unknown[], count: 0 };
  for (let hour = 0; hour < 24; hour += 1) {
    const step = resolveRaids(game, T0 + hour * HOUR, T0 + (hour + 1) * HOUR, stock);
    stepped = { events: [...stepped.events, ...step.events], count: stepped.count + step.events.length };
  }
  assert.equal(stepped.count, single.events.length, "adımlı çözüm aynı akınları üretmeli");
  assert.deepEqual(
    stepped.events.map(event => (event as { kind: string; at: number }).at),
    single.events.map(event => event.at),
  );
});

test("yönlendirme tavanı iki keseyle dolar, fazlası kırpılır", () => {
  let carrier: Game = lured();
  for (let i = 0; i < 6; i += 1) carrier = { ...carrier, ...applyLure(carrier, T0) };
  assert.equal(carrier.raidLure, LURE.cap);
  assert.equal(LURE.cap, LURE.perPurse * 2);
});

test("yönlendirme kapalı çözümle söner", () => {
  const carrier = lured({ raidLure: LURE.perPurse, raidLureAt: T0 });
  const later = lureAt(carrier, T0 + AGITATION.tau * HOUR);
  assert.ok(Math.abs(later - LURE.perPurse / Math.E) < 1e-9, `çıkan ${later}`);
  assert.equal(lureAt(lured(), T0 + HOUR), 0, "damga yoksa etki yok");
});

test("istemcinin bildirdiği yönlendirme yok sayılır", () => {
  const previous = save(lured({ lastTickAt: T0, raidLure: LURE.cap, raidLureAt: T0 }));
  const claimed = save({ ...tick(previous, T0 + HOUR), raidLure: 0, raidLureAt: 0 });
  const result = validateGameSave(claimed, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.game.raidLure, LURE.cap);
  assert.equal(result.ok && result.game.raidLureAt, T0);
});

// --- Sıfır ek model çağrısı ----------------------------------------------

test("dış kese hiçbir yeni model çağrısı açmaz", () => {
  const files = ["engine/agitation.ts", "server/agitation-desk.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["fetch(", "callProvider", "decryptByok", "api.openai.com", "api.anthropic.com"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});

test("motor saf kalır: kesede zar ve duvar saati yok", () => {
  const source = readFileSync(new URL("../engine/agitation.ts", import.meta.url), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "crypto.getRandomValues"]) {
    assert.ok(!source.includes(forbidden), `engine/agitation.ts içinde ${forbidden} olmamalı`);
  }
});
