import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyActions } from "../engine/actions";
import {
  DEMAND_NOTICE_HOURS, MAX_OPEN_DEMANDS, VOICE_THRESHOLDS, type VoiceSignals,
  demandsSatisfiedBy, derivePopulaceDemands, garrisonMood, garrisonRefusal,
  DEMAND_SUBJECT, DEMAND_TONE_HOURS, DEMAND_TONES, demandTone,
  garrisonVetoes, openDemands, promiseGaps,
} from "../engine/populace-voice";
import { SOLDIER_THRESHOLDS } from "../engine/populace";
import { COMPARE_BETTER, type CompareMetric } from "../engine/comparison";
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

// --- Sessiz kıyaslama (Fikir 13) -------------------------------------------

/**
 * Kıyas girdisi: kendi değerlerimiz + channel'ın anonim ortalaması. İkisi de
 * `engine/comparison.ts` → `compareValuesOf` ölçeğinde gelir.
 */
const compare = (
  mine: Partial<Record<CompareMetric, number>>,
  averages: Partial<Record<CompareMetric, number>> | null,
): NonNullable<VoiceSignals["comparison"]> => {
  const base: Record<CompareMetric, number> = { popularity: 65, foodRation: 100, taxRate: 15, factionPressure: 0 };
  return {
    mine: { ...base, ...mine },
    averages: averages ? { ...base, ...averages } : null,
  };
};

const kiyasOf = (signals: VoiceSignals) => derivePopulaceDemands(signals).find(demand => demand.kind === "kiyas");

test("kıyas girdisi hiç yoksa kıyas talebi açılmaz", () => {
  assert.equal(kiyasOf(good()), undefined);
  assert.equal(kiyasOf(good({ comparison: null })), undefined);
});

test("ortalama yoksa (gizlilik alt sınırı) kıyas talebi KESİNLİKLE açılmaz", () => {
  // Değirmen dersinin buradaki karşılığı: dayanağı olmayan kıyas Kralı
  // ölçüsüz bir işe çağırır. Kendi hâlimiz ne kadar kötü olsun, ortalama
  // `null` ise talep doğmaz.
  const signals = good({
    popularity: 20, servedFood: 40, taxRate: 45,
    comparison: compare({ popularity: 20, foodRation: 40, taxRate: 45, factionPressure: 80 }, null),
  });
  assert.equal(kiyasOf(signals), undefined);
});

test("kendi değerlerimiz ortalamadan iyiyse kıyas talebi açılmaz", () => {
  const signals = good({
    comparison: compare(
      { popularity: 80, foodRation: 100, taxRate: 8, factionPressure: 0 },
      { popularity: 45, foodRation: 80, taxRate: 30, factionPressure: 40 },
    ),
  });
  assert.equal(kiyasOf(signals), undefined);
});

test("tek ölçütte geride olmak kıyas talebi açmaz", () => {
  // Yüksek vergi bilinçli bir tercih olabilir; halk tek kalemden yola çıkmaz.
  const signals = good({
    comparison: compare({ taxRate: 30 }, { taxRate: 15 }),
  });
  assert.equal(kiyasOf(signals), undefined);
  assert.equal(VOICE_THRESHOLDS.kiyas.metrics, 2);
});

test("eşik farkının tam altında talep açılmaz, tam üstünde açılır", () => {
  const margin = VOICE_THRESHOLDS.kiyas.margin;
  const under = compare(
    { popularity: 65 - margin.popularity + 1, foodRation: 100 - margin.foodRation + 1 },
    { popularity: 65, foodRation: 100 },
  );
  assert.equal(kiyasOf(good({ comparison: under })), undefined);
  const over = compare(
    { popularity: 65 - margin.popularity, foodRation: 100 - margin.foodRation },
    { popularity: 65, foodRation: 100 },
  );
  assert.ok(kiyasOf(good({ comparison: over })));
});

