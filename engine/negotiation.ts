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

/**
 * Masaya oturulabilecek konuların TAM listesi — TEK KAYNAK.
 *
 * Uçtaki `TOPICS` dizisi ve Generalin araç şemasındaki enum elle yazılıyordu.
 * Motora yeni bir konu eklendiğinde ikisi de sessizce geride kalır; General
 * konuyu önerir, uç "Geçersiz müzakere konusu" der ve Kral sebebini göremez.
 * Tip de bu diziden TÜRETİLİR ki liste ile tip hiçbir zaman ayrışamasın.
 */
export const NEGOTIATION_TOPICS = ["tribute", "non_aggression", "alliance", "passage", "ultimatum"] as const;

export type NegotiationTopic = typeof NEGOTIATION_TOPICS[number];

/** Verilen değer gerçekten bir müzakere konusu mu? Uçlar bunu sorar. */
export function isNegotiationTopic(value: unknown): value is NegotiationTopic {
  return (NEGOTIATION_TOPICS as readonly string[]).includes(String(value));
}

/**
 * Haraç TAŞIYAN konular. Ültimatom da haraç şartı taşır: "ödersin ya da
 * yürürüz" bir haraç anlaşmasıdır, yalnızca dili serttir.
 *
 * Tek kaynak burasıdır. Aynı liste hem şartın geçerliliğini denetleyen
 * validateTerms'te hem de vadeleri tahsil eden cron sorgusunda gerekiyor;
 * ikisi ayrı ayrı yazıldığında sessizce saptı: ültimatom imzalanıyor, panelde
 * aktif görünüyor, ama tek bir altın bile akmıyordu.
 */
export const TRIBUTE_TOPICS = ["tribute", "ultimatum"] as const;

export type TributeTopic = typeof TRIBUTE_TOPICS[number];

/** Bu konu haraç şartı taşır mı? Hem motor hem sunucu bunu sorar. */
export function carriesTribute(topic: NegotiationTopic): topic is TributeTopic {
  return (TRIBUTE_TOPICS as readonly NegotiationTopic[]).includes(topic);
}

/** Haracın alınabileceği kaynaklar. Araç şemalarındaki enum buradan türetilir. */
export const TRIBUTE_RESOURCES = ["gold", "food", "stone", "wood", "iron", "ale"] as const;

export type TributeResource = typeof TRIBUTE_RESOURCES[number];

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
  /**
   * Haraç iki biçimde konuşulabilir ve ikisi de desteklenir:
   *  - oran: her ödemede ambarın bu payı gider (0–0.5)
   *  - sabit: her ödemede bu kadar birim gider ("saatte 60 altın")
   * Pazarlıkta insanlar genelde sabit rakam söyler; oran ise fakirleşen
   * krallığı ezmez. İkisi birden verilirse sabit rakam esas alınır.
   */
  tributeRate?: number;
  tributeAmount?: number;
  /** Haraç hangi kaynaktan alınır. */
  resource?: TributeResource;
  /** Haracı hangi taraf ÖDER. Yön yazılmazsa şart anlamsızdır. */
  payerSide?: Side;
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
  /**
   * Bir masada toplam mesaj. Kralın kendi yazdığı sözler token harcamadığı
   * için bu tavan cömert olabilir; asıl gider Generalin yazdıklarıdır ve
   * onun payı ayrıca sınırlıdır (maxGeneralTurns). Eskiden ikisi aynı 6'ydı
   * ve pazarlık daha başlamadan masa kapanıyordu.
   */
  maxTurns: 14,
  /** Bir tarafın Generalinin yazabileceği mesaj; iki LLM'in sohbeti buradan tavanlanır. */
  maxGeneralTurns: 5,
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

/** Sabit haraçta tek ödeme tavanı; model uçuk bir rakam öneremesin. */
export const MAX_TRIBUTE_AMOUNT = 5000;

