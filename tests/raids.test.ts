import assert from "node:assert/strict";
import test from "node:test";
import { applyActions } from "../engine/actions";
import { suppression } from "../engine/populace";
import {
  DEFAULT_WATCH_RATIO, defenseOf, offWatchStrength, raidCatalog, raidInWindow,
  RAID_WINDOW_HOURS, resolveRaids, watchRatioOf, windowStart,
} from "../engine/raids";
import { rates, tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { validateGameSave } from "../server/save-validation";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const WINDOW = RAID_WINDOW_HOURS * HOUR;

/** Koruma süresi bitmiş bir krallık; akınlar ancak koruma bittikten sonra gelir. */
function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
      { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 1 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

/** Bir günlük pencereleri tarayıp gerçekten akın çıkan ilkini bulur. */
function firstRaidWindow(game: Game, limit = 240) {
  for (let index = 0; index <= limit; index += 1) {
    const planned = raidInWindow(game, index);
    if (planned) return { index, planned };
  }
  throw new Error("bu tohumda akın bulunamadı");
}

test("eski kayıtlarda nöbet varsayılanı uygulanır", () => {
  assert.equal(watchRatioOf(newGame()), DEFAULT_WATCH_RATIO);
  assert.equal(watchRatioOf(newGame({ watchRatio: 0 })), 0);
  assert.equal(watchRatioOf(newGame({ watchRatio: 999 })), 100);
});

test("akın planı deterministiktir: aynı girdi aynı akını verir", () => {
  const game = newGame();
  const { index, planned } = firstRaidWindow(game);
  for (let repeat = 0; repeat < 5; repeat += 1) {
    const again = raidInWindow(newGame(), index);
    assert.deepEqual(again, planned, "aynı krallık aynı pencerede aynı akını yaşamalı");
  }
  assert.ok(planned.threat > 0);
  assert.ok(Object.keys(raidCatalog).includes(planned.kind));
});

test("aynı zamanda farklı krallık farklı akın takvimi yaşar", () => {
  const mine = Array.from({ length: 120 }, (_, index) => raidInWindow(newGame(), index)?.kind ?? "-").join("");
  const other = Array.from({ length: 120 }, (_, index) => raidInWindow(newGame({ kingdomName: "Akçakale" }), index)?.kind ?? "-").join("");
  assert.notEqual(mine, other, "tohum krallığa bağlı olmalı");
});

test("tick determinizmi: aynı kayıt iki kez işlenirse aynı sonucu verir", () => {
  const game = newGame({ units: { spearman: 4 }, watchRatio: 0 });
  const first = tick(game, T0 + 24 * HOUR);
  const second = tick(game, T0 + 24 * HOUR);
  assert.deepEqual(first.resources, second.resources);
  assert.deepEqual(first.units, second.units);
  assert.deepEqual(first.notices, second.notices);
});

test("koruma süresi akınları engellemez; krallık ilk günden akına açıktır", () => {
  // Koruma yalnızca diğer krallıklara karşıdır. Dağdaki kurt da haydut da
  // fermanı tanımaz; yeni kurulan kale de vurulabilir.
  const protectedGame = newGame({ protectionEndsAt: T0 + 4 * 86_400_000 });
  let raids = 0;
  for (let index = 0; index <= 24; index += 1) if (raidInWindow(protectedGame, index)) raids += 1;
  assert.ok(raids > 0, "koruma altındaki kaleye de akın gelebilmeli");
});

test("korumalı ve korumasız krallık aynı akın takvimini görür", () => {
  const shielded = newGame({ protectionEndsAt: T0 + 4 * 86_400_000 });
  const exposed = newGame({ protectionEndsAt: T0 });
  for (let index = 0; index <= 24; index += 1) {
    assert.deepEqual(raidInWindow(shielded, index), raidInWindow(exposed, index));
  }
});

test("dağ arazisi ova arazisinden daha çok akın görür", () => {
  const count = (game: Game) => {
    let total = 0;
    for (let index = 0; index <= 600; index += 1) if (raidInWindow(game, index)) total += 1;
    return total;
  };
  assert.ok(count(newGame({ terrain: "mountain" })) > count(newGame({ terrain: "plain" })), "dağ eteği daha tehlikeli olmalı");
});

test("akın şiddeti krallığın gelişmişliğiyle büyür", () => {
  const small = newGame();
  const grown = newGame({ buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 4 }] });
  const { index } = firstRaidWindow(small);
  const weak = raidInWindow(small, index)!;
  const strong = raidInWindow(grown, index)!;
  assert.equal(weak.kind, strong.kind, "tür aynı tohumdan gelmeli");
  assert.ok(strong.threat > weak.threat * 1.5, "büyüyen krallık daha ağır akın görmeli");
});

