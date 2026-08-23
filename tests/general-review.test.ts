import assert from "node:assert/strict";
import test from "node:test";
import { assessAction, pulseNote, reviewProposedActions, type ActionCost, type KingdomSnapshot, type ProposedAction } from "../server/general-risk";
import { FACTION_THRESHOLDS, populacePulse } from "../engine/faction";

const base: KingdomSnapshot = {
  resources: { gold: 10_000, food: 5_000, stone: 5_000, wood: 5_000, iron: 1_000, ale: 0 },
  hourlyRates: { gold: 20, food: 30, stone: 10, wood: 20, iron: 0, ale: 0 },
  population: 400,
  popularity: 60,
  loyalty: 75,
  army: 20,
  protectionHoursLeft: 0,
  counterIntelligenceActive: true,
};

const cheap = { name: "build_structure", arguments: { building_type: "barracks", target_level: 1 } };
const ruinous = { name: "build_structure", arguments: { building_type: "wall", target_level: 1 } };
const costs = (action: ProposedAction): ActionCost =>
  action.arguments.building_type === "wall" ? { gold: 9_000 } : { gold: 200 };
const noConfirm = { insisted: false, justified: false };

test("rutin emir doğrudan geçer, itiraz notu üretilmez", () => {
  const review = reviewProposedActions([cheap], base, costs, null, noConfirm);
  assert.equal(review.approved.length, 1);
  assert.deepEqual(review.notes, []);
  assert.equal(review.toStore, null);
});

test("ağır riskli emir uygulanmaz ve teyit için saklanır", () => {
  const review = reviewProposedActions([ruinous], base, costs, null, noConfirm);
  assert.equal(review.approved.length, 0);
  assert.equal(review.toStore?.riskLevel, "severe");
  assert.match(review.notes[0], /^⏸/);
  assert.match(review.notes[0], /Onayınızı bekliyorum/);
});

test("gerekçeli ısrar bekleyen emri uygular ve kaydı düşürür", () => {
  const review = reviewProposedActions([ruinous], base, costs, "build_structure", { insisted: true, justified: true });
  assert.equal(review.approved.length, 1);
  assert.equal(review.approved[0].arguments.confirmed_risk, true);
  assert.equal(review.clearPending, true);
  assert.equal(review.toStore, null);
  assert.match(review.notes[0], /^⚠/);
});

test("düşük sadakatte ısrar reddedilir, emir saklanmaz", () => {
  const disloyal = { ...base, loyalty: 20 };
  const review = reviewProposedActions([ruinous], disloyal, costs, "build_structure", { insisted: true, justified: true });
  assert.equal(review.approved.length, 0);
  assert.equal(review.toStore, null);
  assert.match(review.notes[0], /^✕/);
  assert.match(review.notes[0], /ikna etmelisiniz/);
});

test("modelin uydurduğu confirmed_risk bayrağına güvenilmez", () => {
  const forged = { name: "build_structure", arguments: { building_type: "wall", target_level: 1, confirmed_risk: true } };
  const review = reviewProposedActions([forged], base, costs, null, noConfirm);
  assert.equal(review.approved.length, 0, "model kendi kendine teyit veremez");
});

test("başka bir emre verilen onay bekleyen emri açmaz", () => {
  const review = reviewProposedActions([ruinous], base, costs, "set_tax_rate", { insisted: true, justified: true });
  assert.equal(review.approved.length, 0);
  assert.match(review.notes[0], /^⏸/);
});

test("aynı turda birden fazla riskli emirden yalnızca biri saklanır", () => {
  const review = reviewProposedActions([ruinous, { name: "set_tax_rate", arguments: { rate_percent: 48 } }], base, costs, null, noConfirm);
  assert.equal(review.approved.length, 0);
  assert.equal(review.notes.length, 2);
  assert.equal(review.toStore?.action.name, "build_structure");
});

test("riskli emir engellenirken aynı turdaki rutin emir uygulanır", () => {
  const review = reviewProposedActions([cheap, ruinous], base, costs, null, noConfirm);
  assert.equal(review.approved.length, 1);
  assert.equal(review.approved[0].arguments.building_type, "barracks");
  assert.equal(review.toStore?.action.arguments.building_type, "wall");
});

// --- HALKIN NABZI (Fikir 6) ------------------------------------------------

test("nabız yalnızca zaten var olan eşiklerden okunur, yeni kademe uydurulmaz", () => {
  // Rıza `moodFloor`un üstünde ve baskı yok: gidişat da iyi.
  assert.equal(populacePulse(65, 0).id, "steady");
  // Rıza muhalefetin beslendiği bandın İÇİNDE ama baskı henüz sıfır: gösterge
  // yine uyarır, çünkü ölçü `factionTarget` (gidişat), bugünkü baskı değil.
  assert.equal(populacePulse(30, 0).id, "grumbling");
  // Baskı kıpırdanma eşiğini geçtiyse rıza iyi olsa bile nabız yumuşamaz.
  assert.equal(populacePulse(65, FACTION_THRESHOLDS.stirring).id, "grumbling");
  assert.equal(populacePulse(65, FACTION_THRESHOLDS.organized).id, "hostile");
  assert.equal(populacePulse(65, FACTION_THRESHOLDS.defiant).id, "breaking");
  // Eşiğin bir tık altı bir üst kademeye geçmez.
  assert.equal(populacePulse(65, FACTION_THRESHOLDS.organized - 1).id, "grumbling");
  assert.equal(populacePulse(65, FACTION_THRESHOLDS.defiant - 1).id, "hostile");
});

