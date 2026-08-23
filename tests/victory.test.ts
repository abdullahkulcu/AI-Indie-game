import assert from "node:assert/strict";
import test from "node:test";
import { STARTING_REPUTATION } from "../engine/founding";
import { VICTORY, victoryDoctrine, victoryScore, type VictoryPurse } from "../engine/victory";
import { COMPARE_MIN_SAMPLE } from "../engine/comparison";
import { channelVictoryStanding } from "../server/world-projection";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;
const DAY = 86_400_000;

/** Skorun okuduğu alanların hepsi nötr; her test yalnızca ilgilendiği alanı bozar. */
const neutral = {
  reputation: STARTING_REPUTATION, peopleJoined: 0, peopleLeft: 0, raidsRepelled: 0, raidsSuffered: 0,
};

const score = (input: Partial<{ purses: VictoryPurse[]; caughtPurses: number; game: typeof neutral }> = {}) =>
  victoryScore({
    purses: input.purses ?? [],
    caughtPurses: input.caughtPurses ?? 0,
    game: { ...neutral, ...(input.game ?? {}) },
  });

const line = (result: ReturnType<typeof score>, id: string) => {
  const found = result.lines.find(entry => entry.id === id);
  assert.ok(found, `${id} satırı yok`);
  return found!;
};

// --- İki sütun ayrı hesaplanır ---------------------------------------------

test("boş defterde her iki sütun da sıfırdır", () => {
  const result = score();
  assert.equal(result.quiet, 0);
  assert.equal(result.martial, 0);
  assert.equal(result.total, 0);
  assert.equal(result.doctrine.id, "idle");
});

test("askersiz katkı yalnızca sessiz sütunu, akın yalnızca askeri sütunu büyütür", () => {
  const quietOnly = score({ purses: [{ target: "b", status: "settled" }] });
  assert.equal(quietOnly.quiet, VICTORY.silentPurse);
  assert.equal(quietOnly.martial, 0, "kese askeri sütuna yazılmamalı");

  const martialOnly = score({ game: { ...neutral, raidsRepelled: 4 } });
  assert.equal(martialOnly.martial, 4 * VICTORY.raidRepelled);
  assert.equal(martialOnly.quiet, 0, "püskürtülen akın sessiz sütuna yazılmamalı");
  assert.equal(martialOnly.total, martialOnly.quiet + martialOnly.martial);
});

test("her satır tek bir sütuna aittir ve sütun toplamı satırların toplamıdır", () => {
  const result = score({
    purses: [{ target: "b", status: "settled" }, { target: "c", status: "exposed" }],
    caughtPurses: 2,
    game: { ...neutral, reputation: 70, peopleJoined: 80, peopleLeft: 20, raidsRepelled: 3, raidsSuffered: 1 },
  });
  for (const column of ["quiet", "martial"] as const) {
    const sum = result.lines.filter(entry => entry.column === column).reduce((total, entry) => total + entry.points, 0);
    assert.equal(column === "quiet" ? result.quiet : result.martial, sum, `${column} sütunu satırlara toplanmıyor`);
  }
  assert.equal(result.total, result.quiet + result.martial);
});

// --- Kese defteri -----------------------------------------------------------

test("kaderi belli olmayan (pending) kese hiç sayılmaz", () => {
  // Motora `pending` satır GEÇMEZ (tip bunu yasaklar, süzgeç sunucudadır);
  // burada sınanan şey, sayımın yalnızca verilen satırlardan çıktığı.
  assert.equal(line(score(), "silent_purses").points, 0);
  assert.equal(line(score(), "exposed_purses").points, 0);
});

test("ifşa olan kese ceza yazar ama sessiz keseyi silmez", () => {
  const result = score({ purses: [{ target: "b", status: "settled" }, { target: "b", status: "exposed" }] });
  assert.equal(line(result, "silent_purses").points, VICTORY.silentPurse);
  assert.equal(line(result, "exposed_purses").points, VICTORY.exposedPurse);
  assert.equal(result.quiet, VICTORY.silentPurse + VICTORY.exposedPurse);
});

test("İSTİSMAR: tek hedefe kese yağdırmak tavana çarpar, hedef çeşitlendirmek çarpmaz", () => {
  const oneTarget = Array.from({ length: 20 }, () => ({ target: "kurban", status: "settled" as const }));
  const capped = score({ purses: oneTarget });
  assert.equal(line(capped, "silent_purses").points, VICTORY.purseCapPerTarget * VICTORY.silentPurse);

  const spread = Array.from({ length: 20 }, (_, index) => ({ target: `sancak-${index}`, status: "settled" as const }));
  const wide = score({ purses: spread });
  assert.equal(line(wide, "silent_purses").points, 20 * VICTORY.silentPurse);
  assert.ok(wide.quiet > capped.quiet, "yirmi sancağa dokunmak tek sancağı sondalamaktan değerli olmalı");
});

