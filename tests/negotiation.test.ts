import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DECLINABLE_STATUSES, KING_PRESENCE_MS, LIMITS, MAX_HOURS, MAX_MESSAGE_LENGTH, MAX_TRIBUTE_AMOUNT,
  MAX_TRIBUTE_RATE, MAX_TRIBUTE_RATE_PERCENT, MISSES_BEFORE_BREACH, SIGNABLE_STATUS,
  TRIBUTE_RESOURCES, TRIBUTE_TOPICS,
  canBind, canDecline, canOpen, canProposeTerms, canSpeak, carriesTribute, clampTerms, duePayments,
  settleTribute, isKingPresent, shouldGeneralAnswer, sideOf, tributeExpected, tributePayment,
  tributeRateFromPercent, validateTerms,
  type Negotiation, type NegotiationStatus, type NegotiationTopic,
} from "../engine/negotiation";
import { newId } from "../server/ids";
import { REPUTATION_CHANGES, reputationChange } from "../engine/diplomacy";
import { offlineDeskTools } from "../server/negotiation-brief";

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

test("Kralın masada sayılması yalnızca kendi izine bakar", () => {
  assert.equal(isKingPresent(T0, T0 + 1000), true);
  assert.equal(isKingPresent(T0, T0 + KING_PRESENCE_MS), false, "süre dolunca Kral masada değildir");
  assert.equal(isKingPresent(null, T0), false);
  assert.equal(isKingPresent(undefined, T0), false, "izi olmayan Kral masada sayılmaz");
});

