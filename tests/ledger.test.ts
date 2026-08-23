import assert from "node:assert/strict";
import test from "node:test";
import {
  LEDGER_KINDS, LEDGER_LIMIT, RESTATE_WINDOW_MS, type LedgerEntry, type LedgerKind,
  deriveLedgerEvents, phraseFor, pruneLedger, recordEvent, recordEvents, renderLedger, timesPhrase,
} from "../engine/ledger";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

const signals = (overrides: Partial<Parameters<typeof deriveLedgerEvents>[0]> = {}) => ({
  resources: { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
  hourlyRates: { gold: 3, food: 14, stone: 0, wood: 22, iron: 0, ale: 0 },
  populace: { moodScore: 50, foodRation: 100, soldierPay: 100, soldierUnrest: 0, army: 0 },
  appliedActions: [] as string[],
  kingOverrode: false,
  generalRefused: false,
  kingBackedDown: false,
  requestsMet: 0,
  requestsRefused: 0,
  ...overrides,
});

// --- kayıt ve birleştirme ---------------------------------------------------

test("aynı türden olay yeni madde açmaz, ağırlığı artırır", () => {
  let entries = recordEvent([], "override", T0);
  entries = recordEvent(entries, "override", T0 + HOUR);
  assert.equal(entries.length, 1, "tek madde kalmalı");
  assert.equal(entries[0].weight, 2);
  assert.equal(entries[0].firstSeenAt, T0, "ilk görülme korunur");
  assert.equal(entries[0].lastSeenAt, T0 + HOUR);
});

test("farklı türler ayrı maddelerde durur", () => {
  const entries = recordEvents([], ["override", "starvation", "festival"], T0);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(entry => entry.kind).sort(), ["festival", "override", "starvation"]);
});

test("durum temelli madde tekrar penceresi dolmadan yeniden sayılmaz", () => {
  // Halk açken her mesajda "yine aç bıraktınız" saymak tek krizi onlarca
  // suçlamaya çevirirdi.
  let entries = recordEvent([], "starvation", T0);
  entries = recordEvent(entries, "starvation", T0 + HOUR);
  assert.equal(entries[0].weight, 1, "pencere içinde ağırlık artmamalı");
  entries = recordEvent(entries, "starvation", T0 + RESTATE_WINDOW_MS + 1);
  assert.equal(entries[0].weight, 2, "pencere dolunca yeniden sayılır");
});

test("olay temelli madde pencereye takılmaz", () => {
  // İtirazın ezilmesi tekil bir olaydır; arka arkaya olsa da her biri sayılır.
  let entries = recordEvent([], "override", T0);
  entries = recordEvent(entries, "override", T0 + 1000);
  assert.equal(entries[0].weight, 2);
});

// --- budama -----------------------------------------------------------------

test("defter sınırı aşınca en sönük madde düşer", () => {
  const many: LedgerEntry[] = Array.from({ length: LEDGER_LIMIT + 3 }, (_, index) => ({
    kind: `kind${index}` as LedgerKind,
    weight: index === 0 ? 1 : index + 1,
    firstSeenAt: T0,
    lastSeenAt: T0 + index,
  }));
  const pruned = pruneLedger(many);
  assert.equal(pruned.length, LEDGER_LIMIT);
  // Sentetik türler kullanıldığı için karşılaştırma string üzerinden yapılır.
  assert.ok(!pruned.some(entry => String(entry.kind) === "kind0"), "en düşük ağırlıklı madde düşmeli");
});

test("sınırın altındaki defter olduğu gibi kalır", () => {
  const entries = recordEvents([], ["override", "festival"], T0);
  assert.deepEqual(pruneLedger(entries), entries);
});

test("ağırlık eşitse taze madde korunur", () => {
  const entries: LedgerEntry[] = [
    { kind: "override", weight: 1, firstSeenAt: T0, lastSeenAt: T0 },
    { kind: "festival", weight: 1, firstSeenAt: T0, lastSeenAt: T0 + HOUR },
  ];
  const pruned = pruneLedger(entries, 1);
  assert.equal(pruned[0].kind, "festival");
});

// --- dil --------------------------------------------------------------------

test("tekrar sayısı Türkçe sözcükle yazılır", () => {
  assert.equal(timesPhrase(1), "bir kez");
  assert.equal(timesPhrase(3), "üç kez");
  assert.equal(timesPhrase(14), "14 kez");
});

