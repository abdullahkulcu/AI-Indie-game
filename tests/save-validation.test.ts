import { catalog } from "../engine/catalog";
import { orderGoldBounds } from "../engine/market";
import { grossRates, tick } from "../engine/tick";
import { BUILDING_TYPES } from "../server/save-validation";
import assert from "node:assert/strict";
import test from "node:test";
import { startingState, parseStoredSave, validateGameSave } from "../server/save-validation";

/** Hız 1'deki kanonik başlangıç; bu dosyadaki kayıtlar onun üstüne kurulur. */
const STARTING_STATE = startingState(1);

const NOW = 1_800_000_000_000;

function startingSave(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    kingdomName: "Demirkale",
    rulerName: "Alaric",
    channel: "Standart Sezon I",
    channelId: "standard",
    speed: 1,
    terrain: "plain",
    foundedAt: NOW - 60_000,
    lastTickAt: NOW,
    protectionEndsAt: NOW - 60_000 + STARTING_STATE.protectionDays * 86_400_000,
    resources: { ...STARTING_STATE.resources },
    population: 100,
    capacity: 150,
    popularity: 50,
    reputation: 50,
    loyalty: 75,
    taxRate: 15,
    quota: 2,
    quotaAt: NOW,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
      { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 1 },
    ],
    units: { spearman: 0 },
    queue: null,
    notices: [{ kind: "KURULUŞ", text: "Krallık kuruldu.", at: NOW }],
    provider: null,
    model: null,
    generalConnected: false,
    ...overrides,
  };
}

const firstSave = { previous: null, previousUpdatedAt: null, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW };

test("geçerli kuruluş kaydı kabul edilir", () => {
  const result = validateGameSave(startingSave(), firstSave);
  assert.equal(result.ok, true);
});

test("kota alanlarını taşıyan eski kayıt hâlâ kabul edilir", () => {
  // Kota kaldırıldı ama şema `.strict()`; alanlar `.optional()` yapılmasaydı
  // bütün eski kayıtlar reddedilirdi.
  const result = validateGameSave(startingSave({ quota: 8, quotaAt: NOW }), firstSave);
  assert.equal(result.ok, true);
});

test("kota alanları hiç yokken de kayıt kabul edilir", () => {
  // Arayüz kotayı bıraktığında kayıtlar bu alansız gelecek.
  const save = startingSave() as Record<string, unknown>;
  delete save.quota;
  delete save.quotaAt;
  const result = validateGameSave(save, firstSave);
  assert.equal(result.ok, true);
});

test("şişirilmiş kota artık kaydı reddettirmez", () => {
  // Kota hiçbir emri kısıtlamadığı için değerini şişirmek bir avantaj sağlamaz;
  // eski simülasyon kontrolü meşru kayıtları haksız yere 409'luyordu.
  const previous = startingSave({ quota: 0 });
  const current = startingSave({ quota: 24, lastTickAt: NOW + 60_000 });
  const result = validateGameSave(current, {
    previous: previous as never, previousUpdatedAt: NOW, channelSpeed: 1,
    channelName: "Standart Sezon I", now: NOW + 60_000,
  });
  assert.equal(result.ok, true);
});

test("ilk kayıtta uydurma kaynak reddedilir", () => {
  const result = validateGameSave(startingSave({ resources: { gold: 999_999_999, food: 1, stone: 1, wood: 1, iron: 1, ale: 0 } }), firstSave);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400); // tavanı da aşıyor
});

test("tavan içinde ama başlangıcın üstündeki ilk kayıt reddedilir", () => {
  const result = validateGameSave(startingSave({ resources: { ...STARTING_STATE.resources, gold: 400_000 } }), firstSave);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 409);
});

test("ilk kayıtta Sv.6 kale reddedilir", () => {
  const save = startingSave();
  save.buildings[0].level = 6;
  const result = validateGameSave(save, firstSave);
  assert.equal(result.ok, false);
});

test("bilinmeyen bina türü reddedilir", () => {
  const save = startingSave();
  save.buildings.push({ type: "altin_basimevi", name: "Altın Basımevi", category: "Ekonomi", level: 1 });
  assert.equal(validateGameSave(save, firstSave).ok, false);
});

test("şemada olmayan alan reddedilir", () => {
  const result = validateGameSave(startingSave({ cheatMode: true }), firstSave);
  assert.equal(result.ok, false);
});

