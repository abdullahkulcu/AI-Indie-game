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
function jitter(seed: string, span: number) {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 1000 / 1000 - .5) * span;
}

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
export type Feature = { biome: BiomeId; glyph: string; x: number; z: number; size: number };

const FEATURE_GLYPHS: Record<BiomeId, string[]> = {
  forest: ["🌲", "🌲", "🌳"],
  mountain: ["⛰", "⛰", "🏔"],
  riverbank: ["≈", "≈", "🌊"],
  plain: ["🌾", "🌾", "ʬ"],
};

export function biomeFeatures(channelId: string, extent: number, perBiome = 26): Feature[] {
  const features: Feature[] = [];
  for (const biome of BIOMES) {
    const glyphs = FEATURE_GLYPHS[biome.id];
    for (let index = 0; index < perBiome; index += 1) {
      const seed = `${channelId}:${biome.id}:${index}`;
      // Yarıçap görüş alanının 1.35 katına kadar; öğeler kenarlardan taşar.
      const radius = 12 + ((index * 37) % 100) / 100 * extent * 1.35 + jitter(`${seed}:r`, 10);
      const angleDeg = biome.centerAngle + jitter(`${seed}:a`, biome.spread * 0.92);
      const angle = angleDeg * Math.PI / 180;
      features.push({
        biome: biome.id,
        glyph: glyphs[index % glyphs.length],
        x: Math.round(Math.cos(angle) * radius * 10) / 10,
        z: Math.round(Math.sin(angle) * radius * 10) / 10,
        size: 10 + ((index * 53) % 7),
      });
    }
  }
  return features;
}

/** Haritanın kaç birim genişliğinde çizileceği; halkalar büyüdükçe dünya da büyür. */
export function worldExtent(placements: Iterable<Placement>) {
  let max = RING_START;
  for (const placement of placements) max = Math.max(max, Math.hypot(placement.x, placement.z));
  return Math.ceil(max + RING_GAP);
}
