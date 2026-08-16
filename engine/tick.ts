import { catalog, quotaPerHour, resourceLabels, terrainCatalog } from "./catalog";
import type { Game, Key, Res } from "./types";

export const keep = (g: Pick<Game, "buildings">) => g.buildings.find(b => b.type === "keep")?.level ?? 1;

export const affordable = (r: Res, c: Partial<Res>) =>
  Object.entries(c).every(([key, value]) => r[key as Key] >= (value ?? 0));

export const debit = (resources: Res, cost: Partial<Res>): Res => {
  const next = { ...resources };
  Object.entries(cost).forEach(([key, value]) => { next[key as Key] -= value ?? 0; });
  return next;
};

/** Bir binanın mevcut seviyesine göre bir sonraki seviyenin maliyeti. */
export const costFor = (base: Partial<Res>, level: number): Partial<Res> =>
  Object.fromEntries(Object.entries(base).map(([key, value]) => [key, Math.ceil((value ?? 0) * Math.pow(1.65, level))])) as Partial<Res>;

export function rates(g: Game): Res {
  const levels = Object.fromEntries(g.buildings.map(b => [b.type, b.level]));
  const terrain = terrainCatalog[g.terrain] ?? terrainCatalog.plain;
  return {
    gold: g.population * g.taxRate / 100 * .22,
    food: ((levels.wheat_farm ?? 0) * 18 + (levels.apple_orchard ?? 0) * 10) * terrain.food - g.population * .035,
    stone: (levels.quarry ?? 0) * 16 * terrain.stone,
    wood: (levels.lumberjack ?? 0) * 22 * terrain.wood,
    iron: (levels.mine ?? 0) * 7 * terrain.iron,
    ale: 0,
  };
}

/**
 * Kaynak üretimi, kuyruk tamamlanması, nüfus/popülerlik ve emir kotasını
 * `now` anına kadar ilerletir. Saf fonksiyon: aynı girdi hep aynı çıktıyı verir,
 * böylece istemci ve sunucu aynı sonucu hesaplar.
 */
export function tick(g: Game, now: number): Game {
  const hours = Math.min(24, (now - g.lastTickAt) / 3_600_000 * g.speed);
  if (hours <= 0) return g;

  const rt = rates(g), resources = { ...g.resources };
  resourceLabels.forEach(([key]) => { resources[key] = Math.max(0, resources[key] + rt[key] * hours); });

  let buildings = g.buildings, units = g.units, queue = g.queue, notices = g.notices;
  if (queue && queue.completesAt <= now) {
    const done = queue;
    if (done.kind === "building") {
      const existing = buildings.find(b => b.type === done.type);
      const item = catalog.find(b => b.type === done.type);
      buildings = existing
        ? buildings.map(b => b.type === done.type ? { ...b, level: done.targetLevel ?? b.level } : b)
        : [...buildings, {
            type: done.type,
            name: done.name.replace(/ Sv\.\d+$/, "") || item?.name || done.name,
            category: item?.category ?? "Yönetim",
            level: done.targetLevel ?? 1,
          }];
    } else {
      units = { ...units, [done.type]: (units[done.type] ?? 0) + (done.count ?? 0) };
    }
    notices = [{ kind: "TAMAMLANDI", text: `${done.name} tamamlandı.`, at: now }, ...notices].slice(0, 20);
    queue = null;
  }

  const level = keep({ buildings });
  const square = buildings.find(b => b.type === "town_square")?.level ?? 0;
  const capacity = 150 + square * 80 + (level - 1) * 50;
  const popularity = Math.max(0, Math.min(100, g.popularity + ((15 - g.taxRate) * .025 + (rt.food >= 0 ? .06 : -.18)) * hours));
  const growth = popularity >= 50 && rt.food >= 0 ? (.08 + square * .04) * hours : popularity < 20 ? -.2 * hours : 0;
  const quotaHours = Math.floor((now - g.quotaAt) / 3_600_000);

  return {
    ...g,
    resources,
    popularity,
    population: Math.max(20, Math.min(capacity, g.population + growth)),
    capacity,
    buildings,
    units,
    queue,
    notices,
    quota: Math.min(quotaPerHour(level) * 2, g.quota + quotaHours * quotaPerHour(level)),
    quotaAt: quotaHours ? g.quotaAt + quotaHours * 3_600_000 : g.quotaAt,
    lastTickAt: now,
  };
}
