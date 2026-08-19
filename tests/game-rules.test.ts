import { BUILDABLE_TYPES, buildingAliases, catalog } from "../engine/catalog";
import test from"node:test";import assert from"node:assert/strict";import{deepDigCost,mineMultiplier,refillQuota,resolveRaid,siegeRound,transferResources}from"../server/game/rules.js";import{canJoinChannel,seasonWinner}from"../server/game/channel.js";import{conquestTransfer}from"../server/game/conquest.js";
test("maden taper eğrisi %20 altında doğrusal",()=>{assert.equal(mineMultiplier(20,100),1);assert.equal(mineMultiplier(10,100),.5);assert.equal(mineMultiplier(0,100),0);assert.equal(deepDigCost(2),1125);});
test("emir kotası iki saatlik tavana devreder",()=>{const now=new Date("2026-01-01T03:00:00Z");assert.deepEqual(refillQuota(0,new Date("2026-01-01T00:00:00Z"),now,3),{remaining:6,refilledAt:now});});
test("kervan kapasitesi ve kaynak bakiyesi",()=>{assert.deepEqual(transferResources({iron:450},"iron",400),{amount:200,remaining:{iron:250}});});
test("kuşatma birimi suru aşındırır",()=>{const result=siegeRound({attackers:{catapult:10,spearman:100},defenders:{spearman:20},wallIntegrity:100,terrain:"plain",moraleA:1,moraleD:1,fatigue:1,keep:2,wall:2,tower:1,seed:.5});assert.ok(result.wallDamage>0);assert.ok(result.wallIntegrity<100);});
test("yüksek kale savunmayı güçlendirir",()=>{const low=resolveRaid({attackers:{swordsman:50},defenders:{spearman:20},terrain:"plain",attackerMorale:1,defenderMorale:1,fatigue:1,tacticAttack:1,tacticDefense:1,keepLevel:1,wallLevel:1,towerLevel:1,seed:.5});const high=resolveRaid({attackers:{swordsman:50},defenders:{spearman:20},terrain:"mountain",attackerMorale:1,defenderMorale:1,fatigue:1,tacticAttack:1,tacticDefense:1,keepLevel:5,wallLevel:5,towerLevel:3,seed:.5});assert.ok(high.defensePower>low.defensePower);});
test("geç katılım ve sezon tek taraf kuralı",()=>{const now=new Date("2026-01-01");assert.equal(canJoinChannel(new Date("2026-01-05"),4,now),false);assert.equal(seasonWinner([{id:"a",allianceId:"x"},{id:"b",allianceId:"x"}]),"x");});
test("başkent düşünce bütün kaynaklar anında aktarılır",()=>{const result=conquestTransfer({capitalFell:true,winner:{gold:10},loser:{gold:90,iron:20}});assert.deepEqual(result.winner,{gold:100,iron:20});assert.equal(result.requiresCaravans,false);});

test("General kataloğdaki her binayı kurabilir", () => {
  // Bu satır bir kez kırıldı: araç şemasındaki liste elle yazılmıştı ve
  // kataloğdan sapmıştı. Ambar, Depo, Park, Bira Evi, Evlilik Dairesi ve
  // Tiyatro listede yoktu, yani Kral isteyince kurulamıyordu.
  const missing = catalog.map(item => item.type).filter(type => !BUILDABLE_TYPES.includes(type));
  assert.deepEqual(missing, [], `araç şemasında eksik binalar: ${missing.join(", ")}`);
  assert.ok(BUILDABLE_TYPES.includes("keep"), "Kale de yükseltilebilmeli");
});

test("her binanın Türkçe adı tanınır", () => {
  const unnamed = catalog.filter(item => {
    const entry = buildingAliases.find(([type]) => type === item.type);
    return !entry?.[1].includes(item.name.toLocaleLowerCase("tr-TR"));
  });
  assert.deepEqual(unnamed.map(item => item.name), [], "adı eşleşmeyen bina kalmamalı");
});

test("ambar ve depo birbirine karışmaz", () => {
  // Kral "ambar" dedi, General Depo'yu yükseltti. İkisi ayrı yapı.
  const granary = buildingAliases.find(([type]) => type === "granary")![1];
  const warehouse = buildingAliases.find(([type]) => type === "warehouse")![1];
  assert.ok(granary.includes("ambar"), "ambar → Ambar olmalı");
  assert.ok(warehouse.includes("depo"), "depo → Depo olmalı");
  assert.equal(granary.filter(alias => warehouse.includes(alias)).length, 0, "takma adlar çakışmamalı");
});