test("nöbetsiz krallık ağır kayıp verir, nöbetteki ordu akını püskürtür", () => {
  const army = { spearman: 30 };
  const undefended = newGame({ units: army, watchRatio: 0 });
  const guarded = newGame({ units: army, watchRatio: 100 });
  const { planned } = firstRaidWindow(undefended);

  const open = resolveRaids(undefended, planned.at - 1, planned.at, undefended.resources);
  const held = resolveRaids(guarded, planned.at - 1, planned.at, guarded.resources);

  assert.equal(open.events.length, 1);
  assert.equal(held.events.length, 1);
  assert.equal(open.events[0].repelled, false, "nöbetsiz kale yarılmalı");
  assert.equal(held.events[0].repelled, true, "nöbetteki 30 asker bu akını karşılamalı");
  assert.ok(open.soldiersLost > 0, "yarılan savunma asker kaybettirir");
  assert.equal(held.soldiersLost, 0);
});

test("sur ve arazi savunmayı güçlendirir", () => {
  const base = newGame({ units: { spearman: 20 }, watchRatio: 60 });
  const walled = newGame({
    units: { spearman: 20 }, watchRatio: 60,
    buildings: [...base.buildings, { type: "wall", name: "Sur", category: "Askerî", level: 3 }],
  });
  const mountain = newGame({ units: { spearman: 20 }, watchRatio: 60, terrain: "mountain" });
  assert.ok(defenseOf(walled).power > defenseOf(base).power * 1.5, "sur savunmayı belirgin artırmalı");
  assert.ok(defenseOf(mountain).power > defenseOf(base).power, "dağ arazisi savunmaya yardım etmeli");
  assert.equal(defenseOf(base).watchers, 12, "20 askerin %60'ı nöbette olmalı");
});

test("isyankâr asker nöbette bile savunmaz", () => {
  const loyal = newGame({ units: { spearman: 30 }, watchRatio: 100, soldierUnrest: 0 });
  const mutinous = newGame({ units: { spearman: 30 }, watchRatio: 100, soldierUnrest: 90 });
  assert.equal(defenseOf(mutinous).power, 0, "isyan etmiş ordu kaleyi savunmaz");
  assert.ok(defenseOf(loyal).power > 0);

  const { planned } = firstRaidWindow(loyal);
  const outcome = resolveRaids(mutinous, planned.at - 1, planned.at, mutinous.resources);
  assert.equal(outcome.events[0].repelled, false, "maaşsız ordu akını karşılamaz");
});

test("akın kaynak çalar ve asker öldürür", () => {
  const game = newGame({ units: { spearman: 20 }, watchRatio: 0 });
  const { planned } = firstRaidWindow(game);
  const entry = raidCatalog[planned.kind];
  const before = tick(game, planned.at - 1);
  const after = tick(before, planned.at + 1);

  if (entry.goldGreed > 0) assert.ok(after.resources.gold < before.resources.gold, "haydutlar hazineden götürmeli");
  if (entry.foodGreed > 0) assert.ok(after.resources.food < before.resources.food + rates(before).food, "ambar yağmalanmalı");
  assert.ok(after.units.spearman < 20, "yarılan savunma asker kaybettirir");
  assert.ok(after.popularity < before.popularity, "yağmalanan halkın rızası düşer");
});

