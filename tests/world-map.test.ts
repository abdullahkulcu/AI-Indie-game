import assert from "node:assert/strict";
import test from "node:test";
import { BIOMES, layoutChannel, worldExtent, type MemberInput } from "../engine/world-map";

const terrains = ["plain", "forest", "mountain", "riverbank"];
const members = (count: number): MemberInput[] =>
  Array.from({ length: count }, (_, index) => ({ userId: `user-${index}`, terrain: terrains[index % terrains.length] }));

function angleOf(x: number, z: number) {
  const degrees = Math.atan2(z, x) * 180 / Math.PI;
  return (degrees + 360) % 360;
}

test("krallık seçtiği araziye ait biyoma yerleşir", () => {
  const layout = layoutChannel("standard", members(80));
  for (const member of members(80)) {
    const placement = layout.get(member.userId)!;
    const biome = BIOMES.find(entry => entry.id === member.terrain)!;
    const angle = angleOf(placement.x, placement.z);
    // İki açı arasındaki en kısa mesafe.
    const delta = Math.abs(((angle - biome.centerAngle + 540) % 360) - 180);
    assert.ok(delta <= biome.spread / 2 + 1, `${member.terrain} biyomunun dışına düştü: ${angle}° (merkez ${biome.centerAngle}°)`);
    assert.equal(placement.biome, member.terrain);
  }
});

test("300 oyuncuda tam çakışma yok", () => {
  const layout = layoutChannel("standard", members(300));
  const seen = new Set(Array.from(layout.values()).map(p => `${p.x},${p.z}`));
  assert.equal(seen.size, 300, "her krallık benzersiz konumda olmalı");
});

test("300 oyuncuda üst üste binme yok", () => {
  const points = Array.from(layoutChannel("standard", members(300)).values());
  let tooClose = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z) < 3) tooClose++;
    }
  }
  assert.equal(tooClose, 0, `${tooClose} çift 3 birimden yakın`);
});

test("dünya oyuncu sayısıyla dışa doğru büyür", () => {
  const small = worldExtent(layoutChannel("standard", members(12)).values());
  const large = worldExtent(layoutChannel("standard", members(300)).values());
  assert.ok(large > small, "yeni oyuncular dış halkalara eklenmeli");
});

test("erken katılanlar merkeze yakın kalır", () => {
  const layout = layoutChannel("standard", members(120));
  const first = layout.get("user-0")!, last = layout.get("user-116")!;
  assert.ok(Math.hypot(first.x, first.z) < Math.hypot(last.x, last.z));
});

test("konumlar üyelik sırası korundukça sabittir", () => {
  const a = layoutChannel("standard", members(50));
  const b = layoutChannel("standard", members(50));
  for (const [id, placement] of a) assert.deepEqual(b.get(id), placement);
});

test("sonradan katılan mevcut krallıkların yerini değiştirmez", () => {
  const before = layoutChannel("standard", members(20));
  const after = layoutChannel("standard", members(40));
  for (const [id, placement] of before) assert.deepEqual(after.get(id), placement, `${id} yer değiştirdi`);
});

test("farklı channel farklı dünya üretir", () => {
  const a = layoutChannel("standard", members(20)).get("user-3")!;
  const b = layoutChannel("frontier", members(20)).get("user-3")!;
  assert.notDeepEqual({ x: a.x, z: a.z }, { x: b.x, z: b.z });
});

test("tek biyoma yığılma halkalara dağılır", () => {
  const all = Array.from({ length: 40 }, (_, index) => ({ userId: `u${index}`, terrain: "mountain" }));
  const points = Array.from(layoutChannel("standard", all).values());
  assert.equal(new Set(points.map(p => `${p.x},${p.z}`)).size, 40);
  assert.ok(Math.max(...points.map(p => p.ring)) >= 3, "yığılma dış halkalara taşmalı");
});
