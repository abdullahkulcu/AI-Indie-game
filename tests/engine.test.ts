import { keepUpgradeCosts } from "../engine/catalog";
import assert from "node:assert/strict";
import test from "node:test";
import { applyActions } from "../engine/actions";
import { UPKEEP, buildOptions, costFor, grossRates, keep, materialScaleOf, rates, tick } from "../engine/tick";
import { marketDuration } from "../engine/actions";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 4 * 86_400_000,
    resources: { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
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

test("başlangıç üretim hızları oyunun gösterdiği değerlerle aynı", () => {
  const r = rates(newGame());
  assert.equal(Math.round(r.gold * 10) / 10, 3.3);
  assert.equal(Math.round(r.food * 10) / 10, 14.5);
  // Odun brüt 22 üretiyor ama %35 bakıma gidiyor: net 14.3.
  assert.equal(Math.round(r.wood * 10) / 10, 14.3);
  assert.equal(r.stone, 0);
});

test("odun ve taşın sürekli gideri var; net brüte eşit değil", () => {
  // Bu satır bir kez kırıldı: odunun tek gideri inşaattı, yani inşaat durunca
  // ambar sonsuza kadar büyüyordu ve kaynak anlamsızlaşıyordu.
  const game = newGame({ buildings: [...newGame().buildings, { type: "quarry", name: "Taş Ocağı", category: "Ekonomi", level: 2 }] });
  const gross = grossRates(game), net = rates(game);
  assert.ok(net.wood < gross.wood, "odun bakım yemeli");
  assert.ok(net.stone < gross.stone, "taş bakım yemeli");
  assert.equal(Math.round(net.wood * 100) / 100, Math.round(gross.wood * (1 - UPKEEP.wood) * 100) / 100);
});

test("arazi çarpanları üretime yansır", () => {
  assert.ok(rates(newGame({ terrain: "forest" })).wood > rates(newGame()).wood);
  assert.ok(rates(newGame({ terrain: "riverbank" })).food > rates(newGame()).food);
});

test("bir saatlik tick kaynakları üretim hızı kadar artırır", () => {
  const before = newGame();
  const after = tick(before, T0 + 3_600_000);
  assert.equal(Math.round(after.resources.wood), Math.round(before.resources.wood + rates(before).wood));
  assert.equal(after.lastTickAt, T0 + 3_600_000);
});

test("çevrimdışı kazanç 24 saatle sınırlıdır", () => {
  const week = tick(newGame(), T0 + 7 * 86_400_000);
  const day = tick(newGame(), T0 + 86_400_000);
  assert.equal(Math.round(week.resources.wood), Math.round(day.resources.wood));
});

test("channel hızı tick'i çarpar", () => {
  const slow = tick(newGame({ speed: 1 }), T0 + 3_600_000);
  const fast = tick(newGame({ speed: 4 }), T0 + 3_600_000);
  assert.ok(fast.resources.wood > slow.resources.wood);
});

test("kuyruk tamamlanınca bina eklenir ve bildirim düşer", () => {
  const queued = newGame({ queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 1000 } });
  const after = tick(queued, T0 + 2000);
  assert.equal(after.queue, null);
  assert.equal(after.buildings.find(b => b.type === "quarry")?.level, 1);
  assert.match(after.notices[0].text, /tamamlandı/);
});

test("tick emir kotası biriktirmez; alan olduğu gibi taşınır", () => {
  const after = tick(newGame({ quota: 0 }), T0 + 20 * 3_600_000);
  assert.equal(after.quota, 0, "kota birikimi kaldırıldı");
  assert.equal(after.quotaAt, T0, "kota zamanı da ilerletilmez");
});

test("malzeme maliyeti altından daha dik büyür", () => {
  assert.deepEqual(costFor({ wood: 80 }, 0), { wood: 80 });
  // Odun ve taş 1.85, altın ve yiyecek 1.65: glut olan kaynak yüksek seviyede
  // gerçek gider olsun, zaten dar olan altın daha da darlaşmasın.
  assert.deepEqual(costFor({ wood: 80 }, 1), { wood: 148 });
  assert.deepEqual(costFor({ gold: 80 }, 1), { gold: 132 });
});