test("tekrar eden davranışta dil sertleşir", () => {
  const once = phraseFor({ kind: "override", weight: 1 });
  const often = phraseFor({ kind: "override", weight: 3 });
  assert.match(once, /bir kez/);
  assert.match(often, /üç kez/);
  assert.notEqual(once, often, "tekrar eden davranış karakter tespitine dönüşmeli");
  assert.match(often, /ciddiye almama/);
});

test("her madde türü bir cümle üretir", () => {
  // Liste ARTIK ELLE YAZILMIYOR: motorun kendi `LEDGER_KINDS` dizisinden
  // okunur. Eskiden burada elle yazılı bir kopya vardı ve yeni bir tür
  // eklendiğinde test onu hiç görmüyordu — cümlesi olmayan bir tür sessizce
  // geçebiliyordu.
  assert.ok(LEDGER_KINDS.length >= 13, "tür listesi eksilmiş olmasın");
  for (const kind of LEDGER_KINDS) {
    for (const weight of [1, 2, 5]) {
      const text = phraseFor({ kind, weight });
      assert.ok(text.length > 10, `${kind} (ağırlık ${weight}) için cümle üretilmeli`);
    }
  }
});

test("boş defter boş metin verir", () => {
  assert.equal(renderLedger([], T0), "");
});

test("defter metni en tazeden eskiye sıralanır ve yaş belirtir", () => {
  const entries: LedgerEntry[] = [
    { kind: "starvation", weight: 1, firstSeenAt: T0 - 50 * HOUR, lastSeenAt: T0 - 50 * HOUR },
    { kind: "override", weight: 1, firstSeenAt: T0 - 2 * HOUR, lastSeenAt: T0 - 2 * HOUR },
  ];
  const lines = renderLedger(entries, T0).split("\n");
  assert.match(lines[0], /itirazımı/, "en taze madde başta olmalı");
  assert.match(lines[0], /2 saat önce/);
  assert.match(lines[1], /2 gün önce/);
});

// --- olay türetme -----------------------------------------------------------

test("itirazın ezilmesi ve ret deftere geçer", () => {
  const kinds = deriveLedgerEvents(signals({ kingOverrode: true, generalRefused: true }));
  assert.ok(kinds.includes("override"));
  assert.ok(kinds.includes("refusal"));
});

test("uyarıya uyup vazgeçmek deftere geçer", () => {
  assert.ok(deriveLedgerEvents(signals({ kingBackedDown: true })).includes("heeded"));
});

test("düşük istihkak açlık olarak deftere geçer", () => {
  const kinds = deriveLedgerEvents(signals({ populace: { foodRation: 40, army: 0 } }));
  assert.ok(kinds.includes("starvation"));
  assert.ok(!kinds.includes("fed_people"));
});

test("yiyecek birkaç saat içinde bitiyorsa açlık sayılır", () => {
  const kinds = deriveLedgerEvents(signals({
    resources: { gold: 1000, food: 30, stone: 0, wood: 0, iron: 0, ale: 0 },
    hourlyRates: { gold: 3, food: -10, stone: 0, wood: 0, iron: 0, ale: 0 },
  }));
  assert.ok(kinds.includes("starvation"), "3 saatlik yiyecek açlık demektir");
});

test("tam istihkak ve artı üretim tokluk olarak deftere geçer", () => {
  const kinds = deriveLedgerEvents(signals());
  assert.ok(kinds.includes("fed_people"));
  assert.ok(!kinds.includes("starvation"));
});

test("firar eşiğini geçen huzursuzluk deftere geçer", () => {
  const kinds = deriveLedgerEvents(signals({ populace: { army: 20, soldierUnrest: 70, soldierPay: 0 } }));
  assert.ok(kinds.includes("desertion"));
  assert.ok(!kinds.includes("paid_soldiers"));
});

test("ordu yokken maaş maddesi hiç açılmaz", () => {
  const kinds = deriveLedgerEvents(signals({ populace: { army: 0, soldierUnrest: 90 } }));
  assert.ok(!kinds.includes("desertion"));
  assert.ok(!kinds.includes("paid_soldiers"));
});

test("dibe vuran hazine deftere geçer", () => {
  const kinds = deriveLedgerEvents(signals({
    resources: { gold: 10, food: 500, stone: 0, wood: 0, iron: 0, ale: 0 },
  }));
  assert.ok(kinds.includes("treasury_drain"));
});

test("karşılanan ve geçiştirilen talepler sayısınca deftere geçer", () => {
  const kinds = deriveLedgerEvents(signals({ requestsMet: 2, requestsRefused: 1 }));
  assert.equal(kinds.filter(kind => kind === "request_met").length, 2);
  assert.equal(kinds.filter(kind => kind === "request_refused").length, 1);
});

