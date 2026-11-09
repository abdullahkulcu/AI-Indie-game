/**
 * General'in adı.
 *
 * Hepsi "Aldric" olduğunda iki krallığın Generali birbirinden ayırt
 * edilemiyordu; müzakerede kimin konuştuğu karışıyordu. Ad krallığa göre
 * DETERMİNİSTİK seçilir: aynı krallık her açılışta aynı Generali görür, ama
 * farklı krallıkların Generalleri farklı olur.
 */

/** Tarihte öne çıkan komutanlar; İngilizce yazımları oyuncuya gösterilir. */
const NAMES = [
  "Alexander", "Hannibal", "Scipio", "Caesar", "Belisarius", "Khalid", "Saladin", "Subutai",
  "Joan", "Richard", "William", "Edward", "Timur", "Gustavus", "Turenne", "Marlborough",
  "Frederick", "Napoleon", "Wellington", "Grant", "Sherman", "Lee", "Moltke", "Zhukov",
  "Montgomery", "Eisenhower", "Patton", "Nimitz", "MacArthur", "Yi", "Oda", "Tokugawa",
  "Boudica", "Themistocles", "Leonidas", "Trajan", "Aetius", "Suleiman", "Baybars", "Skanderbeg",
  "Gonzalo", "Maurice", "Suvorov", "Nelson", "Kutuzov", "Jomini", "Foch", "Manstein",
] as const;

const TITLES = ["General", "Marshal", "Commander", "Field Marshal"] as const;

/** FNV-1a: motorun başka yerlerinde kullanılan aynı karma. */
function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Krallığa özgü General adı. Tohum krallığın adı ve kuruluş anıdır; ikisi de
 * kayıtta durduğu için ad hiçbir yerde saklanmasa da hep aynı çıkar.
 */
export function generalNameFor(kingdomName: string, foundedAt: number) {
  const seed = hash(`${kingdomName}|${foundedAt}`);
  const name = NAMES[seed % NAMES.length];
  const title = TITLES[Math.floor(seed / NAMES.length) % TITLES.length];
  return `${title} ${name}`;
}
