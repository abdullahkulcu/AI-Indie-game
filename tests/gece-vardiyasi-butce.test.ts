/**
 * GECE VARDİYASININ İKİ EKSİĞİ.
 *
 * 3a. `max_actions_per_wake` hiç okunmuyordu. Sütun (varsayılan 1) ve
 *     `StandingOrder` tipi baştan beri bu alanı taşıyordu, ama `runOne` her
 *     uyanışta örtük olarak BİR hamle varsayıyordu. Kral "gece en fazla üç iş
 *     yap" dese de bir iş yapılıyordu — ayar oyuncuya yalan söylüyordu.
 *
 * 3b. Gece vardiyası `general_ledger`'a hiç yazmıyordu (`appendToLedger`
 *     yalnızca Kral çevrimiçiyken çağrılıyordu), yani General ertesi gün
 *     "dün gece ne oldu" diye hatırlamıyordu.
 *
 * Not: Kral gece olanı ZATEN görüyordu — `runOne` her hamlede kayda
 * "GECE VARDİYASI" bildirimi düşüyor. Eksik olan Kralın görüşü değil,
 * General'in HAFIZASIYDI.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveLedgerEvents, LEDGER_KINDS } from "../engine/ledger";
import { wakeBudget } from "../server/night-shift";

const cron = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");

test("bütçe Kralın uyanış başına verdiği hakkı okur", () => {
  assert.equal(wakeBudget({ maxActionsPerWake: 3, dailyActionCap: 8 }, 0), 3);
  assert.equal(wakeBudget({ maxActionsPerWake: 1, dailyActionCap: 8 }, 0), 1);
});

test("bütçe günlük tavandan KALANI aşamaz", () => {
  // "Uyanışta 3, günde 8" diyen Kralda yedinci hamleden sonra yalnızca bir hak
  // kalmıştır; bütçe onu aşarsa günlük tavan anlamını yitirir.
  assert.equal(wakeBudget({ maxActionsPerWake: 3, dailyActionCap: 8 }, 7), 1);
  assert.equal(wakeBudget({ maxActionsPerWake: 3, dailyActionCap: 8 }, 6), 2);
});

test("bütçe en az 1 döner — sıfır bütçe shouldWake ile çelişirdi", () => {
  // Günlük tavan gerçekten dolmuşsa hamleyi `shouldWake` engeller; bütçe
  // fonksiyonu ikinci bir kapı kurmaz.
  assert.equal(wakeBudget({ maxActionsPerWake: 3, dailyActionCap: 8 }, 8), 1);
  assert.equal(wakeBudget({ maxActionsPerWake: 0, dailyActionCap: 8 }, 0), 1);
  assert.equal(wakeBudget({ maxActionsPerWake: -5, dailyActionCap: 8 }, 0), 1);
});

test("kesirli ayar aşağıya yuvarlanır", () => {
  assert.equal(wakeBudget({ maxActionsPerWake: 2.9, dailyActionCap: 8 }, 0), 2);
});

test("cron bütçeyi ELLE hesaplamıyor, kuralı motordan okuyor", () => {
  assert.match(cron, /wakeBudget\(row, window\.actionsToday\)/, "cron bütçeyi okumuyor");
  assert.equal(
    /maxActionsPerWake\s*[,)]?\s*[<>*]/.test(cron), false,
    "cron içinde elle yazılmış ikinci bir bütçe hesabı var",
  );
});

test("cron her hamlede shouldWake'i YENİDEN soruyor", () => {
  // Açık soru buydu: birden çok hamlede her biri ayrı ayrı değerlendirilir mi?
  // Cevap evet — kuyruğun dolması, karşılanabilir emrin kalmaması ve günlük
  // tavan hamleler arasında kendiliğinden saygı görür.
  assert.match(cron, /const next = shouldWake\(/, "döngü içinde yeniden karar sorulmuyor");
});

test("cron defterе yazıyor ve sohbete özgü sinyalleri KAPALI geçiyor", () => {
  assert.match(cron, /appendToLedger\(row\.userId, kinds, now\)/, "gece vardiyası deftere yazmıyor");
  // Masada Kral yok: itirazın ezilmesi, reddetme, geri adım ve talep karşılama
  // gece anlamsızdır; açık bırakılırsa General olmayan bir konuşmayı hatırlar.
  assert.match(cron, /kingOverrode: false, generalRefused: false, kingBackedDown: false/);
  assert.match(cron, /requestsMet: 0, requestsRefused: 0/);
});

test("gece için YENİ bir defter türü uydurulmadı", () => {
  // Kural: hiçbir şey eklemeden bitir. Defterin tür listesi değişmemeli.
  assert.equal(LEDGER_KINDS.includes("faction_settled" as never), true, "liste beklenmedik biçimde değişmiş");
  assert.equal(
    LEDGER_KINDS.some(kind => /night|gece|wake/i.test(kind)), false,
    "geceye özel bir defter türü eklenmiş; bu tur hiçbir şey eklenmemeliydi",
  );
});

test("durumdan türeyen defter kayıtları gece bağlamında da çalışır", () => {
  // Gece sonundaki durum da bir durumdur: açlık, tokluk, firar ve boşalan
  // hazine sohbet gerektirmez.
  const ac = deriveLedgerEvents({
    resources: { gold: 10, food: 0 }, hourlyRates: { food: -20 },
    populace: { foodRation: 40, soldierPay: 0, soldierUnrest: 90, army: 30 },
    appliedActions: [], kingOverrode: false, generalRefused: false,
    kingBackedDown: false, requestsMet: 0, requestsRefused: 0,
  });
  assert.ok(ac.includes("starvation"), "açlık geceye yazılmıyor");
  assert.ok(ac.includes("desertion"), "firar geceye yazılmıyor");
  assert.ok(ac.includes("treasury_drain"), "boşalan hazine geceye yazılmıyor");

  const tok = deriveLedgerEvents({
    resources: { gold: 9000, food: 9000 }, hourlyRates: { food: 30 },
    populace: { foodRation: 100, soldierPay: 100, soldierUnrest: 0, army: 10 },
    appliedActions: ["host_festival"], kingOverrode: false, generalRefused: false,
    kingBackedDown: false, requestsMet: 0, requestsRefused: 0,
  });
  assert.ok(tok.includes("fed_people"));
  assert.ok(tok.includes("paid_soldiers"));
  assert.ok(tok.includes("festival"), "gecenin uyguladığı şenlik deftere girmiyor");
  // Sohbete özgü türler gece HİÇ doğmaz.
  for (const kind of ["override", "refusal", "heeded", "request_met", "request_refused"]) {
    assert.equal(tok.includes(kind as never), false, `${kind} gece bağlamında doğmamalı`);
  }
});