test("koruma süresi uzatılamaz", () => {
  const result = validateGameSave(startingSave({ protectionEndsAt: NOW + 90 * 86_400_000 }), firstSave);
  assert.equal(result.ok, false);
});

test("gelecekteki kayıt zamanı reddedilir", () => {
  const result = validateGameSave(startingSave({ lastTickAt: NOW + 86_400_000 }), firstSave);
  assert.equal(result.ok, false);
});

test("gerçek üretim eğrisine uyan artış kabul edilir", () => {
  const previous = validateGameSave(startingSave({ lastTickAt: NOW - 3_600_000 }), firstSave);
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  // Sv.1 oduncu kulübesi saatte 22 odun üretir; bir saatlik kazanç bu civarda olmalı.
  const next = startingSave({ lastTickAt: NOW, resources: { ...STARTING_STATE.resources, wood: 300 + 22 } });
  const result = validateGameSave(next, {
    previous: previous.game, previousUpdatedAt: NOW - 3_600_000, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW,
  });
  assert.equal(result.ok, true);
});

test("sunucu simülasyonunun üstündeki kaynak reddedilir", () => {
  const previous = validateGameSave(startingSave({ lastTickAt: NOW - 3_600_000 }), firstSave);
  if (!previous.ok) throw new Error("kurulum başarısız");
  // Kaba tavanların altında kalan ama üretimle açıklanamayan bir artış.
  const next = startingSave({ lastTickAt: NOW, resources: { ...STARTING_STATE.resources, wood: 300 + 4_000 } });
  const result = validateGameSave(next, {
    previous: previous.game, previousUpdatedAt: NOW - 3_600_000, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 409);
  assert.match(result.ok === false ? result.error : "", /sunucunun ürettiği değerin üzerinde/);
});

test("bir saatte imkânsız kaynak sıçraması reddedilir", () => {
  const previous = validateGameSave(startingSave(), firstSave);
  if (!previous.ok) throw new Error("kurulum başarısız");
  const next = startingSave({ resources: { ...STARTING_STATE.resources, gold: 3_000_000 } });
  const result = validateGameSave(next, {
    previous: previous.game, previousUpdatedAt: NOW - 3_600_000, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 409);
});

test("kuruluş zamanı sonradan değiştirilemez", () => {
  const previous = validateGameSave(startingSave(), firstSave);
  if (!previous.ok) throw new Error("kurulum başarısız");
  const result = validateGameSave(startingSave({ foundedAt: NOW - 10_000_000 }), {
    previous: previous.game, previousUpdatedAt: NOW - 60_000, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW,
  });
  assert.equal(result.ok, false);
});

test("üye olunmayan channel adı reddedilir", () => {
  const result = validateGameSave(startingSave({ channel: "Hızlı Taç" }), firstSave);
  assert.equal(result.ok, false);
});

test("bozuk kayıt okunurken çökmez, null döner", () => {
  assert.equal(parseStoredSave("{bozuk json"), null);
  assert.equal(parseStoredSave(JSON.stringify({ version: 2, kingdomName: "X" })), null);
  assert.notEqual(parseStoredSave(JSON.stringify(startingSave())), null);
});

test("kayıt şeması kataloğdaki her binayı kabul eder", () => {
  // Bu satır bir kez kırıldı ve sonucu ağırdı: şemadaki liste elle yazılmıştı,
  // Ambar ve Depo yoktu. Kral Ambar kurunca kaydının TAMAMI okunamaz oldu;
  // cron "Okunabilir bulut kaydı yok" dedi, istemci eski kopyayı aldı ve bina
  // kaybolmuş göründü. Depo'nun seviye atlaması da hiç kalıcı olmadı.
  const missing = catalog.map(item => item.type).filter(type => !BUILDING_TYPES.includes(type));
  assert.deepEqual(missing, [], `kayıt şemasında eksik binalar: ${missing.join(", ")}`);
  assert.ok(BUILDING_TYPES.includes("keep"));
});

test("kataloğdaki her bina içeren kayıt kabul edilir", () => {
  const now = Date.now();
  const everything = {
    version: 2, kingdomName: "D", rulerName: "A", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: now - 1000, lastTickAt: now, protectionEndsAt: now + 1000,
    resources: { gold: 1, food: 1, stone: 1, wood: 1, iron: 1, ale: 1 },
    population: 20, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      ...catalog.map(item => ({ type: item.type, name: item.name, category: item.category, level: 1 })),
    ],
    units: {}, queue: null, notices: [], provider: null, model: null, generalConnected: false,
  };
  assert.ok(parseStoredSave(JSON.stringify(everything)), "her binayı içeren kayıt okunabilmeli");
});

test("gerçekten bilinmeyen bina türü hâlâ reddedilir", () => {
  const now = Date.now();
  const bogus = {
    version: 2, kingdomName: "D", rulerName: "A", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: now - 1000, lastTickAt: now, protectionEndsAt: now + 1000,
    resources: { gold: 1, food: 1, stone: 1, wood: 1, iron: 1, ale: 1 },
    population: 20, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15,
    buildings: [{ type: "altin_basimevi", name: "Darphane", category: "Ekonomi", level: 6 }],
    units: {}, queue: null, notices: [], provider: null, model: null, generalConnected: false,
  };
  assert.equal(parseStoredSave(JSON.stringify(bogus)), null, "uydurma bina kabul edilmemeli");
});

/**
 * PAZAR TEKLİFİYLE KAYNAK ÜRETME AÇIĞI — kapatıldığının kanıtı.
 *
 * Teklifin altını istemcide hesaplanıp kayda yazılıyor ve `tick()` teklif
 * kapanınca o sayıyı sorgusuz hazineye ekliyor. Sömürü iki adımlıydı:
 * (1) kaynaklar aynı kalırken içine sahte bir teklif konur — hiçbir denetim
 * kaynak artışı görmediği için geçer; (2) teklif kapanınca sunucunun kendi
 * simülasyonu AYNI sahte teklifi kendisi de öder ve tavanı doğrular.
 */
function afterFirstSave(overrides: Record<string, unknown> = {}) {
  const first = validateGameSave(startingSave(overrides), firstSave);
  if (!first.ok) throw new Error("kurulum başarısız");
  return first.game;
}

const laterSave = (previous: ReturnType<typeof afterFirstSave>, elapsedMs: number) => ({
  previous, previousUpdatedAt: NOW - elapsedMs, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW,
});

test("fiyat modelinin tavanını aşan pazar teklifi reddedilir", () => {
  const previous = afterFirstSave();
  // Tek birim demir için dokuz milyon altın: eski kodda bu kayıt kabul edilir,
  // teklif kapanınca dokuz milyon altın hazineye yazılırdı.
  const next = startingSave({
    marketOrders: [{
      id: "s-iron-1", resource: "iron", amount: 1, direction: "sell",
      gold: 9_000_000, placedAt: NOW, completesAt: NOW + 30 * 60_000,
    }],
    resources: { ...STARTING_STATE.resources, iron: 99 },
  });
  const result = validateGameSave(next, laterSave(previous, 60_000));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 409);
  assert.match(result.ok === false ? result.error : "", /fiyat modelinin tavanını aşıyor/);
});

