import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/war-desk.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../components/WarCampaignWorkspace.tsx", import.meta.url), "utf8");

test("başarılı yağma, savaş ve dönüş raporlarında ganimeti açıkça bildirir", () => {
  assert.ok(source.includes("Yağma birliği ${lootSummary(loot)} ele geçirdi"));
  assert.ok(source.includes("ganimet dönüşte ambara katılacak"));
  assert.ok(source.includes("Kalan ${army[0].supply} yiyecek ile ${lootSummary(loot)} ambara katıldı"));
});

test("boş hedeften yağma alınmadığı da saldırana açıkça söylenir", () => {
  assert.ok(source.includes("Yağma birliği hedefte taşınabilir kaynak bulamadı"));
  assert.ok(source.includes("Math.max(0, Math.min"), "negatif kaynaklar yağma olarak yazılamaz");
});

test("saha sonucu haberci gelmeden savaş defterine ve barış masasına açılmaz", () => {
  assert.ok(source.includes("availableAt: reportAt"));
  assert.ok(source.includes("visibleAt: reportAt"));
  assert.ok(source.includes("Saha haberi henüz saraya ulaşmadı"));
  assert.ok(source.includes("courierTravelMs"));
});

test("savaş defteri tarafları adla değil hesap kimliğiyle ayırır", () => {
  assert.ok(source.includes("eq(warReports.userId, userId)"));
  assert.ok(source.includes("userId: war.attackerId"));
  assert.ok(source.includes("userId: war.defenderId"));
  assert.doesNotMatch(source, /kingdomName\s*===\s*/);
});

test("haberci gecikmesi olan rapor, sahadaki ve saraya varan zamanı ayrı gösterir", () => {
  assert.match(view, /Sahadan:/);
  assert.match(view, /Saraya ulaştı:/);
  assert.match(view, /report\.availableAt > report\.createdAt/);
});

test("savunan kendi savaş raporunda üretim aksamasını da görür", () => {
  assert.match(source, /Şehir üretimi toparlanana kadar %\$\{Math\.round\(disruption\.productionPenalty \* 100\)\} aksayacak/);
  assert.match(source, /şehir üretimi toparlanana kadar %\$\{Math\.round\(disruption\.productionPenalty \* 100\)\} aksayacak/);
});
