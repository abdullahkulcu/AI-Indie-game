/**
 * İÇ MUHALEFET — rıza uzun süre düşük kalınca krallığın içinde bir elebaşı çıkar.
 *
 * Bu mekanik halka verilen bir CEZA DEĞİL, halkın kendi hareketidir. Bu yüzden
 * Kralın elinde onu bastıracak bir düğme yoktur: "elebaşını astır" diye bir
 * emir icat edilmedi ve edilmeyecek — bu, "halka emir verilmez" ilkesinin
 * doğrudan sonucudur. Muhalefet yalnızca YÖNETİMLE, yani rızayı yükselterek erir.
 *
 * TERİM NOTU: bu mekaniğe eskiden "hizip" deniyordu; oyuncuya daha anlaşılır
 * olsun diye tüm görünen metinler "muhalefet" olarak değiştirildi. Kod içindeki
 * `faction*` adları (İngilizce) DEĞİŞMEDİ — dolayısıyla alan adı, tip adı ve
 * `factionLeaderName`'in TOHUM DİZGESİ olduğu gibi kaldı (bkz. aşağıdaki not:
 * tohum değişirse her krallığın elebaşısının adı değişirdi).
 *
 * Baskı (0-100) kapalı çözümlü üstel biriktirilir/eritilir:
 *
 *     dx/dt = k · (hedef − x)
 *     x(h)  = hedef + (x0 − hedef) · e^(−k·h)
 *
 * Üstel fonksiyon tam olarak bölünebilirdir (e^(−k·6) = (e^(−k))^6), yani
 * istemcinin saniyelik adımları ile sunucunun tek adımı BİREBİR aynı sonucu
 * verir — `advanceCommons` ve `RAID_TRAUMA` ile aynı desen. Birikim ve erime
 * hızları farklıdır; bu bölünebilirliği bozmaz çünkü x bir adım içinde hedefe
 * doğru tek yönde yürür, işaret adım ortasında dönmez.
 *
 * Zar yoktur. Elebaşının adı `engine/general-name.ts` deseniyle tohumdan türer.
 */

const FACTION = {
  /**
   * Rıza bu eşiğin ÜSTÜNDEyken muhalefet hedefi sıfırdır, yani muhalefet erir.
   * 40, halkın "Huzursuz"dan "Kaynıyor"a geçtiği sınırdır: ölçülen dinlenme
   * noktaları (normal krallık 42-46, iyi krallık 62-67) bu eşiğin üstünde
   * oturuyor, dolayısıyla düzgün yönetilen krallıkta muhalefet hiç doğmaz.
   */
  moodFloor: 40,
  /** Eşiğin altındaki her rıza puanının hedefe kattığı baskı. */
  slope: 7.5,
  /** Birikim hızı (1/oyun saati). Rıza 30'da 24 saatte 0 → 61 puan. */
  riseRate: .07,
  /** Erime hızı (1/oyun saati). Rıza 60'a dönünce 12 saatte 60 → 16 puan. */
  easeRate: .11,
  /**
   * Askerin zapt gücünü tamamen kıran baskı. Muhalefet büyüdükçe garnizonun halkı
   * bastırma gücü zayıflar: kalabalık artık kimin adamı olduğunu bilmiyordur.
   */
  suppressionBreak: 100,
} as const;

export const FACTION_LIMITS = { min: 0, max: 100 } as const;

/** Baskının eşikleri; panel, bildirim ve prompt aynı listeden okur. */
export const FACTION_THRESHOLDS = { stirring: 20, organized: 50, defiant: 80 } as const;

export const factionPressureOf = (game: { factionPressure?: number }) =>
  Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, Number(game.factionPressure) || 0));

/**
 * Mevcut rızanın işaret ettiği muhalefet baskısı. Rıza eşiğin üstündeyse 0: muhalefet
 * kendi kendine büyümez, ancak memnuniyetsizlikten beslenir.
 */
export function factionTarget(popularity: number) {
  const mood = Number.isFinite(popularity) ? popularity : 50;
  const raw = (FACTION.moodFloor - mood) * FACTION.slope;
  return Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, raw));
}

/**
 * Baskıyı `hours` kadar ilerletir. `boost` dış müdahalenin (yabancı kesenin)
 * o pencerede eklediği puandır; hedefe değil doğrudan baskıya eklenir, çünkü
 * kese rızayı değiştirmez — yalnızca var olan hoşnutsuzluğu örgütler.
 */
