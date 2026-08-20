/**
 * General'in adı.
 *
 * Hepsi "Aldric" olduğunda iki krallığın Generali birbirinden ayırt
 * edilemiyordu; müzakerede kimin konuştuğu karışıyordu. Ad krallığa göre
 * DETERMİNİSTİK seçilir: aynı krallık her açılışta aynı Generali görür, ama
 * farklı krallıkların Generalleri farklı olur.
 */

const NAMES = [
  "Aldric", "Bertan", "Cezmi", "Doruk", "Ediz", "Ferhat", "Gökhan", "Haluk",
  "İlhan", "Kerem", "Levent", "Murat", "Necdet", "Orhan", "Pertev", "Rüştü",
  "Sencer", "Tarkan", "Ulvi", "Volkan", "Yaman", "Zeki", "Bahadır", "Cengiz",
  "Demirhan", "Erdem", "Fikret", "Gürkan", "Hakan", "Kaya", "Mert", "Nizam",
] as const;

const TITLES = ["General", "Serdar", "Kumandan", "Beylerbeyi"] as const;

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
