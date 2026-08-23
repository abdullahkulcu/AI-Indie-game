import assert from "node:assert/strict";
import test from "node:test";
import {
  INTEL_MISSIONS, INTEL_MISSION_KINDS, INTEL_TRAVEL_MIN_MS,
  intelChances, intelTravelMs, isIntelMissionKind, resolveIntelMission,
} from "../engine/intel";
import { intelReportOf, moodLabelOf, type PublicKingdom } from "../server/world-projection";

/**
 * DERİN GÖZETLEME (plan belgesi Fikir 5).
 *
 * Kararın iki yarısı test ediliyor: (a) bu bilgi standart raporun parçası
 * DEĞİL, ayrı ve daha riskli/pahalı bir görev; (b) rapor kaba durum etiketi
 * verir, kesin sayı ASLA.
 */

const CHANNEL = "Standart Sezon I";
const NOW = 1_800_000_000_000;

const kingdom: PublicKingdom = {
  id: "u1", name: "Demirkale", ruler: "Alaric", terrain: "plain",
  keepLevel: 3, population: 120, buildingCount: 8, army: 14,
};

function saveJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 2, kingdomName: "Akçakale", rulerName: "Bertran", channel: CHANNEL, channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: NOW - 86_400_000, lastTickAt: NOW,
    protectionEndsAt: NOW - 1000,
    resources: { gold: 900, food: 400, stone: 200, wood: 200, iron: 50, ale: 0 },
    population: 100, capacity: 150, popularity: 80, reputation: 50, loyalty: 70, taxRate: 12,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 2 }],
    units: {}, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  });
}

// --- görev türleri: bedel ve risk --------------------------------------------

test("derin gözetleme ayrı bir görev türüdür ve liste tek kaynaktan okunur", () => {
  assert.deepEqual([...INTEL_MISSION_KINDS], ["scout", "deep"]);
  assert.ok(isIntelMissionKind("deep"));
  assert.ok(isIntelMissionKind("scout"));
  assert.equal(isIntelMissionKind("derin"), false);
  assert.equal(isIntelMissionKind(undefined), false);
});

test("derin gözetleme daha pahalı, daha düşük ihtimalli ve daha riskli", () => {
  // Karar (2026-08-22): "daha düşük başarı ihtimali, daha yüksek bedel."
  assert.equal(INTEL_MISSIONS.scout.goldCost, 0, "standart keşif bedavadır");
  assert.ok(INTEL_MISSIONS.deep.goldCost > 0, "derin gözetleme bedelsiz olamaz");
  for (const defended of [false, true]) {
    const scout = intelChances("scout", defended), deep = intelChances("deep", defended);
    assert.ok(deep.successChance < scout.successChance, `başarı ihtimali düşmedi (defended=${defended})`);
    assert.ok(deep.detectionChance > scout.detectionChance, `tespit ihtimali yükselmedi (defended=${defended})`);
  }
  // Karşı-istihbarat ayaktaysa iki türde de iş zorlaşır.
  assert.ok(intelChances("deep", true).successChance < intelChances("deep", false).successChance);
  assert.ok(intelChances("deep", true).detectionChance > intelChances("deep", false).detectionChance);
});

test("derin gözetleme ajanı yolda daha uzun kalır; hız süreyi kısaltır ama tabanı geçmez", () => {
  assert.ok(intelTravelMs("deep", 1) > intelTravelMs("scout", 1));
  assert.ok(intelTravelMs("deep", 24) < intelTravelMs("deep", 1));
  assert.equal(intelTravelMs("scout", 1000), INTEL_TRAVEL_MIN_MS);
  // Hız bozuk gelse bile süre negatife/NaN'a düşmez.
  assert.equal(intelTravelMs("scout", 0), intelTravelMs("scout", 1));
});

// --- zar --------------------------------------------------------------------

test("zar tohumludur: aynı görev kimliği aynı sonucu verir", () => {
  const input = { missionId: "gorev-1", successChance: 50, detectionChance: 50, hasSnapshot: true };
  assert.deepEqual(resolveIntelMission(input), resolveIntelMission(input));
  // Farklı görev farklı tohum: en az bir kimlik farklı sonuç vermeli, yoksa
  // zar sabit demektir.
  const outcomes = new Set(Array.from({ length: 40 }, (_, index) =>
    resolveIntelMission({ ...input, missionId: `gorev-${index}` }).succeeded));
  assert.equal(outcomes.size, 2, "zar sabit: 40 farklı görev aynı sonucu verdi");
});

