import type { TerrainId } from "./types";

/**
 * Channel dünyasının sabit coğrafyası.
 *
 * Dünya dört biyom diliminden oluşur ve her krallık seçtiği araziye karşılık
 * gelen dilime yerleşir. Yerleşim halkalar hâlinde dışa doğru büyür: yeni gelen
 * oyuncu bir sonraki boş yuvaya oturur, böylece harita sınırlı bir tepsi değil
 * genişleyen bir diyar gibi görünür.
 *
 * Konumlar üyelik sırasından türetildiği için deterministiktir ve çakışmaz.
 * (Önceki hash tabanlı yerleşim 300 oyuncuda 36 tam çakışma üretiyordu.)
 */

export type BiomeId = TerrainId;

export type Biome = {
  id: BiomeId;
  label: string;
  /** Dilimin orta açısı (derece) ve genişliği. */
  centerAngle: number;
  spread: number;
};

export const BIOMES: Biome[] = [
  { id: "plain", label: "Otlak Düzlükleri", centerAngle: 45, spread: 78 },
  { id: "forest", label: "Karaorman Kuşağı", centerAngle: 135, spread: 78 },
  { id: "mountain", label: "Demirsırt Dağları", centerAngle: 225, spread: 78 },
  { id: "riverbank", label: "Akçay Kıyıları", centerAngle: 315, spread: 78 },
];

export const HOME_RADIUS = 0;
/** İlk halkanın merkeze uzaklığı ve halkalar arası mesafe. */
const RING_START = 30;
const RING_GAP = 20;
/** Halka r'deki yuva sayısı; dışa doğru gidildikçe çevre büyüdüğü için artar. */
const slotsInRing = (ring: number) => 3 + ring * 2;

export type Placement = { x: number; z: number; ring: number; biome: BiomeId };

/** Deterministik küçük sapma; ızgara görüntüsünü kırıp organik durmasını sağlar. */
export function jitter(seed: string, span: number) {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 1000 / 1000 - .5) * span;
}

/** Aynı karmadan 0-1 aralığında deterministik değer. */
export const unit = (seed: string) => jitter(seed, 1) + .5;

function slotPosition(biome: Biome, index: number, seed: string): Placement {
  // Yuva indeksinden halka ve halka içi sırayı çöz.
  let ring = 0, remaining = index;
  while (remaining >= slotsInRing(ring)) { remaining -= slotsInRing(ring); ring += 1; }

  const count = slotsInRing(ring);
  // Yuvalar dilim içinde eşit aralıklı; tek yuvalıysa ortaya oturur.
  const step = biome.spread / (count + 1);
  const angleDeg = biome.centerAngle - biome.spread / 2 + step * (remaining + 1) + jitter(`${seed}:a`, step * .5);
  const radius = RING_START + ring * RING_GAP + jitter(`${seed}:r`, RING_GAP * .35);
  const angle = angleDeg * Math.PI / 180;
  return {
    x: Math.round(Math.cos(angle) * radius * 10) / 10,
    z: Math.round(Math.sin(angle) * radius * 10) / 10,
    ring,
    biome: biome.id,
  };
}

export type MemberInput = { userId: string; terrain: string };

/**
 * Channel üyelerini biyomlara dağıtır. Girdi sırası (katılım sırası) korunduğu
 * sürece herkesin konumu sabit kalır.
 */
export function layoutChannel(channelId: string, members: MemberInput[]): Map<string, Placement> {
  const used = new Map<BiomeId, number>();
  const result = new Map<string, Placement>();
  for (const member of members) {
    const biome = BIOMES.find(entry => entry.id === member.terrain) ?? BIOMES[0];
    const index = used.get(biome.id) ?? 0;
    used.set(biome.id, index + 1);
    result.set(member.userId, slotPosition(biome, index, `${channelId}:${member.userId}`));
  }
  return result;
}

/** Ortak maden, dört biyomun kesiştiği merkeze yakın nötr bir noktada durur. */
export function sharedMinePosition(): { x: number; z: number } {
  return { x: -17, z: -17 };
}

/**
 * Biyomların arazi öğeleri. Deterministiktir: aynı channel her açılışta aynı
 * ormanı, aynı dağı gösterir. Görüş alanının dışına taşacak kadar üretilir ki
 * dünya çerçeveli bir ada değil, sürüp giden bir diyar gibi okunsun.
 */
/**
 * Arazi sembolleri emoji değil ÇİZİLMİŞ harita işaretleridir; `kind` hangi
 * sembolün çizileceğini söyler, çizim katmanı bunu SVG'ye çevirir.
 */
