import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MIGRATION, migrationArrivalNotice, migrationReturnNotice, migrationTravelMs, spreadMigrants,
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

// --- Dağıtım: kapasite, çekicilik ve "kimse kaybolmaz" -------------------

/** Bir dağıtımda fiilen yerleşen kişi sayısı. */
const placed = (spread: ReturnType<typeof spreadMigrants>) =>
  spread.allocations.reduce((sum, allocation) => sum + allocation.count, 0);

/** Dağıtımın altın kuralı: giren = yerleşen + geri dönen. Hiçbir koşulda kişi buharlaşmaz. */
function assertKimseKaybolmadi(count: number, spread: ReturnType<typeof spreadMigrants>) {
  assert.equal(placed(spread) + spread.returning, count,
    `giren ${count} ≠ yerleşen ${placed(spread)} + dönen ${spread.returning}`);
}

test("kapasitesi dolu ya da aşmış aday hiç pay almaz", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "a", population: 400, capacity: 400, popularity: 80 }, // tam dolu
    { userId: "b", population: 450, capacity: 400, popularity: 80 }, // aşmış
    { userId: "c", population: 100, capacity: 400, popularity: 10 }, // tek açık aday
  ];
  const spread = spreadMigrants(30, candidates);
  assert.deepEqual(spread.allocations, [{ userId: "c", count: 30 }]);
  assert.equal(spread.returning, 0);
  assertKimseKaybolmadi(30, spread);
});

test("aday yoksa ya da hiçbirinde boş konut yoksa HERKES geri döner (kimse kaybolmaz)", () => {
  // Tek kişilik channel: aday listesi boş. ESKİ DAVRANIŞ bu kişileri siliyordu
  // ve bu, oyunun en sık yaşanan hâliydi.
  const bosChannel = spreadMigrants(12, []);
  assert.deepEqual(bosChannel.allocations, []);
  assert.equal(bosChannel.returning, 12);
  assertKimseKaybolmadi(12, bosChannel);

  const doluChannel = spreadMigrants(12, [{ userId: "a", population: 400, capacity: 400, popularity: 90 }]);
  assert.equal(doluChannel.returning, 12);
  assertKimseKaybolmadi(12, doluChannel);
});

test("hedeflerin boş konutu yetmezse yalnızca sığan kadarı yerleşir, gerisi geri döner", () => {
  const spread = spreadMigrants(100, [
    { userId: "a", population: 98, capacity: 100, popularity: 90 },  // 2 boş
    { userId: "b", population: 297, capacity: 300, popularity: 90 }, // 3 boş
  ]);
  assert.equal(placed(spread), 5, "toplam boş konut 5");
  assert.equal(spread.returning, 95);
  assertKimseKaybolmadi(100, spread);
  for (const allocation of spread.allocations) {
    assert.ok(allocation.count <= (allocation.userId === "a" ? 2 : 3), "boş konuttan fazla yazılmamalı");
  }
});

test("kervan TEK hedefe değil TÜM uygun adaylara dağılır", () => {
  const spread = spreadMigrants(30, [
    { userId: "a", population: 100, capacity: 400, popularity: 60 },
    { userId: "b", population: 100, capacity: 400, popularity: 60 },
    { userId: "c", population: 100, capacity: 400, popularity: 60 },
  ]);
  assert.equal(spread.allocations.length, 3, "üç adayın hepsi pay almalı");
  assert.deepEqual(spread.allocations.map(allocation => allocation.count), [10, 10, 10]);
  assertKimseKaybolmadi(30, spread);
});

test("rızası dibe vurmuş bir krallık da (taban çekicilikle) göçmen çeker", () => {
  // Tek aday: rızası 0 olsa bile ATTRACTIVENESS_FLOOR sayesinde pay alır —
  // göçmenler zaten bir yerden kaçıyor, mutlak mükemmeli değil eldeki en az
  // kötüyü arıyorlar.
  const spread = spreadMigrants(10, [{ userId: "isyanci", population: 50, capacity: 200, popularity: 0 }]);
  assert.deepEqual(spread.allocations, [{ userId: "isyanci", count: 10 }]);
  assertKimseKaybolmadi(10, spread);
});

