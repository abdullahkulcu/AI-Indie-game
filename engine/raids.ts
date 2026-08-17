import { terrainCatalog } from "./catalog";
import { armySize } from "./populace";
import type { Game, TerrainId } from "./types";

/**
 * Dağ akınları ve nöbet sistemi.
 *
 * Dağlardan inen kurtlar, haydutlar ve akıncılar rastgele zamanlarda kaleye
 * saldırır; askeri öldürür, ambarı ve hazineyi yağmalar. Karşılarında yalnızca
 * NÖBETTEKİ asker, Sur ve arazinin savunma avantajı vardır.
 *
 * Saf fonksiyonlardır. `Math.random()` KULLANILMAZ: istemci ve sunucu aynı
 * `tick`'i çalıştırıp aynı sonucu üretmek zorunda (bkz. server/save-validation.ts).
 * Rastgelelik, `engine/world-map.ts` içindeki `jitter()` ile aynı fikirden gelir:
 * tohumlu FNV-1a karması. Tohum sabit değerlerden (krallık adı, kuruluş anı,
 * akın penceresinin indeksi) kurulduğu için aynı krallık aynı anda hep aynı
 * akını yaşar; yeniden yüklemek akını değiştirmez, "save-scum" işe yaramaz.
 *
 * Nöbetin bedeli: nöbetteki asker halkın huzursuzluğunu bastırmaya daha az
 * katkı verir (bkz. `offWatchStrength`). Kral az askerle hem akını karşılamak
 * hem halkı zapt etmek zorunda kalır; asıl karar buradadır.
 */

export type RaidKind = "wolves" | "bandits" | "mountain_raiders";

export const raidCatalog: Record<RaidKind, {
  label: string;
  /** Taban şiddet; krallığın gelişmişliğiyle ölçeklenir. */
  power: number;
  /** Savunmayı aşan gücün asker kaybına çevrim katsayısı. */
  soldierToll: number;
  /** Savunmayı aşan güç başına kaçırılan yiyecek ve altın. */
  foodGreed: number;
  goldGreed: number;
  /** Başarılı akının halkın rızasına vurduğu puan. */
  moodHit: number;
}> = {
  wolves: { label: "Kurt Sürüsü", power: 7, soldierToll: .1, foodGreed: 9, goldGreed: 0, moodHit: 4 },
  bandits: { label: "Haydutlar", power: 9, soldierToll: .05, foodGreed: 2, goldGreed: 9, moodHit: 5 },
  mountain_raiders: { label: "Dağ Akıncıları", power: 16, soldierToll: .12, foodGreed: 7, goldGreed: 6, moodHit: 8 },
};

/**
 * Arazi akının hem sıklığını hem türünü belirler: dağ eteğindeki kale sürekli
 * akıncı görür, ova daha çok haydut yolu üstündedir.
 */
const TERRAIN_RAIDS: Record<TerrainId, { chance: number; weights: Record<RaidKind, number> }> = {
  plain: { chance: .14, weights: { wolves: .25, bandits: .55, mountain_raiders: .2 } },
  forest: { chance: .16, weights: { wolves: .5, bandits: .3, mountain_raiders: .2 } },
  mountain: { chance: .24, weights: { wolves: .3, bandits: .2, mountain_raiders: .5 } },
  riverbank: { chance: .13, weights: { wolves: .25, bandits: .55, mountain_raiders: .2 } },
};

/** Akın penceresi: oyun saati cinsinden. Her pencerede en fazla bir akın olur. */
export const RAID_WINDOW_HOURS = 4;

/** Tek tick'te çözülecek azami pencere; `tick` de üretimi 24 oyun saatiyle sınırlar. */
const MAX_WINDOWS_PER_TICK = 24 / RAID_WINDOW_HOURS;

/** Nöbetteki asker başına savunma gücü. */
const GUARD_PER_SOLDIER = 1.4;

/** Sur seviyesi başına savunma: hem sabit bir taban hem çarpan verir. */
const WALL_FLAT = 4;
const WALL_MULTIPLIER = .2;

/**
 * Nöbetteki askerin huzursuzluk bastırma gücünden düşülen pay. %100 nöbette
 * ordunun yalnızca %40'ı halkı zapt etmeye kalır.
 */
const WATCH_SUPPRESSION_PENALTY = .6;

/** Tek akında kaybedilebilecek azami ordu payı; bir baskın orduyu bitiremez. */
const MAX_SOLDIER_LOSS_SHARE = .25;

/** Nöbet oranı verilmemiş eski kayıtlarda uygulanan varsayılan. */
export const DEFAULT_WATCH_RATIO = 60;

export const WATCH_LIMITS = { min: 0, max: 100 } as const;

export const clampWatch = (value: number) =>
  Math.max(WATCH_LIMITS.min, Math.min(WATCH_LIMITS.max, Math.round(Number(value) || 0)));

