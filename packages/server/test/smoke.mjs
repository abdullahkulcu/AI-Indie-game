/**
 * Uçtan uca duman testi.
 *
 * Gerçek bir PostgreSQL + Redis'e karşı koşar ve şu zinciri doğrular:
 * üretim tick'i → aksiyon yürütme (kota + kaynak + kademeli karar) → inşaat
 * kuyruğunun tamamlanması → ordu seferi → savaş çözümü.
 *
 * Birim testlerinin göremediği şeyi görür: SQL'in gerçekten çalıştığını.
 * `npm run test:smoke -w @krallik/server` ile çalıştırılır; DATABASE_URL ve
 * REDIS_URL ayakta olmalı.
 */

import assert from 'node:assert/strict';

const { query, queryOne, closePool } = await import('../dist/db/pool.js');
const { closeRedis } = await import('../dist/redis.js');
const { runTick } = await import('../dist/tick/worker.js');
const { executeAction, newNonce } = await import('../dist/game/actions.js');
const { loadKingdomSnapshot } = await import('../dist/game/state.js');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

const kingdom = await queryOne(`SELECT * FROM kingdoms WHERE name = 'Demirkale'`);
assert.ok(kingdom, 'Seed çalıştırılmamış: Demirkale bulunamadı.');
const target = await queryOne(`SELECT * FROM kingdoms WHERE name = 'Karataş'`);

console.log('\n[duman] üretim tick\'i');

// Son tick zamanını geriye alarak bir saatlik pencere simüle ediyoruz.
await query(`UPDATE kingdoms SET last_tick_at = now() - INTERVAL '1 hour' WHERE id = $1`, [
  kingdom.id,
]);
const before = await queryOne('SELECT wood, stone, wheat, gold, food FROM kingdoms WHERE id = $1', [
  kingdom.id,
]);

await runTick();

const after = await queryOne('SELECT wood, stone, wheat, gold, food FROM kingdoms WHERE id = $1', [
  kingdom.id,
]);

await check('oduncu kulübesi odun üretti', () => {
  assert.ok(after.wood > before.wood, `odun ${before.wood} → ${after.wood}`);
});
await check('taş ocağı taş üretti', () => {
  assert.ok(after.stone > before.stone, `taş ${before.stone} → ${after.stone}`);
});
await check('buğday tarlası ham buğday üretti', () => {
  assert.ok(after.wheat > before.wheat, `buğday ${before.wheat} → ${after.wheat}`);
});
await check('vergi altın getirdi', () => {
  assert.ok(after.gold > before.gold, `altın ${before.gold} → ${after.gold}`);
});
await check('değirmen olmadan buğday yiyeceğe dönüşmedi (zincir darboğazı)', () => {
  // Başlangıç binaları arasında değirmen/fırın yok; nüfus yediği için yiyecek
  // düşmeli. Zincirin gerçekten kurulması gerektiğini kanıtlar.
  assert.ok(after.food < before.food, `yiyecek ${before.food} → ${after.food}`);
});

console.log('\n[duman] aksiyon yürütme');