export function advanceFaction(current: number, popularity: number, hours: number, boost = 0) {
  const start = Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, Number(current) || 0))
    + Math.max(0, Number(boost) || 0);
  if (!(hours > 0)) return Math.min(FACTION_LIMITS.max, start);
  const target = factionTarget(popularity);
  const rate = start < target ? FACTION.riseRate : FACTION.easeRate;
  const next = target + (start - target) * Math.exp(-rate * hours);
  return Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, next));
}

/**
 * Muhalefetin askerin zapt gücüne çarpanı. 1 = muhalefet yok, 0 = garnizon halkı
 * hiç bastıramıyor. `populace.suppression()` bunu `reliability` ile birlikte uygular.
 */
export function factionDrag(pressure: number) {
  const level = Math.max(0, Math.min(FACTION_LIMITS.max, Number(pressure) || 0));
  return Math.max(0, 1 - level / FACTION.suppressionBreak);
}

export type FactionState = {
  id: "none" | "stirring" | "organized" | "defiant";
  label: string;
  note: string;
};

export function factionState(pressure: number): FactionState {
  const level = Math.max(0, Number(pressure) || 0);
  if (level >= FACTION_THRESHOLDS.defiant) {
    return { id: "defiant", label: "Açık meydan okuma", note: "Muhalefet sokakta açıkça toplanıyor; garnizonun zapt gücü neredeyse kalmadı." };
  }
  if (level >= FACTION_THRESHOLDS.organized) {
    return { id: "organized", label: "Örgütlü muhalefet", note: "Bir elebaşı çıktı ve halkın bir bölümü onun sözünü dinliyor." };
  }
  if (level >= FACTION_THRESHOLDS.stirring) {
    return { id: "stirring", label: "Kıpırdanma", note: "Kahvelerde fısıltı var; henüz bir önder yok." };
  }
  return { id: "none", label: "Muhalefet yok", note: "Krallıkta örgütlü bir muhalefet yok." };
}

// --- HALKIN NABZI (plan belgesi Fikir 6) -----------------------------------

/**
 * KRİTİK BİR KARARDA HALKIN MUHTEMEL TEPKİSİ — kararın SONRASI değil ÖNCESİ.
 *
 * Kral ağır bir emir verdiğinde (`server/general-risk.ts` → `elevated`/`severe`)
 * General'in itirazının yanında halkın nabzı da gösterilir: "bu karar halkın
 * gözünde nasıl karşılanır". Veto DEĞİL, sinyal.
 *
 * İKİ KESİN TASARIM KARARI (plan belgesi, "Karar 2026-08-22") — ikisi de
 * tartışmaya kapalı:
 *
 *  1) NİTEL ETİKET, sayı YOK. "Rıza tahmini −8 puan" demek oyuncuyu min-maxing'e
 *     çağırırdı: Kral eşiğin bir puan altında kalmayı öğrenir ve halk bir
 *     aktörden bir formüle dönüşürdü. Bu yüzden `label`/`note` metindir ve
 *     BURADA hiçbir sayı üretilmez.
 *  2) `elevated` VE `severe` kademelerinde görünür (yalnızca `severe` değil).
 *     Kademe kapısı BU DOSYADA DEĞİL, `server/general-risk.ts` içinde durur:
 *     risk kademesi orada hesaplanıyor ve kapıyı iki yerde tutmak ikinci bir
 *     eşik listesi açardı (kısıt #5).
 *
 * YENİ EŞİK UYDURULMADI: nabız yalnızca zaten var olan iki ölçüden okunur —
 * `factionTarget(popularity)` (mevcut rızanın işaret ettiği baskı; rıza
 * `moodFloor`un üstündeyse 0) ve `FACTION_THRESHOLDS`. Yani nabız halkın
 * bugünkü hâlini değil, gidişatın işaret ettiği yeri söyler.
 */
export type PopulacePulseId = "steady" | "grumbling" | "hostile" | "breaking";

export type PopulacePulse = {
  id: PopulacePulseId;
  /** Kral'a gösterilen tek cümlelik nitel etiket. */
  label: string;
  /** Etiketin gerekçesi; hâlâ nitel, hâlâ sayısız. */
  note: string;
};

const PULSES: Record<PopulacePulseId, Omit<PopulacePulse, "id">> = {
  steady: {
    label: "Halk şu an arkanızda.",
    note: "Rıza yerinde ve örgütlü bir muhalefet yok; bu kararın bedeli halkta değil, hazinede ya da savunmada aranmalı.",
  },
  grumbling: {
    label: "Halk bunu hoş karşılamaz.",
    note: "Rıza zaten muhalefetin beslendiği bandın içinde; böyle bir karar kahvedeki fısıltıyı büyütür.",
  },
  hostile: {
    label: "Halk buna açıkça karşı çıkar.",
    note: "Muhalefetin bir elebaşısı var ve sözü dinleniyor; bu karar onun elini güçlendirir, garnizonun zapt gücünü daha da zayıflatır.",
  },
  breaking: {
    label: "Halk bunu bir kopuş sayar.",
    note: "Muhalefet meydanda açıkça toplanıyor; bu kararın ardından Kral'ın elinde halkı yatıştıracak bir kuvvet kalmaz, yalnızca rızayı yükseltmek kalır.",
  },
};