test("hedefin kaydı okunamıyorsa görev başarıya çevrilemez", () => {
  const blind = resolveIntelMission({ missionId: "gorev-1", successChance: 100, detectionChance: 0, hasSnapshot: false });
  assert.equal(blind.succeeded, false);
  assert.notEqual(blind.status, "succeeded");
});

test("başarı tespitin önünde okunur; başarısız ajan yakalanabilir", () => {
  const won = resolveIntelMission({ missionId: "g", successChance: 100, detectionChance: 100, hasSnapshot: true });
  assert.equal(won.status, "succeeded", "başarılı ajan yakalanmış sayılmaz");
  const caught = resolveIntelMission({ missionId: "g", successChance: 0, detectionChance: 100, hasSnapshot: true });
  assert.equal(caught.status, "detected");
  const quiet = resolveIntelMission({ missionId: "g", successChance: 0, detectionChance: 0, hasSnapshot: true });
  assert.equal(quiet.status, "failed");
});

test("ihtimal gerçekten ihtimaldir: düşük şans nadiren tutar", () => {
  // Tohumun tek düze dağıldığını kabaca doğrular. Bozuk bir tohum (hep 0 ya da
  // hep 1) bu testi kırar: %6'lık bir görev ya hiç ya her zaman tutardı.
  const tries = 3000;
  let wins = 0;
  for (let index = 0; index < tries; index += 1) {
    if (resolveIntelMission({ missionId: `m-${index}`, successChance: 6, detectionChance: 0, hasSnapshot: true }).succeeded) wins += 1;
  }
  const rate = wins / tries * 100;
  assert.ok(rate > 2 && rate < 12, `%6'lık görev %${rate.toFixed(1)} tuttu`);
});

// --- raporun içeriği --------------------------------------------------------

test("standart keşif raporu moral bilgisi TAŞIMAZ", () => {
  const report = intelReportOf(kingdom);
  // Alan HİÇ yazılmaz (null bile değil): standart raporun alan listesi bu
  // maddeden önceki hâliyle aynı kalır.
  assert.equal("mood" in report, false, "standart rapora moral alanı sızdı");
  assert.equal(report.mood, undefined);
  assert.deepEqual(Object.keys(report).sort(), ["army", "buildingCount", "keepLevel", "name", "population", "ruler", "terrain"]);
  assert.equal("resources" in report, false, "ambar rapora sızdı");
  assert.equal(JSON.stringify(intelReportOf(kingdom, null)), JSON.stringify(report), "null moral yeni bir alan açmamalı");
});

test("derin gözetleme raporu yalnızca ETİKET taşır, sayı taşımaz", () => {
  const report = intelReportOf(kingdom, "Huzursuz");
  assert.equal(report.mood, "Huzursuz");
  assert.equal(/\d/.test(String(report.mood)), false, "moral alanına sayı girdi");
});

test("moral etiketi kayıttan motorun kademeleriyle türer", () => {
  // Rızası yüksek, askeri olmayan krallık: "Memnun".
  assert.equal(moodLabelOf(saveJson({ popularity: 85 }), CHANNEL), "Memnun");
  // Rıza düştükçe etiket sertleşir; sayı hiçbir zaman dışarı çıkmaz.
  assert.equal(moodLabelOf(saveJson({ popularity: 50 }), CHANNEL), "Huzursuz");
  assert.equal(moodLabelOf(saveJson({ popularity: 30 }), CHANNEL), "Kaynıyor");
  assert.equal(moodLabelOf(saveJson({ popularity: 5 }), CHANNEL), "İsyan");
  for (const popularity of [0, 12, 33, 47, 68, 91]) {
    const label = moodLabelOf(saveJson({ popularity }), CHANNEL);
    assert.equal(/\d/.test(String(label)), false, `etikete sayı sızdı: ${label}`);
  }
});

test("asker huzursuzluğu bastırır: ajan sokakta ne görüyorsa onu getirir", () => {
  const bare = moodLabelOf(saveJson({ popularity: 15, units: {} }), CHANNEL);
  const garrisoned = moodLabelOf(saveJson({ popularity: 15, units: { spearman: 30 }, soldierUnrest: 0 }), CHANNEL);
  assert.equal(bare, "İş bırakma");
  assert.notEqual(garrisoned, bare, "bastırılmış huzursuzluk raporda da bastırılmış görünmeli");
});

test("başka channel'ın ya da bozuk bir kaydın morali sızmaz", () => {
  assert.equal(moodLabelOf(saveJson({ channel: "Başka Sezon" }), CHANNEL), null);
  assert.equal(moodLabelOf("{bozuk", CHANNEL), null);
  assert.equal(moodLabelOf(JSON.stringify({ channel: CHANNEL }), CHANNEL), null);
});
