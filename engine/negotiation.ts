/**
 * İki krallığın Generalleri arasındaki müzakere kuralları.
 *
 * Saf ve deterministik: veritabanına, saate ve rastgeleliğe dokunmaz. Zaman
 * dışarıdan verilir. Böylece hem sunucu hem testler aynı kuralı çalıştırır —
 * bu projede kuralın bir yerde, testinin başka yerde yazıldığı her seferinde
 * ikisi sessizce birbirinden saptı.
 *
 * Tasarımın iki taşıyıcı kuralı:
 *  1. Her General YALNIZCA kendi krallığını bilir. Karşı tarafın sözleri veri
 *     olarak taşınır, bilgi olarak değil — yalan söyleyebilir.
 *  2. Şartı General önerir, imzayı Kral atar. Kral çevrimdışıyken Generali
 *     konuşabilir ama hiçbir şeyi bağlayamaz.
 */

export type NegotiationTopic = "tribute" | "non_aggression" | "alliance" | "passage" | "ultimatum";

export type NegotiationStatus =
  | "open"          // konuşma sürüyor
  | "awaiting_king" // şart sunuldu, Kralın onayı bekleniyor
  | "agreed"
  | "declined"
  | "expired";

export type Side = "initiator" | "target";

/** Anlaşma şartı. Konuya göre alanların hangisinin anlamlı olduğu değişir. */
export type Terms = {
  topic: NegotiationTopic;
  /** Haraç: her ödemede ambarın bu oranı gider. 0–0.5 arası. */
  tributeRate?: number;
  /** Haraç hangi kaynaktan alınır. */
  resource?: "gold" | "food" | "stone" | "wood" | "iron" | "ale";
  /** Anlaşmanın kaç saat süreceği. */
  hours?: number;
  /** Ödeme aralığı (saat). */
  everyHours?: number;
};

export type Negotiation = {
  id: string;
  channelId: string;
  initiatorId: string;
  targetId: string;
  topic: NegotiationTopic;
  status: NegotiationStatus;
  /** Şu ana kadar yazılmış mesaj sayısı; tavana ulaşınca masa kapanır. */
  turns: number;
  /** Sunulmuş şart; Kral onaylayınca anlaşmaya dönüşür. */
  proposed: Terms | null;
  /** Şartı hangi taraf sundu. Kendi teklifini kendin onaylayamazsın. */
  proposedBy: Side | null;
  openedAt: number;
  expiresAt: number;
  lastTurnAt: number;
};

/**
 * Sınırlar. İki LLM konuştuğu için tur sayısı sert olmalı: aksi halde iki
 * General birbiriyle sonsuza kadar nazikleşir ve iki Kralın da kredisi yanar.
 */
export const LIMITS = {
  /** Bir masada toplam mesaj. */
  maxTurns: 6,
  /** Bir krallığın aynı anda açık tutabileceği masa. */
  maxOpenPerKingdom: 3,
  /** Bir krallığa günde açılabilecek masa; spam ve kredi yakma buradan engellenir. */
  maxIncomingPerDay: 5,
  /** Masa bu süre içinde sonuçlanmazsa düşer. */
  lifetimeMs: 12 * 3_600_000,
  /** Aynı iki taraf arasında yeni masa için bekleme. */
  cooldownMs: 2 * 3_600_000,
} as const;

/** Haraç oranı tavanı: bir krallık ambarının yarısından fazlasını veremez. */
export const MAX_TRIBUTE_RATE = .5;

const MAX_HOURS = 72;

export function otherSide(side: Side): Side {
  return side === "initiator" ? "target" : "initiator";
}

export function sideOf(negotiation: Pick<Negotiation, "initiatorId" | "targetId">, userId: string): Side | null {
  if (negotiation.initiatorId === userId) return "initiator";
  if (negotiation.targetId === userId) return "target";
  return null;
}

/** Şartı sınırlara oturtur. Model uydurma bir oran gönderirse burada kırpılır. */
export function clampTerms(terms: Terms): Terms {
  const hours = Math.max(1, Math.min(MAX_HOURS, Math.round(Number(terms.hours) || 24)));
  const everyHours = Math.max(1, Math.min(hours, Math.round(Number(terms.everyHours) || 6)));
  return {
    topic: terms.topic,
    resource: terms.resource ?? "gold",
    tributeRate: Math.max(0, Math.min(MAX_TRIBUTE_RATE, Number(terms.tributeRate) || 0)),
    hours,
    everyHours,
  };
}