test("tavan CEZAYA uygulanmaz: aynı hedefte yakalanan her kese bedelini öder", () => {
  const purses = Array.from({ length: 9 }, () => ({ target: "kurban", status: "exposed" as const }));
  assert.equal(line(score({ purses }), "exposed_purses").points, 9 * VICTORY.exposedPurse);
});

test("karşı-istihbaratın yakaladığı yabancı kese sessiz sütuna yazılır", () => {
  const result = score({ caughtPurses: 3 });
  assert.equal(line(result, "counter_intel").points, 3 * VICTORY.caughtPurse);
  assert.equal(result.martial, 0);
});

test("İSTİSMAR: danışıklı ifşa (biri gönderir, öteki yakalar) çifte puan kazandırmaz", () => {
  // Gönderen yakalanınca `caught_agitating` cezasıyla itibarı 10 puan düşer
  // (bkz. engine/diplomacy.ts); iki tarafın toplamı düşmek ZORUNDA.
  const before = score().total + score().total;
  const sender = score({
    purses: [{ target: "dost", status: "exposed" }],
    game: { ...neutral, reputation: STARTING_REPUTATION - 10 },
  });
  const catcher = score({ caughtPurses: 1 });
  assert.ok(sender.total + catcher.total < before,
    `danışıklı dövüş çifte kâr getirmemeli (önce ${before}, sonra ${sender.total + catcher.total})`);
});

// --- Nüfus defteri: istismar freni -----------------------------------------

test("İSTİSMAR: halkı göçe zorlayıp geri toplamak (çevrim) puan getirmez", () => {
  // Rızayı düşürüp yükselten Kralın defterinin İKİ tarafı da büyür; net sıfır.
  const churn = score({ game: { ...neutral, peopleJoined: 900, peopleLeft: 900 } });
  assert.equal(line(churn, "settlers").points, 0);
  assert.equal(churn.quiet, 0, "çevrim sessiz sütunu hiç büyütmemeli");

  // Aynı sayıda insanı gerçekten TUTAN krallık puan alır.
  const real = score({ game: { ...neutral, peopleJoined: 900, peopleLeft: 0 } });
  assert.equal(line(real, "settlers").points, Math.round(900 * VICTORY.netSettler));
  assert.ok(real.quiet > churn.quiet);
});

test("halkını kaybetmek sessiz savaşı kaybetmektir: net eksi puan eksiye yazılır", () => {
  const bleeding = score({ game: { ...neutral, peopleJoined: 20, peopleLeft: 120 } });
  assert.equal(line(bleeding, "settlers").points, Math.round(-100 * VICTORY.netSettler));
  assert.ok(bleeding.quiet < 0);
});

// --- İtibar ----------------------------------------------------------------

test("itibar kuruluş değerinde puan getirmez; sapma iki yöne de çalışır", () => {
  assert.equal(line(score(), "reputation").points, 0);
  assert.equal(line(score({ game: { ...neutral, reputation: 80 } }), "reputation").points,
    Math.round(30 * VICTORY.reputationPerPoint));
  assert.equal(line(score({ game: { ...neutral, reputation: 20 } }), "reputation").points,
    Math.round(-30 * VICTORY.reputationPerPoint));
});

// --- Sınır durumları -------------------------------------------------------

test("hiç kese ve hiç akın yoksa yalnızca defter ve itibar konuşur", () => {
  const result = score({ game: { ...neutral, reputation: 60, peopleJoined: 40, peopleLeft: 0 } });
  assert.equal(line(result, "silent_purses").points, 0);
  assert.equal(line(result, "exposed_purses").points, 0);
  assert.equal(line(result, "counter_intel").points, 0);
  assert.equal(result.martial, 0);
  assert.equal(result.quiet, Math.round(40 * VICTORY.netSettler) + Math.round(10 * VICTORY.reputationPerPoint));
});

test("eksik ve bozuk alanlar skoru çökertmez", () => {
  const bare = victoryScore({ purses: [], caughtPurses: 0, game: { reputation: STARTING_REPUTATION } });
  assert.equal(bare.total, 0);
  const junk = victoryScore({
    purses: [], caughtPurses: Number.NaN,
    game: { reputation: Number.NaN, peopleJoined: -5, peopleLeft: Number.NaN, raidsRepelled: -3, raidsSuffered: undefined },
  });
  assert.equal(junk.total, 0);
  assert.ok(Number.isFinite(junk.quiet) && Number.isFinite(junk.martial));
});

