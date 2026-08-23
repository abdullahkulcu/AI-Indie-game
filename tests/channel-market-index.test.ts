import assert from "node:assert/strict";
import test from "node:test";
import { applyActions, marketState } from "../engine/actions";
import {
  LIVING_WEIGHTS, MARKET_INDEX, PRICE_CEILING, PRICE_FLOOR, SPREAD, TRADED_KEYS,
  channelPriceIndex, commonsReference, coverageOf, fillOrder, indexedMultiplier,
  livingCost, marketPrices, orderGoldBounds, priceMultiplier, unitPrice,
} from "../engine/market";
import { tick } from "../engine/tick";
import type { Game, TradeKey } from "../engine/types";
import { validateGameSave } from "../server/save-validation";
import { channelAverages } from "../server/world-projection";

/**
 * CHANNEL PAZAR ENDEKSİ (plan belgesi Fikir 24).
 *
 * Bu dosya bir DENGE testi değil, bir GÜVENLİK testidir. Endeks bu kod
 * tabanının iki en pahalı hata türüne aynı anda dokunuyor:
 *
 *  1. İSTİSMAR — `commons` istismarının aynısı (bkz. server/save-validation.ts,
 *     "HALKIN DEFTERİ SUNUCUNUN"). İstemci endeksi kendi lehine bildirebilse
 *     fiyatı kırar/şişirir ve üç denetimin hiçbiri görmez.
 *  2. SAVE REDDİ = İLERLEME KAYBI (CLAUDE.md #2). Fiyat channel'a bağlanırken
 *     `tick()`'in ya da emrin kabul aralığının kayması, meşru bir kaydın 409
 *     ile reddine yol açar.
 *
 * Aşağıdaki testler bu iki kapının KAPALI olduğunu ölçer.
 */

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const REF = commonsReference(500);

// --- ENDEKSİN KENDİSİ ------------------------------------------------------

test("satış akışı fiyatı düşürür, alım akışı yükseltir", () => {
  // Yön yerel eğrinin yönüyle aynı olmak zorunda: satış halkın eline mal
  // geçirir (bolluk → ucuz), alım malı çeker (kıtlık → pahalı).
  const glutted = channelPriceIndex({ netFlow: { food: 1e9 }, reference: REF, channelSpeed: 1 });
  const scarce = channelPriceIndex({ netFlow: { food: -1e9 }, reference: REF, channelSpeed: 1 });
  assert.ok(glutted.food < 1, `satış akışı çarpanı düşürmeli: ${glutted.food}`);
  assert.ok(scarce.food > 1, `alım akışı çarpanı yükseltmeli: ${scarce.food}`);
});

test("endeksin etkisi hafif kalır: uçta bile ±reach", () => {
  // "Küçük bir sızıntı/yayılma etkisi" kararı ölçülebilir olmalı; endeks bir
  // gün fiyat mekaniğinin tamamına dönüşmesin.
  const extreme = channelPriceIndex({ netFlow: { food: 1e12, wood: -1e12 }, reference: REF, channelSpeed: 1 });
  assert.ok(Math.abs(extreme.food - (1 - MARKET_INDEX.reach)) < 1e-12);
  assert.ok(Math.abs(extreme.wood - (1 + MARKET_INDEX.reach)) < 1e-12);
  assert.ok(MARKET_INDEX.reach < .1, "sızıntı hafif olmalı");
  assert.ok(MARKET_INDEX.reach * 2 < SPREAD - 1, "endeks makasın altında kalmalı: tur atmak yine zarar olsun");
});

test("akış yoksa endeks nötrdür ve fiyat bugünküyle birebir aynıdır", () => {
  const neutral = channelPriceIndex({ netFlow: {}, reference: REF, channelSpeed: 1 });
  for (const key of TRADED_KEYS) assert.equal(neutral[key], 1);
  // Nötr endeksle geçen fiyat, endeks hiç verilmemiş fiyatla aynı olmalı.
  assert.deepEqual(marketPrices(REF, REF, undefined, neutral), marketPrices(REF, REF));
});

test("nüfus okunamadığında endeks nötrdür", () => {
  // Eşik sıfırsa bölme sonsuza gider; bilinmeyen bir sayı fiyatı oynatmamalı.
  const index = channelPriceIndex({ netFlow: { food: 5_000 }, reference: { food: 0 }, channelSpeed: 1 });
  assert.equal(index.food, 1);
});

// --- EŞİĞİN ÖLÇEKLENMESİ ---------------------------------------------------