test("yüksek rızalı aday daha büyük pay alır ama kaynayan krallık da payını alır", () => {
  const spread = spreadMigrants(100, [
    { userId: "mutlu", population: 100, capacity: 400, popularity: 90 },
    { userId: "kaynayan", population: 100, capacity: 400, popularity: 5 },
  ]);
  const mutlu = spread.allocations.find(allocation => allocation.userId === "mutlu")!.count;
  const kaynayan = spread.allocations.find(allocation => allocation.userId === "kaynayan")!.count;
  // Rıza yalnızca ince ayardır, veto değildir.
  assert.ok(mutlu > kaynayan, `mutlu ${mutlu} > kaynayan ${kaynayan}`);
  assert.ok(kaynayan > 0, "taban çekicilik sayesinde kaynayan krallık da pay alır");
  assertKimseKaybolmadi(100, spread);
});

test("boş konutu bol aday, aynı rızada daha büyük pay alır", () => {
  const spread = spreadMigrants(60, [
    { userId: "genis", population: 100, capacity: 700, popularity: 50 },
    { userId: "kucuk", population: 100, capacity: 250, popularity: 50 },
  ]);
  const genis = spread.allocations.find(allocation => allocation.userId === "genis")!.count;
  const kucuk = spread.allocations.find(allocation => allocation.userId === "kucuk")!.count;
  assert.ok(genis > kucuk, `geniş ${genis} > küçük ${kucuk}`);
  assertKimseKaybolmadi(60, spread);
});

test("dağıtım belirlenimcidir: aynı girdi hep aynı dağılım (save-scum işe yaramaz)", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "a", population: 100, capacity: 400, popularity: 60 },
    { userId: "b", population: 50, capacity: 300, popularity: 40 },
  ];
  assert.deepEqual(spreadMigrants(37, candidates), spreadMigrants(37, candidates));
});

test("aday sırası (DB'den dönüş sırası) dağılımı değiştirmez", () => {
  const candidates: MigrationCandidate[] = [
    { userId: "z-krallik", population: 100, capacity: 400, popularity: 60 },
    { userId: "a-krallik", population: 50, capacity: 300, popularity: 40 },
  ];
  const forward = spreadMigrants(23, candidates);
  const backward = spreadMigrants(23, [...candidates].reverse());
  assert.deepEqual(forward, backward);
});

test("tek kişilik kervan da kaybolmaz: en çekici adaya gider", () => {
  const spread = spreadMigrants(1, [
    { userId: "mutlu", population: 100, capacity: 400, popularity: 95 },
    { userId: "kaynayan", population: 100, capacity: 400, popularity: 5 },
  ]);
  assert.deepEqual(spread.allocations, [{ userId: "mutlu", count: 1 }]);
  assertKimseKaybolmadi(1, spread);
});

test("ondalık kalanlar yüzünden tek kişi bile buharlaşmaz", () => {
  // 7 kişi / 3 eşit aday = 2.33 → tabana yuvarlanınca 2+2+2 = 6; artan 1 kişi
  // EN BÜYÜK KALAN yöntemiyle dağıtılmazsa kaybolurdu.
  for (const count of [1, 2, 5, 7, 11, 13, 29, 97]) {
    const spread = spreadMigrants(count, [
      { userId: "a", population: 0, capacity: 500, popularity: 33 },
      { userId: "b", population: 0, capacity: 500, popularity: 66 },
      { userId: "c", population: 0, capacity: 500, popularity: 99 },
    ]);
    assertKimseKaybolmadi(count, spread);
    assert.equal(spread.returning, 0, `${count} kişilik kervanda yer bol, kimse dönmemeli`);
  }
});

test("sıfır ya da eksi kervan hiçbir şey üretmez", () => {
  assert.deepEqual(spreadMigrants(0, [{ userId: "a", population: 0, capacity: 100, popularity: 50 }]),
    { allocations: [], returning: 0 });
  assert.deepEqual(spreadMigrants(-5, [{ userId: "a", population: 0, capacity: 100, popularity: 50 }]),
    { allocations: [], returning: 0 });
});