/**
 * Halkın nabzı. Saf ve sayısız; girdiler bozuk gelirse en yumuşak kademeye
 * düşer (`steady`), çünkü bilgisi olmayan bir gösterge Kral'ı korkutmamalı.
 *
 * Sıra ANLAMLIDIR: baskı büyükten küçüğe sınanır, en sonda "gidişat kötü ama
 * henüz örgüt yok" hâli gelir.
 */
export function populacePulse(popularity: number, pressure: number): PopulacePulse {
  const level = Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, Number(pressure) || 0));
  const drift = factionTarget(Number.isFinite(popularity) ? popularity : 50);
  const id: PopulacePulseId = level >= FACTION_THRESHOLDS.defiant ? "breaking"
    : level >= FACTION_THRESHOLDS.organized ? "hostile"
    // Ya baskı kıpırdanmaya başladı ya da rıza muhalefetin beslendiği bandın
    // içine düştü (yani baskı henüz 0 olsa bile hedef sıfırdan büyük).
    : level >= FACTION_THRESHOLDS.stirring || drift > 0 ? "grumbling"
    : "steady";
  return { id, ...PULSES[id] };
}

// --- Elebaşının adı --------------------------------------------------------

const LEADERS = [
  "Balaban", "Cüneyt", "Davut", "Emrah", "Fettah", "Gündüz", "Hüsam", "İsfendiyar",
  "Karaca", "Lütfi", "Mahmut", "Nasuh", "Osman", "Pervane", "Recep", "Sadık",
  "Şahin", "Tuğrul", "Umut", "Veli", "Yılmaz", "Ziya", "Bekir", "Cafer",
] as const;

const EPITHETS = ["Değirmenci", "Demirci", "Dokumacı", "Fırıncı", "Kayıkçı", "Tuzcu", "Yorgancı", "Nalbant"] as const;

/** FNV-1a; motorun her yerinde kullanılan aynı karma. */
function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Muhalefetin elebaşı. Tohum krallığın adı ve kuruluş anıdır: ad hiçbir yerde
 * saklanmasa da aynı krallıkta hep aynı çıkar, farklı krallıklarda farklı olur.
 *
 * TOHUM DİZGESİ ("hizip") DEĞİŞTİRİLEMEZ. Terim "muhalefet"e çevrildiğinde bu
 * dizgeyi de güncellemek doğal görünüyor ama YAPILMAMALI: tohum değişirse hash
 * değişir, hash değişirse HER MEVCUT KRALLIĞIN elebaşısı bir gecede başka biri
 * olur. Oyuncunun aylardır tanıdığı isim kaybolur. Dizge burada bir kimliktir,
 * bir metin değil.
 */
export function factionLeaderName(kingdomName: string, foundedAt: number) {
  const seed = hash(`${kingdomName}|${foundedAt}|hizip`);
  const name = LEADERS[seed % LEADERS.length];
  const epithet = EPITHETS[Math.floor(seed / LEADERS.length) % EPITHETS.length];
  return `${epithet} ${name}`;
}

/** Eşik geçişlerinde Kral'a yazılan bildirim; her eşik bir kez konuşur. */
export function factionNotice(previous: number, current: number, kingdomName: string, foundedAt: number): string | null {
  const crossed = (limit: number) => current >= limit && previous < limit;
  if (crossed(FACTION_THRESHOLDS.defiant)) {
    return `${factionLeaderName(kingdomName, foundedAt)} meydanda açıkça konuşuyor; asker kalabalığı dağıtamıyor. Bunu ancak halkın rızasını yükselterek çözebilirsiniz.`;
  }
  if (crossed(FACTION_THRESHOLDS.organized)) {
    return `Halkın hoşnutsuzluğu bir isme bağlandı: ${factionLeaderName(kingdomName, foundedAt)}. Muhalefet artık örgütlü ve garnizonun zapt gücünü zayıflatıyor.`;
  }
  if (crossed(FACTION_THRESHOLDS.stirring)) {
    return "Kahvelerde ve tezgâh başlarında hoşnutsuz bir fısıltı dolaşıyor; henüz bir önder yok.";
  }
  return null;
}