/** Anlaşmanın ve ödeme aralığının saat tavanı. */
export const MAX_HOURS = 72;

/** Masaya yazılan bir mesajın azami uzunluğu. */
export const MAX_MESSAGE_LENGTH = 600;

/** Generalin Krala bıraktığı notun azami uzunluğu. */
export const MAX_KING_NOTE_LENGTH = 200;

/**
 * Oranın araç şemasında yüzde olarak istenmesinin sebebi: model 0.15 gibi bir
 * kesri şaşırtıcı sıklıkta 15 diye gönderiyor. Yüzde tam sayısı hem model için
 * doğal hem de tavanı MAX_TRIBUTE_RATE'ten türetilebilir.
 */
export const MAX_TRIBUTE_RATE_PERCENT = Math.round(MAX_TRIBUTE_RATE * 100);

/** Araç çağrısındaki yüzdeyi Terms.tributeRate oranına çevirir. */
export function tributeRateFromPercent(percent: unknown): number {
  const value = Math.round(Number(percent) || 0);
  return Math.max(0, Math.min(MAX_TRIBUTE_RATE_PERCENT, value)) / 100;
}

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
    payerSide: terms.payerSide,
    tributeRate: Math.max(0, Math.min(MAX_TRIBUTE_RATE, Number(terms.tributeRate) || 0)),
    tributeAmount: Math.max(0, Math.min(MAX_TRIBUTE_AMOUNT, Math.floor(Number(terms.tributeAmount) || 0))),
    hours,
    everyHours,
  };
}