test("NİTEL ETİKET: nabız metinleri hiçbir sayı ya da yüzde taşımaz", () => {
  // Karar (2026-08-22): sayısal tahmin YOK — min-maxing riski bilinçli olarak
  // reddedildi. Bir sayı sızarsa bu test kırılır.
  for (const pressure of [0, FACTION_THRESHOLDS.stirring, FACTION_THRESHOLDS.organized, FACTION_THRESHOLDS.defiant]) {
    for (const mood of [10, 30, 45, 65, 90]) {
      const pulse = populacePulse(mood, pressure);
      assert.ok(!/[0-9%]/.test(pulse.label), pulse.label);
      assert.ok(!/[0-9%]/.test(pulse.note), pulse.note);
      assert.ok(pulse.label.length > 10 && pulse.note.length > 20, pulse.id);
    }
  }
});

test("bozuk nabız girdisi en yumuşak kademeye düşer", () => {
  assert.equal(populacePulse(Number.NaN, Number.NaN).id, "steady");
  assert.equal(populacePulse(65, -20).id, "steady");
});

test("nabız RUTİN emirde gösterilmez — kapı DOĞRUDAN sınanır", () => {
  const routine = assessAction(cheap, { ...base, popularity: 20 }, { gold: 200 });
  assert.equal(routine.level, "low");
  // Değerlendirme nabzı yine HESAPLAR: hesap ile gösterim kapısı ayrıdır.
  assert.equal(routine.pulse.id, "grumbling");
  // Ama `low` kademede tek karakter bile basılmaz. Bu iddia `pulseNote`u
  // doğrudan çağırıyor: `reviewProposedActions` `low` kademede hiç not
  // üretmediği için kapı o yoldan sınanamıyordu (kapıyı kaldıran bir mutasyon
  // tek bir testi bile kırmıyordu).
  assert.equal(pulseNote(routine), "");
  assert.match(pulseNote({ ...routine, level: "elevated" }), /HALKIN NABZI/);
  assert.match(pulseNote({ ...routine, level: "severe" }), /HALKIN NABZI/);
  const review = reviewProposedActions([cheap], { ...base, popularity: 20 }, costs, null, noConfirm);
  assert.deepEqual(review.notes, []);
});

test("nabız ORTA riskte (elevated) de gösterilir, yalnızca severe değil", () => {
  // Karar (2026-08-22) birinci maddesi. %35 vergi `elevated` üretir.
  const elevated = { name: "set_tax_rate", arguments: { rate_percent: 35 } };
  const state = { ...base, popularity: 30, factionPressure: 0 };
  assert.equal(assessAction(elevated, state, {}).level, "elevated");
  const review = reviewProposedActions([elevated], state, () => ({}), null, noConfirm);
  assert.match(review.notes[0], /^⏸/);
  assert.match(review.notes[0], /HALKIN NABZI/);
  assert.match(review.notes[0], /hoş karşılamaz/);
});

test("nabız ağır riskte teyit, ısrar ve ret notlarının hepsinde görünür", () => {
  const angry = { ...base, popularity: 20, factionPressure: FACTION_THRESHOLDS.organized };
  const waiting = reviewProposedActions([ruinous], angry, costs, null, noConfirm);
  assert.match(waiting.notes[0], /^⏸/);
  assert.match(waiting.notes[0], /açıkça karşı çıkar/);
  const applied = reviewProposedActions([ruinous], angry, costs, "build_structure", { insisted: true, justified: true });
  assert.match(applied.notes[0], /^⚠/);
  assert.match(applied.notes[0], /HALKIN NABZI/);
  const refused = reviewProposedActions([ruinous], { ...angry, loyalty: 20 }, costs, "build_structure", { insisted: true, justified: true });
  assert.match(refused.notes[0], /^✕/);
  assert.match(refused.notes[0], /HALKIN NABZI/);
});

test("baskı bildirilmeyen çağıran için nabız yalnızca rızadan okunur", () => {
  // `factionPressure` opsiyonel: eski çağıran gösterge kaybetmez.
  const state = { ...base, popularity: 15 };
  assert.equal(assessAction(ruinous, state, { gold: 9_000 }).pulse.id, "grumbling");
  const calm = { ...base, popularity: 80 };
  assert.equal(assessAction(ruinous, calm, { gold: 9_000 }).pulse.id, "steady");
  const review = reviewProposedActions([ruinous], calm, costs, null, noConfirm);
  assert.match(review.notes[0], /arkanızda/);
});
