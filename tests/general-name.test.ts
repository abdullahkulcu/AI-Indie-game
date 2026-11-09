import assert from "node:assert/strict";
import test from "node:test";
import { generalNameFor } from "../engine/general-name";

test("aynı krallık hep aynı Generali görür", () => {
  const first = generalNameFor("Osmanlı", 1_800_000_000_000);
  assert.equal(first, generalNameFor("Osmanlı", 1_800_000_000_000));
  assert.ok(first.length > 3);
});

test("farklı krallıkların Generalleri ayrışır", () => {
  // Hepsi "Aldric" olduğunda müzakerede kimin konuştuğu karışıyordu.
  const names = new Set<string>();
  for (let i = 0; i < 40; i++) names.add(generalNameFor(`Krallık${i}`, 1_800_000_000_000 + i));
  assert.ok(names.size > 25, `40 krallıkta ${names.size} farklı ad çıktı, çeşitlilik yetersiz`);
});

test("aynı ada sahip iki krallık kuruluş anıyla ayrışır", () => {
  // Kralın iki hesabının da krallık adı "Osmanlı" idi.
  assert.notEqual(generalNameFor("Osmanlı", 1_800_000_000_000), generalNameFor("Osmanlı", 1_800_000_000_001));
});

test("ad bir unvanla başlar", () => {
  const name = generalNameFor("Akkale", 1_800_000_000_000);
  assert.match(name, /^(General|Marshal|Commander|Field Marshal) /);
});

test("General adı İngilizce tarihî komutan havuzundan atanır", () => {
  const name = generalNameFor("Akkale", 1_800_000_000_000);
  assert.match(name, /(Alexander|Hannibal|Scipio|Caesar|Belisarius|Khalid|Saladin|Subutai|Joan|Richard|William|Edward|Timur|Gustavus|Turenne|Marlborough|Frederick|Napoleon|Wellington|Grant|Sherman|Lee|Moltke|Zhukov|Montgomery|Eisenhower|Patton|Nimitz|MacArthur|Yi|Oda|Tokugawa|Boudica|Themistocles|Leonidas|Trajan|Aetius|Suleiman|Baybars|Skanderbeg|Gonzalo|Maurice|Suvorov|Nelson|Kutuzov|Jomini|Foch|Manstein)$/);
});
