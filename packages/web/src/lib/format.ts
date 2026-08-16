/**
 * Biçimlendirme ve Türkçe etiket yardımcıları.
 *
 * Oyun tabloları (`@krallik/shared`) zaten Türkçe adları taşıyor; burada yalnızca
 * DTO'larda ham enum olarak gelen alanların karşılıkları ve zaman/sayı biçimleri
 * var.
 */

import type {
  ArmyIntent,
  ChannelType,
  DiplomacyStatus,
  LlmProvider,
  ProposalType,
  RelationState,
  Resource,
  Tactic,
} from '@krallik/shared';

const numberFmt = new Intl.NumberFormat('tr-TR');

export function num(value: number): string {
  return numberFmt.format(Math.round(value));
}

export function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${num(rounded)}` : num(rounded);
}

/** Saniyeyi "2sa 14dk" biçimine indirger — referans arayüzdeki ETA dili. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}sn`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}dk`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin > 0 ? `${hours}sa ${restMin}dk` : `${hours}sa`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}g ${restHours}sa` : `${days}g`;
}

/** Verilen ISO zamanına kalan süre; geçmişse null. */
export function etaFrom(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  const left = (target - now) / 1000;
  if (left <= 0) return null;
  return duration(left);
}

export function secondsUntil(iso: string | null, now: number = Date.now()): number {
  if (!iso) return 0;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, (target - now) / 1000);
}

/** "12 dk önce" biçiminde geçmiş zaman. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = (now - then) / 1000;
  if (diff < 45) return 'az önce';
  return `${duration(diff)} önce`;
}

export function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 0..1 aralığına kırpıp yüzdeye çevirir (CSS width için). */
export function pct(value: number, max: number): string {
  if (max <= 0) return '0%';
  const ratio = Math.min(1, Math.max(0, value / max));
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Yükseltme ilerlemesi: başlangıç/bitiş zamanından oran. */
export function progressRatio(startedAt: string | null, completesAt: string | null, now = Date.now()): number {
  if (!startedAt || !completesAt) return 0;
  const start = Date.parse(startedAt);
  const end = Date.parse(completesAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

// --- Enum → Türkçe -----------------------------------------------------------

export const CHANNEL_TYPE_TR: Record<ChannelType, string> = {
  season: 'Sezon',
  short: 'Kısa Sezon',
  recurring: 'Sürekli',
};

export const RELATION_TR: Record<RelationState, string> = {
  neutral: 'Tarafsız',
  ally: 'Müttefik',
  war: 'Savaş',
  ceasefire: 'Ateşkes',
  vassal: 'Tabi',
  protector: 'Hami',
};

export const INTENT_TR: Record<ArmyIntent, string> = {
  attack: 'Saldırı',
  reinforce: 'Takviye',
  scout: 'Keşif',
  raid: 'Akın',
  return: 'Dönüş',
};

export const TACTIC_TR: Record<Tactic, string> = {
  ambush: 'Pusu',
  frontal: 'Cepheden Taarruz',
  withdraw_to_keep: 'Kaleye Çekil',
  terrain_advantage: 'Arazi Üstünlüğü',
};

export const PROPOSAL_TR: Record<ProposalType, string> = {
  ceasefire: 'Ateşkes',
  alliance: 'İttifak',
  trade: 'Ticaret',
  protection_offer: 'Koruma Teklifi',
  vassalage_request: 'Tabiiyet Talebi',
  betrayal_signal: 'İhanet Sinyali',
  troop_rental: 'Birlik Kiralama',
};

export const DIPLOMACY_STATUS_TR: Record<DiplomacyStatus, string> = {
  pending: 'Görüşülüyor',
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  cancelled: 'İptal edildi',
};

export const STANCE_TR: Record<'open' | 'accept' | 'counter' | 'reject' | 'stall', string> = {
  open: 'açılış',
  accept: 'kabul',
  counter: 'karşı teklif',
  reject: 'ret',
  stall: 'oyalama',
};

export const PROVIDER_TR: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  openai_compatible: 'OpenAI Uyumlu (özel uç)',
};

/** Aksiyon adlarının oyuncuya gösterilen karşılıkları (chip etiketleri). */
export const ACTION_TR: Record<string, string> = {
  build_structure: 'İnşaat',
  train_unit: 'Birlik eğitimi',
  move_army: 'Ordu sevki',
  send_caravan: 'Kervan',
  host_festival: 'Şenlik',
  set_tax_rate: 'Vergi oranı',
  send_diplomacy_message: 'Diplomasi',
  post_market_offer: 'Pazar ilanı',
  accept_market_offer: 'İlan kabulü',
  propose_troop_rental: 'Birlik kiralama',
  deploy_spy: 'Casus',
  hire_mercenaries: 'Kiralık asker',
  deep_excavation: 'Derin kazı',
  set_strategy_note: 'Strateji notu',
  choose_tactic: 'Taktik',
  respond_to_decision: 'Karar yanıtı',
  get_kingdom_status: 'Durum sorgusu',
  get_realm_intel: 'İstihbarat',
};

export function actionLabel(name: string): string {
  return ACTION_TR[name] ?? name;
}

/** Darboğaz nedenlerinin insan-okur karşılığı. */
export const BOTTLENECK_REASON_TR: Record<string, string> = {
  input_shortage: 'girdi yetersiz',
  worker_shortage: 'işçi yetersiz',
  storage_full: 'depo dolu',
  reserve_depleted: 'rezerv tükendi',
};

/** ResourceBundle'ı "60 Buğday · 12 Altın" gibi tek satıra indirger. */
export function bundleSummary(
  bundle: Partial<Record<Resource, number>>,
  labels: Record<Resource, string>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    if (typeof value !== 'number' || value === 0) continue;
    parts.push(`${signed(value)} ${labels[key as Resource]}`);
  }
  return parts.join(' · ');
}
