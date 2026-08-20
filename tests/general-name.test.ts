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
  assert.match(name, /^(General|Serdar|Kumandan|Beylerbeyi) /);
});