test("bedeli ambardan düşülmemiş pazar teklifi kaynak tavanını yükseltmez", () => {
  const previous = afterFirstSave();
  // Fiyatı makul, ama satılan 100 demir ambardan HİÇ düşmemiş: oyuncu hem malı
  // hem parasını almak istiyor. Tavan, verilmeyen peşinat kadar düşürülür.
  // Miktar, tavanın sabit payını (SIMULATION_FLOOR) aşacak kadar büyük seçilir;
  // küçük bir kalem o payın içinde kaybolur ve denetim ölçülemez.
  const bounds = orderGoldBounds("wood", 5_000, "sell");
  const next = startingSave({
    marketOrders: [{
      id: "s-wood-5000", resource: "wood", amount: 5_000, direction: "sell",
      // Kapanma anı motorun bu miktar için verdiği süreden (618 dk) sonra olmalı;
      // aksi hâlde teklif "erken kapanıyor" diye başka bir dalda reddedilir.
      gold: Math.floor((bounds.min + bounds.max) / 2), placedAt: NOW, completesAt: NOW + 700 * 60_000,
    }],
  });
  const result = validateGameSave(next, laterSave(previous, 60_000));
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /sunucunun ürettiği değerin üzerinde/);
});

test("bedeli gerçekten ödenmiş makul pazar teklifi kabul edilir", () => {
  const previous = afterFirstSave();
  const bounds = orderGoldBounds("iron", 100, "sell");
  const next = startingSave({
    marketOrders: [{
      id: "s-iron-100", resource: "iron", amount: 100, direction: "sell",
      gold: Math.floor((bounds.min + bounds.max) / 2), placedAt: NOW, completesAt: NOW + 30 * 60_000,
    }],
    // Mal ambardan hemen çıkar; parası teklif kapanınca gelir.
    resources: { ...STARTING_STATE.resources, iron: 0 },
  });
  const result = validateGameSave(next, laterSave(previous, 60_000));
  assert.equal(result.ok, true);
});

