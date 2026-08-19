/**
 * Nehir şeridinin geometrisi.
 *
 * Sahnenin içinde yazıldığında sarım yönü ters kalmıştı: yüzey aşağı bakıyor,
 * nehir yukarıdan görünmüyordu ve Kralın nehir kıyısı arazisi düz ovaya
 * dönmüştü. Burada saf bir fonksiyon olduğu için normalin yönü test edilebilir.
 */

export type Ribbon = { positions: Float32Array; indices: number[] };

/**
 * Eğriyi takip eden tek parça üçgen şeridi üretir. Genişlik akış yönüne DİK
 * ölçülür; z eksenine dik ölçülseydi nehir kıvrımda incelirdi.
 *
 * Sarım saat yönünün tersinedir, yani normal +Y'ye bakar ve yüzey yukarıdan
 * görünür.
 */
export function riverRibbon(
  centerX: (z: number) => number,
  /** Sabit genişlik ya da z'ye göre değişen genişlik. Haliç ağzında nehir açılır. */
  width: number | ((z: number) => number),
  span: number,
  segments: number,
): Ribbon {
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];
  const widthAt = typeof width === "number" ? () => width : width;

  for (let i = 0; i <= segments; i++) {
    const z = -span / 2 + (span * i) / segments;
    const cx = centerX(z), half = widthAt(z) / 2;
    const slope = centerX(z + .5) - centerX(z - .5);
    const normal = 1 / Math.hypot(1, slope);
    const offsetX = half * normal, offsetZ = -half * slope * normal;

    positions.set([cx - offsetX, 0, z - offsetZ], i * 6);
    positions.set([cx + offsetX, 0, z + offsetZ], i * 6 + 3);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  return { positions, indices };
}

/** Bir üçgenin normalinin Y bileşeni. Pozitifse yüzey yukarı bakar. */
export function triangleNormalY(positions: Float32Array, a: number, b: number, c: number) {
  const at = a * 3, bt = b * 3, ct = c * 3;
  const abx = positions[bt] - positions[at], abz = positions[bt + 2] - positions[at + 2];
  const acx = positions[ct] - positions[at], acz = positions[ct + 2] - positions[at + 2];
  // (ab × ac) vektörünün Y bileşeni.
  return abz * acx - abx * acz;
}