test("eşik channel nüfusuyla ölçeklenir: aynı akış büyük channel'da daha az oynatır", () => {
  // Kararın kendisi: sabit eşik değil, channel büyüklüğüne göre ölçeklenen eşik.
  // 500 birim, üç küçük sancaklı bir channel'da uçtur; büyük channel'da gürültü.
  const flow = { food: 3_000 };
  const small = channelPriceIndex({ netFlow: flow, reference: commonsReference(150), channelSpeed: 1 });
  const large = channelPriceIndex({ netFlow: flow, reference: commonsReference(15_000), channelSpeed: 1 });
  assert.ok(small.food < large.food, `küçük channel daha çok oynamalı: ${small.food} < ${large.food}`);
  assert.ok(Math.abs(large.food - 1) < Math.abs(small.food - 1));
  // Ölçek gerçekten nüfusla gidiyor: nüfusu ve akışı birlikte katlamak aynı
  // endeksi vermeli, yoksa "eşik ölçekleniyor" demek boş bir iddia olurdu.
  const doubled = channelPriceIndex({ netFlow: { food: 6_000 }, reference: commonsReference(300), channelSpeed: 1 });
  assert.ok(Math.abs(doubled.food - small.food) < 1e-12, "akış ve nüfus birlikte katlanınca endeks sabit kalmalı");
});

test("eşik channel hızıyla da ölçeklenir", () => {
  // Hızlı channel'da teklifler daha çabuk kapanır (marketDuration hıza bölünür),
  // yani aynı ticaret yoğunluğu her an daha KÜÇÜK bir açık emir havuzu gösterir.
  // Eşik hızla küçülmeseydi hızlı channel'lar endeksi hiç kıpırdatamazdı.
  // Akış bilerek küçük: iki hızda da uca DAYANMAMASI gerek, yoksa ikisi de
  // kırpılıp aynı sayıya oturur ve test hiçbir şey ölçmez.
  const flow = { food: 30 };
  const slow = channelPriceIndex({ netFlow: flow, reference: REF, channelSpeed: 1 });
  const fast = channelPriceIndex({ netFlow: flow, reference: REF, channelSpeed: 4 });
  assert.ok(Math.abs(fast.food - 1) > Math.abs(slow.food - 1),
    `hızlı channel'da aynı akış daha çok oynatmalı: ${fast.food} vs ${slow.food}`);
});

// --- KABUL ARALIĞI: 409 RİSKİ ---------------------------------------------

test("endeks fiyat tabanını ve tavanını GENİŞLETMEZ", () => {
  /**
   * Bu testin tamamı CLAUDE.md #2 hakkında. `orderGoldBounds` emrin kabul
   * aralığını `[BASE × PRICE_FLOOR, BASE × PRICE_CEILING]`'dan çiziyor ve
   * sunucu emri bu aralıkla ölçüyor. Endeks aralığın DIŞINA çıkabilseydi iki
   * kötü seçenek kalırdı: ya meşru bir emir tavanı aşıp 409 alır (ilerleme
   * kaybı), ya da tavanı yükseltmek zorunda kalırız (her emir için istismar
   * payı büyür). Endeks bu yüzden aralığın İÇİNDE oynar.
   */
  for (const factor of [1 - MARKET_INDEX.reach, 1, 1 + MARKET_INDEX.reach]) {
    for (const coverage of [0, .0001, .5, 1, 1.0001, 2, 5, 1e6]) {
      const multiplier = indexedMultiplier(coverage, factor);
      assert.ok(multiplier >= PRICE_FLOOR - 1e-12 && multiplier <= PRICE_CEILING + 1e-12,
        `kapsama ${coverage}, çarpan ${factor}: ${multiplier} aralık dışında`);
    }
  }
});

test("endeksin ucundaki emir bile sunucunun kabul aralığında kalır", () => {
  // Yukarıdaki kırpmanın somut sonucu: hiçbir endeks değeri emri 409'a düşürmez.
  const amount = 400;
  for (const direction of ["sell", "buy"] as const) {
    for (const factor of [1 - MARKET_INDEX.reach, 1, 1 + MARKET_INDEX.reach]) {
      const bounds = orderGoldBounds("food", amount, direction);
      // Kıtlık ve bolluk uçları: fiyatın gerçekten tavana/tabana dayandığı yer.
      for (const stock of [0, REF.food * .01, REF.food, REF.food * 40]) {
        const fill = fillOrder("food", amount, stock, REF.food, direction, 0, factor);
        assert.ok(fill.gold <= bounds.max + 1, `satış getirisi tavanı aşmamalı: ${fill.gold} > ${bounds.max}`);
        assert.ok(fill.gold >= bounds.min - 1, `alış bedeli tabanın altına inmemeli: ${fill.gold} < ${bounds.min}`);
      }
    }
  }
});

