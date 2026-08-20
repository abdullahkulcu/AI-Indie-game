import { catalog, keepSeconds, keepUpgradeCosts, MAX_KEEP_LEVEL, resourceLabels } from "./catalog";
import { commonsOf, commonsReference, coverageOf, fillOrder, isTraded, livingCost, marketPrices, maxPurchase, SPREAD, TRADED_KEYS } from "./market";
import { armySize, clampRation } from "./populace";
import { clampWatch, watchRatioOf } from "./raids";
import { affordable, costFor, debit, keep, materialScaleOf, rates, tick } from "./tick";
import type { Game, GameAction, Key, Res } from "./types";

/** Sunucu uçlarına devredilen eylemler; oyun durumunu doğrudan değiştirmezler. */
export const REMOTE_ACTIONS = ["send_miners", "recall_miners", "send_scout", "raise_counter_intelligence", "open_negotiation", "reply_negotiation", "propose_terms"];

export type ApplyResult = {
  game: Game;
  /** Krala gösterilecek satırlar; "✓" uygulandı, "✕" engellendi. */
  results: string[];
  /** Sunucu uçlarına iletilmesi gereken eylemler. */
  remote: GameAction[];
};

const MAX_ACTIONS_PER_TURN = 3;

/**
 * General'in önerdiği eylemleri oyun durumuna uygular. Saf fonksiyondur:
 * ağ, depolama veya tarayıcı API'si kullanmaz, bu yüzden istemci ve sunucu
 * birebir aynı sonucu üretir.
 *
 * Emirlerin sayısına kota konmaz. Oyunun asıl değeri General'le konuşmaktır;
 * saatlik bir sayaç Kralı tam da bu konuşmadan caydırıyordu. Kısıtı üç gerçek
 * kaynak taşır: harcanan kaynaklar, aynı anda tek iş alan kuyruk ve General'in
 * kendi risk yargısı (bkz. server/general-risk.ts).
 */
/**
 * Göçmen çağrısı: nüfusu beklemeden büyütmenin tek doğrudan yolu. Bedeli
 * ambardan çıkar ve üç koşulu vardır — boş konut, kabul edilebilir rıza ve
 * bekleme süresi. Böylece nüfus, hazineyle sınırsızca satın alınamaz.
 */
/**
 * Hızlandırma parayla bitirme değildir: dışarıdan gezgin usta tutulur, iş iki
 * kat hızlanır ve o kadar. Ustalar krallığın nüfusundan çıkmaz — tarlada bir el
 * eksilmez — ama yevmiyeleri ağırdır ve aynı işe bir kez çağrılırlar.
 */
const HASTEN = { goldPerMinute: 6, minCost: 60, minSeconds: 120, crew: "bir usta takımı" };

const SETTLERS = { cost: { gold: 220, food: 320 }, minRoom: 8, minMood: 45, share: .25, cooldownMs: 12 * 3_600_000 };

/**
 * Pazar: kaynağı altına, altını kaynağa çevirir. Karşı taraf HALKIN KENDİSİDİR
 * ve fiyat halkın stoğundan doğar (bkz. engine/market.ts).
 *
 * Alış fiyatı satıştan yüksektir (makas), yani bir kaynağı satıp geri almak
 * hep zarardır — pazar bedava altın makinesi değil, sıkışıklık çözer. Günlük
 * hacim Pazar seviyesiyle sınırlıdır; ambarı bir seferde boşaltamazsın.
 */
const MARKET = {
  dailyPerLevel: 1500,
  /** Teklifin kapanma süresi: sabit hazırlık + yük başına bekleme. */
  baseMinutes: 18,
  minutesPerUnit: .12,
};

/** Bir teklifin kaç dakikada kapanacağı. Channel hızı süreyi kısaltır. */
export function marketDuration(amount: number, speed: number) {
  return Math.max(5, Math.round((MARKET.baseMinutes + amount * MARKET.minutesPerUnit) / Math.max(1, speed)));
}

const labelOf = (key: Key) => resourceLabels.find(([id]) => id === key)?.[1] ?? key;

