import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, MAX_TRIBUTE_RATE, canBind, canOpen, canSpeak, clampTerms, duePayments, sideOf, tributePayment, validateTerms, type Negotiation } from "../engine/negotiation";

const T0 = 1_800_000_000_000;

function table(overrides: Partial<Negotiation> = {}): Negotiation {
  return {
    id: "n1", channelId: "standard", initiatorId: "a", targetId: "b",
    topic: "tribute", status: "open", turns: 0, proposed: null, proposedBy: null,
    openedAt: T0, expiresAt: T0 + LIMITS.lifetimeMs, lastTurnAt: T0,
    ...overrides,
  };
}

test("taraf kimliği doğru okunur", () => {
  assert.equal(sideOf(table(), "a"), "initiator");
  assert.equal(sideOf(table(), "b"), "target");
  assert.equal(sideOf(table(), "yabancı"), null, "üçüncü kişi masaya taraf değildir");
});

test("tur tavanı masayı kapatır", () => {
  assert.equal(canSpeak(table({ turns: LIMITS.maxTurns - 1 }), "initiator", T0).ok, true);
  const full = canSpeak(table({ turns: LIMITS.maxTurns }), "initiator", T0);
  assert.equal(full.ok, false);
  if (!full.ok) assert.match(full.reason, /söz hakkı kalmadı/);
});

test("süresi dolan masada konuşulamaz", () => {
  assert.equal(canSpeak(table(), "initiator", T0 + LIMITS.lifetimeMs).ok, false);
});

test("kendi teklifini bekleyen taraf tekrar konuşamaz", () => {
  const waiting = table({ status: "awaiting_king", proposedBy: "initiator" });
  assert.equal(canSpeak(waiting, "initiator", T0).ok, false, "teklifi veren beklemeli");
  assert.equal(canSpeak(waiting, "target", T0).ok, true, "karşı taraf cevap verebilmeli");
});

test("kapanmış masa yeniden açılmaz", () => {
  for (const status of ["agreed", "declined"] as const) {
    assert.equal(canSpeak(table({ status }), "initiator", T0).ok, false);
  }
});

test("Kral masada değilken General imza atamaz", () => {
  // Kralın kuralı: General konuşabilir, blöf yapabilir ama bağlayamaz.
  const offline = canBind(false);
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.match(offline.reason, /bağlayamaz/);
  assert.equal(canBind(true).ok, true);
});

test("haraç oranı yarıyı geçemez", () => {
  assert.equal(clampTerms({ topic: "tribute", tributeRate: 0.9 }).tributeRate, MAX_TRIBUTE_RATE);
  assert.equal(clampTerms({ topic: "tribute", tributeRate: -1 }).tributeRate, 0);
});

test("saldırmazlıkta haraç sessizce sıfırlanır", () => {
  // Kral yanlış şart onaylamasın: konuyla ilgisiz alan temizlenir.
  const result = validateTerms({ topic: "non_aggression", tributeRate: .4, hours: 24 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.terms.tributeRate, 0);
});

test("süre ve ödeme aralığı sınırlara oturur", () => {
  const terms = clampTerms({ topic: "tribute", tributeRate: .2, hours: 500, everyHours: 0 });
  assert.equal(terms.hours, 72, "anlaşma en fazla 72 saat sürer");
  // Geçersiz aralık (0) varsayılana düşer, 1 saate değil: ödeyenin lehine.
  assert.equal(terms.everyHours, 6);
  // Ödeme aralığı anlaşma süresini aşamaz.
  assert.equal(clampTerms({ topic: "tribute", tributeRate: .2, hours: 4, everyHours: 40 }).everyHours, 4);
});

test("müzakereye kapalı krallığa masa açılmaz", () => {
  const blocked = canOpen({ openByInitiator: 0, incomingToTargetToday: 0, lastBetweenPairAt: null, targetAcceptsNegotiation: false, now: T0 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.reason, /kapalı/);
});

test("spam ve kredi yakma engellenir", () => {
  const base = { openByInitiator: 0, incomingToTargetToday: 0, lastBetweenPairAt: null, targetAcceptsNegotiation: true, now: T0 };
  assert.equal(canOpen({ ...base, openByInitiator: LIMITS.maxOpenPerKingdom }).ok, false);
  // Karşı tarafın BYOK kredisi bir günde sınırsız yakılamaz.
  assert.equal(canOpen({ ...base, incomingToTargetToday: LIMITS.maxIncomingPerDay }).ok, false);
  assert.equal(canOpen({ ...base, lastBetweenPairAt: T0 - 1000 }).ok, false, "aynı çiftte bekleme süresi var");
  assert.equal(canOpen({ ...base, lastBetweenPairAt: T0 - LIMITS.cooldownMs }).ok, true);
});

test("haraç sabit rakamla da konuşulabilir", () => {
  // Pazarlıkta "saatte 60 altın" denir; oran değil sabit miktar.
  assert.equal(tributePayment(1000, { tributeAmount: 60 }), 60);
  // Ambarda o kadar yoksa olan gider, borç birikmez.
  assert.equal(tributePayment(80, { tributeAmount: 60 }), 40, "tek ödemede ambarın yarısı tavandır");
  assert.equal(tributePayment(0, { tributeAmount: 60 }), 0);
});

test("haraç oranla da konuşulabilir", () => {
  assert.equal(tributePayment(1000, { tributeRate: .2 }), 200);
  assert.equal(tributePayment(1000, { tributeRate: .9 }), 500, "tavan yarıdır");
});

test("sabit rakam oranı ezer", () => {
  assert.equal(tributePayment(1000, { tributeAmount: 60, tributeRate: .4 }), 60);
});

test("sabit haraçlı şart geçerlidir", () => {
  const result = validateTerms({ topic: "tribute", tributeAmount: 60, payerSide: "target", hours: 24, everyHours: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.terms.tributeAmount, 60);
});

test("ne oran ne miktar verilmeyen haraç reddedilir", () => {
  assert.equal(validateTerms({ topic: "tribute", payerSide: "target", hours: 24 }).ok, false);
});

test("gecikmiş cron turu ödeme atlamaz", () => {
  // 6 saatte bir ödeme, 20 saat geçmiş, hiç ödenmemiş → 3 ödeme birikmiş.
  const agreement = { startedAt: T0, everyHours: 6, paidCount: 0, endsAt: T0 + 48 * 3_600_000 };
  assert.equal(duePayments(agreement, T0 + 20 * 3_600_000), 3);
  assert.equal(duePayments({ ...agreement, paidCount: 3 }, T0 + 20 * 3_600_000), 0);
});

test("anlaşma bitince ödeme birikmez", () => {
  const agreement = { startedAt: T0, everyHours: 6, paidCount: 2, endsAt: T0 + 12 * 3_600_000 };
  assert.equal(duePayments(agreement, T0 + 100 * 3_600_000), 0, "süre dolduktan sonrası sayılmaz");
});

test("yönü olmayan haraç şartı reddedilir", () => {
  // Kim kime ödüyor yazmazsa şart uygulanamaz; Krala hiç sunulmamalı.
  const result = validateTerms({ topic: "tribute", tributeAmount: 60, hours: 24 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /hangi taraf/);
});
