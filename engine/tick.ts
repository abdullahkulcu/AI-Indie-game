export { materialScaleOf } from "./catalog";
import { MAX_BUILDING_LEVEL, MAX_KEEP_LEVEL, catalog, keepSeconds, keepUpgradeCosts, materialScaleOf, resourceLabels, terrainCatalog } from "./catalog";
import { advanceCommons, commonsFlow, commonsOf, commonsReference, livingCost, livingCostMood, orderPayout } from "./market";
import { armySize, approachMood, hourlyDemand, moodState, moodTarget, populationChange, rationsOf, satisfaction, soldierUnrestAfter, SOLDIER_THRESHOLDS, suppression } from "./populace";
import { offWatchStrength, raidNotice, resolveRaids, watchRatioOf } from "./raids";
import { applySpoilage, storageCaps } from "./storage";
import type { Game, Key, Res } from "./types";

/** Defteri gereksiz satırla doldurmamak için, hareket bu eşiği aşınca yazılır. */
const LEDGER_STEP = 5;

const labelOf = (key: Key) => resourceLabels.find(([id]) => id === key)?.[1] ?? key;

export const keep = (g: Pick<Game, "buildings">) => g.buildings.find(b => b.type === "keep")?.level ?? 1;

export const affordable = (r: Res, c: Partial<Res>) =>
  Object.entries(c).every(([key, value]) => r[key as Key] >= (value ?? 0));

export const debit = (resources: Res, cost: Partial<Res>): Res => {
  const next = { ...resources };
  Object.entries(cost).forEach(([key, value]) => { next[key as Key] -= value ?? 0; });
  return next;
};

/** Bir binanın mevcut seviyesine göre bir sonraki seviyenin maliyeti. */
/**
 * Seviye maliyeti.
 *
 * Odun ve taş daha dik büyür (1.85), altın ve yiyecek eskisi gibi (1.65):
 * glut olan kaynak yüksek seviyelerde gerçek bir gider olsun, zaten dar olan
 * altın daha da darlaşmasın.
 *
 * `materialScale` channel'dan gelir: hızlı channel'da saatte daha çok odun
 * çıkar, dolayısıyla aynı seviye orada da bir anlam taşısın diye malzeme
 * maliyeti aynı oranda büyür. Yalnızca malzemeye uygulanır.
 */
const MATERIALS = new Set<string>(["wood", "stone", "iron"]);

export const costFor = (base: Partial<Res>, level: number, materialScale = 1): Partial<Res> =>
  Object.fromEntries(Object.entries(base).map(([key, value]) => {
    const material = MATERIALS.has(key);
    const growth = key === "wood" || key === "stone" ? 1.85 : 1.65;
    return [key, Math.ceil((value ?? 0) * Math.pow(growth, level) * (material ? materialScale : 1))];
  })) as Partial<Res>;

/**
 * Kale yükseltmesinin maliyeti; katalog binalarıyla AYNI kuralla ölçeklenir:
 * yalnızca malzeme (odun, taş, demir) channel çarpanını yer, altın yemez.
 *
 * Kale bu çarpanın dışında kaldığı sürece katalog kendi içinde tutarsızdı ve
 * başlangıç stoğu hıza göre ölçeklenince tutarsızlık dengesizliğe dönüşüyordu:
 * hız 24'te 7.200 taşla 400 taşlık Kale Sv.2 ilk dakikada alınıyor, tier-2
 * binalar (Pazar, Bira Evi) sezonun ilk dakikasında açılıyordu.
 */
export const keepCostFor = (level: number, materialScale = 1): Partial<Res> =>
  Object.fromEntries(Object.entries(keepUpgradeCosts[level] ?? {}).map(([key, value]) =>
    [key, Math.ceil((value ?? 0) * (MATERIALS.has(key) ? materialScale : 1))],
  )) as Partial<Res>;

/**
 * Nüfus kapasitesi — TEK KAYNAK. Kuruluşta (`engine/founding.ts`) elle "150"
 * yazılıydı; formül burada değişince o kopya sessizce sapıyordu.
 */
export const capacityFor = (buildings: Game["buildings"]) =>
  150 + (buildings.find(b => b.type === "town_square")?.level ?? 0) * 80 + (keep({ buildings }) - 1) * 50;



/**
 * Kurulabilecek/yükseltilebilecek yapıların listesi: ad, sıradaki seviye, süre
 * ve MALİYET. Tek kaynak olması şart — panel maliyeti bir yerde, General'in
 * bağlamı başka yerde hesapladığında ikisi saptı: Kral panelde 204 taş görüp
 * emri verdi, General 4.884 taşa göre itiraz etti.
 */
export type BuildOption = { type: string; name: string; nextLevel: number; seconds: number; cost: Partial<Res> };