test("Kral masadayken General onun yerine konuşmaz", () => {
  const decision = shouldGeneralAnswer({
    negotiation: table({ turns: 1 }), side: "target", lastMessageSide: "initiator", kingPresent: true, now: T0,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /Kral masada/);
});

test("Kral yokken General yalnızca sırası gelince konuşur", () => {
  const base = { negotiation: table({ turns: 1 }), side: "target" as const, kingPresent: false, now: T0 };
  assert.equal(shouldGeneralAnswer({ ...base, lastMessageSide: "initiator" }).ok, true, "son söz karşı taraftaysa cevap verilir");
  assert.equal(shouldGeneralAnswer({ ...base, lastMessageSide: "target" }).ok, false, "arka arkaya iki mesaj yazılmaz");
  assert.equal(shouldGeneralAnswer({ ...base, lastMessageSide: null }).ok, false, "boş masaya General söz açmaz");
});

test("General cevabı da masanın sınırlarına tabidir", () => {
  const full = shouldGeneralAnswer({
    negotiation: table({ turns: LIMITS.maxTurns }), side: "target", lastMessageSide: "initiator", kingPresent: false, now: T0,
  });
  assert.equal(full.ok, false, "tur tavanı General için de geçerlidir");
  const expired = shouldGeneralAnswer({
    negotiation: table({ turns: 1 }), side: "target", lastMessageSide: "initiator", kingPresent: false, now: T0 + LIMITS.lifetimeMs,
  });
  assert.equal(expired.ok, false, "süresi dolmuş masada General de konuşamaz");
  const closed = shouldGeneralAnswer({
    negotiation: table({ status: "agreed", turns: 2 }), side: "target", lastMessageSide: "initiator", kingPresent: false, now: T0,
  });
  assert.equal(closed.ok, false, "kapanmış masaya cevap yazılmaz");
});

test("Kral yokken General onun önündeki teklifi silemez", () => {
  // Karşı taraf şart sundu: imza Kralındır. General üstüne yeni şart yazarsa
  // Kral sabah onaylayacağı teklifi hiç görmez.
  const waiting = table({ status: "awaiting_king", proposedBy: "initiator", turns: 2 });
  const offline = canProposeTerms(waiting, "target", false, T0);
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.match(offline.reason, /imzasını bekliyor/);
  // Ama konuşabilir: Kralın kararı "cevap versin ama imza atamasın".
  assert.equal(canSpeak(waiting, "target", T0).ok, true);
  // Kral masadaysa karşı teklif vermek onun kendi kararıdır; teklifi görmüştür.
  assert.equal(canProposeTerms(waiting, "target", true, T0).ok, true);
});

test("boş masada şart sunmak serbesttir, kapalı masada değildir", () => {
  assert.equal(canProposeTerms(table({ turns: 1 }), "target", false, T0).ok, true);
  assert.equal(canProposeTerms(table({ turns: LIMITS.maxTurns }), "target", false, T0).ok, false);
  // Kendi teklifini bekleyen taraf ne konuşur ne de yeni şart sunar.
  assert.equal(canProposeTerms(table({ status: "awaiting_king", proposedBy: "target" }), "target", false, T0).ok, false);
});

test("yönü olmayan haraç şartı reddedilir", () => {
  // Kim kime ödüyor yazmazsa şart uygulanamaz; Krala hiç sunulmamalı.
  const result = validateTerms({ topic: "tribute", tributeAmount: 60, hours: 24 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /hangi taraf/);
});

test("masanın söz hakkı cömert, Generalin payı sınırlı", () => {
  // Kral 6/6'da tıkandı: pazarlık daha başlamadan masa kapanıyordu. Toplam
  // tavan büyütüldü çünkü Kralın kendi yazdığı sözler token harcamıyor;
  // asıl gider Generalin payı ve o ayrıca sınırlı.
  assert.ok(LIMITS.maxTurns > LIMITS.maxGeneralTurns * 2, "Kralın elle pazarlık edecek alanı olmalı");
  assert.equal(canSpeak(table({ turns: 10 }), "initiator", T0).ok, true, "10. sözde masa hâlâ açık");
});

test("General payını doldurunca susar, Kral konuşmaya devam eder", () => {
  const open = table({ turns: 8 });
  const spent = shouldGeneralAnswer({
    negotiation: open, side: "initiator", lastMessageSide: "target",
    generalTurnsUsed: LIMITS.maxGeneralTurns, kingPresent: false, now: T0,
  });
  assert.equal(spent.ok, false);
  if (!spent.ok) assert.match(spent.reason, /söz hakkını doldurdu/);
  // Aynı masada Kral hâlâ konuşabilir.
  assert.equal(canSpeak(open, "initiator", T0).ok, true);
  // Payı dolmadıysa General konuşur.
  assert.equal(shouldGeneralAnswer({
    negotiation: open, side: "initiator", lastMessageSide: "target",
    generalTurnsUsed: LIMITS.maxGeneralTurns - 1, kingPresent: false, now: T0,
  }).ok, true);
});

test("ödenemeyen vade kaçırılmış sayılır, ödenmiş sayılmaz", () => {
  // Eskiden ambarı boş olan taraf hiçbir bedel ödemeden sıyrılıyordu.
  const terms = { tributeAmount: 100 };
  assert.deepEqual(settleTribute(1000, 3, terms), { moved: 300, paid: 3, missed: 0 });
  // 250 stokla: ilk ödeme 100 (tavan 125), sonra 150'nin yarısı 75 < 100 → kaçtı.
  const tight = settleTribute(250, 3, terms);
  assert.equal(tight.paid, 1);
  assert.equal(tight.missed, 2);
  assert.deepEqual(settleTribute(0, 2, terms), { moved: 0, paid: 0, missed: 2 });
});

test("oranlı haraçta eksik ödeme kaçırılmış sayılmaz", () => {
  // Oran ambarla küçülür; az ödemek anlaşmayı ihlal etmez.
  const result = settleTribute(1000, 2, { tributeRate: .2 });
  assert.equal(result.missed, 0);
  assert.ok(result.moved > 0);
});

test("tavana takılan haraç artık boşa düşmüyor: ya taşınır ya gerçekten yoktur", () => {
  // ÖLÇÜM TABLOSU (kusurun kilidi). Eskiden beklenen tutar ambarın yarısını
  // geçtiği anda HİÇ ödeme yapılmıyor, ambarı dolu Kral hem parasını tutuyor
  // hem "ödemedi" damgası yiyordu: 9.999 altını olan Kral 5.000 altınlık haracı
  // ödemiyor, iki turda anlaşma bozuluyor ve itibarı 20 düşüyordu.
  const rows: Array<[number, number, number, number]> = [
    // [stok, beklenen, taşınan, kaçan]
    [1000, 400, 400, 0],
    [1000, 501, 500, 1],
    [100, 60, 50, 1],
    [9999, 5000, 4999, 1],
  ];
  for (const [stock, expected, moved, missed] of rows) {
    const terms = { tributeAmount: expected };
    assert.equal(tributeExpected(stock, terms), expected, `beklenen ${expected}`);
    assert.deepEqual(settleTribute(stock, 1, terms), { moved, paid: missed ? 0 : 1, missed },
      `stok ${stock}, beklenen ${expected}`);
    // Ambarı dolu olup hiçbir şey kaybetmeden "ödemedi" damgası yemek mümkün olmamalı.
    if (missed) assert.ok(moved > 0, "kaçıran taraf ödeyebildiğini yine de öder");
  }
  // Gerçekten ödeyemeyecek durum: ambar boş. Taşınacak bir şey yok, vade kaçar.
  assert.deepEqual(settleTribute(0, 2, { tributeAmount: 60 }), { moved: 0, paid: 0, missed: 2 });
});

test("ihlal mekanizması ayakta kalır: eksik ödeyen iki turda bozar", () => {
  // "Artık hiçbir zaman kaçırılmaz" kabul edilemez; tavana takılan ödeme
  // taşınsa bile vade KAPANMAZ.
  const tight = settleTribute(100, MISSES_BEFORE_BREACH, { tributeAmount: 60 });
  assert.equal(tight.paid, 0);
  assert.equal(tight.missed, MISSES_BEFORE_BREACH, "iki kaçırma anlaşmayı bozar");
  assert.ok(tight.moved > 0, "kaçırmanın bir bedeli var");
  // Tek ödemede krallığı boşaltma koruması yerinde: ambarın yarısından fazlası gitmez.
  assert.equal(tributePayment(100, { tributeAmount: 10_000 }), 50);
  assert.ok(settleTribute(1000, 5, { tributeAmount: 10_000 }).moved < 1000, "birikmiş vadeler ambarı sıfırlamaz");
});

test("oranlı haraç ambarla küçülür ve vadeyi kaçırmaz", () => {
  const result = settleTribute(1000, 2, { tributeRate: .1 });
  assert.deepEqual(result, { moved: 190, paid: 2, missed: 0 });
});

test("oranlı haraç araç şemasından GERÇEKTEN kurulabilir", () => {
  // Kusur: tributeRate'i yazan tek yer clampTerms'ti; hiçbir araç şeması oran
  // sunmuyordu, dolayısıyla oranlı haraç yalnızca testlerde vardı.
  const [, propose] = offlineDeskTools(true);
  const properties = (propose.parameters as { properties: Record<string, { maximum?: number; enum?: string[]; maxLength?: number }> }).properties;
  assert.ok(properties.rate_percent, "çevrimdışı General oran önerebilmeli");
  assert.equal(properties.rate_percent.maximum, MAX_TRIBUTE_RATE_PERCENT);
  // Çevrimiçi General'in şeması ayrı dosyada; oranı o da sunmalı.
  const onlineTools = readFileSync(new URL("../app/api/general/route.ts", import.meta.url), "utf8");
  assert.match(onlineTools, /propose_terms[\s\S]{0,900}rate_percent/, "propose_terms oran alanı sunmalı");
  // Yüzde → oran çevrimi tavanı motordan alır.
  assert.equal(tributeRateFromPercent(10), .1);
  assert.equal(tributeRateFromPercent(90), MAX_TRIBUTE_RATE, "tavan aşılamaz");
  assert.equal(tributeRateFromPercent(undefined), 0);
  assert.equal(clampTerms({ topic: "tribute", tributeRate: tributeRateFromPercent(25) }).tributeRate, .25);
  const checked = validateTerms({ topic: "tribute", tributeRate: tributeRateFromPercent(20), payerSide: "target", hours: 24 });
  assert.equal(checked.ok, true, "oran tek başına geçerli bir haraç şartıdır");
});

test("araç şemasının sınırları motordan türetilir, elle yazılmaz", () => {
  const [reply, propose] = offlineDeskTools(true);
  const props = (propose.parameters as { properties: Record<string, { maximum?: number; enum?: string[]; maxLength?: number }> }).properties;
  assert.equal(props.amount_per_payment.maximum, MAX_TRIBUTE_AMOUNT);
  assert.equal(props.hours.maximum, MAX_HOURS);
  assert.equal(props.every_hours.maximum, MAX_HOURS);
  assert.deepEqual(props.resource.enum, [...TRIBUTE_RESOURCES]);
  assert.equal(props.message.maxLength, MAX_MESSAGE_LENGTH);
  const replyProps = (reply.parameters as { properties: Record<string, { maxLength?: number }> }).properties;
  assert.equal(replyProps.message.maxLength, MAX_MESSAGE_LENGTH);
});

test("haraç taşıyan konular tek kaynaktan okunur", () => {
  // Kusur: validateTerms ültimatomdan da haraç şartı istiyordu ama cron yalnızca
  // "tribute" tahsil ediyordu — ültimatom imzalanıyor, hiçbir kaynak akmıyordu.
  assert.ok(TRIBUTE_TOPICS.includes("ultimatum"), "ültimatom haraç taşır");
  const topics: NegotiationTopic[] = ["tribute", "non_aggression", "alliance", "passage", "ultimatum"];
  for (const topic of topics) {
    const bare = validateTerms({ topic, payerSide: "target", hours: 24 });
    const withTribute = validateTerms({ topic, tributeAmount: 60, payerSide: "target", hours: 24 });
    if (carriesTribute(topic)) {
      assert.equal(bare.ok, false, `${topic}: haraçsız şart geçersiz olmalı`);
      assert.equal(withTribute.ok && withTribute.terms.tributeAmount, 60, `${topic}: haraç korunmalı`);
    } else {
      assert.equal(bare.ok, true, `${topic}: haraç aranmamalı`);
      assert.equal(withTribute.ok && withTribute.terms.tributeAmount, 0, `${topic}: haraç sıfırlanmalı`);
    }
  }
});

test("cron haraç turu aynı listeden okur ve turu düşürmez", () => {
  // Bu dosya app/api/cron/route.ts'i import EDEMEZ (cloudflare:workers).
  // Kuralın iki yerde yazılıp sessizce sapması bu projedeki en sık hata sınıfı
  // olduğu için bağ kaynak üzerinden kilitleniyor.
  const cron = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");
  assert.match(cron, /inArray\(agreements\.topic, \[\.\.\.TRIBUTE_TOPICS\]\)/, "haraç sorgusu TRIBUTE_TOPICS'ten türemeli");
  assert.doesNotMatch(cron, /eq\(agreements\.topic, "tribute"\)/, "konu listesi cron'a elle yazılmamalı");
  // Haraç turu try/catch içinde olmalı: tek hata bütün cron turunu düşürmemeli.
  assert.match(cron, /try \{ tributes = await settleTributes\(now\); \}\s*\n\s*catch/, "haraç turu sarılmalı");
  // Vade kapatma koşullu UPDATE ile kilitlenir; çakışan tetikleme sayacı ikilemez.
  assert.match(cron, /eq\(agreements\.missedCount, deal\.missedCount\)/, "vade kapatma koşullu olmalı");
});

test("itibar cezası canlı motordan okunur ve değeri korunur", () => {
  // Ölü Fastify yığınına tek bağ buydu; taşındı, değer aynı kaldı.
  assert.equal(reputationChange("betrayal"), -20);
  assert.equal(Math.max(0, Math.min(100, 50 + reputationChange("betrayal"))), 30, "itibar 50 → 30");
  assert.equal(REPUTATION_CHANGES.broke_ceasefire, -12);
  assert.equal(REPUTATION_CHANGES.kept_promise, 2);
});


// --- Bu paketin kapattığı kusurlar ---------------------------------------
// Uç rotası testten import EDİLEMEZ (`cloudflare:workers`). Saf kural motora
// çıkarıldı ve orada gerçek testi var; uçtaki uygulanışı kaynak metin üzerinden
// kilitleniyor — önceki paketin cron için kullandığı desenin aynısı.

const routeSource = readFileSync(new URL("../app/api/negotiate/route.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const membershipSource = readFileSync(new URL("../server/active-membership.ts", import.meta.url), "utf8");
const saveRouteSource = readFileSync(new URL("../app/api/save/route.ts", import.meta.url), "utf8");

test("imzalanmış masa reddedilemez", () => {
  // Kusur: decline dalı hiçbir durum denetimi yapmıyordu. Anlaşma yürürlükte
  // kalırken masa "declined" görünüyor, Kral anlaşmadan çıktığını sanıyordu.
  assert.equal(canDecline("open").ok, true);
  assert.equal(canDecline(SIGNABLE_STATUS).ok, true);
  const signed = canDecline("agreed");
  assert.equal(signed.ok, false);
  assert.match(signed.ok ? "" : signed.reason, /anlaşma/i, "Kral anlaşmanın sürdüğünü okumalı");
  assert.equal(canDecline("declined").ok, false);
  assert.equal(canDecline("expired").ok, false);
  // Liste ile kural ayrışmasın: uçtaki koşullu UPDATE de aynı listeden türer.
  const all: NegotiationStatus[] = ["open", "awaiting_king", "agreed", "declined", "expired"];
  for (const status of all) {
    assert.equal(canDecline(status).ok, (DECLINABLE_STATUSES as readonly string[]).includes(status), status);
  }
});

test("kimlikler çakışmaz", () => {
  // Kusur: `ng_${user.id}_${Date.now()}` ve `nm_${row.id}_${now}_${row.turns}`.
  // Aynı milisaniyede iki masa ya da aynı bayat turns'ü okuyan iki cevap
  // birincil anahtarı çakıştırıp isteği 500'e düşürüyordu.
  const ids = new Set(Array.from({ length: 5000 }, () => newId("nm")));
  assert.equal(ids.size, 5000, "5000 kimlikte tek bir çakışma bile olmamalı");
  assert.match(newId("ng"), /^ng_[0-9a-f-]{36}$/, "önek korunur, gövde rastgeledir");
  assert.doesNotMatch(newId("ag"), /\d{13}/, "kimlikte zaman damgası taşınmaz");
});

test("uç imza yarışını koşullu UPDATE ile kapatır", () => {
  // Kusur: durum okuması ile yazma arasında koruma yoktu. İki eşzamanlı accept
  // iki aktif anlaşma yaratıyor ve cron ikisini birden tahsil ediyordu; haracı
  // ALAN taraf bunu kendi lehine tetikleyebiliyordu.
  const accept = routeSource.slice(routeSource.indexOf('body.action === "accept"'));
  assert.match(accept, /eq\(negotiations\.status, SIGNABLE_STATUS\)/, "durum geçişi koşullu olmalı");
  assert.match(accept, /\.returning\(\{ id: negotiations\.id \}\)/, "yarışın kazananı returning ile anlaşılmalı");
  assert.match(accept, /if \(!signed\) return json\([^)]*409\)/, "yarışı kaybeden 409 almalı");
  // Anlaşma ANCAK koşullu update tuttuysa yazılır: sıra tersine dönerse yarış geri gelir.
  assert.ok(accept.indexOf("if (!signed)") < accept.indexOf("db.insert(agreements)"),
    "anlaşma insert'i koşullu update'in ARDINDAN gelmeli");
  assert.doesNotMatch(accept, /status: "agreed" \}\)\.where\(eq\(negotiations\.id/, "koşulsuz update kalmamalı");
});

test("uç kapanmış masayı reddettirmez", () => {
  const decline = routeSource.slice(routeSource.indexOf('body.action === "decline"'), routeSource.indexOf('body.action === "accept"'));
  assert.match(decline, /canDecline\(row\.status\)/, "durum kuralı motordan okunmalı");
  assert.match(decline, /inArray\(negotiations\.status, \[\.\.\.DECLINABLE_STATUSES\]\)/, "UPDATE koşullu ve liste motordan olmalı");
  assert.match(decline, /if \(!closed\) return json\([^)]*409\)/, "yarışı kaybeden 409 almalı");
});

test("uç kimlikleri ve tur sayacını yarışa dayanıklı yazar", () => {
  assert.doesNotMatch(routeSource, /id: `(ng|nm|ag)_[^`]*\$\{now\}/, "zaman damgalı kimlik kalmamalı");
  assert.doesNotMatch(routeSource, /row\.turns \+ 1/, "tur sayacı bayat okumadan artmamalı");
  const bumps = routeSource.match(/turns: sql`\$\{negotiations\.turns\} \+ 1`/g) ?? [];
  assert.equal(bumps.length, 2, "reply ve propose dallarının ikisi de sayacı veritabanında artırmalı");
  assert.equal((routeSource.match(/newId\("(ng|nm|ag)"\)/g) ?? []).length, 5, "beş kimlik de newId'den gelmeli");
});

test("müzakere ucu hesap bazında hız sınırlar", () => {
  // set_open hiçbir motor kuralına takılmıyordu; sınırsız tek uç kalmasın.
  assert.match(routeSource, /consumeRateLimit\(RATE_LIMITS\.negotiate, `user:\$\{user\.id\}`\)/, "sınır hesap bazında olmalı");
  assert.match(routeSource, /rateLimitResponse\(limit,/, "sınıra takılan istek 429 almalı");
  assert.doesNotMatch(routeSource, /clientIp\(/, "IP bazlı sınır konmamalı");
  const rules = readFileSync(new URL("../server/rate-limit.ts", import.meta.url), "utf8");
  assert.match(rules, /negotiate: \{ scope: "negotiate", limit: \d+, windowMs: /, "kural RATE_LIMITS'te tanımlı olmalı");
  // Sınır, POST gövdesi okunmadan önce tüketilmeli: aksi halde dev bir gövde
  // sınırın önüne geçer.
  assert.ok(routeSource.indexOf("consumeRateLimit") < routeSource.indexOf("await request.json()"),
    "sınır gövde okunmadan önce tüketilmeli");
});

test("aktif üyelik tek ve belirli bir kuraldan okunur", () => {
  // Kusur: sırasız limit(1) rastgele bir üyelik seçiyordu; kayıt bir channel'a,
  // müzakere başkasına gidebiliyordu.
  assert.match(routeSource, /activeMembershipOf\(user\.id\)/, "uç paylaşılan kuralı çağırmalı");
  assert.doesNotMatch(routeSource, /from\(channelMembers\)\.where\(and\(eq\(channelMembers\.userId/, "uçta ikinci bir üyelik sorgusu kalmamalı");
  assert.match(membershipSource, /\.orderBy\(desc\(channelMembers\.joinedAt\), asc\(channelMembers\.channelId\)\)/, "sıra belirli olmalı");
  // Aday kümesi app/api/save/route.ts ile AYNI üç koşuldan doğmalı; ayrışırsa
  // kayıt ve müzakere yine iki ayrı channel görür.
  for (const predicate of [/eq\(channelMembers\.userId, userId\)/, /eq\(channelMembers\.status, "active"\)/, /eq\(channels\.status, "active"\)/]) {
    assert.match(membershipSource, predicate, "üyelik kuralı eksik");
    assert.match(saveRouteSource, predicate, "kayıt ucunun kuralı ayrışmış");
  }
});

test("bir masadan bir anlaşma çıkar: şema seviyesinde ağ", () => {
  assert.match(schemaSource, /uniqueIndex\("idx_agreements_negotiation"\)\.on\(table\.negotiationId\)/,
    "agreements.negotiationId tekil olmalı");
});

test("panel müzakereye kapanma anahtarını sunar", () => {
  // Kusur: acceptsNegotiation DEFAULT TRUE ve set_open panelde HİÇ çağrılmıyordu;
  // hiçbir Kral müzakereye kapanamıyor, yabancı masalar onun BYOK kredisini yakıyordu.
  assert.match(panelSource, /action:"set_open",accepts/, "panel kapıyı değiştirebilmeli");
  assert.match(panelSource, /data\.acceptsNegotiation==="boolean"/, "mevcut durum GET yanıtından okunmalı");
  assert.match(panelSource, /Açık masalar ve sizin açtığınız masalar sürer/, "kapalıyken ne olduğu Krala yazılmalı");
});

test("panel oranlı haraç sunabilir ve tavanları motordan okur", () => {
  // Kusur: sunucu ve araç şeması hazırdı, panel yalnızca tributeAmount gönderiyordu.
  assert.match(panelSource, /tributeRate:tributeRateFromPercent\(action\.arguments\.rate_percent\)/, "Generalin oranı masaya ulaşmalı");
  assert.match(panelSource, /tributeRate:envoyTerm\.mode==="rate"\?tributeRateFromPercent\(value\):0/, "Kral kendi eliyle oran önerebilmeli");
  assert.match(panelSource, /tributeAmount:envoyTerm\.mode==="amount"\?Math\.floor\(value\):0/, "sabit miktar ile oran aynı anda gönderilmemeli");
  // Tavanlar motordan import edilir; panelde elle yazılan bir tavan sunucununkinden sapar.
  assert.match(panelSource, /MAX_TRIBUTE_RATE_PERCENT/, "oran tavanı motordan okunmalı");
  assert.match(panelSource, /MAX_TRIBUTE_AMOUNT/, "miktar tavanı motordan okunmalı");
  assert.match(panelSource, /max=\{MAX_HOURS\}/, "saat tavanı motordan okunmalı");
  assert.doesNotMatch(panelSource, /maxLength=\{600\}/, "mesaj tavanı elle yazılmamalı");
  assert.doesNotMatch(panelSource, /%50/, "oran tavanı panele elle yazılmamalı");
});
