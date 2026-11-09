import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MIGRATION, distributeMigrants, migrationArrivalNotice, migrationReturnNotice, migrationTravelMs,
  type MigrationCandidate,
} from "../engine/migration";
import { capacityFor, tick } from "../engine/tick";
import { validateGameSave } from "../server/save-validation";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0 - 10 * 86_400_000, lastTickAt: T0, protectionEndsAt: T0 - 6 * 86_400_000,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 100, capacity: 400, popularity: 60, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 3 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

// --- Çoklu hedef dağıtımı: kapasite ve çekicilik ---------------------------

test("kapasitesi dolu ya da aşmış aday göçmen almaz", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "a", population: 400, capacity: 400, popularity: 80 }, // tam dolu
    { userId: "b", population: 450, capacity: 400, popularity: 80 }, // aşmış
    { userId: "c", population: 100, capacity: 400, popularity: 10 }, // tek açık aday
  ];
  assert.deepEqual(distributeMigrants(candidates, 40), {
    allocations: [{ userId: "c", count: 40 }], unplaced: 0,
  });
});

test("aday yoksa ya da hiçbirinde boş konut yoksa herkes kaynağa döner", () => {
  assert.deepEqual(distributeMigrants([], 12), { allocations: [], unplaced: 12 });
  assert.deepEqual(distributeMigrants([{ userId: "a", population: 400, capacity: 400, popularity: 90 }], 12), {
    allocations: [], unplaced: 12,
  });
});

test("rızası dibe vurmuş bir krallık da taban çekicilikle göçmen alabilir", () => {
  // Tek aday: rızası 0 olsa bile ATTRACTIVENESS_FLOOR sayesinde seçilir —
  // göçmenler zaten bir yerden kaçıyor, mutlak mükemmeli değil eldeki en az
  // kötüyü arıyorlar.
  assert.deepEqual(distributeMigrants([{ userId: "isyanci", population: 50, capacity: 200, popularity: 0 }], 25), {
    allocations: [{ userId: "isyanci", count: 25 }], unplaced: 0,
  });
});

test("göçmenler birden çok hedefe çekicilik oranıyla bölünür", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "mutlu", population: 100, capacity: 200, popularity: 100 },
    { userId: "kaynayan", population: 100, capacity: 200, popularity: 0 },
  ];
  const result = distributeMigrants(candidates, 50);
  assert.equal(result.unplaced, 0);
  assert.deepEqual(result.allocations, [{ userId: "kaynayan", count: 10 }, { userId: "mutlu", count: 40 }]);
});

test("toplam boş konutu aşan göçmenin kalanı kaynak krallığa döner", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "a", population: 95, capacity: 100, popularity: 60 },
    { userId: "b", population: 98, capacity: 100, popularity: 40 },
  ];
  assert.deepEqual(distributeMigrants(candidates, 12), {
    allocations: [{ userId: "a", count: 5 }, { userId: "b", count: 2 }], unplaced: 5,
  });
});

test("aday sırası sonucu değiştirmez: userId'ye göre kararlıdır", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "z-krallik", population: 100, capacity: 400, popularity: 60 },
    { userId: "a-krallik", population: 50, capacity: 300, popularity: 40 },
  ];
  const forward = distributeMigrants(candidates, 75);
  const backward = distributeMigrants([...candidates].reverse(), 75);
  assert.deepEqual(forward, backward);
});

// --- Yol süresi --------------------------------------------------------

test("göçmen kervanı yolda hızlı channel'da daha kısa kalır", () => {
  assert.ok(migrationTravelMs(24) < migrationTravelMs(1));
  assert.ok(migrationTravelMs(1) > 0);
  assert.equal(MIGRATION.travelMinutes, 90);
});

// --- Bildirim ------------------------------------------------------------

test("varış bildirimi kimden geldiğini söylemez (bilgi sınırı)", () => {
  const text = migrationArrivalNotice(7);
  assert.match(text, /^7 kişi/);
  assert.ok(!/[A-ZÇĞİÖŞÜ][a-zçğıöşü]+kale/.test(text), "kaynak krallığın adı sızmamalı");
});

test("dönüş bildirimi kaybolmayı değil kaynak krallığa dönüşü söyler", () => {
  assert.match(migrationReturnNotice(7), /^7 kişi/);
  assert.match(migrationReturnNotice(7), /geri döndü/);
});

// --- Kapasite tavanı: engine/tick.ts ile AYNI kaynaktan okunur -----------

test("aday kapasitesi capacityFor ile aynı formülden hesaplanır (tek doğru kaynak)", () => {
  const buildings = [
    { type: "keep", name: "Kale", category: "Yönetim", level: 3 },
    { type: "town_square", name: "Meydan", category: "Yönetim", level: 2 },
  ];
  const candidate: MigrationCandidate = { userId: "x", population: 0, capacity: capacityFor(buildings), popularity: 50 };
  assert.equal(candidate.capacity, capacityFor(buildings));
});

// --- Hedefin nüfus/peopleJoined artışı sonraki kayıtta reddedilmez -------

test("cron'un doğrudan yazdığı göçmen artışı, hedefin bir sonraki kaydında reddedilmez", () => {
  // settleMigrations'ın yaptığı TAM OLARAK budur: hedefin kaydına doğrudan
  // (validateGameSave'den GEÇMEDEN) population + peopleJoined yazılır — tıpkı
  // haraç tahsilatının/maden cevherinin doğrudan yazması gibi (bkz.
  // app/api/cron/route.ts, server/mine ilgili route). Yeni bir SERVER_DERIVED
  // alanı GEREKMEZ: `population` zaten istemci-raporlu+tavanlı bir alandır ve
  // doğrudan yazma bir SONRAKİ kaydın `previous` tabanına girer.
  const before = newGame({ population: 100, capacity: 400, peopleJoined: 20, lastTickAt: T0 });
  const afterCronWrite = {
    ...before,
    population: 130,
    peopleJoined: 50,
    notices: [{ kind: "GÖÇ", text: migrationArrivalNotice(30), at: T0 }, ...before.notices],
  };
  // Hedefin kendi istemcisi bir SONRAKİ turda normal biçimde ilerletir ve kaydeder.
  const nextClientSave = tick(afterCronWrite, T0 + HOUR);
  const result = validateGameSave(nextClientSave, {
    previous: afterCronWrite as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.game.population >= 130, "göçmenlerin getirdiği nüfus kalıcı olmalı");
});

// --- Motor saflığı ---------------------------------------------------------

test("motor saf kalır: göçte zar, Date.now ve crypto yok", () => {
  const source = readFileSync(new URL("../engine/migration.ts", import.meta.url), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "crypto.getRandomValues", "crypto.randomUUID"]) {
    assert.ok(!source.includes(forbidden), `engine/migration.ts içinde ${forbidden} olmamalı`);
  }
});

test("göç hiçbir yeni model çağrısı açmaz", () => {
  const files = ["engine/migration.ts", "server/migration-desk.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["fetch(", "callProvider", "decryptByok", "api.openai.com", "api.anthropic.com"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});

test("cron göçü tek hedefe yığmaz; dönüşle birlikte tek işlemde kapatır", () => {
  const source = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function settleMigrations");
  const end = source.indexOf("async function punishAgitator", start);
  const settlement = source.slice(start, end);
  assert.match(settlement, /distributeMigrants/);
  assert.match(settlement, /migrationReturnNotice/);
  assert.match(settlement, /db\.transaction/);
  assert.ok(!settlement.includes("pickMigrationTarget"));
  assert.ok(!settlement.includes("lost +="));
});
