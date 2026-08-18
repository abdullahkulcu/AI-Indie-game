import { catalog, resourceLabels, terrainCatalog } from "./catalog";
import { armySize, approachMood, hourlyDemand, moodState, moodTarget, rationsOf, satisfaction, soldierUnrestAfter, SOLDIER_THRESHOLDS, suppression } from "./populace";
import { offWatchStrength, raidNotice, resolveRaids, watchRatioOf } from "./raids";
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

/** Ham üretim: halkın tüketimi ve iş bırakma etkisi hesaba katılmadan önce. */
/**
 * Madende çalışan halk yerel üretime katkı vermez. Askerler nüfustan düşüldüğü
 * için ayrıca hesaba katılmaz; madenci ise nüfusta kalır (yemek yer) ama tarlada
 * değildir. Oran, üretimi ölçeklendirir.
 */
export function laborFactor(g: Pick<Game, "population" | "mineWorkers">) {
  const away = Math.max(0, Math.min(g.population, g.mineWorkers ?? 0));
  return g.population > 0 ? Math.max(0, (g.population - away) / g.population) : 1;
}

export function grossRates(g: Game): Res {
  const levels = Object.fromEntries(g.buildings.map(b => [b.type, b.level]));
  const terrain = terrainCatalog[g.terrain] ?? terrainCatalog.plain;
  const labor = laborFactor(g);
  return {
    gold: g.population * g.taxRate / 100 * .22 * labor,
    food: ((levels.wheat_farm ?? 0) * 18 + (levels.apple_orchard ?? 0) * 10) * terrain.food * labor,
    stone: (levels.quarry ?? 0) * 16 * terrain.stone * labor,
    wood: (levels.lumberjack ?? 0) * 22 * terrain.wood * labor,
    iron: (levels.mine ?? 0) * 7 * terrain.iron * labor,
    ale: (levels.brewery ?? 0) * 9 * labor,
  };
}

/**
 * Net saatlik değişim: üretim × iş bırakma çarpanı − halkın istihkakı − asker maaşı.
 * Arayüzdeki "+x/sa" değerleri budur, yani istihkakı değiştirince etkisi hemen görünür.
 */
export function rates(g: Game): Res {
  const gross = grossRates(g);
  const demand = hourlyDemand(g);
  const army = armySize(g.units ?? {});
  // Nöbetteki asker halkı zapt etmeye daha az kalır; nöbetin üretim bedeli budur.
  const state = moodState(g.popularity, suppression(offWatchStrength(army, watchRatioOf(g)), g.population, g.soldierUnrest ?? 0));
  const net = { ...gross };
  for (const [key] of resourceLabels) net[key] = gross[key] * state.production;
  net.food -= demand.food;
  net.ale -= demand.ale;
  net.gold -= demand.gold;
  return net;
}

/**
 * Kaynak üretimi, kuyruk tamamlanması ve nüfus/popülerliği `now` anına kadar
 * ilerletir. Saf fonksiyon: aynı girdi hep aynı çıktıyı verir, böylece istemci
 * ve sunucu aynı sonucu hesaplar.
 *
 * Emir kotası birikimi kaldırıldı; `quota`/`quotaAt` alanları yalnızca eski
 * kayıtlarla uyum için taşınır ve motor bunlara hiç dokunmaz.
 */