test("bekleyen pazar teklifi sonradan değiştirilemez", () => {
  const bounds = orderGoldBounds("iron", 100, "sell");
  const order = {
    id: "s-iron-100", resource: "iron", amount: 100, direction: "sell",
    gold: Math.floor((bounds.min + bounds.max) / 2), placedAt: NOW, completesAt: NOW + 30 * 60_000,
  };
  const previous = afterFirstSave();
  const opened = validateGameSave(
    startingSave({ marketOrders: [order], resources: { ...STARTING_STATE.resources, iron: 0 } }),
    laterSave(previous, 60_000),
  );
  if (!opened.ok) throw new Error("teklif açılamadı");
  // Bir kez ölçülen teklifin altını ikinci kayıtta yukarı çekilemez.
  const tampered = startingSave({
    marketOrders: [{ ...order, placedAt: order.placedAt + 1_000 }],
    resources: { ...STARTING_STATE.resources, iron: 0 },
  });
  const result = validateGameSave(tampered, laterSave(opened.game, 60_000));
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /sonradan değiştirilemez/);
});

/**
 * SIÇRAMA PAYI PENCEREYE BAĞLI — istek başına ödenmediğinin kanıtı.
 *
 * Eski kural geçen süreyi bir dakikaya yuvarlıyordu, yani 5 saniyede bir
 * kaydeden istemci payın TAMAMINI her istekte yeniden topluyordu. Saniyede 10
 * kayıt atan bir betik saniyede yarım milyon altın basabiliyordu.
 */
test("sıçrama payı kısa aralıkta oransal, tam ödenmiyor", () => {
  const previous = afterFirstSave();
  const jump = startingSave({ resources: { ...STARTING_STATE.resources, gold: 1_000 + 50_000 } });

  // 5 saniyelik pencerede pay 1/12'sidir: büyüme denetimi bu artışı reddeder.
  const quick = validateGameSave(jump, laterSave(previous, 5_000));
  assert.equal(quick.ok, false);
  assert.match(quick.ok === false ? quick.error : "", /geçen sürede mümkün değil/);

  // Aynı artış bir dakikalık pencerede büyüme denetimini geçer — pay orada
  // gerçekten hak edilmiştir. (Simülasyon tavanı onu ayrıca yakalar; burada
  // ölçtüğümüz, payın SÜREYE bağlı olduğu.)
  const slow = validateGameSave(jump, laterSave(previous, 60_000));
  assert.equal(slow.ok, false);
  assert.doesNotMatch(slow.ok === false ? slow.error : "", /geçen sürede mümkün değil/);
});

test("sunucunun türettiği itibar istemcinin bildirdiğini ezer", () => {
  // Haraç ihlalinin cezası (itibar 50 -> 30) bir sonraki kayıtta 100 yazılarak
  // siliniyordu. Artık itibarı yalnızca sunucu yazar.
  const previous = afterFirstSave();
  assert.equal(previous.reputation, 50);
  const result = validateGameSave(startingSave({ reputation: 100 }), laterSave(previous, 60_000));
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.game.reputation, 50);
});

test("Değirmen kurmuş kayıt, Değirmen'e etki verildikten sonra da kabul edilir", () => {
  // Geriye dönük uyum: hâlihazırda Değirmen kurmuş Kralların kaydı, binanın
  // artık gerçekten yiyecek üretmesi yüzünden reddedilmemeli. Tavan da aynı
  // motordan çıktığı için kendiliğinden yükselir.
  const milled = [
    { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
    { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 2 },
    { type: "mill", name: "Değirmen", category: "Ekonomi", level: 2 },
  ];
  const previous = validateGameSave(startingSave({ lastTickAt: NOW - 3_600_000, buildings: milled }), firstSave);
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  const produced = tick(previous.game as never, NOW);
  const result = validateGameSave({ ...produced, notices: [] }, {
    previous: previous.game, previousUpdatedAt: NOW - 3_600_000, channelSpeed: 1, channelName: "Standart Sezon I", now: NOW,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  // Etki gerçekten var: tarla Sv.2 + Değirmen Sv.2 = 36 × 1,5 = 54 yiyecek/sa brüt.
  assert.equal(Math.round(grossRates(previous.game as never).food), 54);
});