/**
 * Pazarın o andaki hâli. `price` artık sabit tablo değil, halkın defterinden
 * okunan CANLI fiyattır; alanın biçimi (kaynak → birim fiyat) aynı kaldığı için
 * arayüz değişmeden canlı fiyatı gösterir.
 *
 * `commons`, `reference` ve `coverage` arayüzün halkın durumunu gösterebilmesi
 * için dışarı verilir: Kral neye baktığını görmeden fiyatı yönetemez.
 */
export function marketState(game: Game, now: number) {
  const level = game.buildings.find(building => building.type === "market")?.level ?? 0;
  const open = game.marketOrders ?? [];
  const fresh = now - (game.marketDayAt ?? 0) >= 86_400_000;
  const used = fresh ? 0 : game.marketVolume ?? 0;
  const limit = level * MARKET.dailyPerLevel;
  const commons = commonsOf(game);
  const reference = commonsReference(game.population);
  return {
    level, used, limit,
    left: Math.max(0, limit - used),
    dayAt: fresh ? now : game.marketDayAt ?? now,
    price: marketPrices(commons, reference),
    spread: SPREAD,
    open, slots: level,
    freeSlots: Math.max(0, level - open.length),
    commons, reference,
    coverage: Object.fromEntries(TRADED_KEYS.map(key => [key, coverageOf(commons[key], reference[key])])) as Record<string, number>,
    livingCost: livingCost(commons, reference),
  };
}