export function buildOptions(g: Game): BuildOption[] {
  const level = keep(g), scale = materialScaleOf(g.speed);
  const options: BuildOption[] = catalog
    .filter(item => item.unlock <= level)
    // Tavana ulaşan bina listeden düşer. Düşmediğinde Sv.7 öneriliyor, emir
    // kabul ediliyor, sonra kayıt şeması bütün kaydı reddediyordu.
    .filter(item => (g.buildings.find(building => building.type === item.type)?.level ?? 0) < MAX_BUILDING_LEVEL)
    .map(item => {
      const current = g.buildings.find(building => building.type === item.type)?.level ?? 0;
      return {
        type: item.type, name: item.name, nextLevel: current + 1,
        seconds: Math.round(item.seconds / g.speed),
        cost: costFor(item.cost, current, scale),
      };
    });
  if (level < MAX_KEEP_LEVEL) {
    options.unshift({
      type: "keep", name: "Kale", nextLevel: level + 1,
      seconds: Math.round(keepSeconds[level] / g.speed),
      cost: keepCostFor(level, scale),
    });
  }
  return options;
}

/**
 * Yapıların bakımı: üretimin bu payı kereste ve taş ocağının kendi onarımına,
 * yol ve sur bakımına gider. Ölçüldü — bu olmadan odunun tek gideri inşaattı,
 * yani inşaat durunca ambar sonsuza kadar büyüyordu.
 */