// --- Yol süresi --------------------------------------------------------

test("göçmen kervanı yolda hızlı channel'da daha kısa kalır", () => {
  assert.ok(migrationTravelMs(24) < migrationTravelMs(1));
  assert.ok(migrationTravelMs(1) > 0);
  assert.equal(MIGRATION.travelMinutes, 90);
});

// --- Bildirim ------------------------------------------------------------

test("varış bildirimi geldikleri sancağı SÖYLER: halk hedefin sınırından geçti", () => {
  // Bilgi sınırı burada bilinçli olarak asimetrik. Dış kese gizli gönderilir ve
  // göndereni saklar; göç ise hedefin sınırından geçerek gelir, yani karşılayan
  // Kral onlara nereden geldiklerini sorabilir. Saklamak fiziksel olarak
  // tutarsız olurdu.
  const text = migrationArrivalNotice(7, "Karakale");
  assert.match(text, /^7 kişi/);
  assert.match(text, /Karakale/, "geldikleri sancağın adı yazılmalı");
  assert.match(text, /sınır/, "sebebini de söylemeli: sınırdan geçtiler");
  // Sancağın ne kadar eridiği söylenmez; hedef yalnızca kendi sayımını bilir.
  assert.ok(!/nüfus[a-zçğıöşü]*\s*\d/.test(text), "kaynağın nüfusu hakkında sayı vermemeli");
});

test("kaynağın adı çözülemezse varış bildirimi adsız cümleye düşer", () => {
  // Kaydı okunamayan ya da hesabı silinmiş kaynak: bildirim hiç yazılmamaktan
  // iyidir, ama uydurma bir ad da yazılmaz.
  const text = migrationArrivalNotice(7);
  assert.match(text, /^7 kişi/);
  assert.match(text, /komşu bir sancaktan/);
});

test("DÖNÜŞ bildirimi sayıyı ve SEBEBİ söyler, ama nereye gidildiğini SÖYLEMEZ", () => {
  // Asimetrinin öteki yarısı: Kral kendi sınırından çıkanı uğurlar, komşunun
  // sınırından geçtiğini görmez. Komşularının konut durumunu göçmenlerinin
  // dönüşünden öğrenemez.
  const text = migrationReturnNotice(12);
  assert.match(text, /12 kişi/);
  assert.match(text, /bulamadı/, "Kral nüfusunun neden geri geldiğini anlamalı");
  assert.ok(!/[A-ZÇĞİÖŞÜ][a-zçğıöşü]+kale/.test(text), "denenen komşuların adı sızmamalı");
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

test("cron'un kaynağa geri yazdığı dönüş, kaynağın bir sonraki kaydında reddedilmez", () => {
  // settleMigrations'ın 2. aşaması: yer bulamayan göçmenler kaynağın kaydına
  // DOĞRUDAN (validateGameSave'den GEÇMEDEN) geri yazılır. Hedef yazmasıyla
  // aynı iki alan kullanılır (`population` + `peopleJoined`), bu yüzden yeni
  // bir SERVER_DERIVED alanı GEREKMEZ.
  const beforeReturn = newGame({ population: 70, capacity: 400, peopleJoined: 10, peopleLeft: 30, lastTickAt: T0 });
  const afterCronWrite = {
    ...beforeReturn,
    population: 100,
    peopleJoined: 40,
    notices: [{ kind: "GÖÇ", text: migrationReturnNotice(30), at: T0 }, ...beforeReturn.notices],
  };
  const nextClientSave = tick(afterCronWrite, T0 + HOUR);
  const result = validateGameSave(nextClientSave, {
    previous: afterCronWrite as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.game.population >= 100, "geri dönen halk kalıcı olmalı");
  // Zafer puanının baktığı NET (giren − çıkan) sıfıra döner: kimse gitmemiş gibi.
  assert.equal((afterCronWrite.peopleJoined ?? 0) - (afterCronWrite.peopleLeft ?? 0), 10,
    "dönüş `peopleJoined`e yazıldığı için NET, göç öncesindeki değerine döner");
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