test("ortalamadan belirgin kötüysek ve süre şartı dolduysa kıyas talebi açılır", () => {
  const signals = good({
    comparison: compare(
      { popularity: 40, foodRation: 80, taxRate: 35, factionPressure: 30 },
      { popularity: 62, foodRation: 98, taxRate: 14, factionPressure: 0 },
    ),
  });
  const demand = kiyasOf(signals);
  assert.ok(demand);
  assert.equal(demand.voice, "commons");
  assert.equal(demand.minGameHours, VOICE_THRESHOLDS.kiyas.hours);
  // Süre şartı: tek tick'lik dalgalanma talep açmaz.
  const candidates = derivePopulaceDemands(signals);
  assert.deepEqual(openDemands(candidates, { kiyas: VOICE_THRESHOLDS.kiyas.hours - .1 }), []);
  assert.equal(openDemands(candidates, { kiyas: VOICE_THRESHOLDS.kiyas.hours }).length, 1);
});

test("kıyas talebi asla acil olmaz: somut taleplerin önüne geçmez", () => {
  const signals = good({
    servedFood: 40,
    comparison: compare(
      { popularity: 20, foodRation: 40, taxRate: 45, factionPressure: 70 },
      { popularity: 62, foodRation: 98, taxRate: 14, factionPressure: 0 },
    ),
  });
  assert.equal(kiyasOf(signals)?.severity, "normal");
});

test("BİLGİ SINIRI: kıyas metni hiçbir krallık adı ya da sayı içermez", () => {
  // Bilgi akışı TEK YÖNLÜ: halk kıyaslar, Krala baskı olarak gelir. Kral bu
  // yolla komşunun verisine ASLA erişmemeli. Metin bu yüzden ne isim ne sayı
  // taşır; yalnızca nitel bir kıyas kurar.
  const names = ["Demirkale", "Sınır Boyu", "Akçakale", "Karahisar"];
  const signals = good({
    comparison: compare(
      { popularity: 30, foodRation: 55, taxRate: 44, factionPressure: 65 },
      { popularity: 66, foodRation: 99, taxRate: 12, factionPressure: 3 },
    ),
  });
  const demand = kiyasOf(signals);
  assert.ok(demand);
  // Dört ölçütte birden geride olmak kıyasın en geniş hâli: metin bu hâlde de
  // sayı taşımıyorsa hiçbir hâlde taşımaz.
  assert.equal(demand.text.match(/\d/), null, `metinde sayı var: ${demand.text}`);
  assert.doesNotMatch(demand.text, /%/);
  for (const name of names) assert.ok(!demand.text.includes(name), `metinde krallık adı var: ${name}`);
  // Ortalamanın kendisi de metne sızmasın: hiçbir ölçüt değeri geçmiyor.
  for (const value of [30, 55, 44, 65, 66, 99, 12, 3]) {
    assert.ok(!demand.text.includes(String(value)), `metinde ölçüt değeri var: ${value}`);
  }
});

test("kıyas talebi aynı MAX_OPEN_DEMANDS tavanını paylaşır", () => {
  // Acil bir talep (açlık) varken kıyas tavandaki yeri ondan almaz ve tavan
  // aşılmaz: kıyas için ayrı bir kategori/tavan açılmadı.
  const signals = good({
    servedFood: 40, soldierUnrest: 90,
    comparison: compare(
      { popularity: 20, foodRation: 40, taxRate: 45, factionPressure: 70 },
      { popularity: 62, foodRation: 98, taxRate: 14, factionPressure: 0 },
    ),
  });
  const candidates = derivePopulaceDemands(signals);
  assert.ok(candidates.some(demand => demand.kind === "kiyas"));
  const open = openDemands(candidates, { bread: 99, wage: 99, kiyas: 99 });
  assert.equal(open.length, MAX_OPEN_DEMANDS);
  assert.ok(!open.some(demand => demand.kind === "kiyas"), "acil talepler varken kıyas tavana giremez");
  // Tek başına kaldığında ise açılır.
  const alone = openDemands(candidates.filter(demand => demand.kind === "kiyas"), { kiyas: 99 });
  assert.deepEqual(alone.map(demand => demand.kind), ["kiyas"]);
});