export const UPKEEP = { wood: .35, stone: .35 } as const;

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
  // Bakım: odun ve taşın tek sürekli gideri. Bunlar olmadan net = brüt idi ve
  // ambar sonsuza kadar şişiyordu. Sabit sayı değil ORAN, çünkü seviye başına
  // sabit gider büyük krallıkta üretimi aşıyor, küçükte hissedilmiyor.
  net.wood -= gross.wood * UPKEEP.wood;
  net.stone -= gross.stone * UPKEEP.stone;
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
  const rt = rates(g); let resources = { ...g.resources };
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

  const capacity = capacityFor(buildings);

  // --- Halk sistemi -------------------------------------------------------
  // İstihkak fiilen ne kadar dağıtılabildi? Stok yetmezse kâğıt üstündeki oran
  // değil, dağıtılabilen oran mutluluğu belirler.
  const rations = rationsOf(g);
  const served = {
    food: rations.food * satisfaction(demand.food * hours, g.resources.food + gross.food * hours),
    ale: rations.ale * satisfaction(demand.ale * hours, g.resources.ale + gross.ale * hours),
    pay: rations.soldierPay * satisfaction(demand.gold * hours, g.resources.gold + gross.gold * hours),
  };

  // --- Halkın defteri -----------------------------------------------------
  // Krallığın İKİNCİ defteri: halkın kendi stoğu. Fiyat buradan doğar ve
  // pahalı ekmeğin rızaya bedeli buradan hesaplanır. Sürücüler (nüfus, fiilen
  // dağıtılan istihkak) tıpkı diğer kalemler gibi ADIM BAŞINDAN okunur.
  const commonsNow = commonsOf(g);
  const commonsRef = commonsReference(g.population);

  const target = moodTarget({
    servedFood: served.food, servedAle: served.ale, taxRate: g.taxRate,
    population: g.population, capacity, buildings,
    hoursSinceRaid: g.lastRaidAt ? (now - g.lastRaidAt) / 3_600_000 : null,
    livingMood: livingCostMood(livingCost(commonsNow, commonsRef)),
  });
  // Yağmalanan krallıkta halkın rızası da düşer.
  const popularity = Math.max(0, approachMood(g.popularity, target, hours) - raid.moodLoss);

  const soldierUnrest = army > 0 ? soldierUnrestAfter(g.soldierUnrest ?? 0, served.pay, hours) : 0;
  const state = moodState(popularity, suppression(offWatchStrength(army, watch), g.population, soldierUnrest));

  // Nüfus halkın büyüklüğüne oranla değişir; kapasite büyümeyi frenler.
  const growth = populationChange(state, g.population, capacity, buildings, hours);

  notices = populaceNotices(g, { state, soldierUnrest, previousUnrest: g.soldierUnrest ?? 0, served }, notices, now);

  let mutinyLoss = 0;
  if (soldierUnrest >= SOLDIER_THRESHOLDS.desertion && army > 0) {
    // Firar: maaşsız kalan askerlerin bir kısmı dağılır.
    mutinyLoss = Math.min(army, Math.ceil(army * (soldierUnrest >= SOLDIER_THRESHOLDS.mutiny ? .12 : .05) * hours));
    if (mutinyLoss > 0) units = shrinkArmy(units, mutinyLoss);
  }

  // Depo tavanı: aşan stok saatte bir oranla bozulur. Anında kırpılmaz ki Kral
  // depo kurmaya ya da Pazarda satmaya vakit bulsun.
  //
  // Adım başındaki stok (`g.resources`) da verilir: bozulmanın ne kadar sürdüğü
  // stoğun aralık boyunca izlediği yola bağlıdır. Yalnızca varış noktasına
  // bakıldığında tek adım ile saniyelik adımlar %19'a varan farklı sonuç
  // veriyordu ve bu, motorun determinizm kuralının sessiz ihlaliydi.
  const caps = storageCaps({ buildings, speed: g.speed });
  const spoiled = applySpoilage(resources, caps, hours, g.resources);
  resources = spoiled.resources;
  const spoiledEntries = (Object.entries(spoiled.lost) as Array<[Key, number]>).filter(([, amount]) => amount >= 1);
  // Depo taşması sürerken her tick'te bildirim yazmak defteri doldurur ve akın
  // gibi asıl kayıtları 20 satırlık pencereden dışarı iter. "En üstteki AMBAR
  // ise yazma" yetmedi: araya GENERAL/İNŞAAT bildirimi girince engel sıfırlandı
  // ve Kralın defterinin 20 satırından 16'sı taşma uyarısı oldu. Artık ZAMANA
  // bağlı: oyun saatinde en fazla saatte bir uyarı.
  let spoilNoticeAt = g.lastSpoilNoticeAt ?? 0;
  if (spoiledEntries.length && now - spoilNoticeAt >= 3_600_000) {
    spoilNoticeAt = now;
    const text = spoiledEntries.map(([key, amount]) => `${Math.round(amount)} ${labelOf(key)}`).join(", ");
    notices = [{ kind: "AMBAR", text: `Depo taştı; ${text} bozuldu. Ambar yükseltilmeli ya da fazlası satılmalı.`, at: now }, ...notices].slice(0, 20);
  }

  // Pazar teklifleri: süresi dolan teklif kapanır, karşılığı ancak şimdi gelir.
  let marketOrders = g.marketOrders ?? [];
  if (marketOrders.length) {
    const due = marketOrders.filter(order => order.completesAt <= now);
    marketOrders = marketOrders.filter(order => order.completesAt > now);
    for (const order of due) {
      // Ödemenin ne olduğu TEK YERDE yazılıdır (bkz. engine/market.ts,
      // orderPayout): sunucu bekleyen emrin getireceği miktarı doğrularken
      // aynı kuralı okur, yoksa motorun ödediği ile sunucunun beklediği ayrışır.
      const payout = orderPayout(order);
      resources[payout.key] += payout.amount;
      notices = [{
        kind: "PAZAR",
        text: order.direction === "sell"
          ? `${order.amount} ${labelOf(order.resource)} satıldı; ${order.gold} altın hazineye girdi.`
          : `Satın alınan ${order.amount} ${labelOf(order.resource)} ambara indirildi.`,
        at: order.completesAt,
      }, ...notices].slice(0, 20);
    }
  }

  // Nüfus defteri: sessiz erime olmasın, her hareket yazıya geçsin.
  const settled = Math.max(20, Math.min(capacity, g.population + growth));
  const moved = settled - g.population;
  let drift = (g.migrationDrift ?? 0) + moved;
  let joined = g.peopleJoined ?? 0, left = g.peopleLeft ?? 0;
  if (drift <= -LEDGER_STEP) {
    const gone = Math.floor(-drift);
    left += gone; drift += gone;
    notices = [{ kind: "GÖÇ", text: `${gone} kişi krallığı terk etti; geriye ${Math.round(settled)} kişi kaldı.`, at: now }, ...notices].slice(0, 20);
  } else if (drift >= LEDGER_STEP) {
    const came = Math.floor(drift);
    joined += came; drift -= came;
    notices = [{ kind: "GÖÇ", text: `${came} kişi krallığa yerleşti; nüfus ${Math.round(settled)} oldu.`, at: now }, ...notices].slice(0, 20);
  }

  // Halkın kileri: istihkak fazlası kilere girer, eksiği kilerden yenir, geri
  // kalanı ortalamaya döner. Kapalı çözüm olduğu için altı adım tek adımla
  // birebir aynı sonucu verir (bkz. tests/market.test.ts).
  const commons = advanceCommons(commonsNow, commonsRef, commonsFlow(g.population, served), hours);

  return {
    ...g,
    commons,
    marketOrders,
    lastSpoilNoticeAt: spoilNoticeAt,
    peopleJoined: joined,
    peopleLeft: left,
    migrationDrift: drift,
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
    population: settled,
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
