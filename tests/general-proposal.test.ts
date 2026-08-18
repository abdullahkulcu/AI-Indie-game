import assert from "node:assert/strict";
import test from "node:test";
import { readProposal } from "../server/general-proposal";

const TOOLS = ["trade_resource", "build_structure", "call_settlers", "propose_action"] as const;

test("öneri uygulanmaz, onaya sunulur", () => {
  const out = readProposal([{ name: "propose_action", arguments: { action: "trade_resource", arguments: { resource: "wood", amount: 100, direction: "sell" }, summary: "Pazarda 100 odun satacağım." } }], TOOLS);
  assert.deepEqual(out.actions, [], "öneri turu hiçbir eylem uygulamamalı");
  assert.equal(out.pending?.action.name, "trade_resource");
  assert.deepEqual(out.pending?.action.arguments, { resource: "wood", amount: 100, direction: "sell" });
  assert.match(out.note!, /Onaylıyor musunuz/);
});

test("uydurma araç adı onaya sunulmaz", () => {
  const out = readProposal([{ name: "propose_action", arguments: { action: "altin_bas", summary: "Altın basacağım." } }], TOOLS);
  assert.equal(out.pending, null);
  assert.match(out.note!, /somut bir eyleme çeviremedim/);
});

test("özet olmadan öneri kabul edilmez", () => {
  const out = readProposal([{ name: "propose_action", arguments: { action: "call_settlers" } }], TOOLS);
  assert.equal(out.pending, null);
});

test("öneri kendini öneremez", () => {
  const out = readProposal([{ name: "propose_action", arguments: { action: "propose_action", summary: "Öneri sunacağım." } }], TOOLS);
  assert.equal(out.pending, null);
});

test("öneri yoksa eylemler olduğu gibi geçer", () => {
  const actions = [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }];
  const out = readProposal(actions, TOOLS);
  assert.deepEqual(out.actions, actions);
  assert.equal(out.pending, null);
  assert.equal(out.note, null);
});

test("öneri yanında gelen gerçek eylem düşmez", () => {
  const out = readProposal([
    { name: "propose_action", arguments: { action: "call_settlers", summary: "Göçmen çağıracağım." } },
    { name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } },
  ], TOOLS);
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].name, "build_structure");
  assert.equal(out.pending?.action.name, "call_settlers");
});