export function tick(g: Game, now: number): Game {
  const hours = Math.min(24, (now - g.lastTickAt) / 3_600_000 * g.speed);
  if (hours <= 0) return g;

  const gross = grossRates(g), demand = hourlyDemand(g), army = armySize(g.units ?? {});
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

  // --- Dağ akınları -------------------------------------------------------
  // Nöbetteki asker, Sur ve arazi akını karşılar; yarılan savunma asker, erzak
  // ve altın götürür. Pencereler mutlak zamana oturduğu için istemcinin küçük
  // adımları ile sunucunun tek adımı aynı akınları çözer.
  const watch = watchRatioOf(g);
  const raid = resolveRaids(g, g.lastTickAt, now, resources);
  if (raid.events.length) {
    resources.food = Math.max(0, resources.food - raid.foodStolen);
    resources.gold = Math.max(0, resources.gold - raid.goldStolen);
    if (raid.soldiersLost > 0) units = shrinkArmy(units, raid.soldiersLost);
    notices = [...raid.events.map(event => ({ kind: "AKIN", text: raidNotice(event), at: event.at })).reverse(), ...notices].slice(0, 20);
  }

  const level = keep({ buildings });
  const square = buildings.find(b => b.type === "town_square")?.level ?? 0;
  const capacity = 150 + square * 80 + (level - 1) * 50;

  // --- Halk sistemi -------------------------------------------------------
  // İstihkak fiilen ne kadar dağıtılabildi? Stok yetmezse kâğıt üstündeki oran
  // değil, dağıtılabilen oran mutluluğu belirler.
  const rations = rationsOf(g);
  const served = {
    food: rations.food * satisfaction(demand.food * hours, g.resources.food + gross.food * hours),
    ale: rations.ale * satisfaction(demand.ale * hours, g.resources.ale + gross.ale * hours),
    pay: rations.soldierPay * satisfaction(demand.gold * hours, g.resources.gold + gross.gold * hours),
  };

  const target = moodTarget({
    servedFood: served.food, servedAle: served.ale, taxRate: g.taxRate,
    population: g.population, capacity, buildings,
    hoursSinceRaid: g.lastRaidAt ? (now - g.lastRaidAt) / 3_600_000 : null,
  });
  // Yağmalanan krallıkta halkın rızası da düşer.
  const popularity = Math.max(0, approachMood(g.popularity, target, hours) - raid.moodLoss);

  const soldierUnrest = army > 0 ? soldierUnrestAfter(g.soldierUnrest ?? 0, served.pay, hours) : 0;
  const state = moodState(popularity, suppression(offWatchStrength(army, watch), g.population, soldierUnrest));

  // Nüfus: durumun tabanı + evlilik dairesi ve meydan katkısı.
  const marriage = buildings.find(b => b.type === "marriage_hall")?.level ?? 0;
  const growthBonus = state.populationPerHour > 0 ? (square * .04 + marriage * .12) : 0;
  const growth = (state.populationPerHour + growthBonus) * hours;

  notices = populaceNotices(g, { state, soldierUnrest, previousUnrest: g.soldierUnrest ?? 0, served }, notices, now);

  let mutinyLoss = 0;
  if (soldierUnrest >= SOLDIER_THRESHOLDS.desertion && army > 0) {
    // Firar: maaşsız kalan askerlerin bir kısmı dağılır.
    mutinyLoss = Math.min(army, Math.ceil(army * (soldierUnrest >= SOLDIER_THRESHOLDS.mutiny ? .12 : .05) * hours));
    if (mutinyLoss > 0) units = shrinkArmy(units, mutinyLoss);
  }

  return {
    ...g,
    resources,
    popularity,
    soldierUnrest,
    foodRation: rations.food,
    aleRation: rations.ale,
    soldierPay: rations.soldierPay,
    watchRatio: watch,
    lastRaidAt: raid.lastRaidAt ?? g.lastRaidAt,
    raidsRepelled: (g.raidsRepelled ?? 0) + raid.repelled,
    raidsSuffered: (g.raidsSuffered ?? 0) + raid.suffered,
    population: Math.max(20, Math.min(capacity, g.population + growth)),
    capacity,
    buildings,
    units,
    queue,
    notices,
    lastTickAt: now,
  };
}

/** Firar ve isyanda ordu küçülür; en kalabalık birlikten başlanır. */
function shrinkArmy(units: Record<string, number>, loss: number) {
  const next = { ...units };
  let remaining = loss;
  for (const key of Object.keys(next).sort((a, b) => next[b] - next[a])) {
    const taken = Math.min(next[key], remaining);
    next[key] -= taken;
    remaining -= taken;
    if (remaining <= 0) break;
  }
  return next;
}

/**
 * Halkın ve askerin durumu değiştiğinde Kral'ı bilgilendirir. Aynı durum
 * tekrar tekrar bildirilmez; yalnızca eşik geçişleri deftere düşer.
 */
function populaceNotices(
  previous: Game,
  now: { state: { id: string; label: string }; soldierUnrest: number; previousUnrest: number; served: { food: number; ale: number; pay: number } },
  notices: Game["notices"],
  at: number,
) {
  const added: Game["notices"] = [];
  const previousState = moodState(previous.popularity, suppression(offWatchStrength(armySize(previous.units ?? {}), watchRatioOf(previous)), previous.population, previous.soldierUnrest ?? 0));
  if (previousState.id !== now.state.id) {
    const text = now.state.id === "revolt" ? "Halk isyan etti; tezgâhlar durdu ve şehirden kaçış başladı."
      : now.state.id === "strike" ? "Halk iş bıraktı; üretim ağır biçimde düştü."
      : now.state.id === "simmering" ? "Halk kaynıyor; istihkak ya da vergi elden geçmeli."
      : now.state.id === "content" ? "Halk memnun; tezgâhlar her zamankinden hızlı."
      : "Halkın öfkesi dindi.";
    added.push({ kind: "HALK", text, at });
  }
  if (now.served.food < 60 && previous.popularity > 0) {
    const already = notices.some(notice => notice.kind === "AÇLIK" && at - notice.at < 6 * 3_600_000);
    if (!already) added.push({ kind: "AÇLIK", text: "Ambarlar istihkakı karşılamıyor; halk aç kalıyor.", at });
  }
  const crossed = (limit: number) => now.soldierUnrest >= limit && now.previousUnrest < limit;
  if (crossed(SOLDIER_THRESHOLDS.demand)) added.push({ kind: "ORDU", text: "Askerler maaşlarını istiyor.", at });
  if (crossed(SOLDIER_THRESHOLDS.desertion)) added.push({ kind: "ORDU", text: "Maaşsız kalan askerler firar etmeye başladı.", at });
  if (crossed(SOLDIER_THRESHOLDS.mutiny)) added.push({ kind: "ORDU", text: "Ordu isyan etti; artık halkı zapt etmiyorlar.", at });
  return added.length ? [...added, ...notices].slice(0, 20) : notices;
}