/** Şart konusuyla tutarlı mı? Tutarsız şart Krala hiç sunulmaz. */
export function validateTerms(terms: Terms): { ok: true; terms: Terms } | { ok: false; reason: string } {
  const next = clampTerms(terms);
  // Hangi konunun haraç taşıdığı TRIBUTE_TOPICS'te yazar; cron da vadeleri o
  // listeye göre tahsil eder. İki dal birbirinin tamamlayıcısıdır: liste
  // değişirse ikisi birlikte değişir.
  if (carriesTribute(next.topic)) {
    if (!next.tributeRate && !next.tributeAmount) {
      return { ok: false, reason: "Haraç şartında ya sabit miktar ya da oran belirtilmeli." };
    }
    if (next.payerSide !== "initiator" && next.payerSide !== "target") {
      return { ok: false, reason: "Haracı hangi tarafın ödeyeceği belirtilmeli." };
    }
  } else {
    // Bu konularda haraç anlamsız; sessizce sıfırlanır ki Kral yanlış şart onaylamasın.
    next.tributeRate = 0;
    next.tributeAmount = 0;
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

/**
 * Kral masada mı?
 *
 * Ölçüt Kralın KENDİ istemcisinin bıraktığı iz olmalı: `lastTickAt` yalnızca
 * tarayıcı tick attığında ilerler. Kayıt satırının `updated_at` sütunu sunucu
 * yazdığında da tazelenir (haraç bildirimi, gece vardiyası); onu ölçüt yapmak
 * "General bir not düştü, demek ki Kral masada" gibi kendi kuyruğunu yiyen bir
 * sonuç doğururdu.
 */
export const KING_PRESENCE_MS = 15 * 60_000;

export function isKingPresent(lastSeenAt: number | null | undefined, now: number): boolean {
  if (typeof lastSeenAt !== "number" || !Number.isFinite(lastSeenAt)) return false;
  return now - lastSeenAt < KING_PRESENCE_MS;
}

/**
 * Kral çevrimdışıyken Generali masaya cevap versin mi?
 *
 * Kralın kararı: "Cevap versin ama imza atamasın." Bu yüzden burada yalnızca
 * SÖZ hakkı sorulur; imza için canBind ayrı durur. General ancak son sözü karşı
 * taraf söylediyse konuşur — böylece iki General birbirine art arda yazmaz ve
 * bir turda bir taraf bir mesaj kuralı korunur.
 */
export function shouldGeneralAnswer(input: {
  negotiation: Negotiation;
  side: Side;
  /** Masadaki son mesajı kim yazdı? Hiç mesaj yoksa null. */
  lastMessageSide: Side | null;
  /** Bu tarafta General'in şimdiye kadar yazdığı mesaj sayısı. */
  generalTurnsUsed?: number;
  kingPresent: boolean;
  now: number;
}): TurnDecision {
  if (input.kingPresent) return { ok: false, reason: "Kral masada; sözü Kral söyler." };
  if (input.lastMessageSide === null) return { ok: false, reason: "Masada henüz söz yok." };
  if (input.lastMessageSide === input.side) return { ok: false, reason: "Son söz bizim; sıra karşı tarafta." };
  // Generalin payı ayrı tavanlanır: masanın toplam söz hakkı cömert olabilir
  // çünkü Kralın kendi yazdığı sözler token harcamıyor.
  if ((input.generalTurnsUsed ?? 0) >= LIMITS.maxGeneralTurns) {
    return { ok: false, reason: `General bu masada söz hakkını doldurdu (${LIMITS.maxGeneralTurns} mesaj); sözü Kral almalı.` };
  }
  return canSpeak(input.negotiation, input.side, input.now);
}

/**
 * Bu tarafta YENİ bir şart sunulabilir mi?
 *
 * Karşı taraf şart sunmuşsa o şart bizim Kralımızın imzasını bekliyordur. Kral
 * yokken Generalin üstüne yeni şart yazması, Kralın hiç görmediği bir teklifi
 * siler: sabah masaya döndüğünde onaylayacağı şart ortada olmaz. Bu yüzden Kral
 * çevrimdışıyken General yalnızca konuşur. Kral masadaysa karşı teklif vermek
 * onun kendi kararıdır; teklifi görmüştür.
 */
export function canProposeTerms(negotiation: Negotiation, side: Side, kingPresent: boolean, now: number): TurnDecision {
  const speak = canSpeak(negotiation, side, now);
  if (!speak.ok) return speak;
  if (negotiation.status === "awaiting_king" && negotiation.proposedBy === otherSide(side) && !kingPresent) {
    return { ok: false, reason: "Karşı şart Kralın imzasını bekliyor; General onun önündeki teklifi silemez." };
  }
  return { ok: true };
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

/**
 * Bir ödemede ambardan FİİLEN çıkan miktar.
 *
 * Sabit rakam konuşulduysa o esastır ("saatte 60 altın"). Ambar yetmiyorsa ya
 * da tavana takılıyorsa olan gider — eksik kalan borç olarak birikmez, o vade
 * kaçırılmış sayılır (settleTribute onu ayrıca sayar).
 *
 * Tavan bilinçlidir: tek ödemede ambarın yarısından fazlası çıkmaz, yoksa
 * gecikmiş bir cron turu birikmiş vadeleri arka arkaya kapatırken krallığı bir
 * gecede sıfırlar. Tavana takılan ödeme ARTIK BOŞA DÜŞMÜYOR: eskiden beklenen
 * tutar tavanı geçtiği anda hiç ödeme yapılmıyor, ambarı dolu Kral hem parasını
 * tutuyor hem "ödemedi" damgası yiyordu.
 */
export function tributePayment(stock: number, terms: Pick<Terms, "tributeRate" | "tributeAmount">) {
  const ceiling = Math.floor(Math.max(0, stock) * MAX_TRIBUTE_RATE);
  return Math.max(0, Math.min(tributeExpected(stock, terms), ceiling));
}

/**
 * Bir vadede BEKLENEN tutar: sabit rakam varsa o, yoksa orandan çıkan miktar.
 * Oranda beklenen zaten ambarla küçüldüğü için tavanı hiç zorlamaz; eksik ödeme
 * yalnızca sabit rakamda söz konusudur.
 */
export function tributeExpected(stock: number, terms: Pick<Terms, "tributeRate" | "tributeAmount">) {
  if (terms.tributeAmount && terms.tributeAmount > 0) return Math.floor(terms.tributeAmount);
  return Math.floor(Math.max(0, stock) * Math.max(0, Math.min(MAX_TRIBUTE_RATE, terms.tributeRate ?? 0)));
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

/** Anlaşmanın bozulması için gereken kaçırılmış vade sayısı. */
export const MISSES_BEFORE_BREACH = 2;

export type TributeSettlement = {
  /** Fiilen taşınan miktar. */
  moved: number;
  /** Bu turda ödenebilen vade sayısı. */
  paid: number;
  /** Ambar yetmediği için ödenemeyen vade sayısı. */
  missed: number;
};

/**
 * Bir turda kapatılan vadeleri hesaplar.
 *
 * İki kural birlikte durur:
 *  1. Ödenemeyen vade "ödendi" SAYILMAZ. Eskiden sayılıyordu ve ambarı boş olan
 *     taraf hiçbir bedel ödemeden anlaşmadan sıyrılıyordu.
 *  2. Eksik ödeme de olsa ambardan ÇIKAR. Eskiden çıkmıyordu: beklenen tutar
 *     ambarın yarısını geçtiği anda ödeme sıfırlanıyor, ödeyen hem kaynağını
 *     tutuyor hem vadeyi kaçırmış sayılıyordu — cezası olan ama bedeli olmayan
 *     bir kaçırma. Artık kaçıran taraf her hâlükârda ödeyebildiğini öder;
 *     "ödemedim ve elimde kaldı" diye bir sonuç yok.
 *
 * Vade yalnızca beklenen tutarın TAMAMI taşındığında kapanır; aksi halde
 * kaçırılmış sayılır ve MISSES_BEFORE_BREACH'te anlaşma bozulur.
 */
export function settleTribute(stock: number, due: number, terms: Pick<Terms, "tributeRate" | "tributeAmount">): TributeSettlement {
  let left = Math.max(0, stock), moved = 0, paid = 0, missed = 0;
  for (let i = 0; i < due; i++) {
    const expected = tributeExpected(left, terms);
    const amount = tributePayment(left, terms);
    left -= amount;
    moved += amount;
    if (amount > 0 && amount >= expected) paid++;
    else missed++;
  }
  return { moved, paid, missed };
}

/**
 * Masanın imzaya HAZIR olduğu tek durum.
 *
 * Hem uçtaki koşullu UPDATE hem de buradaki kural bu değeri okur: iki eşzamanlı
 * imza isteği "durumu oku → anlaşmayı yaz" arasında yarışıyordu ve masa başına
 * İKİ aktif anlaşma doğuyordu; cron ikisini birden tahsil ediyor, haracı ALAN
 * taraf bunu kendi lehine tetikleyebiliyordu.
 */
export const SIGNABLE_STATUS = "awaiting_king" as const;

/**
 * Reddedilebilir masa durumları. İmzalanmış masa REDDEDİLEMEZ: anlaşma yürürlükte
 * kalırken masa "declined" görünüyordu ve Kral anlaşmadan çıktığını sanıyordu.
 */
export const DECLINABLE_STATUSES = ["open", SIGNABLE_STATUS] as const;

/**
 * SÜRESİ DOLABİLEN masa durumları — `agreed` ve `declined` NİHAİDİR, süre
 * dolsa da onlara dokunulmaz (imzalı anlaşma yürürlükte kalır).
 *
 * Aynı liste `DECLINABLE_STATUSES` ile birebir aynı; ayrı bir sabit olarak
 * duruyor çünkü ikisi AYNI ŞEY DEĞİL: biri "Kral bu masayı reddedebilir mi",
 * öteki "zaman bu masayı kapatır mı". İleride biri değişirse ötekini sessizce
 * sürüklemesin.
 */
export const EXPIRABLE_STATUSES = ["open", SIGNABLE_STATUS] as const;

/**
 * KAPANMIŞ masa durumları: masanın işi bitmiştir, bir daha söz söylenmez.
 *
 * Yukarıdaki iki sabitin AYNISI DEĞİL, tersi de değil — üç ayrı soru:
 * "Kral reddedebilir mi", "zaman kapatır mı", "bu masa artık geçmiş mi".
 * `agreed` masası reddedilemez ve süresi dolmaz ama KAPANMIŞTIR: imza atıldı,
 * masa dağıldı, iş artık anlaşmanın kendisinde (`agreements`) sürüyor.
 *
 * Elçilik defteri bu ayrımla ikiye bölünür: önünde duran masalar ve geçmiş.
 * Kral kapanmış bir masayı "cevap bekliyor" sanmasın, General de kapanmış masayı
 * okuyup boşa token harcamasın.
 */
export const CLOSED_STATUSES = ["agreed", "declined", "expired"] as const;

/** Masanın işi bitti mi? Tek soru, tek yer. */
export const isClosedTable = (status: NegotiationStatus) =>
  (CLOSED_STATUSES as readonly NegotiationStatus[]).includes(status);

/**
 * SÜRE DOLDU MU? `canSpeak`'in eşiğiyle AYNI karşılaştırma (`now >= expiresAt`).
 *
 * NEDEN VAR: bu kural bugüne kadar yalnızca `canSpeak` içinde yaşıyordu, yani
 * yalnızca "konuşmayı engelle" tarafı vardı; masanın DURUMUNU yazan hiçbir yol
 * yoktu. Sonuç görünür bir hataydı: süresi geçmiş masa Kralın defterinde `open`
 * kalıyor, arayüz ona tur sayacı gösteriyor ve "cevap bekleyen masa" sayacında
 * SONSUZA KADAR duruyordu — temizlenemeyen bir bildirim. Kural artık tek yerde
 * ve hem engelleyen hem yazan taraf onu okuyor.
 */
export function isExpired(
  negotiation: Pick<Negotiation, "status" | "expiresAt">,
  now: number,
): boolean {
  if (!(EXPIRABLE_STATUSES as readonly NegotiationStatus[]).includes(negotiation.status)) return false;
  return now >= negotiation.expiresAt;
}

/**
 * MASA ZAMANLA KAPANDI MI? `isExpired`ten FARKLI bir soru ve ikisini
 * karıştırmak gerçek bir hataya yol açtı, o yüzden ayrı duruyorlar:
 *
 *  · `isExpired` GEÇİŞ kuralıdır: "süpürme bu satırı şimdi kapatmalı mı?"
 *    Zaten `expired` damgalanmış satır için `false` döner — kapatılacak bir
 *    şey kalmamıştır.
 *  · `isTimedOut` DURUM sorusudur: "bu masa zamanla bitmiş mi?" Damgalanmış
 *    satır için de `true` döner.
 *
 * Arayüz yalnızca `isExpired`i okuduğunda, damgalanmış masaya "SÜRESİ DOLDU"
 * yerine tur sayacı gösteriyordu — yani süpürme çalıştıktan sonra hata geri
 * geliyordu. Gösterim ve sayaçlar bunu okur.
 */
export function isTimedOut(
  negotiation: Pick<Negotiation, "status" | "expiresAt">,
  now: number,
): boolean {
  return negotiation.status === "expired" || isExpired(negotiation, now);
}

/** Bu masa reddedilebilir mi? Uçtaki koşullu UPDATE de aynı listeden türer. */
export function canDecline(status: NegotiationStatus): TurnDecision {
  if ((DECLINABLE_STATUSES as readonly NegotiationStatus[]).includes(status)) return { ok: true };
  return status === "agreed"
    ? { ok: false, reason: "Bu masa imzalandı; reddetmek anlaşmayı bozmaz. Anlaşma yürürlüktedir." }
    : { ok: false, reason: "Bu masa zaten kapandı." };
}