test("hızlı channel malzeme maliyetini büyütür, altını değil", () => {
  // Hızlı channel'da saatte daha çok odun çıkar; aynı seviye orada da bir
  // anlam taşısın diye malzeme maliyeti aynı oranda büyür.
  assert.deepEqual(costFor({ wood: 100, gold: 60 }, 0, materialScaleOf(4)), { wood: 400, gold: 60 });
  assert.deepEqual(costFor({ wood: 100 }, 0, materialScaleOf(1)), { wood: 100 });
  assert.equal(materialScaleOf(0.5), 1, "hız 1'in altına düşse de maliyet azalmaz");
});

test("kale seviyesi binalardan okunur", () => {
  assert.equal(keep(newGame()), 1);
  assert.equal(keep(newGame({ buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 4 }] })), 4);
});

test("bina emri kaynak düşer ve kuyruğa alır; kota harcamaz", () => {
  const before = newGame();
  const { game, results } = applyActions(before, [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.queue?.type, "quarry");
  assert.equal(game.quota, before.quota, "emir kotadan düşmemeli");
  assert.equal(game.resources.wood, before.resources.wood - 100);
  assert.equal(game.resources.gold, before.resources.gold - 60);
});

test("kuyruk doluyken ikinci inşa emri engellenir", () => {
  const busy = newGame({ queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 9_000_000 } });
  const { results } = applyActions(busy, [{ name: "build_structure", arguments: { building_type: "mill", target_level: 1 } }], T0);
  assert.match(results[0], /^✕/);
  assert.match(results[0], /kuyruğu dolu/);
});

test("kale kilidi olmayan bina reddedilir", () => {
  const { results } = applyActions(newGame(), [{ name: "build_structure", arguments: { building_type: "wall", target_level: 1 } }], T0);
  assert.match(results[0], /Kale Sv\.3 gerekli/);
});

test("kışla olmadan asker eğitilemez", () => {
  const { results } = applyActions(newGame(), [{ name: "train_unit", arguments: { unit_type: "spearman", count: 5 } }], T0);
  assert.match(results[0], /Kışla kurulmalı/);
});

test("kota sıfırken bile emirler uygulanır", () => {
  const { game, results } = applyActions(newGame({ quota: 0 }), [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.queue?.type, "quarry");
});

test("art arda çok sayıda emir yalnızca kaynak ve kuyrukla sınırlanır", () => {
  // Kota kalktı: aynı turda üç şenlik de uygulanır, kaynak yettiği sürece.
  const rich = newGame({ resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 } });
  const many = Array.from({ length: 3 }, () => ({ name: "host_festival", arguments: {} }));
  const { game, results } = applyActions(rich, many, T0);
  assert.equal(results.filter(line => line.startsWith("✓")).length, 3);
  assert.equal(game.resources.gold, 5000 - 3 * 120);
});