test("kıyas talebi yalnızca geride olduğumuz ölçütün emriyle kapanır", () => {
  // Değirmen dersi: talep, Kralı ilgisiz bir masrafa çağırmaz.
  const signals = good({
    comparison: compare({ foodRation: 80, taxRate: 30 }, { foodRation: 98, taxRate: 14 }),
  });
  const demand = kiyasOf(signals);
  assert.ok(demand);
  assert.deepEqual([...demand.satisfiedBy.actions].sort(), ["set_food_ration", "set_tax_rate"]);
  assert.deepEqual(demandsSatisfiedBy([demand], [{ name: "set_tax_rate", arguments: { rate_percent: 10 } }]), ["kiyas"]);
  assert.deepEqual(demandsSatisfiedBy([demand], [{ name: "train_unit", arguments: {} }]), []);
});

test("kıyas ölçütlerinin yönü motorun tek kaynağından okunur", () => {
  // Yüksek vergi ve yüksek muhalefet baskısı KÖTÜ yöndedir: ortalamadan
  // YÜKSEK olmak bizi geride bırakır, düşük olmak bırakmaz.
  assert.equal(COMPARE_BETTER.taxRate, "low");
  assert.equal(COMPARE_BETTER.factionPressure, "low");
  const worse = compare({ taxRate: 30, factionPressure: 30 }, { taxRate: 14, factionPressure: 0 });
  assert.ok(kiyasOf(good({ comparison: worse })));
  const better = compare({ taxRate: 5, factionPressure: 0 }, { taxRate: 30, factionPressure: 40 });
  assert.equal(kiyasOf(good({ comparison: better })), undefined);
});

// --- MAKAS: ilan edilen ile fiilen verilen (Fikir 14) ----------------------

const vaatOf = (signals: VoiceSignals) => derivePopulaceDemands(signals).find(demand => demand.kind === "vaat");

test("makas girdisi hiç yoksa vaat talebi açılmaz", () => {
  // Eski çağıran (nominal alanları göndermeyen) yeni bir talep görmez.
  assert.equal(vaatOf(good()), undefined);
  assert.equal(vaatOf(good({ servedFood: 70 })), undefined);
});

test("ilan ile fiilî aynıysa makas yoktur", () => {
  const same = good({ nominalFood: 100, servedFood: 100, nominalPay: 100, servedPay: 100 });
  assert.deepEqual(promiseGaps(same), []);
  assert.equal(vaatOf(same), undefined);
});

test("Kral tam pay İLAN ETMEDİYSE makas talebi açılmaz", () => {
  // İlan %80: kimseye tam pay sözü verilmedi, dolayısıyla tutulmamış söz de yok.
  // Makas ham olarak VAR (80 → 40) ama siyasi kapı geçilmiyor.
  const signals = good({ nominalFood: 80, servedFood: 40 });
  assert.equal(promiseGaps(signals)[0]?.gap, 40);
  assert.equal(vaatOf(signals), undefined);
});

test("tam pay ilan edilip ambar tutmazsa makas talebi açılır", () => {
  // ASIL SENARYO: Kral istihkakı %150'ye çekti, General emri GERÇEKTEN uyguladı
  // (ilan %150), ama ambar ancak %90 karşılıyor. `bread` eşiği (85) aşılmıyor,
  // yani bu makas olmadan halkın hiç sesi çıkmazdı.
  const signals = good({ nominalFood: 150, servedFood: 90 });
  const demand = vaatOf(signals);
  assert.ok(demand);
  assert.equal(demand.voice, "commons");
  assert.equal(demand.minGameHours, VOICE_THRESHOLDS.vaat.hours);
  assert.ok(!kinds(signals).includes("bread"), "ekmek eşiği aşılmadı; sesi yalnızca makas veriyor");
  // Metin İKİ sayıyı da söyler: ikiyüzlülük ancak ikisi yan yana durunca görünür.
  assert.match(demand.text, /%150/);
  assert.match(demand.text, /%90/);
});