// --- DETERMİNİZM: ADIM BÖLÜNMESİ -----------------------------------------

test("endeksle verilen emrin getirisi adım bölünmesinden bağımsızdır", () => {
  /**
   * CLAUDE.md #2'NİN DOĞRUDAN TESTİ — bu işin en hassas kısıtı.
   *
   * Endeksin `tick()`'e sızmasının tek olası yolu emrin kendisidir: emir
   * verilirken endeksle fiyatlanır ve `gold` alanına DAMGALANIR, sonra
   * kapanışta `orderPayout` o damgayı tek kalemde hazineye yazar. Damga
   * pencere boyunca DEĞİŞMEZ bir sayı olduğu için istemcinin dakikalık
   * adımları ile sunucunun tek büyük adımı aynı altına varmak zorunda.
   *
   * Ölçü, emrin hazineye KATTIĞI fark olarak alınır (emirli yörünge eksi
   * emirsiz yörünge). Böylece `tick()`'in emirle ilgisi olmayan kalemleri
   * (vergi, nüfus, halkın defteri) iki tarafta da aynı biçimde birbirini
   * götürür ve test yalnızca ENDEKSİN taşıdığı sayıyı ölçer.
   */
  const start = seed({ resources: { gold: 10_000, food: 40_000, wood: 5_000, stone: 500, iron: 100, ale: 500 } });
  const sell = trade("food", 400, "sell");
  const horizon = NOW + 6 * HOUR;

  /** Aynı yörüngeyi tek adımda ve dakikalık adımlarla yürütür. */
  const walk = (game: Game) => {
    const single = tick(game, horizon);
    let stepped = game;
    for (let i = 0; i < 6 * 60; i++) stepped = tick(stepped, NOW + (i + 1) * 60_000);
    return { single: single.resources.gold, stepped: stepped.resources.gold };
  };

  const idle = walk(start);
  for (const index of [undefined, cheapIndex(), dearIndex()]) {
    const placed = applyActions(start, [sell], NOW, index);
    const stamped = placed.game.marketOrders?.[0]?.gold ?? 0;
    assert.ok(stamped > 0, "emir kurulmalı");

    const traded = walk(placed.game);
    // Emrin hazineye kattığı fark, iki adım boyutunda AYNI olmalı.
    const bySingle = traded.single - idle.single;
    const byStepped = traded.stepped - idle.stepped;
    assert.ok(Math.abs(bySingle - byStepped) < 1e-6,
      `endeks ${index?.food ?? 1}: tek adım ${bySingle}, dakikalık adımlar ${byStepped}`);
    // Ve o fark tam olarak damgalanan sayı kadar: endeks emrin İÇİNDE kalır,
    // pencere boyunca yeniden okunan canlı bir sayıya dönüşmez.
    assert.ok(Math.abs(bySingle - stamped) < 1e-6,
      `endeks ${index?.food ?? 1}: damga ${stamped}, hazineye giren ${bySingle}`);
  }
});

test("tick() endeksten habersizdir: imzasında endeks yok", () => {
  /**
   * Yapısal güvence. Yukarıdaki test davranışı ölçüyor; bu test SEBEBİ
   * kilitliyor: `tick` yalnızca durumu ve zamanı alır, endeksi almaz. Biri
   * ileride endeksi `tick`'e geçirmeye kalkarsa bu satır kırılır ve gerekçeyi
   * burada okur.
   */
  assert.ok(tick.length <= 2, `tick(game, now) beklenirken ${tick.length} argüman alıyor`);
});

