import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MIGRATION, arrivingMigrants, migrationArrivalNotice, migrationTravelMs, pickMigrationTarget,
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

// --- Hedef seçimi: kapasite ve çekicilik -----------------------------------

test("kapasitesi dolu ya da aşmış aday hiç seçilmez", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "a", population: 400, capacity: 400, popularity: 80 }, // tam dolu
    { userId: "b", population: 450, capacity: 400, popularity: 80 }, // aşmış
    { userId: "c", population: 100, capacity: 400, popularity: 10 }, // tek açık aday
  ];
  const pick = pickMigrationTarget(candidates, "sabit-tohum");
  assert.equal(pick?.userId, "c");
  assert.equal(pick?.room, 300);
});

test("aday yoksa ya da hiçbirinde boş konut yoksa null döner", () => {
  assert.equal(pickMigrationTarget([], "x"), null);
  assert.equal(pickMigrationTarget([{ userId: "a", population: 400, capacity: 400, popularity: 90 }], "x"), null);
});

test("rızası dibe vurmuş bir krallık da (taban çekicilikle) göçmen çekebilir", () => {
  // Tek aday: rızası 0 olsa bile ATTRACTIVENESS_FLOOR sayesinde seçilir —
  // göçmenler zaten bir yerden kaçıyor, mutlak mükemmeli değil eldeki en az
  // kötüyü arıyorlar.
  const pick = pickMigrationTarget([{ userId: "isyanci", population: 50, capacity: 200, popularity: 0 }], "tohum");
  assert.equal(pick?.userId, "isyanci");
});

test("yüksek rızalı ve boş konutu bol aday, çoğunlukla daha çok seçilir", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "mutlu", population: 100, capacity: 400, popularity: 90 },
    { userId: "kaynayan", population: 100, capacity: 400, popularity: 5 },
  ];
  let mutluSecildi = 0;
  const samples = 500;
  for (let i = 0; i < samples; i += 1) {
    const pick = pickMigrationTarget(candidates, `göç-${i}`);
    if (pick?.userId === "mutlu") mutluSecildi += 1;
  }
  // Rıza yalnızca ince ayardır, veto değildir: mutlu krallık ÇOĞUNLUKLA
  // seçilir ama kaynayan krallık da payını alır (taban çekicilik).
  assert.ok(mutluSecildi > samples * 0.6, `mutlu ${mutluSecildi}/${samples}`);
  assert.ok(mutluSecildi < samples, "kaynıyan krallık da bazen seçilmeli");
});

test("aynı tohum hep aynı hedefi seçer: save-scum işe yaramaz", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "a", population: 100, capacity: 400, popularity: 60 },
    { userId: "b", population: 50, capacity: 300, popularity: 40 },
  ];
  const first = pickMigrationTarget(candidates, "olay-42");
  const second = pickMigrationTarget(candidates, "olay-42");
  assert.deepEqual(first, second);
});

test("aday sırası (DB'den dönüş sırası) sonucu değiştirmez: userId'ye göre sabitlenir", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "z-krallik", population: 100, capacity: 400, popularity: 60 },
    { userId: "a-krallik", population: 50, capacity: 300, popularity: 40 },
  ];
  const forward = pickMigrationTarget(candidates, "olay-7");
  const backward = pickMigrationTarget([...candidates].reverse(), "olay-7");
  assert.deepEqual(forward, backward);
});

// --- Varan göçmen sayısı: kapasite tavanı ------------------------------

test("varan göçmen sayısı boş konuttan fazla olamaz", () => {
  assert.equal(arrivingMigrants(50, 20), 20);
  assert.equal(arrivingMigrants(5, 20), 5);
  assert.equal(arrivingMigrants(-5, 20), 0);
  assert.equal(arrivingMigrants(10, 0), 0);
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
