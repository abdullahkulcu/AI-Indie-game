/**
 * FİKİR 18 — KRALIN KENDİ HALKINI FEDA ETMESİ.
 *
 * Bu testin ASIL sebebi son testi: kapının adım-bölünmesinden bağımsızlığı.
 * İlk sürüm kapıyı `heaviestGrievance`'a bağlıyordu ve ÖLÇÜLDÜ ki bu bir
 * kazanan-hepsini-alır karşılaştırması olduğu için adım büyüklüğü değişince
 * takla atıyor: sunucunun tek büyük adımı cezayı hiç uygulamıyor, istemcinin
 * dakikalık adımları 24 saatte 30 puan düşürüyordu. Kısıt #2 tam olarak bunu
 * yasaklıyor ve bu tarihte birden çok kez gerçek hataya dönüşmüş.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { deliberateExodus, EXODUS_PENALTY, FULL_RATION, TAX_NEUTRAL } from "../engine/populace";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";

const T0 = 1_700_000_000_000;

function game(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "S", channelId: "s",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0,
    resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 },
    population: 60, capacity: 500, popularity: 25, reputation: 100, loyalty: 75,
    taxRate: 30, quota: 6, quotaAt: T0, foodRation: 70, aleRation: 0,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null,
    generalConnected: false, ...overrides,
  } as Game;
}

test("tam pay ilan edilmiş ve vergi nötrken feda yoktur", () => {
  assert.equal(deliberateExodus({ foodRation: FULL_RATION, taxRate: TAX_NEUTRAL }), null);
});

test("pay kısılmışsa gerekçe 'food', kısılmamış ama vergi yüksekse 'tax'", () => {
  assert.equal(deliberateExodus({ foodRation: FULL_RATION - 1, taxRate: TAX_NEUTRAL }), "food");
  assert.equal(deliberateExodus({ foodRation: FULL_RATION, taxRate: TAX_NEUTRAL + 1 }), "tax");
  // Sıra SABİT: ikisi birdense pay öne geçer. Büyüklük karşılaştırması YOK —
  // karşılaştırma olsaydı adım bölünmesinde takla atardı.
  assert.equal(deliberateExodus({ foodRation: 40, taxRate: 50 }), "food");
});

test("itibar sapması AYRILAN SAYISININ farkıyla sınırlı kalır", () => {
  // ASIL DENETİM BU. Kapı `heaviestGrievance`'a bağlıyken (kazanan-hepsini-alır
  // karşılaştırması) tek büyük adım cezayı HİÇ uygulamıyor, dakikalık adımlar
  // 24 saatte 30 puan düşürüyordu — oysa ayrılan sayısı farkının açıkladığı en
  // fazla ~15 puandı. Yani sapma nüfus borcundan DEĞİL kapının kendisinden
  // geliyordu. Bu iddia o hatayı yakalar.
  //
  // "İki yol da aynı kararı verir" diye DAHA GÜÇLÜ bir iddia yazılamıyor ve
  // bunun sebebi bu madde değil: bildirim eşiği (`drift <= -LEDGER_STEP`)
  // birikime bağlı, birikim de `populationChange`in bilinen adım-bölünmesi
  // borcunu taşıyor (bkz. docs/plans/2026-08-22-acik-backlog-maddeleri.md).
  // Pencerenin kesildiği anda bir yol eşiği geçmiş, diğeri geçmemiş olabilir.
  // O borç kapanınca bu iddia eşitliğe sıkılaştırılabilir.
  // İKİ senaryo: küçük krallık (kapı sınırda) ve KALABALIK krallık. İkincisi
  // orijinal hatayı açığa çıkaran senaryodur — küçük krallıkta takla hiç
  // görünmüyordu, o yüzden yalnızca onu ölçen bir test boş bir garanti olurdu.
  const senaryolar: Array<[string, Partial<Game>]> = [
    ["küçük krallık", {}],
    // Taban kırpması ölçümü gizlemesin diye itibar 100'den başlar.
    ["kalabalık krallık", { population: 400, popularity: 15, taxRate: 45, foodRation: 40 }],
  ];
  const hours = 24, end = T0 + hours * 3_600_000;
  let tetiklenen = 0;
  for (const [ad, ayar] of senaryolar) {
    const big = tick(game(ayar), end);
    let small = game(ayar);
    for (let step = 1; step <= hours * 60; step += 1) small = tick(small, T0 + step * 60_000);
    if (big.reputation < 100 || small.reputation < 100) tetiklenen += 1;

    const peopleGap = Math.abs((big.peopleLeft ?? 0) - (small.peopleLeft ?? 0));
    const reputationGap = Math.abs(big.reputation - small.reputation);
    assert.ok(
      reputationGap <= peopleGap * EXODUS_PENALTY.reputationPerPerson + 1e-9,
      `${ad}: itibar farkı (${reputationGap}) ayrılan farkının açıkladığından büyük `
      + `(${peopleGap} kişi × ${EXODUS_PENALTY.reputationPerPerson})`,
    );
  }
  assert.equal(tetiklenen, senaryolar.length, "bir senaryo cezayı hiç tetiklemiyor; senaryo bozulmuş");
});

test("kapı SAF ve adım büyüklüğünden bağımsız: yalnızca Kralın ayarını okur", () => {
  // Kapının kendisi karşılaştırma yapmıyor, dolayısıyla aynı ayar için her
  // adım büyüklüğünde aynı cevabı verir. Eski sürüm `heaviestGrievance`
  // aldığı için bu garanti YOKTU.
  assert.equal(deliberateExodus.length, 1, "kapı ikinci bir girdi alıyor: karşılaştırmaya geri dönülmüş");
  const policy = { foodRation: 70, taxRate: 30 };
  assert.equal(deliberateExodus(policy), deliberateExodus(policy));
});

test("ceza kişi BAŞINA: aynı sayıda insan için aynı bedel", () => {
  // Kişi başına olmasının sebebi üslup değil kısıt #2: bildirim eşiği
  // (`drift <= -LEDGER_STEP`) OLAY SAYISINI adım bölünmesine bağlı kılıyor,
  // dolayısıyla ceza olay başına olsaydı iki taraf farklı hesaplardı.
  assert.ok(EXODUS_PENALTY.reputationPerPerson > 0, "kişi başına ceza tanımlı değil");
  const forTwentyFive = 25 * EXODUS_PENALTY.reputationPerPerson;
  assert.ok(
    forTwentyFive >= 5 && forTwentyFive <= 20,
    `25 kişilik ceza (${forTwentyFive}) REPUTATION_CHANGES mertebesinden çıkmış`,
  );
});