// --- Doktrin okunuşu -------------------------------------------------------

test("doktrin etiketi sütunların ağırlığını okur", () => {
  assert.equal(victoryDoctrine(0, 0).id, "idle");
  assert.equal(victoryDoctrine(60, 10).id, "silent");
  assert.equal(victoryDoctrine(60, -10).id, "silent", "askeri sütun eksideyken sessiz üstünlük sayılır");
  assert.equal(victoryDoctrine(10, 60).id, "steel");
  assert.equal(victoryDoctrine(40, 30).id, "mixed");
  assert.equal(victoryDoctrine(-20, -5).id, "idle");
});

// --- Sunucu tarafı: sıralama ve gizlilik -----------------------------------

function saveOf(overrides: Partial<Game> = {}) {
  const game: Game = {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0 - 10 * DAY, lastTickAt: T0, protectionEndsAt: T0 - 6 * DAY,
    resources: { gold: 1000, food: 1000, stone: 100, wood: 100, iron: 50, ale: 50 },
    population: 100, capacity: 300, popularity: 50, reputation: STARTING_REPUTATION, loyalty: 75,
    taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
  return JSON.stringify(game);
}

const rowsOf = (ids: string[], overrides: Record<string, Partial<Game>> = {}) =>
  ids.map(id => ({ userId: id, gameState: saveOf(overrides[id] ?? {}) }));

test("kendi kese defterimiz iner, komşuların defteri inmez", () => {
  const standing = channelVictoryStanding({
    channelName: "Standart Sezon I", userId: "kral", now: T0,
    rows: rowsOf(["kral", "a", "b", "c"]),
    purses: [
      { sourceUserId: "kral", targetUserId: "a", status: "settled" },
      { sourceUserId: "a", targetUserId: "b", status: "settled" },
      { sourceUserId: "b", targetUserId: "kral", status: "exposed" },
    ],
  });
  assert.deepEqual(standing.purses, [{ target: "a", status: "settled" }]);
  assert.equal(standing.caught, 1, "bize gelip yakalanan kese karşı-istihbarat hanemize yazılır");
  // Çıktıda komşuya ait tek bir sayı bile bulunmasın.
  assert.deepEqual(Object.keys(standing).sort(), ["caught", "ranked", "rank", "purses"].sort());
});

test("gizlilik alt sınırı: yeterli sancak yoksa sıra hiç üretilmez", () => {
  const few = channelVictoryStanding({
    channelName: "Standart Sezon I", userId: "kral", now: T0,
    rows: rowsOf(["kral", "a", "b"]), purses: [],
  });
  assert.equal(few.rank, null, `bizden başka ${COMPARE_MIN_SAMPLE} sancak olmadan sıra verilmez`);

  const enough = channelVictoryStanding({
    channelName: "Standart Sezon I", userId: "kral", now: T0,
    rows: rowsOf(["kral", "a", "b", "c"]), purses: [],
  });
  assert.equal(enough.ranked, 4);
  assert.equal(enough.rank, 1, "hepsi eşit skorda: paylaşılan birincilik");
});

test("kuruluş koruması süren sancak sıralamaya girmez", () => {
  const standing = channelVictoryStanding({
    channelName: "Standart Sezon I", userId: "kral", now: T0,
    rows: rowsOf(["kral", "a", "b", "c", "yeni"], { yeni: { protectionEndsAt: T0 + DAY } }),
    purses: [],
  });
  assert.equal(standing.ranked, 4, "korumalı sancak sayılmamalı");

  // Korumamız sürerken sıralamada YOKUZ; sıra da verilmez.
  const shielded = channelVictoryStanding({
    channelName: "Standart Sezon I", userId: "kral", now: T0,
    rows: rowsOf(["kral", "a", "b", "c"], { kral: { protectionEndsAt: T0 + DAY } }),
    purses: [],
  });
  assert.equal(shielded.rank, null);
});

test("sıra skora göre kurulur ve başka channel'ın kaydı karışmaz", () => {
  const standing = channelVictoryStanding({
    channelName: "Standart Sezon I", userId: "kral", now: T0,
    rows: rowsOf(["kral", "a", "b", "c", "yabanci"], {
      a: { raidsRepelled: 100 },
      b: { peopleJoined: 400 },
      yabanci: { channel: "Başka Sezon", peopleJoined: 100_000 },
    }),
    purses: [],
  });
  assert.equal(standing.ranked, 4, "başka channel'ın kaydı sayılmamalı");
  assert.equal(standing.rank, 3, "iki sancak bizden yukarıda");
});
