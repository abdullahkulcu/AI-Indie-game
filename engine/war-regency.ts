import type { GameAction } from "./types";

/** Kral cephedeyken naibin tek başına bağlayamayacağı büyük kararlar. */
export const REGENCY_DEFERRED_ACTIONS = [
  "build_structure", "accelerate_construction", "call_settlers", "host_festival",
  "set_tax_rate", "set_food_ration", "set_ale_ration", "set_soldier_pay",
  "set_strategy_note", "set_night_order", "open_negotiation", "reply_negotiation",
  "propose_terms", "hold_referendum", "send_scout", "send_purse",
] as const;

const labels: Record<(typeof REGENCY_DEFERRED_ACTIONS)[number], string> = {
  build_structure: "inşa/yükseltme", accelerate_construction: "inşaat hızlandırma",
  call_settlers: "göçmen çağrısı", host_festival: "şenlik", set_tax_rate: "vergi düzeni",
  set_food_ration: "yiyecek istihkakı", set_ale_ration: "bira istihkakı",
  set_soldier_pay: "asker maaşı", set_strategy_note: "yönetim doktrini",
  set_night_order: "sürekli talimat", open_negotiation: "yeni müzakere",
  reply_negotiation: "müzakere cevabı", propose_terms: "anlaşma şartı",
  hold_referendum: "halk oylaması", send_scout: "dış keşif", send_purse: "dolaylı faaliyet",
};

export const FIELD_STATUSES = ["gathering", "marching", "engaged", "siege", "blockade", "returning"] as const;

export function isRegencyDeferredAction(name: string): name is (typeof REGENCY_DEFERRED_ACTIONS)[number] {
  return (REGENCY_DEFERRED_ACTIONS as readonly string[]).includes(name);
}

/** Naiplik, ekonomi rutinini ve savunma hazırlığını sürdürür; kalıcı/siyasi kararları bekletir. */
export function filterRegencyActions(actions: GameAction[]) {
  const deferred = actions.filter(action => isRegencyDeferredAction(action.name));
  return {
    actions: actions.filter(action => !isRegencyDeferredAction(action.name)),
    deferred,
    note: deferred.length
      ? `⌛ Kral cephede olduğu için ${[...new Set(deferred.map(action => labels[action.name as keyof typeof labels]))].join(", ")} dönüşe ertelendi. Naiplikte Hazinedar pazar işlerini, General savunma emirlerini sürdürüyor.`
      : null,
  };
}
