import assert from "node:assert/strict";
import test from "node:test";
import { LOYALTY, assessAction, decide, readConfirmation, type KingdomSnapshot } from "../server/general-risk";

const healthy: KingdomSnapshot = {
  resources: { gold: 10_000, food: 5_000, stone: 5_000, wood: 5_000, iron: 1_000, ale: 0 },
  hourlyRates: { gold: 20, food: 30, stone: 10, wood: 20, iron: 0, ale: 0 },
  population: 400,
  popularity: 60,
  loyalty: 75,
  army: 20,
  protectionHoursLeft: 0,
  counterIntelligenceActive: true,
};

const build = { name: "build_structure", arguments: { building_type: "barracks", target_level: 1 } };

test("ucuz emir düşük riskli ve doğrudan uygulanır", () => {
  const assessment = assessAction(build, healthy, { gold: 200, wood: 150 });
  assert.equal(assessment.level, "low");
  assert.equal(decide(assessment, 75, false, false).outcome, "apply");
});

test("hazinenin üçte ikisini yiyen emir ağır risk sayılır", () => {
  const assessment = assessAction(build, healthy, { gold: 8_000 });
  assert.equal(assessment.level, "severe");
  assert.match(assessment.reasons[0], /altın/);
  assert.equal(decide(assessment, 75, false, false).outcome, "confirm");
});

test("açlık yaklaşırken yiyecek getirmeyen emir ağır risktir", () => {
  const starving: KingdomSnapshot = { ...healthy, resources: { ...healthy.resources, food: 60 }, hourlyRates: { ...healthy.hourlyRates, food: -30 } };
  const assessment = assessAction(build, starving, { gold: 100 });
  assert.equal(assessment.level, "severe");
  assert.match(assessment.reasons.join(" "), /aç bırakır/);
});

test("tarla kurmak açlık sırasında cezalandırılmaz", () => {
  const starving: KingdomSnapshot = { ...healthy, resources: { ...healthy.resources, food: 60 }, hourlyRates: { ...healthy.hourlyRates, food: -30 } };
  const farm = { name: "build_structure", arguments: { building_type: "wheat_farm", target_level: 1 } };
  assert.equal(assessAction(farm, starving, { gold: 100 }).level, "low");
});

test("yüksek vergi risk seviyesini yükseltir", () => {
  assert.equal(assessAction({ name: "set_tax_rate", arguments: { rate_percent: 35 } }, healthy).level, "elevated");
  assert.equal(assessAction({ name: "set_tax_rate", arguments: { rate_percent: 48 } }, healthy).level, "severe");
});

test("nüfusun dörtte birinden fazlasını askere almak ağır risktir", () => {
  assert.equal(assessAction({ name: "train_unit", arguments: { unit_type: "spearman", count: 150 } }, healthy).level, "severe");
});

test("nöbet yokken ajan yollamak orta risklidir", () => {
  const exposed: KingdomSnapshot = { ...healthy, counterIntelligenceActive: false };
  assert.equal(assessAction({ name: "send_scout", arguments: { target_ordinal: 1 } }, exposed).level, "elevated");
});

test("düşük sadakatte General ağır riskli emri reddeder, Kral 'yap' diyerek geçemez", () => {
  const assessment = assessAction(build, healthy, { gold: 9_000 });
  const verdict = decide(assessment, LOYALTY.wary - 1, true, true);
  assert.equal(verdict.outcome, "refuse");
});

test("ağır riskte gerekçesiz ısrar orta sadakatte yetmez", () => {
  const assessment = assessAction(build, healthy, { gold: 9_000 });
  assert.equal(decide(assessment, 55, true, false).outcome, "confirm");
});

test("ağır riskte gerekçeli ısrar uygulanır", () => {
  const assessment = assessAction(build, healthy, { gold: 9_000 });
  assert.equal(decide(assessment, 55, true, true).outcome, "apply");
});

test("yüksek sadakatte gerekçesiz ısrar da yeter", () => {
  const assessment = assessAction(build, healthy, { gold: 9_000 });
  assert.equal(decide(assessment, LOYALTY.obedient + 5, true, false).outcome, "apply");
});

test("Kralın onayı ve gerekçesi mesajdan okunur", () => {
  assert.deepEqual(readConfirmation("yap"), { insisted: true, cancelled: false, justified: false });
  assert.equal(readConfirmation("yine de uygula çünkü sınırda savaş var").justified, true);
  assert.equal(readConfirmation("vazgeçtim, yapma").insisted, false);
  assert.equal(readConfirmation("vazgeçtim, yapma").cancelled, true);
});

test("kısa onaylar bekleyen emri uygular", () => {
  // Bu satır bir kez kırıldı: readConfirmation'ın kendi listesi vardı ve
  // "onay" ile "onay veriyorum" hiç eşleşmiyordu. Kral onay verdiğini
  // sanıyor, bekleyen emir sessizce bekliyordu.
  for (const reply of ["onay", "onay veriyorum", "evet", "tamam", "olur", "onaylıyorum", "kabul ediyorum"]) {
    assert.equal(readConfirmation(reply).insisted, true, `"${reply}" onay sayılmalı`);
  }
});

test("vazgeçme onay sayılmaz", () => {
  for (const reply of ["vazgeçtim", "iptal", "boş ver", "gerek yok"]) {
    assert.equal(readConfirmation(reply).insisted, false, `"${reply}" onay olmamalı`);
  }
});

test("itiraz, oranı hangi kaynaktan aldıysa onun adını söyler", () => {
  // Bu satır bir kez yanlıştı: oran EN SIKIŞAN kaynaktan alınıyor ama ad
  // maliyetin en BÜYÜK kalemine göre seçiliyordu. Kralın taşı azken odunu
  // boldu, dolayısıyla General "odun stokunun %120'si" diyor ama gerçekte
  // sıkışan taştı — rakam bir kaynağı, isim başkasını anlatıyordu.
  const state: KingdomSnapshot = {
    resources: { gold: 4258, food: 23763, stone: 2524, wood: 3700, iron: 468, ale: 977 },
    hourlyRates: { gold: 18.6, food: 34.2, stone: 9.4, wood: 28.6, iron: 6.3, ale: 2.6 },
    population: 506, popularity: 54, loyalty: 81, army: 49, protectionHoursLeft: 0, counterIntelligenceActive: false,
  };
  // Odun kalemi daha BÜYÜK, ama sıkışan taş.
  const assessment = assessAction({ name: "build_structure", arguments: {} }, state, { wood: 3683, stone: 3036 });
  assert.match(assessment.reasons[0], /taş/, `sıkışan kaynağın adı geçmeli: ${assessment.reasons[0]}`);
  assert.doesNotMatch(assessment.reasons[0], /odun/, "büyük kalemin adı geçmemeli");
});

test("depo yükseltmeleri bol kaynakla itiraz görmez", () => {
  const state: KingdomSnapshot = {
    resources: { gold: 4258, food: 23763, stone: 2524, wood: 3700, iron: 468, ale: 977 },
    hourlyRates: { gold: 18.6, food: 34.2, stone: 9.4, wood: 28.6, iron: 6.3, ale: 2.6 },
    population: 506, popularity: 54, loyalty: 81, army: 49, protectionHoursLeft: 0, counterIntelligenceActive: false,
  };
  for (const cost of [{ wood: 241, stone: 111 }, { wood: 204, stone: 204 }]) {
    assert.equal(assessAction({ name: "build_structure", arguments: {} }, state, cost).level, "low");
  }
});