export type FeatureKind = "pine" | "broadleaf" | "peak" | "ridge" | "wave" | "reed" | "wheat" | "grass";
export type Feature = { biome: BiomeId; kind: FeatureKind; x: number; z: number; size: number };

const FEATURE_KINDS: Record<BiomeId, FeatureKind[]> = {
  forest: ["pine", "pine", "broadleaf"],
  mountain: ["peak", "ridge", "peak"],
  riverbank: ["wave", "reed", "wave"],
  plain: ["wheat", "grass", "wheat"],
};

export function biomeFeatures(channelId: string, extent: number, perBiome = 26): Feature[] {
  const features: Feature[] = [];
  for (const biome of BIOMES) {
    const kinds = FEATURE_KINDS[biome.id];
    for (let index = 0; index < perBiome; index += 1) {
      const seed = `${channelId}:${biome.id}:${index}`;
      // Yarıçap görüş alanının 1.35 katına kadar; öğeler kenarlardan taşar.
      const radius = 12 + ((index * 37) % 100) / 100 * extent * 1.35 + jitter(`${seed}:r`, 10);
      // Biyom kenarı keskin bir dilim değil; öğeler komşu biyoma biraz taşarak
      // geçişi yumuşatır.
      const angleDeg = biome.centerAngle + jitter(`${seed}:a`, biome.spread * 1.08);
      const angle = angleDeg * Math.PI / 180;
      features.push({
        biome: biome.id,
        kind: kinds[index % kinds.length],
        x: Math.round(Math.cos(angle) * radius * 10) / 10,
        z: Math.round(Math.sin(angle) * radius * 10) / 10,
        size: 13 + ((index * 53) % 8),
      });
    }
  }
  return features;
}

export type WorldPoint = { x: number; z: number; width: number };

/**
 * Menderes yapan nehir. Cetvelle çizilmiş bir şerit değil: yön kanaldan türer,
 * yatak iki farklı frekansta salınır, genişlik kaynaktan ağza doğru artar.
 */
export function worldRiver(channelId: string, extent: number, steps = 48): WorldPoint[] {
  const seed = `${channelId}:river`;
  const heading = unit(`${seed}:heading`) * Math.PI * 2;
  const offset = jitter(`${seed}:offset`, extent * .9);
  const swing = extent * (.16 + unit(`${seed}:swing`) * .12);
  const phase = unit(`${seed}:phase`) * Math.PI * 2;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const reach = extent * 1.6;
  const points: WorldPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const along = -reach + t * reach * 2;
    // İki dalga üst üste: tek sinüs fazla düzenli, ikisi birden menderes verir.
    const lateral = offset
      + Math.sin(t * Math.PI * 2.1 + phase) * swing
      + Math.sin(t * Math.PI * 5.3 + phase * 1.7) * swing * .34;
    points.push({
      x: cos * along - sin * lateral,
      z: sin * along + cos * lateral,
      // Kaynakta dar, ağza doğru genişler.
      width: extent * (.012 + t * .026),
    });
  }
  return points;
}

/**
 * Araziyi takip eden yollar. Merkezden dışa uzanırlar ama düz gitmezler; her
 * yolun kendi kıvrımı ve daralması vardır.
 */
export function worldRoads(channelId: string, extent: number, count = 3, steps = 34): WorldPoint[][] {
  const roads: WorldPoint[][] = [];
  for (let road = 0; road < count; road += 1) {
    const seed = `${channelId}:road:${road}`;
    const heading = unit(`${seed}:heading`) * Math.PI * 2;
    const bend = jitter(`${seed}:bend`, extent * .55);
    const phase = unit(`${seed}:phase`) * Math.PI * 2;
    const cos = Math.cos(heading), sin = Math.sin(heading);
    // Yol iki uçtan da görüş alanının dışına çıkmalı; içeride bitince harita
    // ortasında kesilmiş gibi duruyor.
    const reach = extent * 1.5;
    const line: WorldPoint[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const along = -reach + t * reach * 2;
      // Kıvrım ortada en güçlü; uçlarda yol düzelir.
      const lateral = Math.sin(t * Math.PI) * bend + Math.sin(t * Math.PI * 3.4 + phase) * extent * .05;
      line.push({
        x: cos * along - sin * lateral,
        z: sin * along + cos * lateral,
        width: extent * (.008 + Math.sin(t * Math.PI) * .004),
      });
    }
    roads.push(line);
  }
  return roads;
}

/** Haritanın kaç birim genişliğinde çizileceği; halkalar büyüdükçe dünya da büyür. */
export function worldExtent(placements: Iterable<Placement>) {
  let max = RING_START;
  for (const placement of placements) max = Math.max(max, Math.hypot(placement.x, placement.z));
  return Math.ceil(max + RING_GAP);
}
