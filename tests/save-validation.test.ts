import assert from "node:assert/strict";
import test from "node:test";
import { STARTING_STATE, parseStoredSave, validateGameSave } from "../server/save-validation";

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