test("makas eşiğinin tam altında talep açılmaz, tam üstünde açılır", () => {
  const gap = VOICE_THRESHOLDS.vaat.gap;
  assert.equal(vaatOf(good({ nominalFood: 100, servedFood: 100 - gap + 1 })), undefined);
  assert.ok(vaatOf(good({ nominalFood: 100, servedFood: 100 - gap })));
});

test("maaş makası kışlanın sesidir ve askeri olmayan krallıkta hiç açılmaz", () => {
  const paid = { nominalFood: 100, servedFood: 100 };
  const withArmy = vaatOf(good({ ...paid, nominalPay: 100, servedPay: 60 }));
  assert.ok(withArmy);
  assert.equal(withArmy.voice, "garrison");
  assert.match(withArmy.text, /maaş/);
  // Asker yoksa maaş makası kimseyi ilgilendirmez ("değirmen dersi").
  assert.equal(vaatOf(good({ ...paid, army: 0, nominalPay: 100, servedPay: 60 })), undefined);
});

test("iki kanalda birden makas varsa TEK talep açılır ve ikisini birlikte söyler", () => {
  const both = good({ nominalFood: 120, servedFood: 80, nominalPay: 100, servedPay: 70 });
  const demand = vaatOf(both);
  assert.ok(demand);
  // Sofra makası (40) maaş makasından (30) büyük: konuşan taraf çarşıdır.
  assert.equal(demand.voice, "commons");
  assert.match(demand.text, /sofraya/);
  assert.match(demand.text, /keseye/);
  // Tek satır, tek tür: iki ayrı talep tavanı tek başına doldururdu.
  assert.equal(derivePopulaceDemands(both).filter(item => item.kind === "vaat").length, 1);
});

test("makas talebi asla acil olmaz: aciliyeti asıl sıkıntı taşır", () => {
  // Sofraya %10 geliyor: `bread` ACİL, makas yine normal.
  const signals = good({ nominalFood: 200, servedFood: 10, popularity: 20 });
  const demand = vaatOf(signals);
  assert.ok(demand);
  assert.equal(demand.severity, "normal");
  const bread = derivePopulaceDemands(signals).find(item => item.kind === "bread");
  assert.equal(bread?.severity, "urgent");
  // Tavan dolduğunda acil olanlar kalır, makas kesilir: iki acil talep
  // (aç halk + firar eden garnizon) MAX_OPEN_DEMANDS'i doldurur.
  const crowded = derivePopulaceDemands(good({ nominalFood: 200, servedFood: 10, popularity: 20, soldierUnrest: 90 }));
  assert.ok(crowded.some(item => item.kind === "vaat"), "makas adaylar arasında");
  const open = openDemands(crowded, { bread: 99, wage: 99, vaat: 99, joy: 99, tax: 99, price: 99, roof: 99 });
  assert.equal(open.length, MAX_OPEN_DEMANDS);
  assert.ok(!open.some(item => item.kind === "vaat"), "acil talepler varken makas tavandan düşer");
});

test("makas iki yoldan kapanır: stok bulmak ya da ilanı gerçeğe indirmek", () => {
  const open = derivePopulaceDemands(good({ nominalFood: 150, servedFood: 90 })).filter(item => item.kind === "vaat");
  // İlanı gerçeğe indirmek de meşru bir kapanıştır.
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "set_food_ration", arguments: { percent: 90 } }]), ["vaat"]);
  // Stok bulmak da.
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "trade_resource", arguments: { resource: "food", direction: "buy" } }]), ["vaat"]);
  // Ama ilgisiz bir yapı emri kapatmaz: Sur sofradaki eksiği kapatmaz.
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "build_structure", arguments: { building_type: "wall" } }]), []);
  assert.deepEqual(demandsSatisfiedBy(open, [{ name: "build_structure", arguments: { building_type: "granary" } }]), ["vaat"]);
});