/** Şart konusuyla tutarlı mı? Tutarsız şart Krala hiç sunulmaz. */
export function validateTerms(terms: Terms): { ok: true; terms: Terms } | { ok: false; reason: string } {
  const next = clampTerms(terms);
  if (next.topic === "tribute" || next.topic === "ultimatum") {
    if (!next.tributeRate) return { ok: false, reason: "Haraç şartında oran belirtilmeli." };
  }
  if (next.topic === "non_aggression" || next.topic === "alliance" || next.topic === "passage") {
    // Bu konularda haraç anlamsız; sessizce sıfırlanır ki Kral yanlış şart onaylamasın.
    next.tributeRate = 0;
  }
  return { ok: true, terms: next };
}

export type TurnDecision = { ok: true } | { ok: false; reason: string };

/** Bu tarafın şu an konuşma hakkı var mı? */
export function canSpeak(negotiation: Negotiation, side: Side, now: number): TurnDecision {
  if (negotiation.status === "agreed" || negotiation.status === "declined") {
    return { ok: false, reason: "Bu masa kapandı." };
  }
  if (now >= negotiation.expiresAt) return { ok: false, reason: "Müzakere süresi doldu." };
  if (negotiation.turns >= LIMITS.maxTurns) {
    return { ok: false, reason: `Masada söz hakkı kalmadı (${LIMITS.maxTurns} mesaj).` };
  }
  if (negotiation.status === "awaiting_king" && negotiation.proposedBy === side) {
    return { ok: false, reason: "Şartınız karşı Kralın önünde; cevabı beklemelisiniz." };
  }
  return { ok: true };
}

/**
 * Bu taraf şartı BAĞLAYICI olarak imzalayabilir mi?
 *
 * Kral masadaysa imzayı o atar. Kral çevrimdışıysa Generali konuşabilir,
 * blöf yapabilir, bilgi toplayabilir — ama hiçbir şeyi bağlayamaz; şart
 * Kral döndüğünde onayına sunulur.
 */
export function canBind(kingPresent: boolean): TurnDecision {
  return kingPresent
    ? { ok: true }
    : { ok: false, reason: "Kral masada değil; General şartı bağlayamaz, yalnızca onayına sunar." };
}

/** Yeni masa açılabilir mi? Spam ve kredi yakma buradan engellenir. */
export function canOpen(input: {
  openByInitiator: number;
  incomingToTargetToday: number;
  lastBetweenPairAt: number | null;
  targetAcceptsNegotiation: boolean;
  now: number;
}): TurnDecision {
  if (!input.targetAcceptsNegotiation) return { ok: false, reason: "Karşı krallık müzakereye kapalı." };
  if (input.openByInitiator >= LIMITS.maxOpenPerKingdom) {
    return { ok: false, reason: `Aynı anda en fazla ${LIMITS.maxOpenPerKingdom} masa açık tutabilirsiniz.` };
  }
  if (input.incomingToTargetToday >= LIMITS.maxIncomingPerDay) {
    return { ok: false, reason: "Karşı krallık bugün yeterince müzakere gördü; yarın deneyin." };
  }
  if (input.lastBetweenPairAt !== null && input.now - input.lastBetweenPairAt < LIMITS.cooldownMs) {
    const left = Math.ceil((LIMITS.cooldownMs - (input.now - input.lastBetweenPairAt)) / 3_600_000);
    return { ok: false, reason: `Bu krallıkla yeni masa için ${left} saat beklemelisiniz.` };
  }
  return { ok: true };
}

/** Haraç ödemesi: ambarın oranı kadar, tam sayı. */
export function tributePayment(stock: number, rate: number) {
  return Math.max(0, Math.floor(stock * Math.max(0, Math.min(MAX_TRIBUTE_RATE, rate))));
}

/**
 * Anlaşmanın kaç ödemesi hak edildi? Sunucu bunu tick'te kullanır; ayrı ayrı
 * sayılmadığı için gecikmiş cron turu ödemeleri atlamaz.
 */
export function duePayments(agreement: { startedAt: number; everyHours: number; paidCount: number; endsAt: number }, now: number) {
  const until = Math.min(now, agreement.endsAt);
  if (until <= agreement.startedAt) return 0;
  const elapsed = Math.floor((until - agreement.startedAt) / (agreement.everyHours * 3_600_000));
  return Math.max(0, elapsed - agreement.paidCount);
}