test("geçim endeksi (rıza) channel endeksinden HİÇ etkilenmez", () => {
  /**
   * SINIRIN KENDİSİ ve bu dosyadaki en önemli tek test.
   *
   * `livingCost` bilerek `priceMultiplier`'ı doğrudan çağırır,
   * `indexedMultiplier`'ı DEĞİL: bu sayı `tick()` içinde rızaya dönüşüyor
   * (engine/tick.ts → `livingMood`) ve `tick()` istemcide saniyelik, sunucuda
   * tek büyük adımla çalışıyor. Channel'dan gelen bir çarpan buraya sızsa,
   * pencere içinde değiştiği anda iki taraf ayrı rızaya varır ve meşru kayıt
   * 409 alır — CLAUDE.md #2, ilerleme kaybı. `commonsGlut` da tam bu sebeple
   * rızanın dışında tutuluyor.
   *
   * ÖLÇÜM KENDİNE GÖNDERME YAPMAZ: beklenen değer `priceMultiplier`'dan ELLE
   * kurulur. `livingCost`'u kendisiyle kıyaslayan bir test, endeks sızdırılsa
   * bile geçerdi (bu dosyada bir kez öyle yazıldı ve mutasyon testinde
   * sızıntıyı yakalayamadı).
   */
  const scarce = { ...REF, food: REF.food * .3, ale: REF.ale * .5 };
  const expected = LIVING_WEIGHTS.food * priceMultiplier(coverageOf(scarce.food, REF.food))
    + LIVING_WEIGHTS.ale * priceMultiplier(coverageOf(scarce.ale, REF.ale));
  assert.ok(Math.abs(livingCost(scarce, REF) - expected) < 1e-12,
    `geçim endeksi kırpılmamış yerel eğriden okunmalı: ${livingCost(scarce, REF)} != ${expected}`);

  // Endeks fiyatı GERÇEKTEN oynatıyor — yani yukarıdaki eşitlik "endeks etkisiz"
  // demek değil, "endeks BURAYA girmiyor" demek.
  const index = channelPriceIndex({ netFlow: { food: -1e9 }, reference: REF, channelSpeed: 1 });
  assert.ok(index.food > 1);
  assert.ok(unitPrice("food", scarce.food, REF.food, index.food) > unitPrice("food", scarce.food, REF.food),
    "endeks ticaret fiyatını oynatmalı");
});

test("rıza yörüngesi endeksten bağımsızdır", () => {
  // Yukarıdaki sınırın DAVRANIŞ tarafı: aynı durumdan yürüyen `tick`, endeks
  // ne olursa olsun aynı rızaya varır. Endeks `tick`'e hiç girmediği için bu
  // yapısal olarak doğrudur; test biri onu bozarsa haber verir.
  const start = seed({ commons: { ...REF, food: REF.food * .3, ale: REF.ale * .4 } });
  const walked = tick(start, NOW + 3 * HOUR);
  for (const index of [cheapIndex(), dearIndex()]) {
    // Endeksle emir vermek rızayı DEĞİŞTİRMEMELİ: emir yalnızca altın ve mal
    // hareket ettirir, geçim yükünü halkın kendi stoğu belirler.
    const placed = applyActions(seed({ commons: { ...REF, food: REF.food * .3, ale: REF.ale * .4 } }), [], NOW, index);
    assert.equal(tick(placed.game, NOW + 3 * HOUR).popularity, walked.popularity);
  }
});

// --- İSTİSMAR: İSTEMCİNİN BİLDİRDİĞİ DEĞER ------------------------------

test("istemcinin kaydına yazdığı endeks alanı REDDEDİLİR, okunmaz", () => {
  /**
   * İstismar kapısının kapatılma biçimi: endeks kaydın İÇİNDE HİÇ DURMAZ.
   * `commons` sunucu-türevi yapılarak kurtarılmıştı; endeks ise şemaya hiç
   * girmedi, dolayısıyla `.strict()` şema onu taşıyan kaydı doğrudan reddeder.
   * Kral endeksi kendi lehine bildirmenin bir yolunu bulamaz, çünkü
   * bildirebileceği bir alan yok.
   */
  const previous = save(seed());
  for (const field of ["marketIndex", "channelIndex", "marketIndexAt"]) {
    const claimed = save({ ...tick(seed(), NOW + HOUR), [field]: { food: 1 + MARKET_INDEX.reach } } as Game);
    const result = validateGameSave(JSON.parse(claimed), {
      previous: JSON.parse(previous), previousUpdatedAt: NOW, channelSpeed: 1, now: NOW + HOUR,
    });
    assert.equal(result.ok, false, `${field} alanı kabul edilmemeli`);
  }
});