test("makas ölçüsü Fikir 18 ile PAYLAŞILAN tek kaynaktır ve büyükten küçüğe sıralanır", () => {
  const gaps = promiseGaps(good({ nominalFood: 120, servedFood: 100, nominalPay: 100, servedPay: 40 }));
  assert.deepEqual(gaps.map(entry => entry.channel), ["pay", "food"]);
  assert.deepEqual(gaps.map(entry => entry.gap), [60, 20]);
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

// --- Dilin sertlik kademesi (Fikir 2) --------------------------------------

test("kademe SÜREDEN türer ve sırayla sertleşir", () => {
  assert.equal(demandTone("normal", 0), "ilk");
  assert.equal(demandTone("normal", DEMAND_TONE_HOURS.israr - 0.1), "ilk");
  assert.equal(demandTone("normal", DEMAND_TONE_HOURS.israr), "israr");
  assert.equal(demandTone("normal", DEMAND_TONE_HOURS.ofke), "ofke");
  // Tavan aşılmaz: 10 gün beklemek de öfkedir.
  assert.equal(demandTone("normal", 240), "ofke");
});

test("acil şiddet kademeyi BİR basamak yukarı taşır, tavanı geçmez", () => {
  assert.equal(demandTone("urgent", 0), "israr");
  assert.equal(demandTone("urgent", DEMAND_TONE_HOURS.israr), "ofke");
  assert.equal(demandTone("urgent", DEMAND_TONE_HOURS.ofke), "ofke");
});

test("bozuk süre girdisi en yumuşak kademeye düşer", () => {
  assert.equal(demandTone("normal", Number.NaN), "ilk");
  assert.equal(demandTone("normal", -5), "ilk");
});

test("kademe listesi ve konu listesi tek kaynakta, tam", () => {
  assert.deepEqual([...DEMAND_TONES], ["ilk", "israr", "ofke"]);
  // Her talep türünün Halk-AI'ya verilecek bir konusu OLMAK ZORUNDA: eksik
  // kalan tür promptta boş konuyla giderdi.
  for (const demand of derivePopulaceDemands(good({ servedFood: 40, taxRate: 40, popularity: 20, soldierUnrest: 90, population: 300, capacity: 300, livingCost: 2 }))) {
    assert.ok(DEMAND_SUBJECT[demand.kind]?.length > 10, demand.kind);
  }
  // Konu metinleri Halk-AI promptuna giriyor: sayı ya da yüzde taşımamalı.
  for (const subject of Object.values(DEMAND_SUBJECT)) {
    assert.ok(!/[0-9%]/.test(subject), subject);
  }
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

// --- Sağlayıcı çağrısının yeri ---------------------------------------------

test("tetikleyici ve defter sağlayıcıya HİÇ gitmez", () => {
  // Mekaniğin taşıyıcı ilkesi değişmedi: KARAR motorda verilir (bedava) ve
  // Kralın kendi anahtarıyla fazladan tek bir çağrı açılmaz. Fikir 2 ile
  // eklenen tek şey CÜMLENİN üretimi; o da ayrı bir dosyada, oyun kurucusunun
  // anahtarıyla yaşıyor. Bu iki dosya sağlayıcıya gitmemeye devam etmeli:
  // biri motorun saf kararı, öbürü veritabanı defteri.
  const files = ["engine/populace-voice.ts", "server/populace-voice.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["fetch(", "callProvider", "decryptByok", "api.openai.com", "api.anthropic.com"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});

test("sağlayıcı uç noktası TEK dosyada yaşıyor", () => {
  // CLAUDE.md kısıt #5. Halk-AI için üçüncü bir sağlayıcı çağrısı yazılmadı:
  // gece vardiyasının çağrısı `server/llm-provider.ts`'e taşındı ve orada
  // araçsız bir kardeş kip kazandı. Kralın kendi turu (app/api/general) ayrı
  // kalıyor ve bu bilinçli — gerekçesi llm-provider.ts dosya başında yazılı.
  const owners = ["server/llm-provider.ts", "app/api/general/route.ts"];
  const suspects = [
    "app/api/cron/route.ts", "server/populace-narrator.ts", "server/populace-voice.ts",
    "server/populace-brief.ts", "server/populace-ai-desk.ts",
  ];
  for (const file of owners) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(source.includes("api.openai.com"), `${file} sağlayıcı uç noktasını taşımalı`);
  }
  for (const file of suspects) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["api.openai.com", "api.anthropic.com"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});
