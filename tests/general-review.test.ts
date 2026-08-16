import assert from "node:assert/strict";
import test from "node:test";
import { reviewProposedActions, type ActionCost, type KingdomSnapshot, type ProposedAction } from "../server/general-risk";

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