await check('Kale seviyesi yetmeyen bina reddedilir', async () => {
  // Silahhane Kale Sv.5 istiyor (§5.1); başlangıçta Kale Sv.1.
  const result = await executeAction(
    'build_structure',
    { building_type: 'armory', target_level: 1 },
    { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'requirement_not_met');
  assert.equal(result.quotaSpent, 0, 'reddedilen emir kota yakmamalı');
});

await check('kaynak yetersizken inşaat reddedilir', async () => {
  const saved = await queryOne('SELECT stone, wood, gold FROM kingdoms WHERE id = $1', [kingdom.id]);
  await query('UPDATE kingdoms SET stone = 0, wood = 0, gold = 0 WHERE id = $1', [kingdom.id]);
  try {
    const result = await executeAction(
      'build_structure',
      { building_type: 'keep', target_level: 2 },
      { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
    );
    // Hazine boşken bu emir "büyük karar" eşiğini de aşıyor; yine de Kral'a
    // onay sorulmamalı — karşılanamayan emir için doğru cevap "gücümüz yetmiyor".
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'insufficient_resources', result.message);
  } finally {
    await query('UPDATE kingdoms SET stone = $2, wood = $3, gold = $4 WHERE id = $1', [
      kingdom.id,
      saved.stone,
      saved.wood,
      saved.gold,
    ]);
  }
});

await check('seviyeler tek tek yükselir', async () => {
  const farm = await queryOne(
    `SELECT id, level FROM building_instances WHERE kingdom_id = $1 AND type = 'wheat_farm' LIMIT 1`,
    [kingdom.id],
  );
  const result = await executeAction(
    'build_structure',
    { building_type: 'wheat_farm', building_id: farm.id, target_level: farm.level + 3 },
    { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'invalid_arguments');
});

await check('rutin yükseltme kabul edilir ve kotadan düşer', async () => {
  const quotaBefore = (
    await queryOne('SELECT decree_quota_remaining FROM kingdoms WHERE id = $1', [kingdom.id])
  ).decree_quota_remaining;

  const farm = await queryOne(
    `SELECT id, level FROM building_instances WHERE kingdom_id = $1 AND type = 'wheat_farm' LIMIT 1`,
    [kingdom.id],
  );
  const result = await executeAction(
    'build_structure',
    { building_type: 'wheat_farm', building_id: farm.id, target_level: farm.level + 1 },
    { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
  );
  assert.equal(result.ok, true, result.message);
  assert.equal(result.quotaSpent, 1);

  const quotaAfter = (
    await queryOne('SELECT decree_quota_remaining FROM kingdoms WHERE id = $1', [kingdom.id])
  ).decree_quota_remaining;
  assert.equal(quotaAfter, quotaBefore - 1);

  // Yükseltme kuyruğa girdi mi.
  const queued = await queryOne('SELECT upgrade_completes_at FROM building_instances WHERE id = $1', [
    farm.id,
  ]);
  assert.ok(queued.upgrade_completes_at, 'yükseltme zaman damgası yazılmalı');
});

await check('çok-örnekli binada kimlik verilmezse yeni bina kurulur', async () => {
  const before = await query(
    `SELECT id FROM building_instances WHERE kingdom_id = $1 AND type = 'woodcutter'`,
    [kingdom.id],
  );
  const result = await executeAction(
    'build_structure',
    { building_type: 'woodcutter', target_level: 1 },
    { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
  );
  assert.equal(result.ok, true, result.message);
  const after = await query(
    `SELECT id FROM building_instances WHERE kingdom_id = $1 AND type = 'woodcutter'`,
    [kingdom.id],
  );
  assert.equal(after.length, before.length + 1, 'ikinci oduncu kulübesi eklenmeli');
});

await check('aynı nonce ile tekrarlanan çağrı çift işlenmez', async () => {
  const nonce = newNonce();
  const args = { rate_percent: 35 };
  const first = await executeAction('set_tax_rate', args, {
    kingdomId: kingdom.id,
    source: 'active',
    nonce,
  });
  const second = await executeAction('set_tax_rate', args, {
    kingdomId: kingdom.id,
    source: 'active',
    nonce,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const logs = await query(
    `SELECT id FROM action_log WHERE kingdom_id = $1 AND action_name = 'set_tax_rate'`,
    [kingdom.id],
  );
  assert.equal(logs.length, 1, 'idempotency ikinci kaydı engellemeli');
});

await check('kota tükenince yeni emir reddedilir', async () => {
  await query('UPDATE kingdoms SET decree_quota_remaining = 0 WHERE id = $1', [kingdom.id]);
  const result = await executeAction(
    'set_tax_rate',
    { rate_percent: 25 },
    { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'insufficient_quota');
  await query('UPDATE kingdoms SET decree_quota_remaining = 10 WHERE id = $1', [kingdom.id]);
});

await check('okuma aksiyonu kota harcamaz', async () => {
  const quotaBefore = (
    await queryOne('SELECT decree_quota_remaining FROM kingdoms WHERE id = $1', [kingdom.id])
  ).decree_quota_remaining;
  const result = await executeAction(
    'get_kingdom_status',
    {},
    { kingdomId: kingdom.id, source: 'active', nonce: newNonce() },
  );
  assert.equal(result.ok, true);
  assert.equal(result.quotaSpent, 0);
  const quotaAfter = (
    await queryOne('SELECT decree_quota_remaining FROM kingdoms WHERE id = $1', [kingdom.id])
  ).decree_quota_remaining;
  assert.equal(quotaAfter, quotaBefore);
});

console.log('\n[duman] kademeli karar (§14.5)');

await check('saldırı emri otomatik uygulanmaz, onaya park edilir', async () => {
  // Koruma süresini bitir; yoksa saldırı zaten koruma nedeniyle reddedilir.
  await query(`UPDATE kingdoms SET protection_ends_at = now() - INTERVAL '1 hour'`);

  const targetTile = await queryOne('SELECT x, y FROM map_tiles WHERE id = $1', [
    target.capital_tile_id,
  ]);

  const result = await executeAction(
    'move_army',
    {
      target_x: targetTile.x,
      target_y: targetTile.y,
      intent: 'attack',
      units: { spearman: 5 },
    },
    { kingdomId: kingdom.id, source: 'passive', nonce: newNonce() },
  );

  assert.equal(result.ok, false, 'büyük karar kendi başına uygulanmamalı');
  assert.ok(result.pendingDecisionId, 'bekleyen karar kaydı oluşmalı');

  const decision = await queryOne('SELECT * FROM pending_decisions WHERE id = $1', [
    result.pendingDecisionId,
  ]);
  assert.equal(decision.status, 'awaiting');
  assert.ok(decision.risk_reasons.length > 0, 'gerekçe yazılmış olmalı');
});

await check('Kral onaylayınca aynı emir uygulanır', async () => {
  const targetTile = await queryOne('SELECT x, y FROM map_tiles WHERE id = $1', [
    target.capital_tile_id,
  ]);
  const result = await executeAction(
    'move_army',
    {
      target_x: targetTile.x,
      target_y: targetTile.y,
      intent: 'attack',
      units: { spearman: 5 },
    },
    { kingdomId: kingdom.id, source: 'active', preApproved: true, nonce: newNonce() },
  );
  assert.equal(result.ok, true, result.message);
  assert.ok(result.data?.armyId);
});

console.log('\n[duman] kuyruk ve savaş çözümü');

await check('süresi dolan inşaat tamamlanır', async () => {
  const pending = await query(
    `SELECT id, level, upgrading_to_level FROM building_instances
      WHERE kingdom_id = $1 AND upgrade_completes_at IS NOT NULL`,
    [kingdom.id],
  );
  assert.ok(pending.length > 0, 'kuyrukta yükseltme olmalı');

  await query(
    `UPDATE building_instances SET upgrade_completes_at = now() - INTERVAL '1 minute'
      WHERE kingdom_id = $1 AND upgrade_completes_at IS NOT NULL`,
    [kingdom.id],
  );
  await runTick();

  for (const item of pending) {
    const fresh = await queryOne(
      'SELECT level, upgrade_completes_at FROM building_instances WHERE id = $1',
      [item.id],
    );
    assert.equal(fresh.upgrade_completes_at, null, 'yükseltme temizlenmeli');
    assert.equal(fresh.level, item.upgrading_to_level, 'seviye hedefe çıkmalı');
  }
});

await check('varış zamanı gelen ordu savaşa girer ve rapor üretir', async () => {
  await query(`UPDATE armies SET arrives_at = now() - INTERVAL '1 minute' WHERE status = 'marching'`);
  await runTick();

  const reports = await query(
    `SELECT * FROM battle_reports WHERE attacker_kingdom_id = $1 ORDER BY created_at DESC`,
    [kingdom.id],
  );
  assert.ok(reports.length > 0, 'savaş raporu yazılmalı');
  const report = reports[0];
  assert.ok(report.narrative.length > 0);
  assert.ok(report.attack_power >= 0 && report.defense_power >= 0);
});

await check('savunan tarafa bildirim gitti', async () => {
  const notifications = await query(
    `SELECT * FROM notifications WHERE kingdom_id = $1 AND kind IN ('attack_incoming','battle_report','siege_round')`,
    [target.id],
  );
  assert.ok(notifications.length > 0, 'savunan haberdar edilmeli');
});

console.log('\n[duman] durum yükleme');

await check('krallık anlık görüntüsü tutarlı', async () => {
  const snapshot = await loadKingdomSnapshot(kingdom.id);
  assert.ok(snapshot);
  assert.ok(snapshot.buildings.length >= 6, 'başlangıç binaları yerinde');
  assert.ok(snapshot.ownedTiles.length >= 9, 'başlangıç toprağı yerinde');
  assert.equal(snapshot.channel.status, 'active');
});

await check('DTO dönüşümü hatasız çalışır', async () => {
  const { toKingdomStateDto } = await import('../dist/http/dto.js');
  const snapshot = await loadKingdomSnapshot(kingdom.id);
  const dto = await toKingdomStateDto(snapshot);
  assert.equal(dto.id, kingdom.id);
  assert.ok(dto.keepLevel >= 1);
  assert.ok(dto.buildings.length > 0);
  assert.ok(dto.scores.decreeQuotaCap > 0);
  // Anahtar bağlanmadığı için General sessiz olmalı (§14.6).
  assert.equal(dto.llm.configured, false);
  assert.equal(dto.llm.silent, true);
});

console.log(failures === 0 ? '\n[duman] TÜM KONTROLLER GEÇTİ\n' : `\n[duman] ${failures} KONTROL BAŞARISIZ\n`);

await closePool();
await closeRedis();
process.exit(failures === 0 ? 0 : 1);