test("çalınan miktar stoktan fazla olamaz", () => {
  const broke = newGame({ units: { spearman: 0 }, watchRatio: 0, resources: { gold: 3, food: 2, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const { planned } = firstRaidWindow(broke);
  const outcome = resolveRaids(broke, planned.at - 1, planned.at, broke.resources);
  assert.ok(outcome.goldStolen <= 3);
  assert.ok(outcome.foodStolen <= 2);
});

test("akın deftere AKIN bildirimi düşürür ve ne kaybedildiğini yazar", () => {
  const game = newGame({ units: { spearman: 10 }, watchRatio: 0 });
  const { planned } = firstRaidWindow(game);
  const after = tick(tick(game, planned.at - 1), planned.at + 1);
  const raidNotices = after.notices.filter(notice => notice.kind === "AKIN");
  assert.equal(raidNotices.length, 1, "Kral akından haberdar edilmeli");
  assert.match(raidNotices[0].text, /yağmalandı|çalındı|asker öldü|püskürttü/, "bildirim kaybı rakamıyla anlatmalı");
  assert.match(raidNotices[0].text, new RegExp(planned.label), "hangi akının geldiği yazmalı");
});

test("akın sayaçları birikir", () => {
  const game = newGame({ units: { spearman: 10 }, watchRatio: 40 });
  const { planned } = firstRaidWindow(game);
  const after = tick(tick(game, planned.at - 1), planned.at + 1);
  assert.equal((after.raidsRepelled ?? 0) + (after.raidsSuffered ?? 0), 1);
  assert.equal(after.lastRaidAt, planned.at);
});

test("nöbetteki asker huzursuzluğu bastırmaya daha az kalır", () => {
  const army = 30, population = 100;
  const resting = suppression(offWatchStrength(army, 0), population, 0);
  const guarding = suppression(offWatchStrength(army, 100), population, 0);
  assert.ok(guarding < resting, "nöbetin bir bedeli olmalı");
  assert.ok(guarding > 0, "nöbetteki ordu tamamen kaybolmamalı");

  // Aynı ordu, aynı halk: nöbet arttıkça zapt zayıflar ve krallık iş bırakma
  // eşiğinin altına düşer. Kralın ödediği bedel tam olarak budur.
  const calm = newGame({ units: { spearman: 30 }, popularity: 12, watchRatio: 0 });
  const stretched = { ...calm, watchRatio: 100 };
  assert.ok(rates(stretched).wood < rates(calm).wood * 0.6, "tam nöbet üretimi düşürmeli");
});

test("pencere sınırları mutlak zamana oturur: küçük adımlar tek adımla aynı sonucu verir", () => {
  // İstemci saniyelik adımlarla, sunucu tek adımda ilerler; ikisi de aynı akını
  // görmeli, yoksa server/save-validation.ts kaydı haksız yere reddeder.
  const game = newGame({ units: { spearman: 8 }, watchRatio: 30 });
  const end = firstRaidWindow(game).planned.at + WINDOW;
  const single = tick(game, end);
  let stepped = game;
  for (let at = T0 + 600_000; at <= end; at += 600_000) stepped = tick(stepped, at);
  assert.ok(single.notices.some(notice => notice.kind === "AKIN"), "bu aralıkta gerçekten bir akın olmalı");
  assert.equal(stepped.units.spearman, single.units.spearman, "asker kaybı adım boyutuna bağlı olmamalı");
  assert.deepEqual(
    stepped.notices.filter(notice => notice.kind === "AKIN"),
    single.notices.filter(notice => notice.kind === "AKIN"),
    "aynı akınlar iki yolda da aynı sonuçla çözülmeli",
  );
});

test("pencere başlangıcı hızlı channel'da kısalır", () => {
  const slow = newGame({ speed: 1 }), fast = newGame({ speed: 24 });
  assert.equal(windowStart(slow, 1) - T0, WINDOW);
  assert.equal(windowStart(fast, 1) - T0, WINDOW / 24);
});

test("yağmalanan kayıt sunucu doğrulamasından geçer, uydurma kaynak yine reddedilir", () => {
  const game = newGame({ units: { spearman: 20 }, watchRatio: 0, buildings: [...newGame().buildings, { type: "wall", name: "Sur", category: "Askerî", level: 1 }] });
  const { planned } = firstRaidWindow(game);
  const previous = tick(game, planned.at - HOUR);
  // İstemci akının içinden dakikalık adımlarla geçer; sunucu tek adımda simüle eder.
  let client = previous;
  for (let at = previous.lastTickAt + 60_000; at <= planned.at + HOUR; at += 60_000) client = tick(client, at);
  const options = { previous: previous as never, previousUpdatedAt: previous.lastTickAt, channelSpeed: 1, now: planned.at + HOUR };

  assert.equal(validateGameSave(client, options).ok, true, "yağmalanmış kayıt reddedilmemeli");
  // Kral nöbeti sunucunun bildiğinden yükseltip akını püskürtmüş olabilir: kaynağı
  // sunucunun yağmalı simülasyonundan fazla olur ama bu meşrudur.
  let defended: Game = { ...previous, watchRatio: 100 };
  for (let at = previous.lastTickAt + 60_000; at <= planned.at + HOUR; at += 60_000) defended = tick(defended, at);
  assert.ok(defended.resources.gold >= client.resources.gold);
  assert.equal(validateGameSave(defended, options).ok, true, "akını püskürten kayıt da kabul edilmeli");

  const cheating = { ...client, resources: { ...client.resources, gold: client.resources.gold + 50_000 } };
  assert.equal(validateGameSave(cheating, options).ok, false, "uydurma altın hâlâ yakalanmalı");
});

test("nöbet emri uygulanır ve kota harcar", () => {
  const before = newGame({ units: { spearman: 10 } });
  const { game, results } = applyActions(before, [{ name: "set_watch_ratio", arguments: { percent: 75 } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.watchRatio, 75);
  assert.equal(game.quota, before.quota - 1);
  assert.ok(game.notices.some(notice => notice.kind === "NÖBET"));
});

test("nöbeti fazla düşürmek ya da fazla yükseltmek teyit ister", () => {
  const army = newGame({ units: { spearman: 10 } });
  assert.match(applyActions(army, [{ name: "set_watch_ratio", arguments: { percent: 10 } }], T0).results[0], /dağ akınlarına açar/);
  assert.match(applyActions(army, [{ name: "set_watch_ratio", arguments: { percent: 95 } }], T0).results[0], /zapt edecek asker bırakmaz/);

  const forced = applyActions(army, [{ name: "set_watch_ratio", arguments: { percent: 10, confirmed_risk: true } }], T0);
  assert.match(forced.results[0], /^✓/);
  assert.equal(forced.game.watchRatio, 10);
});

test("geçersiz nöbet oranı reddedilir", () => {
  assert.match(applyActions(newGame(), [{ name: "set_watch_ratio", arguments: { percent: 140 } }], T0).results[0], /%0 ile %100/);
});