test("endeks alanı OLMAYAN kayıt reddedilmez (geriye dönük uyum)", () => {
  // Eski kayıtlar bu işten haberdar değil ve olmak zorunda da değil: endeks
  // kayda hiç yazılmadığı için eski/yeni kayıt ayrımı doğmuyor.
  const previous = save(seed());
  const result = validateGameSave(JSON.parse(save(tick(seed(), NOW + HOUR))), {
    previous: JSON.parse(previous), previousUpdatedAt: NOW, channelSpeed: 1, now: NOW + HOUR,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});

test("Kralın KENDİ emirleri kendi endeksine girmez", () => {
  /**
   * Endeksi kendi lehine oynatmanın ikinci yolu: kendi emirlerini sayıya
   * katmak. `channelAverages` Kralı ilk elemede dışarı atıyor (`excludeUserId`)
   * ve pazar toplamları AYNI döngüde biriktiği için bu süzgeci kendiliğinden
   * devralıyor. Yani Kral ne kadar emir dizerse dizsin kendi fiyatını
   * kıpırdatamaz — endeks yalnızca komşulardan gelir.
   */
  const mine = { userId: "kral", gameState: save(seed({ marketOrders: [order("sell", "food", 900_000)] })) };
  const neighbours = ["a", "b", "c"].map(userId => ({ userId, gameState: save(seed()) }));

  const withMine = channelAverages({ channelName: "Sınır Boyu", excludeUserId: "kral", rows: [mine, ...neighbours], now: NOW });
  const without = channelAverages({ channelName: "Sınır Boyu", excludeUserId: "kral", rows: neighbours, now: NOW });
  assert.deepEqual(withMine.market, without.market);
  assert.equal(withMine.market?.netFlow.food, 0);
});

// --- AGREGASYONUN SINIRLARI ----------------------------------------------

test("gizlilik alt sınırının altında endeks HİÇ üretilmez", () => {
  // Kıyas ortalamasıyla aynı kapı: iki komşunun net emir akışı, kendi
  // emirlerini bilen bir Kral için tek komşunun defterini birebir çözer.
  const rows = ["a", "b"].map(userId => ({ userId, gameState: save(seed({ marketOrders: [order("sell", "food", 500)] })) }));
  const result = channelAverages({ channelName: "Sınır Boyu", excludeUserId: "kral", rows, now: NOW });
  assert.equal(result.averages, null);
  assert.equal(result.market, null, "pazar toplamları da gizlilik kapısından geçmeli");
});

test("kapanma vakti geçmiş emir endekse girmez", () => {
  /**
   * Terk edilmiş krallık sorunu. Kapanma vakti geçmiş bir teklif ancak O
   * OYUNCUNUN istemcisi `tick()` attığında kayıttan düşer; bir daha hiç
   * oynamayan sancağın kaydında sonsuza kadar durur. Süzülmeseydi tek bir
   * ölü sancak channel'ın fiyatını kalıcı olarak eğecekti. Bu şart aynı
   * zamanda endeksin kendi kendine sönmesini sağlıyor: ayrı bir sönüm terimi
   * gerekmiyor, emirler kapandıkça akış sıfıra döner.
   */
  const stale = ["a", "b", "c"].map(userId =>
    ({ userId, gameState: save(seed({ marketOrders: [order("sell", "food", 9_000, NOW - 2 * HOUR)] })) }));
  const result = channelAverages({ channelName: "Sınır Boyu", excludeUserId: null, rows: stale, now: NOW });
  assert.equal(result.market?.netFlow.food, 0, "kapanmış emir akışa sayılmamalı");
});

test("açık emirler net akışa doğru işaretle girer", () => {
  const rows = [
    { userId: "a", gameState: save(seed({ marketOrders: [order("sell", "food", 600)] })) },
    { userId: "b", gameState: save(seed({ marketOrders: [order("buy", "food", 200)] })) },
    { userId: "c", gameState: save(seed({ marketOrders: [order("sell", "wood", 100)] })) },
  ];
  const result = channelAverages({ channelName: "Sınır Boyu", excludeUserId: null, rows, now: NOW });
  assert.equal(result.market?.netFlow.food, 400, "600 satış − 200 alım");
  assert.equal(result.market?.netFlow.wood, 100);
  assert.equal(result.market?.netFlow.iron, 0);
  // Referans, sayılan üç sancağın normal kilerinin toplamı olmalı.
  assert.ok(Math.abs((result.market?.reference.food ?? 0) - 3 * commonsReference(500).food) < 1e-9);
});

// --- UÇTAN UCA: ENDEKS GERÇEKTEN FİYATI DEĞİŞTİRİR ----------------------

test("endeks emrin fiilen getirdiği altını değiştirir", () => {
  /**
   * Kararın kendisi: endeks yalnızca bir bilgi göstergesi DEĞİL, gerçekten
   * fiyatı değiştiren bir mekanik. Ölçüsü hazineye giren altın.
   */
  const game = seed({ resources: { gold: 5_000, food: 5_000, wood: 5_000, stone: 0, iron: 0, ale: 0 } });
  const sell = trade("food", 400, "sell");

  const plain = applyActions(game, [sell], NOW);
  const cheap = applyActions(game, [sell], NOW, cheapIndex());
  const dear = applyActions(game, [sell], NOW, dearIndex());

  const goldOf = (result: ReturnType<typeof applyActions>) => result.game.marketOrders?.[0]?.gold ?? 0;
  assert.ok(goldOf(plain) > 0, "emir kurulmalı");
  assert.ok(goldOf(cheap) < goldOf(plain), `channel bolluğunda satış az getirmeli: ${goldOf(cheap)} < ${goldOf(plain)}`);
  assert.ok(goldOf(dear) > goldOf(plain), `channel kıtlığında satış çok getirmeli: ${goldOf(dear)} > ${goldOf(plain)}`);
});

test("endeks alışa da işler: tek yönlü bir indirim değil", () => {
  // Tek kola işleseydi Kral lehine olan kolu seçerek endeksi bedava bir
  // indirime çevirirdi. İki yönlü olduğu için endeks bir fırsat değil, hava.
  const scarce = channelPriceIndex({ netFlow: { food: -1e9 }, reference: REF, channelSpeed: 1 });
  const plain = fillOrder("food", 300, REF.food, REF.food, "buy");
  const dearer = fillOrder("food", 300, REF.food, REF.food, "buy", 0, scarce.food);
  assert.ok(dearer.gold > plain.gold, `channel kıtlığında alım pahalı olmalı: ${dearer.gold} > ${plain.gold}`);
});

test("marketState endeks verilmediğinde bugünkü fiyatı verir", () => {
  // Gece vardiyası ve her eski çağrı endeksi hiç vermiyor; davranış değişmemeli.
  const game = seed();
  assert.deepEqual(marketState(game, NOW).price, marketState(game, NOW, undefined).price);
  assert.equal(marketState(game, NOW).indexed, false);
  const nudged = marketState(game, NOW, channelPriceIndex({ netFlow: { food: 1e9 }, reference: REF, channelSpeed: 1 }));
  assert.equal(nudged.indexed, true, "arayüz endeksi gösterebilmeli");
  assert.ok(nudged.price.food < marketState(game, NOW).price.food);
});

// --- YARDIMCILAR ----------------------------------------------------------

/** Pazar emri eylemi; `applyActions` argümanları `arguments` altında okur. */
const trade = (resource: TradeKey, amount: number, direction: "sell" | "buy") =>
  ({ name: "trade_resource", arguments: { resource, amount, direction } });

/** Channel çapında bolluk (satış akışı): satış fiyatı düşer. */
const cheapIndex = () => channelPriceIndex({ netFlow: { food: 1e9 }, reference: REF, channelSpeed: 1 });
/** Channel çapında kıtlık (alım akışı): fiyat yükselir. */
const dearIndex = () => channelPriceIndex({ netFlow: { food: -1e9 }, reference: REF, channelSpeed: 1 });

function order(direction: "sell" | "buy", resource: TradeKey, amount: number, completesAt = NOW + HOUR) {
  return { id: `${direction}-${resource}-${amount}-${completesAt}`, resource, amount, direction, gold: 1, placedAt: NOW - 60_000, completesAt };
}

/** Şemayı tam tutan, pazarı kurulmuş bir krallık. */
function seed(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Sancak", rulerName: "Kral", channel: "Sınır Boyu", speed: 1, terrain: "plain",
    // Koruma penceresi şemanın kendi sınırı içinde: kuruluş + PROTECTION_DAYS.
    foundedAt: NOW - 30 * 86_400_000, lastTickAt: NOW, protectionEndsAt: NOW - 29 * 86_400_000,
    resources: { gold: 500, food: 2_000, wood: 500, stone: 200, iron: 50, ale: 100 },
    population: 500, capacity: 900, popularity: 60, reputation: 50, loyalty: 50, taxRate: 20,
    buildings: [
      { type: "keep", name: "Kale", category: "yönetim", level: 3 },
      { type: "market", name: "Pazar", category: "iktisat", level: 2 },
    ],
    units: {}, queue: null, notices: [],
    provider: null, model: null, generalConnected: false,
    ...overrides,
  } as unknown as Game;
}

const save = (game: Game) => JSON.stringify(game);
