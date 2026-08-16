import assert from "node:assert/strict";
import test from "node:test";
import { inferFallbackAction, stripPseudoToolMarkup } from "../server/general-action-fallback";

test("önceki bağlamdaki Kale Sv.2 başlatma emrine güvenli araç çağrısı üretilir", () => {
  assert.deepEqual(inferFallbackAction("tamamdır başlat", [{ text: "Kale Seviye 2 yükseltmesi 45 dakika sürer." }]), { name: "build_structure", arguments: { building_type: "keep", target_level: 2, confirmed_risk: false } });
});

test("soru emir sayılmaz ve sahte XML araç metni temizlenir", () => {
  assert.equal(inferFallbackAction("Kale yükseltsek ne olur?", [{ text: "Sv.2" }]), null);
  assert.equal(stripPseudoToolMarkup("Şimdi başlatıyorum.\n<call_tool><tool_name>upgrade_building</tool_name></call_tool>"), "Şimdi başlatıyorum.");
});
