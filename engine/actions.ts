import { catalog, keepSeconds, keepUpgradeCosts, MAX_KEEP_LEVEL } from "./catalog";
import { armySize, clampRation } from "./populace";
import { clampWatch, watchRatioOf } from "./raids";
import { affordable, costFor, debit, keep, rates, tick } from "./tick";
import type { Game, GameAction, Key, Res } from "./types";

/** Sunucu uçlarına devredilen eylemler; oyun durumunu doğrudan değiştirmezler. */
export const REMOTE_ACTIONS = ["send_miners", "recall_miners", "send_scout", "raise_counter_intelligence"];

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
      const cost = costFor(item.cost, current);
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
      const seconds = Math.max(0, Math.ceil((active.completesAt - now) / 1000));
      const cost = Math.max(10, Math.ceil(seconds / 60) * 2);
      if (next.resources.gold < cost) { blocked(`Hızlandırma engellendi: ${cost} altın gerekiyor, hazinede ${Math.floor(next.resources.gold)} var.`); continue; }
      let buildings = next.buildings, units = next.units;
      if (active.kind === "building") {
        const existing = next.buildings.find(b => b.type === active.type);
        const item = catalog.find(b => b.type === active.type);
        buildings = existing
          ? next.buildings.map(b => b.type === active.type ? { ...b, level: active.targetLevel ?? b.level } : b)
          : [...next.buildings, { type: active.type, name: active.name.replace(/ Sv\.\d+$/, "") || item?.name || active.name, category: item?.category ?? "Yönetim", level: active.targetLevel ?? 1 }];
      } else {
        units = { ...units, [active.type]: (units[active.type] ?? 0) + (active.count ?? 0) };
      }
      next = {
        ...next,
        resources: { ...next.resources, gold: next.resources.gold - cost },
        buildings, units, queue: null,
        notices: [{ kind: "TAMAMLANDI", text: `${active.name} hızlandırılarak tamamlandı.`, at: now }, ...next.notices].slice(0, 20),
      };
      success(`${active.name} ${cost} altın harcanarak tamamlandı.`);
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