test("şenlik emri deftere geçer", () => {
  assert.ok(deriveLedgerEvents(signals({ appliedActions: ["host_festival"] })).includes("festival"));
});

test("üst üste ezilen itirazlar tek maddede birikir ve dile yansır", () => {
  // Uçtan uca: üç tur boyunca Kral itirazı ezerse defterde tek satır ve
  // "üç kez" ifadesi olmalı.
  let entries: LedgerEntry[] = [];
  for (let turn = 0; turn < 3; turn += 1) {
    entries = recordEvents(entries, deriveLedgerEvents(signals({ kingOverrode: true })), T0 + turn * HOUR);
  }
  const override = entries.find(entry => entry.kind === "override");
  assert.equal(override?.weight, 3);
  assert.match(renderLedger(entries, T0 + 3 * HOUR), /üç kez/);
});

// --- KOALİSYON MASASI: elebaşının sertleşmesi (Fikir 8) --------------------

test("masaya oturmak ve geçiştirmek AYNI turda birlikte sayılmaz", () => {
  // Kral hem pazarlığa oturup hem geçiştirmiş olamaz; karşılama önce sınanır ki
  // sınırdaki bir tur Kral'ın aleyhine yazılmasın.
  const both = deriveLedgerEvents(signals({ factionSettled: true, factionDefied: true }));
  assert.ok(both.includes("faction_settled"));
  assert.ok(!both.includes("faction_defied"));
  const only = deriveLedgerEvents(signals({ factionDefied: true }));
  assert.ok(only.includes("faction_defied"));
  assert.ok(!only.includes("faction_settled"));
  // Masa girdisi hiç yoksa defterde masa satırı da yok.
  const none = deriveLedgerEvents(signals());
  assert.ok(!none.some(kind => kind.startsWith("faction_")));
});

test("ELEBAŞI SERTLEŞİR: tekrar eden ret ağırlıkla dili sertleştirir", () => {
  // Kararın (2026-08-22) ikinci maddesi. Sertleşme defterin ARTAN AĞIRLIK
  // deseninde yaşıyor — `override` ile birebir aynı desen.
  const soft = phraseFor({ kind: "faction_defied", weight: 1 });
  const hard = phraseFor({ kind: "faction_defied", weight: 3 });
  assert.notEqual(soft, hard);
  assert.match(hard, /sertleşiyor/);
  assert.ok(hard.length > soft.length, "üç kez geçiştirmek bir kezden ağır anlatılmalı");
  // Masaya oturmak da ağırlıkla bir karakter tespitine dönüşür.
  assert.notEqual(
    phraseFor({ kind: "faction_settled", weight: 1 }),
    phraseFor({ kind: "faction_settled", weight: 3 }),
  );
});

test("masa reddi DURUM temellidir: tekrar penceresi dolmadan yeniden sayılmaz", () => {
  // Baskı 50'nin üstünde kaldığı sürece talep AÇIK kalır; pencere olmasa Kral
  // tek bir konuşmada ağırlığı üçe çıkarır ve elebaşı sebepsiz yere en sert
  // diline geçerdi.
  let entries = recordEvent([], "faction_defied", T0);
  entries = recordEvent(entries, "faction_defied", T0 + RESTATE_WINDOW_MS - 1);
  assert.equal(entries[0].weight, 1, "pencere dolmadan ağırlık artmamalı");
  entries = recordEvent(entries, "faction_defied", T0 + RESTATE_WINDOW_MS);
  assert.equal(entries[0].weight, 2);
  // Karşılama OLAY temellidir: pencereye takılmaz, çünkü Kral üst üste
  // pazarlığa oturabilir ve her biri gerçek bir hamledir.
  let settled = recordEvent([], "faction_settled", T0);
  settled = recordEvent(settled, "faction_settled", T0 + 1);
  assert.equal(settled[0].weight, 2);
});

test("üç tur geçiştirme tek maddede birikir ve defter metnine yansır", () => {
  let entries: LedgerEntry[] = [];
  for (let turn = 0; turn < 3; turn += 1) {
    entries = recordEvents(
      entries,
      deriveLedgerEvents(signals({ factionDefied: true })),
      T0 + turn * RESTATE_WINDOW_MS,
    );
  }
  const table = entries.find(entry => entry.kind === "faction_defied");
  assert.equal(table?.weight, 3);
  assert.match(renderLedger(entries, T0 + 3 * RESTATE_WINDOW_MS), /üç kez/);
  assert.match(renderLedger(entries, T0 + 3 * RESTATE_WINDOW_MS), /sertleşiyor/);
});