export const watchRatioOf = (game: Pick<Game, "watchRatio">) =>
  clampWatch(game.watchRatio ?? DEFAULT_WATCH_RATIO);

/** FNV-1a; `world-map.ts` içindeki `jitter()` ile aynı karma. */
function hashSeed(seed: string) {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/** Tohumdan türeyen 0-1 arası deterministik sayı. */
export function rand01(seed: string) {
  return hashSeed(seed) / 4_294_967_296;
}

/**
 * Nöbetteki asker halkı zapt etmeye daha az kalır. `populace.suppression()`
 * bu küçültülmüş orduyla çağrılır; nöbetin gerçek bedeli budur.
 */
export function offWatchStrength(army: number, watchRatio: number) {
  return Math.max(0, army) * (1 - WATCH_SUPPRESSION_PENALTY * clampWatch(watchRatio) / 100);
}

const wallLevel = (game: Pick<Game, "buildings">) =>
  game.buildings.find(building => building.type === "wall")?.level ?? 0;

const keepLevel = (game: Pick<Game, "buildings">) =>
  game.buildings.find(building => building.type === "keep")?.level ?? 1;

/**
 * Nöbetin fiilî savunma gücü.
 *
 * Maaşı ödenmemiş asker iyi savunmaz: `populace.suppression()` içindeki
 * `reliability` fikri burada da geçerlidir, sadece eşiği biraz daha yüksektir
 * (huzursuz asker halkı zapt etmez ama canı pahasına yine de dövüşür).
 */
export function defenseOf(game: Pick<Game, "buildings" | "units" | "terrain" | "watchRatio" | "soldierUnrest">) {
  const army = armySize(game.units ?? {});
  const watch = watchRatioOf(game);
  const watchers = Math.floor(army * watch / 100);
  const reliability = Math.max(0, 1 - (game.soldierUnrest ?? 0) / 70);
  const wall = wallLevel(game);
  const terrain = terrainCatalog[game.terrain] ?? terrainCatalog.plain;
  const power = (watchers * GUARD_PER_SOLDIER * reliability + wall * WALL_FLAT)
    * (1 + wall * WALL_MULTIPLIER)
    * terrain.defense;
  return { army, watch, watchers, reliability, wall, power };
}

/** Akın penceresinin gerçek zamandaki uzunluğu; hızlı channel'da pencere de kısalır. */
const windowMs = (game: Pick<Game, "speed">) =>
  RAID_WINDOW_HOURS * 3_600_000 / Math.max(1, game.speed || 1);

const windowIndexAt = (game: Pick<Game, "speed" | "foundedAt">, at: number) =>
  Math.floor((at - game.foundedAt) / windowMs(game));

export const windowStart = (game: Pick<Game, "speed" | "foundedAt">, index: number) =>
  Math.round(game.foundedAt + index * windowMs(game));

/** Akın türünü ağırlıklı kurayla seçer. */
function pickKind(terrain: TerrainId, roll: number): RaidKind {
  const weights = (TERRAIN_RAIDS[terrain] ?? TERRAIN_RAIDS.plain).weights;
  let cursor = 0;
  for (const kind of Object.keys(weights) as RaidKind[]) {
    cursor += weights[kind];
    if (roll < cursor) return kind;
  }
  return "bandits";
}

export type PlannedRaid = { kind: RaidKind; label: string; threat: number; at: number };

/**
 * Bir pencerede akın var mı, varsa hangi tür ve ne şiddette?
 *
 * Tamamen tohumdan türer: aynı krallık, aynı pencere → aynı akın. Koruma
 * süresi dolmadan hiçbir pencere akın üretmez.
 */
export function raidInWindow(
  game: Pick<Game, "kingdomName" | "foundedAt" | "speed" | "terrain" | "buildings" | "protectionEndsAt">,
  index: number,
): PlannedRaid | null {
  if (index < 0) return null;
  const at = windowStart(game, index);
  if (at <= game.protectionEndsAt) return null;

  const terrain = TERRAIN_RAIDS[game.terrain] ?? TERRAIN_RAIDS.plain;
  const level = keepLevel(game);
  // Zengin ve büyük kale daha çok göze batar; ihtimal ölçülü biçimde artar.
  const chance = Math.min(.45, terrain.chance * (1 + (level - 1) * .06));
  const seed = `${game.kingdomName}:${game.foundedAt}:${index}`;
  if (rand01(`${seed}:gelir`) >= chance) return null;

  const kind = pickKind(game.terrain, rand01(`${seed}:tur`));
  const entry = raidCatalog[kind];
  // Şiddet krallığın gelişmişliğiyle ölçeklenir: kale seviyesi ve geçen gün.
  const days = Math.min(30, Math.max(0, (at - game.foundedAt) / 86_400_000 * Math.max(1, game.speed || 1)));
  const scale = 1 + (level - 1) * .45 + days * .05;
  // Şiddet dar bir aralıkta salınır; aynı tür akın hep aynı ağırlıkta gelmez.
  const spread = .7 + rand01(`${seed}:siddet`) * .6;
  return { kind, label: entry.label, threat: entry.power * scale * spread, at };
}

export type RaidEvent = PlannedRaid & {
  defense: number;
  repelled: boolean;
  soldiersLost: number;
  foodStolen: number;
  goldStolen: number;
  moodLoss: number;
};

export type RaidResolution = {
  events: RaidEvent[];
  soldiersLost: number;
  foodStolen: number;
  goldStolen: number;
  moodLoss: number;
  repelled: number;
  suffered: number;
  /** Son akının zamanı; hiç akın olmadıysa null. */
  lastRaidAt: number | null;
};

const EMPTY: RaidResolution = {
  events: [], soldiersLost: 0, foodStolen: 0, goldStolen: 0, moodLoss: 0,
  repelled: 0, suffered: 0, lastRaidAt: null,
};

/**
 * `from` ile `to` arasındaki bütün akın pencerelerini çözer.
 *
 * Pencere sınırları mutlak zamana oturduğu için istemcinin saniyelik küçük
 * adımları ile sunucunun tek adımı aynı akınları üretir. Çok uzun aradan sonra
 * dönüldüğünde yalnızca son `MAX_WINDOWS_PER_TICK` pencere çözülür; bu, `tick`
 * içindeki 24 saatlik üretim tavanıyla aynı sınırdır.
 */
export function resolveRaids(
  game: Game,
  from: number,
  to: number,
  stock: { food: number; gold: number },
): RaidResolution {
  if (to <= from) return EMPTY;
  const first = windowIndexAt(game, from) + 1;
  const last = windowIndexAt(game, to);
  if (last < first) return EMPTY;

  const defense = defenseOf(game);
  const start = Math.max(first, last - MAX_WINDOWS_PER_TICK + 1);
  const events: RaidEvent[] = [];
  let food = Math.max(0, stock.food), gold = Math.max(0, stock.gold);
  let army = defense.army;

  for (let index = start; index <= last; index += 1) {
    const planned = raidInWindow(game, index);
    if (!planned) continue;
    const entry = raidCatalog[planned.kind];
    // Savunmayı aşan güç yağmaya dönüşür; aşamayan akın püskürtülür.
    const breach = Math.max(0, planned.threat - defense.power);
    if (breach <= 0) {
      events.push({ ...planned, defense: defense.power, repelled: true, soldiersLost: 0, foodStolen: 0, goldStolen: 0, moodLoss: 0 });
      continue;
    }
    // Nöbette olmayan asker de yatağında öldürülür: yarılan savunmanın bedelini
    // ordunun tamamı öder, sadece nöbetçiler değil. Yine de tek bir akın orduyu
    // silip süpüremez; kayıp mevcudun dörtte biriyle sınırlıdır, ordu ancak
    // üst üste ihmal edilirse erir.
    const soldiersLost = Math.min(army, Math.ceil(breach * entry.soldierToll), Math.max(1, Math.ceil(army * MAX_SOLDIER_LOSS_SHARE)));
    const foodStolen = Math.min(food, breach * entry.foodGreed);
    const goldStolen = Math.min(gold, breach * entry.goldGreed);
    const severity = Math.min(1, breach / Math.max(1, planned.threat));
    const moodLoss = entry.moodHit * severity;
    army -= soldiersLost;
    food -= foodStolen;
    gold -= goldStolen;
    events.push({ ...planned, defense: defense.power, repelled: false, soldiersLost, foodStolen, goldStolen, moodLoss });
  }

  if (!events.length) return EMPTY;
  return {
    events,
    soldiersLost: events.reduce((total, event) => total + event.soldiersLost, 0),
    foodStolen: events.reduce((total, event) => total + event.foodStolen, 0),
    goldStolen: events.reduce((total, event) => total + event.goldStolen, 0),
    moodLoss: events.reduce((total, event) => total + event.moodLoss, 0),
    repelled: events.filter(event => event.repelled).length,
    suffered: events.filter(event => !event.repelled).length,
    lastRaidAt: events[events.length - 1].at,
  };
}

/** Kral ne kaybettiğini rakamıyla görmeli; boş kalem yazılmaz. */
export function raidNotice(event: RaidEvent) {
  if (event.repelled) {
    return `${event.label} kaleye saldırdı; nöbet akını püskürttü, kayıp yok.`;
  }
  const losses: string[] = [];
  if (event.soldiersLost > 0) losses.push(`${event.soldiersLost} asker öldü`);
  if (event.foodStolen >= 1) losses.push(`${Math.round(event.foodStolen)} yiyecek yağmalandı`);
  if (event.goldStolen >= 1) losses.push(`${Math.round(event.goldStolen)} altın çalındı`);
  const detail = losses.length ? losses.join(", ") : "ambarlarda alacak bir şey bulamadılar";
  return `${event.label} savunmayı yardı: ${detail}.`;
}
