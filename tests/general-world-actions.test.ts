import assert from "node:assert/strict";
import test from "node:test";
import { inferFallbackAction } from "../server/general-action-fallback";

test("ortak madene gönderme emri send_miners üretir", () => {
  assert.deepEqual(inferFallbackAction("ortak demir madene gönder"), { name: "send_miners", arguments: { workers: 5 } });
});

test("işçi sayısı emirden okunur ve sınırlanır", () => {
  assert.deepEqual(inferFallbackAction("madene 10 işçi yolla"), { name: "send_miners", arguments: { workers: 10 } });
  assert.deepEqual(inferFallbackAction("madene 90 işçi yolla"), { name: "send_miners", arguments: { workers: 20 } });
});

test("işçileri geri çekme emri recall_miners üretir", () => {
  assert.deepEqual(inferFallbackAction("madendeki işçileri geri çek"), { name: "recall_miners", arguments: {} });
});

test("ajan emri send_scout üretir ve hedef sırası okunur", () => {
  assert.deepEqual(inferFallbackAction("ajan gönder"), { name: "send_scout", arguments: { target_ordinal: 1 } });
  assert.deepEqual(inferFallbackAction("2. sancağa casus yolla"), { name: "send_scout", arguments: { target_ordinal: 2 } });
});

test("karşı-istihbarat emri nöbet kurar", () => {
  assert.deepEqual(inferFallbackAction("karşı istihbarat kur"), { name: "raise_counter_intelligence", arguments: {} });
});

test("maden sorusu emir sayılmaz", () => {
  assert.equal(inferFallbackAction("madene işçi göndersek ne olur"), null);
  assert.equal(inferFallbackAction("sence ajan yollasak mı"), null);
});

test("bina emirleri bozulmadan çalışmaya devam eder", () => {
  assert.deepEqual(inferFallbackAction("taş ocağı kur"), { name: "build_structure", arguments: { building_type: "quarry", target_level: 1, confirmed_risk: false } });
  assert.deepEqual(inferFallbackAction("kaleyi Sv.2 seviyesine yükselt"), { name: "build_structure", arguments: { building_type: "keep", target_level: 2, confirmed_risk: false } });
});

test("kendi maden binası ile ortak maden karıştırılmaz", () => {
  // "maden kur" krallığın kendi maden binasıdır, ortak maden değil.
  assert.deepEqual(inferFallbackAction("maden kur"), { name: "build_structure", arguments: { building_type: "mine", target_level: 1, confirmed_risk: false } });
});
