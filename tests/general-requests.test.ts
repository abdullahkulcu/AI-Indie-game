import assert from "node:assert/strict";
import test from "node:test";
import {
  type RequestSignals,
  deriveRequests, renderRequests, requestsSatisfiedBy,
} from "../engine/general-requests";

/** Hiçbir talebi tetiklemeyen sağlıklı krallık. */
const healthy = (overrides: Partial<RequestSignals> = {}): RequestSignals => ({
  resources: { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
  hourlyRates: { gold: 3, food: 14, stone: 0, wood: 22, iron: 0, ale: 0 },
  buildings: [
    { type: "keep", name: "Kale", level: 1 },
    { type: "barracks", name: "Kışla", level: 1 },
  ],
  populace: { moodScore: 60, foodRation: 100, soldierPay: 100, soldierUnrest: 0, army: 10 },
  ...overrides,
});

const kinds = (signals: RequestSignals) => deriveRequests(signals).map(request => request.kind);

test("sağlıklı krallıkta General bir şey istemez", () => {
  assert.deepEqual(deriveRequests(healthy()), []);
});

test("kışlası olmayan krallıkta kışla istenir", () => {
  const request = deriveRequests(healthy({ buildings: [{ type: "keep", name: "Kale", level: 1 }] }))
    .find(item => item.kind === "barracks");
  assert.ok(request);
  assert.match(request.text, /kışlasız/i);
});

test("bina türü gelmese bile Türkçe ad tanınır", () => {
  // İstemci bağlamı binaları yalnızca ad ve seviyeyle gönderiyor.
  const byName = healthy({ buildings: [{ name: "Kale", level: 1 }, { name: "Kışla", level: 1 }] });
  assert.ok(!kinds(byName).includes("barracks"), "adı geçen kışla var sayılmalı");
});

test("huzursuz asker acil maaş talebi doğurur", () => {
  const request = deriveRequests(healthy({
    populace: { moodScore: 60, foodRation: 100, soldierPay: 40, soldierUnrest: 55, army: 20 },
  })).find(item => item.kind === "soldier_pay");
  assert.ok(request);
  assert.equal(request.severity, "urgent");
  assert.match(request.text, /maaş/i);
});

test("ordusuz krallıkta maaş talebi açılmaz", () => {
  const noArmy = healthy({
    populace: { moodScore: 60, foodRation: 100, soldierPay: 0, soldierUnrest: 90, army: 0 },
  });
  assert.ok(!kinds(noArmy).includes("soldier_pay"));
});

test("eriyen ambar yiyecek üretimi talebi doğurur", () => {
  const starving = healthy({
    resources: { gold: 1000, food: 60, stone: 0, wood: 0, iron: 0, ale: 0 },
    hourlyRates: { gold: 3, food: -10, stone: 0, wood: 0, iron: 0, ale: 0 },
  });
  const request = deriveRequests(starving).find(item => item.kind === "food_production");
  assert.ok(request);
  assert.equal(request.severity, "urgent");
  assert.match(request.text, /6 saat/);
});

test("yarım istihkak talebi acil sayılır", () => {
  const request = deriveRequests(healthy({
    populace: { moodScore: 60, foodRation: 50, soldierPay: 100, soldierUnrest: 0, army: 10 },
  })).find(item => item.kind === "food_ration");
  assert.ok(request);
  assert.equal(request.severity, "urgent");
});

test("karnı tok ama mutsuz halk için şenlik istenir", () => {
  const unhappy = healthy({
    populace: { moodScore: 25, foodRation: 100, soldierPay: 100, soldierUnrest: 0, army: 10 },
  });
  assert.ok(kinds(unhappy).includes("festival"));
});

test("aç halk için şenlik istenmez; önce karnı doyar", () => {
  const hungry = healthy({
    populace: { moodScore: 25, foodRation: 40, soldierPay: 100, soldierUnrest: 0, army: 10 },
  });
  const result = kinds(hungry);
  assert.ok(!result.includes("festival"), "aç halka şenlik önerilmemeli");
  assert.ok(result.includes("food_ration"));
});

test("dibe vuran hazine vergi talebi doğurur", () => {
  const broke = healthy({ resources: { gold: 30, food: 500, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const request = deriveRequests(broke).find(item => item.kind === "treasury");
  assert.ok(request);
  assert.equal(request.severity, "urgent");
});

test("acil talepler listenin başında gelir", () => {
  const dire = healthy({
    populace: { moodScore: 20, foodRation: 50, soldierPay: 0, soldierUnrest: 80, army: 20 },
  });
  assert.equal(deriveRequests(dire)[0].kind, "soldier_pay", "firar eden ordu her şeyden önce gelir");
});

// --- talebin karşılanması ---------------------------------------------------

test("doğru emir talebi karşılar", () => {
  const requests = deriveRequests(healthy({
    populace: { moodScore: 60, foodRation: 100, soldierPay: 40, soldierUnrest: 55, army: 20 },
  }));
  const met = requestsSatisfiedBy(requests, [{ name: "set_soldier_pay", arguments: { percent: 100 } }]);
  assert.deepEqual(met, ["soldier_pay"]);
});

test("alakasız emir talebi karşılamaz", () => {
  const requests = deriveRequests(healthy({
    populace: { moodScore: 60, foodRation: 100, soldierPay: 40, soldierUnrest: 55, army: 20 },
  }));
  assert.deepEqual(requestsSatisfiedBy(requests, [{ name: "set_tax_rate", arguments: { rate_percent: 20 } }]), []);
});

test("yanlış yapıyı kurmak kışla talebini karşılamaz", () => {
  // build_structure adına bakmak yetmez; taş ocağı emri "kışla istiyorum"
  // talebini karşılamış sayılmamalı.
  const requests = deriveRequests(healthy({ buildings: [{ type: "keep", name: "Kale", level: 1 }] }));
  const quarry = requestsSatisfiedBy(requests, [{ name: "build_structure", arguments: { building_type: "quarry" } }]);
  assert.deepEqual(quarry, []);
  const barracks = requestsSatisfiedBy(requests, [{ name: "build_structure", arguments: { building_type: "barracks" } }]);
  assert.deepEqual(barracks, ["barracks"]);
});

test("tarla emri yiyecek üretimi talebini karşılar", () => {
  const requests = deriveRequests(healthy({
    resources: { gold: 1000, food: 60, stone: 0, wood: 0, iron: 0, ale: 0 },
    hourlyRates: { gold: 3, food: -10, stone: 0, wood: 0, iron: 0, ale: 0 },
  }));
  const met = requestsSatisfiedBy(requests, [{ name: "build_structure", arguments: { building_type: "wheat_farm" } }]);
  assert.ok(met.includes("food_production"));
});

// --- metin ------------------------------------------------------------------

test("talep metni acil olanı işaretler", () => {
  const text = renderRequests([
    { text: "Adamlarım maaş istiyor.", severity: "urgent" },
    { text: "Bir şenlik borçlusunuz.", severity: "normal" },
  ]);
  assert.match(text, /\[ACİL\] Adamlarım/);
  assert.ok(!text.includes("[ACİL] Bir şenlik"));
});

test("talep yoksa metin boş kalır", () => {
  assert.equal(renderRequests([]), "");
});

test("Değirmen yiyecek talebini yalnızca tarlası olan krallıkta karşılar", () => {
  // Değirmen tarlanın ürününü öğütür, kendi başına buğday ekmez. Tarlası
  // olmayan Krala Değirmen önermek onu boş bir masrafa sokardı.
  const starving = {
    resources: { gold: 1000, food: 60, stone: 0, wood: 0, iron: 0, ale: 0 },
    hourlyRates: { gold: 3, food: -10, stone: 0, wood: 0, iron: 0, ale: 0 },
  };
  const mill = [{ name: "build_structure", arguments: { building_type: "mill" } }];
  const withoutFarm = deriveRequests(healthy(starving));
  assert.deepEqual(requestsSatisfiedBy(withoutFarm, mill), []);

  const withFarm = deriveRequests(healthy({
    ...starving,
    buildings: [{ type: "keep", name: "Kale", level: 1 }, { type: "wheat_farm", name: "Buğday Tarlası", level: 2 }],
  }));
  assert.ok(requestsSatisfiedBy(withFarm, mill).includes("food_production"));
});
