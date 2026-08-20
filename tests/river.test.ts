import assert from "node:assert/strict";
import test from "node:test";
import { riverRibbon, triangleNormalY } from "../engine/river";

const curve = (z: number) => -12 + Math.sin(z * .018) * 7;

test("nehir yüzeyi yukarı bakar", () => {
  // Sarım ters olduğunda yüzey aşağı bakıyor ve nehir yukarıdan hiç
  // görünmüyordu: Kralın nehir kıyısı arazisi düz ovaya dönmüştü.
  const { positions, indices } = riverRibbon(curve, 15, 220, 110);
  const facingDown: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    if (triangleNormalY(positions, indices[i], indices[i + 1], indices[i + 2]) <= 0) facingDown.push(i / 3);
  }
  assert.deepEqual(facingDown, [], `${facingDown.length} üçgen aşağı bakıyor`);
});

test("genişlik kıvrımda korunur", () => {
  const { positions } = riverRibbon(curve, 15, 220, 110);
  const widths: number[] = [];
  for (let i = 0; i <= 110; i++) {
    const l = i * 6, r = i * 6 + 3;
    widths.push(Math.hypot(positions[r] - positions[l], positions[r + 2] - positions[l + 2]));
  }
  const min = Math.min(...widths), max = Math.max(...widths);
  // Float32 saklama hassasiyeti: 15 birimde ~1e-6 sapma normaldir.
  assert.ok(max - min < 1e-4, `nehir kıvrımda inceliyor: ${min.toFixed(6)} – ${max.toFixed(6)}`);
});

test("şerit sahnenin dışına taşar", () => {
  const { positions } = riverRibbon(curve, 15, 220, 110);
  const first = positions[2], last = positions[positions.length - 1];
  assert.ok(first <= -105 && last >= 105, "nehir zeminin (94 yarıçap) ötesine sürmeli");
});

test("her segment iki üçgen üretir", () => {
  const { indices } = riverRibbon(curve, 15, 220, 110);
  assert.equal(indices.length, 110 * 6);
});

test("değişken genişlik haliçte nehri açar", () => {
  // Haliç ağzına doğru genişleyen nehir: mansaptaki kesit memba kesitinden geniş.
  const widen = (z: number) => (z < 60 ? 15 : 15 * (1 + ((z - 60) / 36) * 2.2));
  const { positions } = riverRibbon(curve, widen, 220, 110);
  const widthAtIndex = (i: number) => {
    const l = i * 6, r = i * 6 + 3;
    return Math.hypot(positions[r] - positions[l], positions[r + 2] - positions[l + 2]);
  };
  assert.ok(Math.abs(widthAtIndex(20) - 15) < 1e-4, "memba tarafı taban genişlikte kalmalı");
  assert.ok(widthAtIndex(108) > 40, `ağız açılmalı, ölçülen: ${widthAtIndex(108).toFixed(1)}`);
});

test("değişken genişlikte de yüzey yukarı bakar", () => {
  const widen = (z: number) => (z < 60 ? 15 : 15 * (1 + ((z - 60) / 36) * 2.2));
  const { positions, indices } = riverRibbon(curve, widen, 220, 110);
  let down = 0;
  for (let i = 0; i < indices.length; i += 3) {
    if (triangleNormalY(positions, indices[i], indices[i + 1], indices[i + 2]) <= 0) down++;
  }
  assert.equal(down, 0, `${down} üçgen aşağı bakıyor`);
});