export function applyActions(base: Game, actions: GameAction[], now: number): ApplyResult {
  let next = tick(base, now);
  const results: string[] = [], remote: GameAction[] = [];
  // Kral, General'in itirazını ezerek emri uygulattıysa sadakat düşer.
  let overridden = false;
  const success = (text: string) => {
    results.push(`✓ ${text}`);
    next = { ...next, loyalty: Math.max(0, Math.min(100, next.loyalty + (overridden ? -2 : .5))) };
  };
  const blocked = (text: string) => results.push(`✕ ${text}`);
  const majorSpend = (cost: Partial<Res>) =>
    Object.entries(cost).some(([key, value]) => (value ?? 0) > Math.max(1, next.resources[key as Key]) * .65);

  for (const action of actions.slice(0, MAX_ACTIONS_PER_TURN)) {
    overridden = action.arguments.confirmed_risk === true;
    const confirmed = overridden;

    if (action.name === "build_structure") {
      if (next.queue) { blocked(`İnşa emri uygulanmadı: ${next.queue.name} kuyruğu dolu.`); continue; }
      const type = String(action.arguments.building_type ?? "");
      const target = Math.floor(Number(action.arguments.target_level));
      const level = keep(next);

      if (type === "keep") {
        if (target !== level + 1 || level >= MAX_KEEP_LEVEL) { blocked(`Kale yalnızca Sv.${level + 1} seviyesine yükseltilebilir.`); continue; }
        const cost = keepUpgradeCosts[level];
        if (!affordable(next.resources, cost)) { blocked("Kale yükseltmesi kaynak yetersizliği nedeniyle engellendi."); continue; }
        if (majorSpend(cost) && !confirmed) { blocked("Kale yükseltmesi hazinenin kritik bölümünü tüketeceği için açık teyit bekliyor."); continue; }
        next = { ...next, resources: debit(next.resources, cost), queue: { kind: "building", type: "keep", name: `Kale Sv.${target}`, targetLevel: target, startedAt: now, completesAt: now + keepSeconds[level] / next.speed * 1000 } };
        success(`Kale Sv.${target} yükseltmesi başlatıldı.`);
        continue;
      }

      const item = catalog.find(entry => entry.type === type);
      if (!item) { blocked("Bilinmeyen bina emri reddedildi."); continue; }
      const current = next.buildings.find(b => b.type === type)?.level ?? 0;
      if (target !== current + 1) { blocked(`${item.name} yalnızca Sv.${current + 1} seviyesine çıkarılabilir.`); continue; }
      if (item.unlock > level) { blocked(`${item.name} için Kale Sv.${item.unlock} gerekli.`); continue; }
      const cost = costFor(item.cost, current, materialScaleOf(next.speed));
      if (!affordable(next.resources, cost)) { blocked(`${item.name} için kaynak yetersiz; General emri beklemeye aldı.`); continue; }
      if (type !== "wheat_farm" && type !== "apple_orchard" && (rates(next).food < 0 || next.resources.food < 100) && !confirmed) {
        blocked(`${item.name} emri yiyecek krizi çözülene kadar ertelendi.`); continue;
      }
      if (majorSpend(cost) && !confirmed) { blocked(`${item.name} hazinenin kritik bölümünü tüketeceği için açık teyit bekliyor.`); continue; }
      next = {
        ...next,
        resources: debit(next.resources, cost),
        queue: { kind: "building", type, name: `${item.name} Sv.${target}`, targetLevel: target, startedAt: now, completesAt: now + item.seconds / next.speed * 1000 },
        notices: [{ kind: "GENERAL", text: `${item.name} Sv.${target} emri uygulandı.`, at: now }, ...next.notices],
      };
      success(`${item.name} Sv.${target} inşaatı başlatıldı.`);
      continue;
    }

    if (action.name === "accelerate_construction") {
      if (!next.queue?.startedAt) { blocked("Hızlandırılacak aktif kuyruk yok."); continue; }
      const active = next.queue;
      if (active.hastened) { blocked(`Hızlandırma engellendi: ${active.name} için zaten dışarıdan işçi tutuldu. Aynı işe ikinci kez usta çağrılmaz.`); continue; }

      const seconds = Math.max(0, Math.ceil((active.completesAt - now) / 1000));
      if (seconds < HASTEN.minSeconds) { blocked(`Hızlandırma engellendi: ${active.name} zaten ${seconds} saniye içinde bitiyor; usta çağırmaya değmez.`); continue; }

      // Ücret kalan süreye göre; iş ne kadar uzunsa o kadar çok yevmiye ödenir.
      const cost = Math.max(HASTEN.minCost, Math.ceil(seconds / 60) * HASTEN.goldPerMinute);
      if (next.resources.gold < cost) { blocked(`Hızlandırma engellendi: dışarıdan usta tutmak ${cost} altın, hazinede ${Math.floor(next.resources.gold)} var.`); continue; }

      // İş bitmez, yalnızca kalan süre yarıya iner. İşçiler dışarıdan gelir:
      // krallığın nüfusundan düşmezler, karşılığında yevmiyeleri ağırdır.
      const saved = Math.floor(seconds / 2);
      next = {
        ...next,
        resources: { ...next.resources, gold: next.resources.gold - cost },
        queue: { ...active, completesAt: active.completesAt - saved * 1000, hastened: true },
        notices: [{ kind: "İNŞAAT", text: `${active.name} için dışarıdan usta tutuldu; ${cost} altın yevmiye ödendi.`, at: now }, ...next.notices].slice(0, 20),
      };
      success(`${active.name} için dışarıdan ${HASTEN.crew} usta çağrıldı; ${cost} altın yevmiye ödendi. Kalan süre yarıya indi: ${Math.ceil((seconds - saved) / 60)} dakika.`);
      continue;
    }

    if (action.name === "train_unit") {
      if (next.queue) { blocked(`Eğitim emri uygulanmadı: ${next.queue.name} kuyruğu dolu.`); continue; }
      if (!next.buildings.some(b => b.type === "barracks")) { blocked("Eğitim engellendi: önce Kışla kurulmalı."); continue; }
      const unit = String(action.arguments.unit_type ?? ""), count = Math.floor(Number(action.arguments.count));
      if (unit !== "spearman" || count < 1 || count > 50) { blocked("Desteklenmeyen birlik veya adet emri reddedildi."); continue; }
      const cost = { gold: count * 8, food: count * 10, iron: count };
      if (!affordable(next.resources, cost) || next.population - count < 20) { blocked(`${count} Mızrakçı için kaynak ya da çalışan nüfus yetersiz.`); continue; }
      if ((rates(next).food < 0 || count > next.population * .25) && !confirmed) { blocked("Eğitim emri yiyecek/nüfus riski nedeniyle açık teyit bekliyor."); continue; }
      next = {
        ...next,
        resources: debit(next.resources, cost),
        population: next.population - count,
        queue: { kind: "unit", type: "spearman", name: `${count} Mızrakçı`, count, startedAt: now, completesAt: now + count * 1200 / next.speed * 1000 },
      };
      success(`${count} Mızrakçının eğitimi başlatıldı.`);
      continue;
    }

    if (action.name === "trade_resource") {
      const resource = String(action.arguments?.resource ?? "");
      const amount = Math.floor(Number(action.arguments?.amount) || 0);
      const buying = String(action.arguments?.direction ?? "sell") === "buy";
      const market = marketState(next, now);

      if (!isTraded(resource)) { blocked(`Pazar emri geçersiz: ${resource || "kaynak"} pazarda işlem görmez. Yalnızca yiyecek, odun, taş, demir ve bira alınıp satılır.`); continue; }
      if (market.level < 1) { blocked("Pazar emri engellendi: Pazarımız yok. Önce Pazar kurulmalı (Kale Sv.2)."); continue; }
      if (amount < 1) { blocked("Pazar emri engellendi: miktar belirtilmedi."); continue; }
      if (market.freeSlots < 1) { blocked(`Pazar emri engellendi: Sv.${market.level} Pazarın ${market.slots} teklif yuvası da dolu. Önce bekleyen teklifler kapansın.`); continue; }
      if (amount > market.left) { blocked(`Pazar emri engellendi: Sv.${market.level} Pazarın günlük hacmi ${market.limit} birim, bugün ${market.used} birim işlem gördü; ${market.left} birim kaldı.`); continue; }

      const key = resource as keyof Res;
      const held = market.commons[resource];
      // Halk son lokmasını satmaz: tek emirde kilerinin ancak bir kısmı alınabilir.
      // Bu aynı zamanda fiyatın tek emirde tavana vurmasını da engeller.
      if (buying && amount > maxPurchase(held)) {
        blocked(`Alım engellendi: halkın elinde ${Math.floor(held)} ${labelOf(key)} var ve tek seferde en çok ${maxPurchase(held)} birimini satar. Kilerlerini boşaltmaya razı değiller.`);
        continue;
      }

      // Fiyat emrin İÇİNDE hareket eder: emir parçalara bölünür, her parça o
      // andaki stoğa göre fiyatlanır. Büyük emir kendi fiyatını bozar.
      const fill = fillOrder(resource, amount, held, market.reference[resource], buying ? "buy" : "sell");
      const minutes = marketDuration(amount, next.speed);
      // Teklif kimliği deterministik: aynı girdi aynı kimliği üretir, motor saf kalır.
      const id = `${buying ? "b" : "s"}-${resource}-${amount}-${now}`;
      // Anlaşma ŞİMDİ yapılır: halkın defteri hemen hareket eder, dolayısıyla
      // fiyat da hemen değişir. Aksi hâlde Kral aynı fiyattan arka arkaya
      // teklif dizip kaymayı tamamen atlatırdı.
      const commons = { ...market.commons, [resource]: fill.commons };
      const priced = `${fill.average.toFixed(2)} altın/birim (${fill.from.toFixed(2)} → ${fill.to.toFixed(2)})`;

      if (buying) {
        const cost = fill.gold;
        if (next.resources.gold < cost) { blocked(`Alım engellendi: ${amount} ${labelOf(key)} için ${cost} altın gerekli, hazinede ${Math.floor(next.resources.gold)} var.`); continue; }
        // Altın peşin çıkar, mal kervanla gelir.
        next = { ...next, commons, resources: { ...next.resources, gold: next.resources.gold - cost },
          marketVolume: market.used + amount, marketDayAt: market.dayAt,
          marketOrders: [...market.open, { id, resource: key, amount, direction: "buy" as const, gold: cost, placedAt: now, completesAt: now + minutes * 60_000 }],
          notices: [{ kind: "PAZAR", text: `Halktan ${amount} ${labelOf(key)} alındı; ${cost} altın ödendi, ${priced}. Mal ${minutes} dakika sonra ambarda.`, at: now }, ...next.notices].slice(0, 20) };
        success(`Pazara alım teklifi verildi: ${amount} ${labelOf(key)}, ${cost} altın peşin — ${priced}. Halkın stoğu azaldığı için fiyat yükseldi. Mal ${minutes} dakika sonra ambara girer.`);
      } else {
        if (next.resources[key] < amount) { blocked(`Satış engellendi: ambarda ${Math.floor(next.resources[key])} ${labelOf(key)} var, ${amount} satılamaz.`); continue; }
        const earned = fill.gold;
        // Mal ambardan hemen çıkar; parası ancak teklif kapanınca gelir.
        next = { ...next, commons, resources: { ...next.resources, [key]: next.resources[key] - amount },
          marketVolume: market.used + amount, marketDayAt: market.dayAt,
          marketOrders: [...market.open, { id, resource: key, amount, direction: "sell" as const, gold: earned, placedAt: now, completesAt: now + minutes * 60_000 }],
          notices: [{ kind: "PAZAR", text: `${amount} ${labelOf(key)} halka satıldı; ${priced}, ${earned} altın ${minutes} dakika sonra hazineye girer.`, at: now }, ...next.notices].slice(0, 20) };
        success(`Pazara satış teklifi verildi: ${amount} ${labelOf(key)} tezgâha çıktı — ${priced}. Halkın eline geçtikçe fiyat düştü. ${earned} altın ${minutes} dakika sonra hazineye girer.`);
      }
      continue;
    }

    if (action.name === "call_settlers") {
      const room = Math.floor(next.capacity - next.population);
      if (room < SETTLERS.minRoom) { blocked(`Göçmen çağrısı engellendi: boş konut yok (${room} kişilik yer var, en az ${SETTLERS.minRoom} gerekli). Önce Meydan veya konut yükseltin.`); continue; }
      if (next.popularity < SETTLERS.minMood) { blocked(`Göçmen çağrısı engellendi: halkın rızası ${Math.round(next.popularity)}. Aç ve huzursuz bir krallığa kimse taşınmaz; en az ${SETTLERS.minMood} gerekli.`); continue; }
      const waited = now - (next.lastSettlerCallAt ?? 0);
      if (waited < SETTLERS.cooldownMs) { blocked(`Göçmen çağrısı engellendi: kervan yolda, ${Math.ceil((SETTLERS.cooldownMs - waited) / 3_600_000)} saat sonra tekrar çağırabilirsiniz.`); continue; }
      if (!affordable(next.resources, SETTLERS.cost)) { blocked(`Göçmen çağrısı engellendi: ${SETTLERS.cost.gold} altın ve ${SETTLERS.cost.food} yiyecek gerekli.`); continue; }

      // Gelen sayı boş konutla sınırlı; yerleşecek yer yoksa kervan geri döner.
      const arrivals = Math.min(room, Math.max(SETTLERS.minRoom, Math.round(next.population * SETTLERS.share)));
      next = {
        ...next,
        resources: debit(next.resources, SETTLERS.cost),
        population: next.population + arrivals,
        peopleJoined: (next.peopleJoined ?? 0) + arrivals,
        lastSettlerCallAt: now,
        notices: [{ kind: "GÖÇ", text: `Çevre köylerden ${arrivals} kişi çağrıya uyup krallığa yerleşti.`, at: now }, ...next.notices],
      };
      success(`Göçmen çağrısı yapıldı; ${arrivals} kişi yerleşti. Nüfus ${Math.round(next.population)}.`);
      continue;
    }

    if (action.name === "host_festival") {
      const cost = { gold: 120, food: 150 };
      if (!affordable(next.resources, cost)) { blocked("Şenlik engellendi: 120 altın ve 150 yiyecek gerekli."); continue; }
      next = {
        ...next,
        resources: debit(next.resources, cost),
        popularity: Math.min(100, next.popularity + 12),
        notices: [{ kind: "GENERAL", text: "General halk için şenlik düzenledi.", at: now }, ...next.notices],
      };
      success("Şenlik düzenlendi; halkın rızası 12 puan yükseldi.");
      continue;
    }

    if (action.name === "set_tax_rate") {
      const rate = Math.floor(Number(action.arguments.rate_percent));
      if (!Number.isFinite(rate) || rate < 0 || rate > 50) { blocked("Geçersiz vergi oranı reddedildi."); continue; }
      if (rate > 30 && !confirmed) { blocked(`%${rate} vergi halk için riskli; açık Kral teyidi olmadan uygulanmadı.`); continue; }
      next = { ...next, taxRate: rate, loyalty: Math.max(0, next.loyalty - (rate > 30 ? 2 : 0)) };
      success(`Vergi oranı %${rate} olarak mühürlendi.`);
      continue;
    }

    if (action.name === "set_food_ration" || action.name === "set_ale_ration" || action.name === "set_soldier_pay") {
      const requested = Number(action.arguments.percent);
      if (!Number.isFinite(requested) || requested < 0 || requested > 200) { blocked("İstihkak oranı %0 ile %200 arasında olmalı."); continue; }
      const percent = clampRation(requested);
      if (action.name === "set_food_ration") {
        // Açlık sınırına inmek halkı hızla öfkelendirir; teyitsiz uygulanmaz.
        if (percent < 60 && !confirmed) { blocked(`Yiyecek istihkakını %${percent}'e indirmek halkı aç bırakır; açık teyit bekliyorum.`); continue; }
        next = { ...next, foodRation: percent, notices: [{ kind: "İSTİHKAK", text: `Yiyecek istihkakı %${percent} olarak belirlendi.`, at: now }, ...next.notices] };
        success(`Yiyecek istihkakı %${percent} olarak mühürlendi.`);
        continue;
      }
      if (action.name === "set_ale_ration") {
        if (percent > 0 && !next.buildings.some(building => building.type === "brewery")) { blocked("Bira istihkakı için önce Bira Evi kurulmalı."); continue; }
        next = { ...next, aleRation: percent, notices: [{ kind: "İSTİHKAK", text: `Bira istihkakı %${percent} olarak belirlendi.`, at: now }, ...next.notices] };
        success(`Bira istihkakı %${percent} olarak mühürlendi.`);
        continue;
      }
      if (percent < 60 && !confirmed) { blocked(`Asker maaşını %${percent}'e indirmek firara ve isyana yol açar; açık teyit bekliyorum.`); continue; }
      next = { ...next, soldierPay: percent, notices: [{ kind: "ORDU", text: `Asker maaşı %${percent} olarak belirlendi.`, at: now }, ...next.notices] };
      success(`Asker maaşı %${percent} olarak mühürlendi.`);
      continue;
    }

    if (action.name === "set_watch_ratio") {
      const requested = Number(action.arguments.percent);
      if (!Number.isFinite(requested) || requested < 0 || requested > 100) { blocked("Nöbet oranı %0 ile %100 arasında olmalı."); continue; }
      const percent = clampWatch(requested);
      if (percent === watchRatioOf(next)) { blocked(`Nöbet zaten %${percent}; emir kotası harcanmadı.`); continue; }
      if (next.quota < 1) { blocked("Nöbet emri uygulanmadı: emir kotası tükendi."); continue; }
      // İki uç da risklidir: düşük nöbet kaleyi akına açar, yüksek nöbet halkı
      // zapt edecek kuvvet bırakmaz. İkisi de Kralın açık teyidini bekler.
      if (percent < 30 && !confirmed) { blocked(`Nöbeti %${percent}'e indirmek kaleyi dağ akınlarına açar; açık teyit bekliyorum.`); continue; }
      if (percent > 85 && armySize(next.units ?? {}) > 0 && !confirmed) { blocked(`%${percent} nöbet halkı zapt edecek asker bırakmaz; açık teyit bekliyorum.`); continue; }
      next = {
        ...next,
        watchRatio: percent,
        quota: next.quota - 1,
        notices: [{ kind: "NÖBET", text: `Nöbet oranı %${percent} olarak belirlendi.`, at: now }, ...next.notices].slice(0, 20),
      };
      success(`Nöbet oranı %${percent} olarak mühürlendi.`);
      continue;
    }

    if (action.name === "set_strategy_note") {
      const note = String(action.arguments.note ?? "").trim();
      if (note.length < 5 || note.length > 300) { blocked("Yönetim doktrini geçersiz olduğu için kaydedilmedi."); continue; }
      next = { ...next, strategyNote: note, notices: [{ kind: "DOKTRİN", text: `Kralın yönetim doktrini güncellendi: ${note}`, at: now }, ...next.notices] };
      success("Yönetim doktrini kaydedildi; sonraki kararlarımda bunu esas alacağım.");
      continue;
    }

    if (REMOTE_ACTIONS.includes(action.name)) { remote.push(action); continue; }
    blocked(`Generalin önerdiği “${action.name}” aracı bu sürümde yetkili değil.`);
  }

  return { game: next, results, remote };
}