test("kaynak bitince emir engellenir; engelleyen kota değil hazinedir", () => {
  const poor = newGame({ resources: { gold: 0, food: 0, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const { results } = applyActions(poor, [{ name: "host_festival", arguments: {} }], T0);
  assert.match(results[0], /^✕/);
  assert.match(results[0], /altın ve 150 yiyecek gerekli/);
});

test("yüksek vergi teyitsiz uygulanmaz, teyitli uygulanır", () => {
  const blockedRun = applyActions(newGame(), [{ name: "set_tax_rate", arguments: { rate_percent: 45 } }], T0);
  assert.match(blockedRun.results[0], /^✕/);
  const allowed = applyActions(newGame(), [{ name: "set_tax_rate", arguments: { rate_percent: 45, confirmed_risk: true } }], T0);
  assert.match(allowed.results[0], /^✓/);
  assert.equal(allowed.game.taxRate, 45);
});

test("itirazı ezen emir sadakati düşürür, rutin emir yükseltir", () => {
  const routine = applyActions(newGame(), [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }], T0);
  assert.equal(routine.game.loyalty, 75.5);
  const forced = applyActions(newGame(), [{ name: "set_tax_rate", arguments: { rate_percent: 45, confirmed_risk: true } }], T0);
  assert.ok(forced.game.loyalty < 75, "ezilen itiraz sadakati düşürmeli");
});

test("şenlik halkın rızasını yükseltir ve kaynak harcar", () => {
  const { game, results } = applyActions(newGame(), [{ name: "host_festival", arguments: {} }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.popularity, 62);
  assert.equal(game.resources.gold, 880);
});

test("sunucu eylemleri motoru değiştirmez, remote listesine düşer", () => {
  const before = newGame();
  const { game, remote, results } = applyActions(before, [{ name: "send_miners", arguments: { workers: 8 } }], T0);
  assert.equal(remote.length, 1);
  assert.equal(results.length, 0);
  assert.deepEqual(game.resources, before.resources);
});

test("bilinmeyen araç reddedilir", () => {
  const { results } = applyActions(newGame(), [{ name: "altin_bas", arguments: {} }], T0);
  assert.match(results[0], /yetkili değil/);
});

test("tur başına en fazla üç eylem işlenir", () => {
  const many = Array.from({ length: 6 }, () => ({ name: "host_festival", arguments: {} }));
  const { results } = applyActions(newGame({ resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 } }), many, T0);
  assert.equal(results.length, 3);
});

test("göçmen çağrısı nüfusu artırır ve deftere yazılır", () => {
  const before = newGame({ popularity: 60, resources: { gold: 1000, food: 1000, stone: 300, wood: 300, iron: 100, ale: 0 } });
  const { game, results } = applyActions(before, [{ name: "call_settlers", arguments: {} }], T0);
  assert.match(results[0], /^✓/);
  assert.ok(game.population > before.population, "çağrı nüfusu artırmalı");
  assert.equal(game.peopleJoined, Math.round(game.population - before.population));
  assert.equal(game.resources.gold, 780);
});

test("huzursuz krallığa kimse taşınmaz", () => {
  const unhappy = newGame({ popularity: 20, resources: { gold: 1000, food: 1000, stone: 300, wood: 300, iron: 100, ale: 0 } });
  const { results } = applyActions(unhappy, [{ name: "call_settlers", arguments: {} }], T0);
  assert.match(results[0], /^✕/);
  assert.match(results[0], /kimse taşınmaz/);
});

test("kapasite doluyken göçmen çağrısı reddedilir", () => {
  const full = newGame({ popularity: 60, population: 150, capacity: 150, resources: { gold: 1000, food: 1000, stone: 300, wood: 300, iron: 100, ale: 0 } });
  const { results } = applyActions(full, [{ name: "call_settlers", arguments: {} }], T0);
  assert.match(results[0], /boş konut yok/);
});

test("göçmen çağrısı ard arda yapılamaz", () => {
  const rich = newGame({ popularity: 60, resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 } });
  const once = applyActions(rich, [{ name: "call_settlers", arguments: {} }], T0);
  const twice = applyActions(once.game, [{ name: "call_settlers", arguments: {} }], T0 + 3_600_000);
  assert.match(twice.results[0], /kervan yolda/);
});

test("göç deftere geçer: sessiz erime olmaz", () => {
  const collapsing = newGame({ popularity: 3, population: 300, capacity: 300 });
  const after = tick(collapsing, T0 + 3 * 3_600_000);
  assert.ok(after.population < collapsing.population);
  assert.ok((after.peopleLeft ?? 0) > 0, "kaybedilen insan deftere yazılmalı");
  assert.match(after.notices[0].text, /terk etti/);
});

test("Pazar olmadan hiçbir şey satılamaz", () => {
  const { results } = applyActions(newGame(), [{ name: "trade_resource", arguments: { resource: "wood", amount: 100, direction: "sell" } }], T0);
  assert.match(results[0], /Pazarımız yok/);
});

test("satış anında olmaz: mal tezgâha çıkar, para sonra gelir", () => {
  const trader = newGame({ buildings: [...newGame().buildings, { type: "market", name: "Pazar", category: "Ekonomi", level: 1 }] });
  const { game, results } = applyActions(trader, [{ name: "trade_resource", arguments: { resource: "wood", amount: 200, direction: "sell" } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.resources.wood, 100, "mal ambardan hemen çıkmalı");
  assert.equal(game.resources.gold, 1000, "para henüz gelmemeli");
  assert.equal(game.marketOrders?.length, 1);
  assert.equal(game.notices[0].kind, "PAZAR");

  const order = game.marketOrders![0];
  const early = tick(game, order.completesAt - 60_000);
  assert.equal(early.marketOrders?.length, 1, "süresi dolmadan kapanmamalı");

  const when = order.completesAt + 1000;
  const settled = tick(game, when);
  assert.equal(settled.marketOrders?.length, 0, "süresi dolan teklif kapanmalı");
  // Aynı anda, teklifi olmayan bir kopyayla karşılaştır: aradaki fark satışın parasıdır.
  const without = tick({ ...game, marketOrders: [] }, when);
  const paid = Math.round(settled.resources.gold - without.resources.gold);
  // Hazineye giren, teklifin üstünde yazan rakamın TA KENDİSİ olmalı: fiyat emir
  // anında bağlanır, kapanışta yeniden pazarlık edilmez.
  assert.equal(paid, order.gold, "kapanışta ödenen, teklifte yazan altın olmalı");
  // Fiyat artık sabit tablo değil: 200 odun 100 kişilik halkın odunluğunu
  // (referans 400) yarı yarıya taşırdığı için birim fiyat taban fiyatın altına
  // iner. Eski sabit tablo 60 altın verirdi; bolluk indirimi bunu düşürmeli.
  assert.ok(paid > 0 && paid < 200 * .3, `bolluk fiyatı kırmalı, ölçülen ${paid}`);
  assert.match(settled.notices.find(notice => notice.kind === "PAZAR")!.text, /hazineye girer|hazineye girdi/);
});

test("satıp geri almak zarardır: pazar bedava altın basmaz", () => {
  const trader = newGame({ resources: { gold: 5000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    buildings: [...newGame().buildings, { type: "market", name: "Pazar", category: "Ekonomi", level: 2 }] });
  const sold = applyActions(trader, [{ name: "trade_resource", arguments: { resource: "wood", amount: 200, direction: "sell" } }], T0);
  const back = applyActions(sold.game, [{ name: "trade_resource", arguments: { resource: "wood", amount: 200, direction: "buy" } }], T0);
  // Bütün teklifler kapansın; ancak o zaman turun bilançosu görülür.
  const done = tick(back.game, T0 + 6 * 3_600_000);
  assert.equal(Math.round(done.resources.wood - tick(trader, T0 + 6 * 3_600_000).resources.wood), 0, "odun geri gelmeli");
  assert.ok(done.resources.gold < tick(trader, T0 + 6 * 3_600_000).resources.gold, "tur bitince hazine azalmalı");
});

test("Pazar yuvaları sınırlıdır: Sv.1 pazarda ikinci teklif açılmaz", () => {
  const trader = newGame({ resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 },
    buildings: [...newGame().buildings, { type: "market", name: "Pazar", category: "Ekonomi", level: 1 }] });
  const first = applyActions(trader, [{ name: "trade_resource", arguments: { resource: "wood", amount: 100, direction: "sell" } }], T0);
  const second = applyActions(first.game, [{ name: "trade_resource", arguments: { resource: "food", amount: 100, direction: "sell" } }], T0);
  assert.match(second.results[0], /teklif yuvası da dolu/);
});

test("yüklü teklif küçük teklife göre daha uzun sürer", () => {
  assert.ok(marketDuration(1000, 1) > marketDuration(50, 1));
  assert.ok(marketDuration(500, 4) < marketDuration(500, 1), "hızlı channel'da teklif daha çabuk kapanır");
});

test("günlük pazar hacmi seviyeyle sınırlıdır", () => {
  const trader = newGame({ resources: { gold: 1000, food: 9000, stone: 300, wood: 300, iron: 100, ale: 0 }, buildings: [...newGame().buildings, { type: "market", name: "Pazar", category: "Ekonomi", level: 1 }] });
  const { results } = applyActions(trader, [{ name: "trade_resource", arguments: { resource: "food", amount: 2000, direction: "sell" } }], T0);
  assert.match(results[0], /günlük hacmi 1500 birim/);
});

test("ambarda olmayan kaynak satılamaz", () => {
  const trader = newGame({ buildings: [...newGame().buildings, { type: "market", name: "Pazar", category: "Ekonomi", level: 1 }] });
  const { results } = applyActions(trader, [{ name: "trade_resource", arguments: { resource: "iron", amount: 400, direction: "sell" } }], T0);
  assert.match(results[0], /ambarda 100 DEMİR var/);
});

test("hızlandırma işi bitirmez, kalan süreyi yarıya indirir", () => {
  const busy = newGame({ resources: { gold: 5000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 3_600_000 } });
  const { game, results } = applyActions(busy, [{ name: "accelerate_construction", arguments: {} }], T0);
  assert.match(results[0], /^✓/);
  assert.ok(game.queue, "iş kuyrukta kalmalı, anında bitmemeli");
  assert.equal(game.queue?.completesAt, T0 + 1_800_000, "kalan süre yarıya inmeli");
  assert.equal(game.buildings.find(b => b.type === "quarry"), undefined, "bina henüz kurulmamalı");
});

test("dışarıdan gelen ustalar nüfustan düşmez", () => {
  const busy = newGame({ resources: { gold: 5000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 3_600_000 } });
  const { game } = applyActions(busy, [{ name: "accelerate_construction", arguments: {} }], T0);
  assert.equal(game.population, busy.population);
  assert.ok(game.resources.gold < busy.resources.gold, "yevmiye ödenmeli");
});

test("aynı işe ikinci kez usta çağrılamaz", () => {
  const busy = newGame({ resources: { gold: 5000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 3_600_000 } });
  const once = applyActions(busy, [{ name: "accelerate_construction", arguments: {} }], T0);
  const twice = applyActions(once.game, [{ name: "accelerate_construction", arguments: {} }], T0);
  assert.match(twice.results[0], /zaten dışarıdan işçi tutuldu/);
});

test("hızlandırma eskisinden pahalıdır", () => {
  const busy = newGame({ resources: { gold: 5000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 3_600_000 } });
  const { game } = applyActions(busy, [{ name: "accelerate_construction", arguments: {} }], T0);
  // 60 dakika × 6 altın = 360; eski tarife 2 altın/dakika ile 120 idi.
  assert.equal(busy.resources.gold - game.resources.gold, 360);
});

test("hızlandırılan iş kuyruk süresi dolunca normal biter", () => {
  const busy = newGame({ resources: { gold: 5000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 3_600_000 } });
  const hastened = applyActions(busy, [{ name: "accelerate_construction", arguments: {} }], T0).game;
  const after = tick(hastened, T0 + 1_800_000);
  assert.equal(after.queue, null);
  assert.equal(after.buildings.find(b => b.type === "quarry")?.level, 1);
});

test("malzeme çarpanı channel hızının kendisidir", () => {
  // Kral kararı: çarpan yumuşatılmasın, hız neyse o olsun — ama arayüzde
  // görünsün. Panel ölçeklenmemiş rakam gösterip General ölçeklenmişe göre
  // itiraz ettiğinde Kral 204 taş görüp %157 uyarısı alıyordu.
  assert.equal(materialScaleOf(1), 1);
  assert.equal(materialScaleOf(4), 4);
  assert.equal(materialScaleOf(24), 24);
  assert.equal(materialScaleOf(0.5), 1, "hız 1'in altına düşse de maliyet azalmaz");
});

test("inşa maliyeti tek kaynaktan gelir", () => {
  // Panel ile General'in bağlamı ayrı ayrı hesapladığında saptı; ikisi de
  // buildOptions okumak zorunda.
  const fast = newGame({ speed: 24, buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 4 }] });
  const options = buildOptions(fast);
  const warehouse = options.find(option => option.type === "warehouse")!;
  assert.equal(warehouse.nextLevel, 1);
  assert.deepEqual(warehouse.cost, costFor({ wood: 110, stone: 110 }, 0, materialScaleOf(24)));
  // Kale ayrı tarifeden gelir ve çarpanla büyümez.
  assert.deepEqual(options.find(option => option.type === "keep")?.cost, keepUpgradeCosts[4]);
});
