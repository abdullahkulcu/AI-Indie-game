/**
 * Aksiyon yürütücü — LLM ile oyun durumu arasındaki tek geçit.
 *
 * GDD §15.5, altın kural: **LLM çıktısı bir öneri, asla bir komut değil.**
 * Buradaki her handler, modelin verdiği hiçbir sayıya (maliyet, süre, mesafe)
 * güvenmeden yetkilendirme/kaynak/önkoşul/mesafe hesaplarını yeniden yapar.
 * Model "bu bina 10 altın" dese de maliyet `buildingCostAtLevel` ile hesaplanır.
 *
 * Aynı yerde üç koruma daha var:
 *   - **Emir kotası** atomik olarak düşülür (§14.4), bypass edilemez.
 *   - **Kademeli karar** (§14.5): büyük/riskli aksiyonlar otomatik uygulanmaz,
 *     `pending_decisions` kaydına park edilir.
 *   - **Idempotency** (§15.5): aynı nonce ile tekrarlanan çağrı çift işlenmez.
 */

import {
  BALANCE,
  BUILDINGS,
  MULTI_INSTANCE_BUILDINGS,
  RENTABLE_UNIT_TYPES,
  TERRAIN,
  UNITS,
  actionConsumesQuota,
  armyContains,
  armyUnitCount,
  assessRisk,
  buildingBuildSeconds,
  buildingCostAtLevel,
  caravanLoad,
  caravanTravelSeconds,
  clamp,
  deepExcavationCost,
  deepExcavationRefund,
  fatigueMultiplier,
  festivalBoost,
  isBuildingUnlocked,
  keepLevelDef,
  marchSeconds,
  mineReserveCapacity,
  missingResources,
  missingSupportUnits,
  normalizeArmy,
  scaleBundle,
  tileDistance,
  type ActionErrorCode,
  type ActionResult,
  type ArmyComposition,
  type ArmyIntent,
  type BuildingType,
  type ProposalType,
  type Resource,
  type ResourceBundle,
  type Tactic,
  type TerrainType,
  type UnitType,
} from '@krallik/shared';
import { config } from '../config.js';
import { newNonce } from '../crypto.js';
import { txQuery, txQueryOne, withTransaction, type Tx } from '../db/pool.js';
import type {
  BuildingInstanceRow,
  KingdomRow,
  MapTileRow,
  MarketOfferRow,
  PendingDecisionRow,
  SiegeRow,
} from '../db/rows.js';
import { notify, recordRegionActivity } from './notifications.js';
import {
  estimateGoldValue,
  grantResources,
  refundDecreeQuota,
  spendDecreeQuota,
  spendResources,
} from './resources.js';
import {
  buildingSlotsTotalOf,
  buildingSlotsUsedOf,
  deployableGarrisonOf,
  isProtected,
  keepLevelOf,
  ledgerOf,
  loadKingdomSnapshot,
  loadTileAt,
  militaryPopulationOf,
  removeUnits,
  storageCapacityOf,
  type KingdomSnapshot,
} from './state.js';

// ---------------------------------------------------------------------------
// Bağlam ve sonuç
// ---------------------------------------------------------------------------

export interface ActionContext {
  kingdomId: string;
  /** 'active' = Kral yönlendiriyor; 'passive' = General kendi karar verdi. */
  source: 'active' | 'passive' | 'system';
  /** Kral zaten onayladıysa kademeli karar kontrolü atlanır. */
  preApproved?: boolean;
  /** Idempotency nonce (§15.5). */
  nonce?: string;
  now?: Date;
}

function fail(code: ActionErrorCode, message: string): ActionResult {
  return { ok: false, message, errorCode: code };
}

function ok(message: string, data?: Record<string, unknown>): ActionResult {
  return { ok: true, message, ...(data ? { data } : {}) };
}

// ---------------------------------------------------------------------------
// Argüman ayıklama — modelin gönderdiği her şey şüpheli kabul edilir
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const str = asString(value);
  return str !== null && (allowed as readonly string[]).includes(str) ? (str as T) : null;
}

/**
 * Model bazen ordu bileşimini `{"spearman": 30}` yerine `{"spearman": "30"}`
 * ya da dizi olarak gönderebiliyor. Ne gönderirse göndersin, tanınmayan birim
 * tipleri ve pozitif olmayan sayılar sessizce elenir.
 */
function asArmyComposition(value: unknown): ArmyComposition {
  if (!value || typeof value !== 'object') return {};
  const out: ArmyComposition = {};
  const entries = Array.isArray(value)
    ? (value as { unit_type?: string; type?: string; count?: unknown }[]).map(
        (item) => [item.unit_type ?? item.type ?? '', item.count] as [string, unknown],
      )
    : Object.entries(value as Record<string, unknown>);

  for (const [key, raw] of entries) {
    if (!(key in UNITS)) continue;
    const count = asInt(raw);
    if (count !== null && count > 0) out[key as UnitType] = count;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ana giriş noktası
// ---------------------------------------------------------------------------

type Handler = (
  tx: Tx,
  snapshot: KingdomSnapshot,
  args: Record<string, unknown>,
  ctx: Required<Pick<ActionContext, 'source' | 'now'>> & ActionContext,
) => Promise<ActionResult>;

export async function executeAction(
  actionName: string,
  args: Record<string, unknown>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const now = ctx.now ?? config.now();
  const handler = HANDLERS[actionName];
  if (!handler) {
    return fail('invalid_arguments', `Bilinmeyen aksiyon: ${actionName}`);
  }

  return withTransaction(async (tx) => {
    // --- Idempotency: aynı nonce ikinci kez işlenmez (§15.5) ---------------
    if (ctx.nonce) {
      const existing = await txQueryOne<{ result: ActionResult }>(
        tx,
        'SELECT result FROM action_idempotency WHERE nonce = $1',
        [ctx.nonce],
      );
      if (existing) {
        return { ...existing.result, message: existing.result.message };
      }
    }

    // Krallık satırını kilitle: aynı anda iki aksiyon aynı kotayı/kaynağı
    // harcayamasın. Tick servisi de aynı satırı kilitler.
    const locked = await txQueryOne<{ id: string }>(
      tx,
      'SELECT id FROM kingdoms WHERE id = $1 FOR UPDATE',
      [ctx.kingdomId],
    );
    if (!locked) return fail('not_authorized', 'Krallık bulunamadı.');

    const snapshot = await loadKingdomSnapshot(ctx.kingdomId, tx);
    if (!snapshot) return fail('not_authorized', 'Krallık bulunamadı.');

    if (snapshot.kingdom.status !== 'active') {
      return fail(
        'not_authorized',
        'Bu krallık artık ayakta değil; yeni emir kabul edilmiyor.',
      );
    }
    if (snapshot.channel.status === 'finished') {
      return fail('not_authorized', 'Bu channel sona erdi.');
    }

    const fullCtx = { ...ctx, source: ctx.source, now };
    let result: ActionResult;

    // --- Kademeli karar (§14.5) -------------------------------------------
    // Aksiyonun "büyük/riskli" olup olmadığı BACKEND'de belirlenir; General'ın
    // kendini "bu rutin" diye ikna edip onay adımını atlaması mümkün olmamalı.
    const risk = await assessActionRisk(tx, snapshot, actionName, args, now);

    // Karşılanamayacak bir emri onaya sunmak Kral'ın dikkatini boşa harcar:
    // "bunu onaylar mısınız" değil, "buna gücümüz yetmiyor" demek gerekir.
    // Bu yüzden bütçe kontrolü kademeli karar kapısından önce geliyor; emir
    // handler'a düşüp kesin hata mesajını oradan alıyor.
    const unaffordable =
      risk.cost !== null && missingResources(ledgerOf(snapshot.kingdom), risk.cost) !== null;

    if (risk.tier === 'major' && !ctx.preApproved && !unaffordable) {
      const parked = await parkPendingDecision(tx, snapshot, actionName, args, risk, now);
      result = {
        ok: false,
        errorCode: 'requirement_not_met',
        message:
          `Bu büyük bir karar, kendi başıma uygulamıyorum. Kral'ın onayını bekliyorum. ` +
          `Gerekçe: ${risk.reasons.join(' ')}`,
        pendingDecisionId: parked.id,
        quotaSpent: 0,
      };
      await logAction(tx, ctx.kingdomId, actionName, args, result, 'major', fullCtx.source, 0);
      if (ctx.nonce) await storeIdempotency(tx, ctx.nonce, ctx.kingdomId, result);
      return result;
    }

    // --- Emir kotası (§14.4) ----------------------------------------------
    const quotaCost = actionConsumesQuota(actionName) ? 1 : 0;
    if (quotaCost > 0) {
      const granted = await spendDecreeQuota(tx, ctx.kingdomId, quotaCost);
      if (!granted) {
        result = fail(
          'insufficient_quota',
          'Emir kotası doldu. Bir sonraki saat başında yenilenecek — o ana kadar yeni bir emir uygulayamam.',
        );
        await logAction(tx, ctx.kingdomId, actionName, args, result, risk.tier, fullCtx.source, 0);
        return result;
      }
    }

    try {
      result = await handler(tx, snapshot, args, fullCtx);
    } catch (error) {
      // Handler'ın attığı beklenmedik hata transaction'ı geri alır; ama biz
      // burada yakalayıp anlamlı bir sonuç dönebilmek için kotayı iade ederiz.
      console.error(`[action] ${actionName} beklenmedik hata:`, error);
      result = fail('internal_error', 'Emir uygulanırken beklenmedik bir sorun oluştu.');
    }

    // Başarısız aksiyon kotayı yakmamalı — model hatalı argüman gönderdiğinde
    // oyuncu cezalandırılmasın.
    if (!result.ok && quotaCost > 0) {
      await refundDecreeQuota(tx, ctx.kingdomId, quotaCost);
      result.quotaSpent = 0;
    } else {
      result.quotaSpent = quotaCost;
    }

    await logAction(
      tx,
      ctx.kingdomId,
      actionName,
      args,
      result,
      risk.tier,
      fullCtx.source,
      result.quotaSpent ?? 0,
    );
    if (ctx.nonce) await storeIdempotency(tx, ctx.nonce, ctx.kingdomId, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Risk değerlendirmesi ve bekleyen karar
// ---------------------------------------------------------------------------

async function assessActionRisk(
  _tx: Tx,
  snapshot: KingdomSnapshot,
  actionName: string,
  args: Record<string, unknown>,
  _now: Date,
): Promise<{
  tier: 'routine' | 'major';
  reasons: string[];
  severity: number;
  /** Aksiyonun somut kaynak maliyeti; bilinmiyorsa `null`. */
  cost: ResourceBundle | null;
}> {
  // Okuma amaçlı ve tepkisel aksiyonlar hiçbir zaman büyük karar sayılmaz.
  if (!actionConsumesQuota(actionName)) {
    return { tier: 'routine', reasons: [], severity: 0, cost: null };
  }

  let estimatedCost = 0;
  let unitsCommitted = 0;
  let intent: string | undefined;
  let proposalType: string | undefined;
  let cost: ResourceBundle | null = null;

  switch (actionName) {
    case 'build_structure': {
      const type = asEnum(args.building_type, Object.keys(BUILDINGS) as BuildingType[]);
      const level = asInt(args.target_level) ?? 1;
      if (type) {
        cost = buildingCostAtLevel(type, level);
        estimatedCost = estimateGoldValue(cost);
      }
      break;
    }
    case 'train_unit': {
      const type = asEnum(args.unit_type, Object.keys(UNITS) as UnitType[]);
      const count = asInt(args.count) ?? 0;
      if (type) {
        cost = scaleBundle(UNITS[type].cost, count);
        estimatedCost = estimateGoldValue(cost);
      }
      break;
    }
    case 'hire_mercenaries': {
      const count = asInt(args.count) ?? 0;
      cost = scaleBundle(UNITS.mercenary.cost, count);
      estimatedCost = estimateGoldValue(cost);
      break;
    }
    case 'move_army': {
      const units = asArmyComposition(args.units);
      unitsCommitted = armyUnitCount(units);
      intent = asString(args.intent) ?? undefined;
      break;
    }
    case 'send_diplomacy_message':
    case 'propose_troop_rental': {
      proposalType =
        actionName === 'propose_troop_rental'
          ? 'troop_rental'
          : (asString(args.proposal_type) ?? undefined);
      break;
    }
    case 'deep_excavation': {
      const building = snapshot.buildings.find((b) => b.id === asString(args.building_id));
      if (building) {
        cost = { gold: deepExcavationCost(building.deep_excavations_used) };
        estimatedCost = cost.gold ?? 0;
      }
      break;
    }
    case 'host_festival': {
      cost = BALANCE.festival.cost as ResourceBundle;
      estimatedCost = estimateGoldValue(cost);
      break;
    }
    default:
      break;
  }

  const garrisonSize = armyUnitCount(deployableGarrisonOf(snapshot));

  const risk = assessRisk({
    action: actionName,
    estimatedCost,
    treasuryGold: snapshot.kingdom.gold,
    unitsCommitted,
    garrisonSize,
    ...(intent ? { intent } : {}),
    ...(proposalType ? { proposalType } : {}),
  });

  return { ...risk, cost };
}

async function parkPendingDecision(
  tx: Tx,
  snapshot: KingdomSnapshot,
  actionName: string,
  args: Record<string, unknown>,
  risk: { reasons: string[]; severity: number },
  now: Date,
): Promise<{ id: string }> {
  const expiresAt = new Date(
    now.getTime() + BALANCE.general.pendingDecisionTimeoutHours * 3600_000,
  );
  const row = await txQueryOne<{ id: string }>(
    tx,
    `INSERT INTO pending_decisions
       (kingdom_id, proposed_action_json, general_recommendation_text, risk_reasons, risk_severity, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      snapshot.kingdom.id,
      JSON.stringify({ name: actionName, arguments: args }),
      `Efendimiz, bu kararı kendi başıma almam doğru olmaz. ${risk.reasons.join(' ')} Onayınızı bekliyorum.`,
      JSON.stringify(risk.reasons),
      risk.severity,
      expiresAt,
    ],
  );

  await notify(tx, {
    kingdomId: snapshot.kingdom.id,
    kind: 'decision_required',
    severity: 'warning',
    title: 'Onayınız bekleniyor',
    body: risk.reasons.join(' '),
    relatedId: row?.id ?? null,
    payload: { action: actionName, arguments: args },
  });

  return { id: row?.id ?? '' };
}

async function logAction(
  tx: Tx,
  kingdomId: string,
  actionName: string,
  args: Record<string, unknown>,
  result: ActionResult,
  tier: 'routine' | 'major',
  source: 'active' | 'passive' | 'system',
  quotaSpent: number,
): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO action_log (kingdom_id, action_name, arguments, ok, error_code, message, quota_spent, tier, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      kingdomId,
      actionName,
      JSON.stringify(args),
      result.ok,
      result.errorCode ?? null,
      result.message.slice(0, 2000),
      quotaSpent,
      tier,
      source,
    ],
  );
}

async function storeIdempotency(
  tx: Tx,
  nonce: string,
  kingdomId: string,
  result: ActionResult,
): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO action_idempotency (nonce, kingdom_id, result)
     VALUES ($1, $2, $3)
     ON CONFLICT (nonce) DO NOTHING`,
    [nonce, kingdomId, JSON.stringify(result)],
  );
}

// ---------------------------------------------------------------------------
// Tile seçimi
// ---------------------------------------------------------------------------

/**
 * Üretim binası için en uygun tile'ı seçer.
 *
 * Arazi çarpanı (§3) en yüksek olan boş tile tercih edilir — oyuncu tek tek
 * tile seçmek zorunda kalmasın, ama coğrafyanın anlamı da kaybolmasın. Aynı
 * tile'a birden fazla üretim binası konabilir; kısıt bina slotu, tile değil.
 */
function pickTileForBuilding(
  snapshot: KingdomSnapshot,
  type: BuildingType,
): MapTileRow | null {
  const def = BUILDINGS[type];
  if (!def.terrainMultiplier && !def.hasMineReserve) {
    return snapshot.capitalTile;
  }

  // Maden için: aynı tile'da başka maden olmasın, rezervler ayrı ayrı tükensin.
  const occupiedByMine = new Set(
    snapshot.buildings
      .filter((b) => BUILDINGS[b.type].hasMineReserve && b.tile_id)
      .map((b) => b.tile_id as string),
  );

  const candidates = snapshot.ownedTiles.filter(
    (t) => !def.hasMineReserve || !occupiedByMine.has(t.id),
  );
  if (candidates.length === 0) return snapshot.capitalTile;

  let best = candidates[0] ?? null;
  let bestScore = -Infinity;
  for (const tile of candidates) {
    const score = def.terrainMultiplier?.[tile.terrain_type] ?? 1;
    if (score > bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Handler'lar
// ---------------------------------------------------------------------------

const buildStructure: Handler = async (tx, snapshot, args) => {
  const type = asEnum(args.building_type, Object.keys(BUILDINGS) as BuildingType[]);
  if (!type) return fail('invalid_arguments', 'Geçersiz bina tipi.');

  const keepLevel = keepLevelOf(snapshot);
  const def = BUILDINGS[type];

  const buildingId = asString(args.building_id);
  let existing: BuildingInstanceRow | undefined;
  if (buildingId) {
    existing = snapshot.buildings.find((b) => b.id === buildingId);
    if (!existing) return fail('building_missing', 'Belirtilen bina bulunamadı.');
    if (existing.type !== type) {
      return fail('invalid_arguments', 'Bina kimliği ile bina tipi uyuşmuyor.');
    }
  } else if (!MULTI_INSTANCE_BUILDINGS.has(type)) {
    // Tekil binalarda kimlik verilmese bile mevcut olanı yükseltmek istenmiştir.
    existing = snapshot.buildings.find((b) => b.type === type);
  }

  const currentLevel = existing?.level ?? 0;
  const targetLevel = asInt(args.target_level) ?? currentLevel + 1;

  if (targetLevel !== currentLevel + 1) {
    return fail(
      'invalid_arguments',
      `Seviyeler tek tek yükselir. ${def.nameTr} şu an Sv.${currentLevel}; hedef Sv.${currentLevel + 1} olmalı.`,
    );
  }
  if (targetLevel > def.maxLevel) {
    return fail('requirement_not_met', `${def.nameTr} en fazla Sv.${def.maxLevel} olabilir.`);
  }

  // Kale kendi seviyesinin önkoşuludur; diğer binalar için Kale seviyesi bakılır.
  if (type !== 'keep' && !isBuildingUnlocked(type, keepLevel)) {
    return fail(
      'requirement_not_met',
      `${def.nameTr} için Kale Sv.${def.requiresKeepLevel} gerekiyor; şu an Sv.${keepLevel}.`,
    );
  }

  if (existing?.upgrade_completes_at) {
    return fail('building_busy', `${def.nameTr} zaten yükseltiliyor.`);
  }

  // Yeni bina ise slot kontrolü.
  if (!existing) {
    const used = buildingSlotsUsedOf(snapshot);
    const total = buildingSlotsTotalOf(snapshot);
    if (used >= total) {
      return fail(
        'requirement_not_met',
        `Bina slotları dolu (${used}/${total}). Kale'yi yükseltmeden yeni bina kuramayız.`,
      );
    }
    if (!MULTI_INSTANCE_BUILDINGS.has(type) && snapshot.buildings.some((b) => b.type === type)) {
      return fail('requirement_not_met', `${def.nameTr} zaten mevcut; yükseltilebilir.`);
    }
  }

  const cost = buildingCostAtLevel(type, targetLevel);
  const missing = missingResources(ledgerOf(snapshot.kingdom), cost);
  if (missing) {
    return fail(
      'insufficient_resources',
      `Yetersiz kaynak. Eksik: ${describeBundle(missing)}.`,
    );
  }

  const spent = await spendResources(tx, snapshot.kingdom.id, cost);
  if (!spent) return fail('insufficient_resources', 'Kaynaklar bu arada tükendi.');

  const seconds = buildingBuildSeconds(type, targetLevel, keepLevel);
  const now = config.now();
  const completesAt = new Date(now.getTime() + seconds * 1000);

  if (existing) {
    await txQuery(
      tx,
      `UPDATE building_instances
          SET upgrading_to_level = $2, upgrade_started_at = $3, upgrade_completes_at = $4
        WHERE id = $1`,
      [existing.id, targetLevel, now, completesAt],
    );
  } else {
    const tile = pickTileForBuilding(snapshot, type);
    const inserted = await txQueryOne<{ id: string }>(
      tx,
      `INSERT INTO building_instances
         (kingdom_id, type, level, upgrading_to_level, upgrade_started_at, upgrade_completes_at, tile_id)
       VALUES ($1, $2, 0, $3, $4, $5, $6)
       RETURNING id`,
      [snapshot.kingdom.id, type, targetLevel, now, completesAt, tile?.id ?? null],
    );

    // Maden ilk kez kurulduğunda tile'a rezerv yazılır (§4.1).
    if (def.hasMineReserve && tile && tile.mine_reserve_capacity === null) {
      const capacity = mineReserveCapacity(1);
      await txQuery(
        tx,
        'UPDATE map_tiles SET mine_reserve_capacity = $2, mine_reserve_remaining = $2 WHERE id = $1',
        [tile.id, capacity],
      );
    }
    void inserted;
  }

  return ok(
    `${def.nameTr} Sv.${targetLevel} inşaatı başladı; ${formatDuration(seconds)} sonra tamamlanacak.`,
    { buildingType: type, targetLevel, completesAt: completesAt.toISOString() },
  );
};

const trainUnit: Handler = async (tx, snapshot, args) => {
  const type = asEnum(args.unit_type, Object.keys(UNITS) as UnitType[]);
  if (!type) return fail('invalid_arguments', 'Geçersiz birim tipi.');
  const count = asInt(args.count);
  if (count === null || count <= 0) return fail('invalid_arguments', 'Adet pozitif olmalı.');

  const def = UNITS[type];
  if (def.trainedAt === null) {
    return fail(
      'invalid_arguments',
      `${def.nameTr} eğitilmez, altınla anında satın alınır — hire_mercenaries kullan.`,
    );
  }

  const building = snapshot.buildings.find(
    (b) => b.type === def.trainedAt && b.level >= def.requiresBuildingLevel,
  );
  if (!building) {
    return fail(
      'requirement_not_met',
      `${def.nameTr} için ${BUILDINGS[def.trainedAt].nameTr} Sv.${def.requiresBuildingLevel} gerekiyor.`,
    );
  }

  const cost = scaleBundle(def.cost, count);
  const missing = missingResources(ledgerOf(snapshot.kingdom), cost);
  if (missing) {
    return fail('insufficient_resources', `Yetersiz kaynak. Eksik: ${describeBundle(missing)}.`);
  }

  // Nüfus kontrolü: ordu büyütmek halkı ekonomiden çekmek demektir (§7).
  const militaryPop = militaryPopulationOf(snapshot);
  const addedPop = def.populationCost * count;
  if (militaryPop + addedPop > snapshot.kingdom.population) {
    const capacity = Math.floor(
      Math.max(0, snapshot.kingdom.population - militaryPop) / Math.max(1, def.populationCost),
    );
    return fail(
      'insufficient_population',
      `Nüfus yetmiyor. ${count} ${def.nameTr} ${addedPop} kişi gerektiriyor; en fazla ${capacity} tane eğitebiliriz.`,
    );
  }

  const spent = await spendResources(tx, snapshot.kingdom.id, cost);
  if (!spent) return fail('insufficient_resources', 'Kaynaklar bu arada tükendi.');

  // Bina seviyesi eğitimi hızlandırır: her seviye %8 kısaltır.
  const speedup = Math.pow(0.92, Math.max(0, building.level - 1));
  const seconds = Math.max(30, Math.round(def.trainSeconds * count * speedup));
  const completesAt = new Date(config.now().getTime() + seconds * 1000);

  await txQuery(
    tx,
    `INSERT INTO training_queue (kingdom_id, unit_type, count, completes_at)
     VALUES ($1, $2, $3, $4)`,
    [snapshot.kingdom.id, type, count, completesAt],
  );

  return ok(
    `${count} ${def.nameTr} eğitim kuyruğuna alındı; ${formatDuration(seconds)} sonra hazır olacak.`,
    { unitType: type, count, completesAt: completesAt.toISOString() },
  );
};

const hireMercenaries: Handler = async (tx, snapshot, args) => {
  const count = asInt(args.count);
  if (count === null || count <= 0) return fail('invalid_arguments', 'Adet pozitif olmalı.');

  const cost = scaleBundle(UNITS.mercenary.cost, count);
  const missing = missingResources(ledgerOf(snapshot.kingdom), cost);
  if (missing) {
    return fail('insufficient_resources', `Yetersiz altın. Eksik: ${describeBundle(missing)}.`);
  }

  const spent = await spendResources(tx, snapshot.kingdom.id, cost);
  if (!spent) return fail('insufficient_resources', 'Altın bu arada tükendi.');

  // Nüfus maliyeti yok (§7) — bu, kiralık askerin tek ama pahalı ayrıcalığı.
  await txQuery(
    tx,
    `INSERT INTO unit_stocks (kingdom_id, unit_type, count) VALUES ($1, 'mercenary', $2)
     ON CONFLICT (kingdom_id, unit_type) DO UPDATE SET count = unit_stocks.count + $2`,
    [snapshot.kingdom.id, count],
  );

  return ok(
    `${count} Kiralık Asker anında göreve alındı. Nüfustan çalmadılar ama erzak yükleri ağır.`,
    { count },
  );
};

const moveArmy: Handler = async (tx, snapshot, args, ctx) => {
  const targetX = asInt(args.target_x);
  const targetY = asInt(args.target_y);
  if (targetX === null || targetY === null) {
    return fail('invalid_arguments', 'Hedef koordinatlar eksik.');
  }
  const intent = asEnum<ArmyIntent>(args.intent, ['attack', 'reinforce', 'scout', 'raid']);
  if (!intent) return fail('invalid_arguments', 'Geçersiz sefer niyeti.');

  const units = normalizeArmy(asArmyComposition(args.units));
  if (armyUnitCount(units) === 0) {
    return fail('invalid_arguments', 'Sefere çıkacak birim belirtilmedi.');
  }

  // Koruma altındayken saldırı seferi çıkarılamaz (§13).
  if (
    !BALANCE.protection.canAttackWhileProtected &&
    isProtected(snapshot.kingdom, ctx.now) &&
    (intent === 'attack' || intent === 'raid')
  ) {
    return fail(
      'protection_active',
      'Yeni oyuncu koruması altındayken saldırı seferi çıkaramayız.',
    );
  }

  // Kiralanan birlikler yalnızca savunmada kullanılabilir (§10.5) — bu yüzden
  // sefer için garnizonun tamamı değil, yalnızca *kendi* birliklerimiz sayılır.
  const deployable = deployableGarrisonOf(snapshot);
  if (!armyContains(deployable, units)) {
    return fail(
      'insufficient_population',
      'Garnizonda o kadar birlik yok. Kiralanmış birlikler yalnızca savunmada kullanılabilir, sefere çıkarılamaz.',
    );
  }

  // Kuşatma makineleri mühendissiz yola çıkamaz (§7).
  const support = missingSupportUnits(units);
  if (support.needed > support.available) {
    return fail(
      'requirement_not_met',
      `Kuşatma makineleri için ${support.needed} mühendis gerekiyor, orduda ${support.available} var.`,
    );
  }

  const targetTile = await loadTileAt(snapshot.channel.id, targetX, targetY, tx);
  if (!targetTile) return fail('invalid_target', 'Hedef koordinatta bir tile yok.');
  if (!snapshot.capitalTile) return fail('internal_error', 'Başkent tile bulunamadı.');

  if (targetTile.owner_kingdom_id === snapshot.kingdom.id && intent !== 'reinforce') {
    return fail('invalid_target', 'Kendi toprağına saldırı ya da akın düzenlenemez.');
  }

  // Hedef krallık koruma altındaysa saldırılamaz.
  if (targetTile.owner_kingdom_id && (intent === 'attack' || intent === 'raid')) {
    const target = await txQueryOne<KingdomRow>(
      tx,
      'SELECT * FROM kingdoms WHERE id = $1',
      [targetTile.owner_kingdom_id],
    );
    if (target && isProtected(target, ctx.now)) {
      return fail(
        'protection_active',
        `${target.name} yeni oyuncu koruması altında; saldırılamaz.`,
      );
    }
  }

  const distance = tileDistance(snapshot.capitalTile, targetTile);
  const seconds = marchSeconds(units, distance, targetTile.terrain_type);
  const fatigue = fatigueMultiplier(distance);
  const tactic = asEnum<Tactic>(args.tactic, ['ambush', 'frontal', 'withdraw_to_keep', 'terrain_advantage']) ?? 'frontal';

  await removeUnits(tx, snapshot.kingdom.id, units);

  const now = ctx.now;
  const arrivesAt = new Date(now.getTime() + seconds * 1000);

  const army = await txQueryOne<{ id: string }>(
    tx,
    `INSERT INTO armies
       (kingdom_id, channel_id, composition, origin_tile_id, target_tile_id,
        departs_at, arrives_at, intent, fatigue_factor, tactic, distance_tiles)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      snapshot.kingdom.id,
      snapshot.channel.id,
      JSON.stringify(units),
      snapshot.capitalTile.id,
      targetTile.id,
      now,
      arrivesAt,
      intent,
      fatigue,
      tactic,
      distance,
    ],
  );

  // Saldırı hedefine önceden haber gider — savunanın hazırlanma şansı olsun,
  // takviye penceresi (§8.2) anlamlı kalsın.
  if (targetTile.owner_kingdom_id && (intent === 'attack' || intent === 'raid')) {
    await notify(tx, {
      kingdomId: targetTile.owner_kingdom_id,
      kind: 'attack_incoming',
      severity: 'critical',
      title: 'Sınırınıza bir ordu yaklaşıyor',
      body: `${snapshot.kingdom.name} yönünden bir ordu geliyor. Tahmini varış: ${formatDuration(seconds)} sonra.`,
      relatedId: army?.id ?? null,
      payload: { arrivesAt: arrivesAt.toISOString(), intent },
    });

    await recordRegionActivity(tx, {
      channelId: snapshot.channel.id,
      originX: targetTile.x,
      originY: targetTile.y,
      severity: intent === 'attack' ? 'major' : 'routine',
      summary:
        intent === 'attack'
          ? `${snapshot.kingdom.name}, ${targetTile.x},${targetTile.y} yönüne bir sefer başlattı.`
          : `${snapshot.kingdom.name} çevrede bir akın düzenliyor.`,
      relatedKingdomIds: [snapshot.kingdom.id, targetTile.owner_kingdom_id],
    });
  }

  const intentTr: Record<ArmyIntent, string> = {
    attack: 'saldırı',
    raid: 'akın',
    reinforce: 'takviye',
    scout: 'keşif',
    return: 'dönüş',
  };

  return ok(
    `${armyUnitCount(units)} birlik ${intentTr[intent]} için yola çıktı. ` +
      `Mesafe ${distance} tile, varış ${formatDuration(seconds)} sonra. ` +
      (fatigue < 1
        ? `Uzak sefer nedeniyle güçleri %${Math.round((1 - fatigue) * 100)} yorgunluk cezası taşıyor.`
        : 'Yorgunluk cezası yok.'),
    { armyId: army?.id, distance, arrivesAt: arrivesAt.toISOString(), fatigue },
  );
};

const sendCaravan: Handler = async (tx, snapshot, args, ctx) => {
  const resource = asEnum<Resource>(args.resource_type, [
    'gold', 'food', 'stone', 'wood', 'iron', 'ale',
    'wheat', 'flour', 'hops', 'milk', 'ore', 'weapons', 'cheese',
  ]);
  if (!resource) return fail('invalid_arguments', 'Geçersiz kaynak tipi.');

  const originId = asString(args.origin_tile_id);
  const targetId = asString(args.target_tile_id);
  if (!originId || !targetId) {
    return fail('invalid_arguments', 'Kervanın kalkış ve varış tile kimlikleri gerekli.');
  }

  const origin = await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [originId]);
  const target = await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [targetId]);
  if (!origin || !target) return fail('invalid_target', 'Tile bulunamadı.');
  if (origin.owner_kingdom_id !== snapshot.kingdom.id) {
    return fail('not_authorized', 'Kervan yalnızca kendi topraklarınızdan kalkabilir.');
  }

  // Fethedilmiş bölgede bekleyen kaynaklar (§9): kervan bunları taşır.
  const stockpile = await txQueryOne<{ amount: number }>(
    tx,
    'SELECT amount FROM tile_stockpiles WHERE tile_id = $1 AND resource = $2',
    [originId, resource],
  );
  const available = stockpile?.amount ?? 0;
  if (available <= 0) {
    return fail('invalid_target', 'Bu bölgede taşınacak o kaynaktan yok.');
  }

  const requested = asInt(args.amount) ?? available;
  const load = caravanLoad(Math.min(requested, available));
  if (load <= 0) return fail('invalid_arguments', 'Taşınacak miktar sıfır.');

  const goldCost: ResourceBundle = { gold: BALANCE.caravan.goldCost };
  if (!(await spendResources(tx, snapshot.kingdom.id, goldCost))) {
    return fail('insufficient_resources', 'Kervan masrafı için altın yetersiz.');
  }

  await txQuery(
    tx,
    'UPDATE tile_stockpiles SET amount = amount - $3, updated_at = now() WHERE tile_id = $1 AND resource = $2',
    [originId, resource, load],
  );

  const distance = tileDistance(origin, target);
  const seconds = caravanTravelSeconds(distance);
  const arrivesAt = new Date(ctx.now.getTime() + seconds * 1000);

  await txQuery(
    tx,
    `INSERT INTO caravans
       (kingdom_id, channel_id, origin_tile_id, target_tile_id, target_kingdom_id,
        resource_type, amount, arrives_at, purpose)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'conquest_transfer')`,
    [
      snapshot.kingdom.id,
      snapshot.channel.id,
      originId,
      targetId,
      target.owner_kingdom_id,
      resource,
      load,
      arrivesAt,
    ],
  );

  const remaining = available - load;
  const tripsLeft = Math.ceil(remaining / BALANCE.caravan.capacityPerTrip);

  return ok(
    `Kervan ${load} ${resourceLabel(resource)} yükledi; ${formatDuration(seconds)} sonra varacak.` +
      (remaining > 0
        ? ` Bölgede ${Math.round(remaining)} birim daha var — boşaltmak için ${tripsLeft} sefer daha gerekiyor.`
        : ' Bölgedeki depo tamamen boşaldı.'),
    { load, remaining, tripsLeft, arrivesAt: arrivesAt.toISOString() },
  );
};

const hostFestival: Handler = async (tx, snapshot, args, ctx) => {
  void args;
  const cost = BALANCE.festival.cost as ResourceBundle;
  const missing = missingResources(ledgerOf(snapshot.kingdom), cost);
  if (missing) {
    return fail(
      'insufficient_resources',
      `Şenlik için kaynak yetmiyor. Eksik: ${describeBundle(missing)}.`,
    );
  }

  if (!(await spendResources(tx, snapshot.kingdom.id, cost))) {
    return fail('insufficient_resources', 'Kaynaklar bu arada tükendi.');
  }

  // Azalan getiri (§6.2): pencere dolduysa sayaç sıfırlanır.
  const windowMs = BALANCE.festival.windowHours * 3600_000;
  const windowStart = snapshot.kingdom.festival_window_started_at;
  const windowExpired = !windowStart || ctx.now.getTime() - windowStart.getTime() > windowMs;
  const priorCount = windowExpired ? 0 : snapshot.kingdom.festivals_in_window;

  const boost = festivalBoost(priorCount);
  const newPopularity = clamp(snapshot.kingdom.popularity + boost, 0, 100);
  const bonusUntil = new Date(ctx.now.getTime() + BALANCE.festival.bonusDurationHours * 3600_000);

  await txQuery(
    tx,
    `UPDATE kingdoms
        SET popularity = $2,
            festivals_in_window = $3,
            festival_window_started_at = $4,
            festival_bonus_until = $5,
            festival_bonus_value = $6
      WHERE id = $1`,
    [
      snapshot.kingdom.id,
      newPopularity,
      priorCount + 1,
      windowExpired ? ctx.now : windowStart,
      bonusUntil,
      BALANCE.festival.lingeringBonus * Math.pow(BALANCE.festival.diminishingFactor, priorCount),
    ],
  );

  const note =
    priorCount > 0
      ? ` Bu hafta içindeki ${priorCount + 1}. şenlik olduğu için etkisi azaldı — halkı asıl memnun edecek olan vergi dengesi ve düzenli yiyecek arzı.`
      : '';

  return ok(
    `Şenlik düzenlendi; popülerlik +${boost.toFixed(1)} yükseldi (${newPopularity.toFixed(0)}/100).${note}`,
    { boost, popularity: newPopularity },
  );
};

const setTaxRate: Handler = async (tx, snapshot, args) => {
  const rate = asInt(args.rate_percent);
  if (rate === null || rate < 0 || rate > 100) {
    return fail('invalid_arguments', 'Vergi oranı 0-100 arasında olmalı.');
  }

  await txQuery(tx, 'UPDATE kingdoms SET tax_rate = $2 WHERE id = $1', [snapshot.kingdom.id, rate]);

  const neutral = BALANCE.popularity.taxNeutralRate;
  const note =
    rate > neutral
      ? `Halk bundan hoşlanmayacak — %${neutral} üzerindeki her puan popülerliği aşağı çekiyor.`
      : rate < neutral
        ? 'Halk memnun olacak, ama hazine daha yavaş dolacak.'
        : 'Bu oran halkın kabul ettiği doğal seviye.';

  return ok(`Vergi oranı %${rate} olarak ayarlandı. ${note}`, { taxRate: rate });
};

const setStrategyNote: Handler = async (tx, snapshot, args) => {
  const note = asString(args.note);
  if (!note) return fail('invalid_arguments', 'Strateji notu boş olamaz.');
  const trimmed = note.slice(0, 2000);
  await txQuery(tx, 'UPDATE kingdoms SET strategy_note = $2 WHERE id = $1', [
    snapshot.kingdom.id,
    trimmed,
  ]);
  return ok('Strateji notunuz kaydedildi; yokluğunuzda kararlarımı buna göre alacağım.', {
    note: trimmed,
  });
};

const chooseTactic: Handler = async (tx, snapshot, args) => {
  const siegeId = asString(args.siege_id);
  const tactic = asEnum<Tactic>(args.tactic, [
    'ambush',
    'frontal',
    'withdraw_to_keep',
    'terrain_advantage',
  ]);
  if (!siegeId || !tactic) return fail('invalid_arguments', 'Kuşatma kimliği ve taktik gerekli.');

  const siege = await txQueryOne<SiegeRow>(
    tx,
    `SELECT * FROM sieges WHERE id = $1 AND status = 'ongoing'`,
    [siegeId],
  );
  if (!siege) return fail('invalid_target', 'Devam eden böyle bir kuşatma yok.');

  const isDefender = siege.defender_kingdom_id === snapshot.kingdom.id;
  const isAttacker = siege.attacker_kingdom_id === snapshot.kingdom.id;
  if (!isDefender && !isAttacker) {
    return fail('not_authorized', 'Bu kuşatmanın tarafı değilsiniz.');
  }

  const column = isDefender ? 'defender_tactic' : 'attacker_tactic';
  await txQuery(tx, `UPDATE sieges SET ${column} = $2 WHERE id = $1`, [siegeId, tactic]);

  const tacticTr: Record<Tactic, string> = {
    ambush: 'Pusu',
    frontal: 'Cepheden Karşılama',
    withdraw_to_keep: 'Kaleye Çekilme',
    terrain_advantage: 'Arazi Avantajı',
  };

  return ok(
    `Taktik "${tacticTr[tactic]}" olarak belirlendi; bir sonraki round'dan itibaren geçerli.`,
    { siegeId, tactic },
  );
};

const deepExcavation: Handler = async (tx, snapshot, args) => {
  const buildingId = asString(args.building_id);
  const building = buildingId
    ? snapshot.buildings.find((b) => b.id === buildingId)
    : snapshot.buildings.find((b) => BUILDINGS[b.type].hasMineReserve);
  if (!building) return fail('building_missing', 'Maden bulunamadı.');
  if (!BUILDINGS[building.type].hasMineReserve) {
    return fail('invalid_arguments', 'Derin kazı yalnızca madenlerde yapılabilir.');
  }
  if (!building.tile_id) return fail('internal_error', 'Madenin tile bilgisi yok.');

  const cost = deepExcavationCost(building.deep_excavations_used);
  if (!(await spendResources(tx, snapshot.kingdom.id, { gold: cost }))) {
    return fail('insufficient_resources', `Derin kazı ${cost} altın tutuyor; hazine yetersiz.`);
  }

  const refund = deepExcavationRefund(building.level);
  await txQuery(
    tx,
    `UPDATE map_tiles
        SET mine_reserve_remaining = LEAST(
              COALESCE(mine_reserve_capacity, $3),
              COALESCE(mine_reserve_remaining, 0) + $2)
      WHERE id = $1`,
    [building.tile_id, refund, mineReserveCapacity(building.level)],
  );
  await txQuery(
    tx,
    'UPDATE building_instances SET deep_excavations_used = deep_excavations_used + 1 WHERE id = $1',
    [building.id],
  );

  const nextCost = deepExcavationCost(building.deep_excavations_used + 1);
  return ok(
    `Derin kazı tamamlandı: rezerve ${refund} birim eklendi (${cost} altın). ` +
      `Bir sonraki kazı ${nextCost} altın tutacak — bir noktadan sonra yeni bir maden tile'ı bulmak daha ucuza gelecek.`,
    { refund, cost, nextCost },
  );
};

const deploySpy: Handler = async (tx, snapshot, args, ctx) => {
  const targetId = asString(args.target_kingdom_id);
  const mission = asEnum(args.mission, ['gather_intel', 'sabotage'] as const);
  if (!targetId || !mission) return fail('invalid_arguments', 'Hedef krallık ve görev gerekli.');
  if (targetId === snapshot.kingdom.id) {
    return fail('invalid_target', 'Kendi krallığınıza casus gönderemezsiniz.');
  }

  if ((snapshot.garrison.spy ?? 0) < 1) {
    return fail('requirement_not_met', 'Elimizde casus yok; önce Kışla\'da casus eğitmeliyiz.');
  }

  const target = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [targetId]);
  if (!target || target.channel_id !== snapshot.channel.id) {
    return fail('invalid_target', 'Hedef krallık bu channel\'da bulunamadı.');
  }

  const targetTile = target.capital_tile_id
    ? await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [target.capital_tile_id])
    : null;
  const distance =
    snapshot.capitalTile && targetTile ? tileDistance(snapshot.capitalTile, targetTile) : 10;

  await removeUnits(tx, snapshot.kingdom.id, { spy: 1 });

  const seconds = UNITS.spy.secondsPerTile * Math.max(1, distance);
  const resolvesAt = new Date(ctx.now.getTime() + seconds * 1000);

  await txQuery(
    tx,
    `INSERT INTO spy_missions (channel_id, origin_kingdom_id, target_kingdom_id, mission, resolves_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [snapshot.channel.id, snapshot.kingdom.id, targetId, mission, resolvesAt],
  );

  return ok(
    `Casus ${target.name} yönüne gönderildi (${mission === 'sabotage' ? 'sabotaj' : 'istihbarat'}). ` +
      `${formatDuration(seconds)} sonra haber bekliyoruz. Yakalanırsa itibarımız zarar görür.`,
    { targetKingdomId: targetId, mission, resolvesAt: resolvesAt.toISOString() },
  );
};

const postMarketOffer: Handler = async (tx, snapshot, args, ctx) => {
  const offerResource = asEnum<Resource>(args.offer_resource, ['gold', 'food', 'stone', 'wood', 'iron', 'ale']);
  const requestResource = asEnum<Resource>(args.request_resource, ['gold', 'food', 'stone', 'wood', 'iron', 'ale']);
  const offerAmount = asInt(args.offer_amount);
  const requestAmount = asInt(args.request_amount);

  if (!offerResource || !requestResource || offerAmount === null || requestAmount === null) {
    return fail('invalid_arguments', 'Teklifin dört alanı da gerekli.');
  }
  if (offerAmount <= 0 || requestAmount <= 0) {
    return fail('invalid_arguments', 'Miktarlar pozitif olmalı.');
  }
  if (offerResource === requestResource) {
    return fail('invalid_arguments', 'Aynı kaynağı kendisiyle takas edemeyiz.');
  }

  const market = snapshot.buildings.find((b) => b.type === 'market' && b.level > 0);
  if (!market) return fail('building_missing', 'Pazar binası olmadan ilan yayınlayamayız.');

  // İlan slotu = Pazar seviyesi × slot/seviye (§10.6).
  const slots =
    BALANCE.market.baseOfferSlots + market.level * (BUILDINGS.market.offerSlotsPerLevel ?? 0);
  const openCount = await txQueryOne<{ count: number }>(
    tx,
    `SELECT COUNT(*)::int AS count FROM market_offers WHERE kingdom_id = $1 AND status = 'open'`,
    [snapshot.kingdom.id],
  );
  if ((openCount?.count ?? 0) >= slots) {
    return fail(
      'requirement_not_met',
      `Açık ilan sınırına ulaştık (${slots}). Pazar'ı yükseltmeden yeni ilan veremeyiz.`,
    );
  }

  // Verilecek kaynak ilan anında rezerve edilir; olmayan malı satmak yok.
  if (!(await spendResources(tx, snapshot.kingdom.id, { [offerResource]: offerAmount }))) {
    return fail('insufficient_resources', `Depoda ${offerAmount} ${resourceLabel(offerResource)} yok.`);
  }

  const expiresAt = new Date(ctx.now.getTime() + BALANCE.market.offerExpiryHours * 3600_000);
  const offer = await txQueryOne<{ id: string }>(
    tx,
    `INSERT INTO market_offers
       (channel_id, kingdom_id, offer_resource, offer_amount, request_resource, request_amount, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      snapshot.channel.id,
      snapshot.kingdom.id,
      offerResource,
      offerAmount,
      requestResource,
      requestAmount,
      expiresAt,
    ],
  );

  return ok(
    `Pazar ilanı yayınlandı: ${offerAmount} ${resourceLabel(offerResource)} karşılığında ` +
      `${requestAmount} ${resourceLabel(requestResource)}. ` +
      'İlan düşmanlar dahil herkese görünür — neye ihtiyacımız olduğunu ele verdiğini unutmayın.',
    { offerId: offer?.id, expiresAt: expiresAt.toISOString() },
  );
};

const acceptMarketOffer: Handler = async (tx, snapshot, args, ctx) => {
  const offerId = asString(args.offer_id);
  if (!offerId) return fail('invalid_arguments', 'İlan kimliği gerekli.');

  const market = snapshot.buildings.find((b) => b.type === 'market' && b.level > 0);
  if (!market) return fail('building_missing', 'Pazar binası olmadan ilan kabul edemeyiz.');

  // İlanı kilitle: iki krallık aynı ilanı aynı anda kabul edemesin.
  const offer = await txQueryOne<MarketOfferRow>(
    tx,
    `SELECT * FROM market_offers WHERE id = $1 AND status = 'open' FOR UPDATE`,
    [offerId],
  );
  if (!offer) return fail('invalid_target', 'İlan bulunamadı ya da çoktan kapandı.');
  if (offer.kingdom_id === snapshot.kingdom.id) {
    return fail('invalid_target', 'Kendi ilanınızı kabul edemezsiniz.');
  }
  if (offer.expires_at.getTime() <= ctx.now.getTime()) {
    return fail('invalid_target', 'İlanın süresi dolmuş.');
  }

  // İstenen kaynağı öderiz.
  if (!(await spendResources(tx, snapshot.kingdom.id, { [offer.request_resource]: offer.request_amount }))) {
    return fail(
      'insufficient_resources',
      `Bu ilan için ${offer.request_amount} ${resourceLabel(offer.request_resource)} gerekiyor; depomuzda yok.`,
    );
  }

  await txQuery(
    tx,
    `UPDATE market_offers SET status = 'accepted', accepted_by_kingdom_id = $2, accepted_at = now() WHERE id = $1`,
    [offerId, snapshot.kingdom.id],
  );

  // Kaynaklar anında ışınlanmaz — nakliye kervanıyla taşınır (§10.6).
  const seller = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [
    offer.kingdom_id,
  ]);
  const sellerTile = seller?.capital_tile_id
    ? await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [seller.capital_tile_id])
    : null;
  const distance =
    snapshot.capitalTile && sellerTile ? tileDistance(snapshot.capitalTile, sellerTile) : 10;
  const seconds = caravanTravelSeconds(distance);

  const trips = await queueTradeCaravans(tx, {
    channelId: snapshot.channel.id,
    fromKingdomId: offer.kingdom_id,
    fromTileId: sellerTile?.id ?? null,
    toKingdomId: snapshot.kingdom.id,
    toTileId: snapshot.capitalTile?.id ?? null,
    resource: offer.offer_resource,
    amount: offer.offer_amount,
    seconds,
    now: ctx.now,
    relatedOfferId: offerId,
  });

  await queueTradeCaravans(tx, {
    channelId: snapshot.channel.id,
    fromKingdomId: snapshot.kingdom.id,
    fromTileId: snapshot.capitalTile?.id ?? null,
    toKingdomId: offer.kingdom_id,
    toTileId: sellerTile?.id ?? null,
    resource: offer.request_resource,
    amount: offer.request_amount,
    seconds,
    now: ctx.now,
    relatedOfferId: offerId,
  });

  await notify(tx, {
    kingdomId: offer.kingdom_id,
    kind: 'diplomacy',
    title: 'Pazar ilanınız kabul edildi',
    body: `${snapshot.kingdom.name} ilanınızı kabul etti. Kervanlar yola çıktı.`,
    relatedId: offerId,
  });

  return ok(
    `İlan kabul edildi. ${offer.offer_amount} ${resourceLabel(offer.offer_resource)} ` +
      `${trips} kervan seferiyle taşınacak; ilk sefer ${formatDuration(seconds)} sonra varacak. ` +
      `Mesafe ${distance} tile — yakın komşularla ticaret her zaman daha verimli.`,
    { offerId, trips, distance },
  );
};

const sendDiplomacyMessage: Handler = async (tx, snapshot, args, ctx) => {
  const targetId = asString(args.target_kingdom_id);
  const message = asString(args.message);
  const proposalType = asEnum<ProposalType>(args.proposal_type, [
    'ceasefire',
    'alliance',
    'trade',
    'protection_offer',
    'vassalage_request',
    'betrayal_signal',
    'troop_rental',
  ]);
  if (!targetId || !message || !proposalType) {
    return fail('invalid_arguments', 'Hedef krallık, mesaj ve teklif türü gerekli.');
  }
  if (targetId === snapshot.kingdom.id) {
    return fail('invalid_target', 'Kendinize teklif gönderemezsiniz.');
  }

  const target = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [targetId]);
  if (!target || target.channel_id !== snapshot.channel.id || target.status !== 'active') {
    return fail('invalid_target', 'Hedef krallık bulunamadı ya da artık ayakta değil.');
  }

  const terms = (args.terms && typeof args.terms === 'object' ? args.terms : {}) as Record<
    string,
    unknown
  >;

  const thread = await txQueryOne<{ id: string }>(
    tx,
    `INSERT INTO diplomacy_threads
       (channel_id, from_kingdom_id, to_kingdom_id, proposal_type, terms, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      snapshot.channel.id,
      snapshot.kingdom.id,
      targetId,
      proposalType,
      JSON.stringify(terms),
      new Date(ctx.now.getTime() + 48 * 3600_000),
    ],
  );

  // Açılış turu: bizim General'ımızın sözleri. Karşı tarafın General'ı bunu
  // pasif/aktif moduna göre yanıtlayacak — insan-insan yazışma hiçbir noktada
  // devreye girmez (§10).
  if (thread) {
    await txQuery(
      tx,
      `INSERT INTO diplomacy_turns (thread_id, speaker_kingdom_id, message, stance)
       VALUES ($1, $2, $3, 'open')`,
      [thread.id, snapshot.kingdom.id, message.slice(0, 4000)],
    );
  }

  await notify(tx, {
    kingdomId: targetId,
    kind: 'diplomacy',
    title: `${snapshot.kingdom.name} bir teklif gönderdi`,
    body: `Teklif türü: ${proposalTypeTr(proposalType)}. General'ınız görüşmeyi yürütüyor.`,
    relatedId: thread?.id ?? null,
  });

  const reputationWarning =
    target.reputation < BALANCE.diplomacy.lowReputationThreshold
      ? ` Uyarı: ${target.name} krallığının itibarı düşük (${Math.round(target.reputation)}/100) — sözünü tutmama ihtimali yüksek.`
      : '';

  return ok(
    `${target.name} krallığının General'ına ${proposalTypeTr(proposalType)} teklifi iletildi. ` +
      `Görüşmeyi ben yürütüyorum; transkripti izleyip beni yönlendirebilirsiniz.${reputationWarning}`,
    { threadId: thread?.id, targetKingdomId: targetId },
  );
};

const proposeTroopRental: Handler = async (tx, snapshot, args, ctx) => {
  const targetId = asString(args.target_kingdom_id);
  const unitType = asEnum<UnitType>(args.unit_type, RENTABLE_UNIT_TYPES);
  const count = asInt(args.count);
  const durationDays = asInt(args.duration_days);
  const feeGold = asInt(args.fee_gold) ?? 0;

  if (!targetId || !unitType || count === null || durationDays === null) {
    return fail('invalid_arguments', 'Hedef, birim tipi, adet ve süre gerekli.');
  }
  if (count <= 0) return fail('invalid_arguments', 'Adet pozitif olmalı.');

  // §10.5: yalnızca temel kara birimleri kiralanabilir; kuşatma ve özel/destek
  // birimleri bu mekanikten hariç.
  if (!UNITS[unitType].rentable) {
    return fail(
      'invalid_arguments',
      `${UNITS[unitType].nameTr} kiralanamaz — yalnızca temel kara birimleri kiralanabilir.`,
    );
  }
  if (!BALANCE.diplomacy.rentalDurationOptions.includes(durationDays as 3 | 7 | 14)) {
    return fail(
      'invalid_arguments',
      `Süre şu seçeneklerden biri olmalı: ${BALANCE.diplomacy.rentalDurationOptions.join(', ')} gün.`,
    );
  }

  const available = deployableGarrisonOf(snapshot)[unitType] ?? 0;
  if (available < count) {
    return fail(
      'insufficient_population',
      `Garnizonda ${available} ${UNITS[unitType].nameTr} var, ${count} kiralanamaz.`,
    );
  }

  const target = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [targetId]);
  if (!target || target.channel_id !== snapshot.channel.id) {
    return fail('invalid_target', 'Hedef krallık bulunamadı.');
  }

  const thread = await txQueryOne<{ id: string }>(
    tx,
    `INSERT INTO diplomacy_threads
       (channel_id, from_kingdom_id, to_kingdom_id, proposal_type, terms, expires_at)
     VALUES ($1, $2, $3, 'troop_rental', $4, $5)
     RETURNING id`,
    [
      snapshot.channel.id,
      snapshot.kingdom.id,
      targetId,
      JSON.stringify({ unit_type: unitType, count, duration_days: durationDays, fee_gold: feeGold }),
      new Date(ctx.now.getTime() + 48 * 3600_000),
    ],
  );

  if (thread) {
    await txQuery(
      tx,
      `INSERT INTO diplomacy_turns (thread_id, speaker_kingdom_id, message, stance)
       VALUES ($1, $2, $3, 'open')`,
      [
        thread.id,
        snapshot.kingdom.id,
        `${count} ${UNITS[unitType].nameTr} birliğimizi ${durationDays} gün süreyle, ` +
          `${feeGold} altın peşin ücret karşılığında savunmanız için kiralamayı teklif ediyoruz.`,
      ],
    );
  }

  await notify(tx, {
    kingdomId: targetId,
    kind: 'diplomacy',
    title: `${snapshot.kingdom.name} birlik kiralama teklif etti`,
    body: `${count} ${UNITS[unitType].nameTr}, ${durationDays} gün, ${feeGold} altın.`,
    relatedId: thread?.id ?? null,
  });

  return ok(
    `Birlik kiralama teklifi gönderildi. Kabul edilirse bu ${count} birlik garnizonumuzdan ayrılacak — ` +
      'kendi savunmamız o süre boyunca zayıflayacak, bunu göze aldığımızı unutmayın.',
    { threadId: thread?.id },
  );
};

const respondToDecision: Handler = async (tx, snapshot, args, ctx) => {
  const decisionId = asString(args.decision_id);
  const response = asEnum(args.response, ['approve', 'reject'] as const);
  if (!decisionId || !response) {
    return fail('invalid_arguments', 'Karar kimliği ve yanıt gerekli.');
  }

  const decision = await txQueryOne<PendingDecisionRow>(
    tx,
    `SELECT * FROM pending_decisions WHERE id = $1 AND kingdom_id = $2 AND status = 'awaiting' FOR UPDATE`,
    [decisionId, snapshot.kingdom.id],
  );
  if (!decision) return fail('invalid_target', 'Bekleyen böyle bir karar yok.');

  if (response === 'reject') {
    await txQuery(
      tx,
      `UPDATE pending_decisions SET status = 'rejected', resolved_at = now(), resolution_note = $2 WHERE id = $1`,
      [decisionId, 'Kral reddetti.'],
    );
    return ok('Karar reddedildi; bu emri uygulamıyorum.', { decisionId, response });
  }

  await txQuery(
    tx,
    `UPDATE pending_decisions SET status = 'approved', resolved_at = now(), resolution_note = $2 WHERE id = $1`,
    [decisionId, 'Kral onayladı.'],
  );

  return ok(
    'Karar onaylandı; emri şimdi uyguluyorum.',
    // Asıl aksiyon aynı transaction içinde çalıştırılamaz (yeni bir kilit ve
    // kota işlemi gerektirir), bu yüzden çağıran taraf `preApproved` ile
    // yeniden tetikler — `pendingAction` bunun için döndürülüyor.
    { decisionId, response, pendingAction: decision.proposed_action_json },
  );
};

const getKingdomStatus: Handler = async (_tx, snapshot) => {
  // Yalnızca okuma; kota harcamaz (§14.4).
  const ledger = ledgerOf(snapshot.kingdom);
  return ok('Krallık durumu okundu.', {
    resources: ledger,
    population: snapshot.kingdom.population,
    popularity: snapshot.kingdom.popularity,
    reputation: snapshot.kingdom.reputation,
    keepLevel: keepLevelOf(snapshot),
    storageCapacity: storageCapacityOf(snapshot),
    quotaRemaining: snapshot.kingdom.decree_quota_remaining,
    garrison: snapshot.garrison,
    buildings: snapshot.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      level: b.level,
      upgradingTo: b.upgrading_to_level,
    })),
  });
};

const getRealmIntel: Handler = async (tx, snapshot, args) => {
  const targetId = asString(args.target_kingdom_id);

  if (targetId) {
    const target = await txQueryOne<KingdomRow>(
      tx,
      'SELECT * FROM kingdoms WHERE id = $1 AND channel_id = $2',
      [targetId, snapshot.channel.id],
    );
    if (!target) return fail('invalid_target', 'Krallık bulunamadı.');
    const warning =
      target.reputation < BALANCE.diplomacy.lowReputationThreshold
        ? 'Bu krallıkla anlaşmadan önce dikkatli olun, itibarı düşük.'
        : null;
    return ok(`${target.name} hakkında bilinenler.`, {
      id: target.id,
      name: target.name,
      // Ayrıntılı üretim/ordu bilgisi yalnızca casusla elde edilir (§10.2);
      // açık istihbarat kaba göstergelerle sınırlı.
      population: Math.round(target.population),
      reputation: Math.round(target.reputation),
      isProtected: isProtected(target, config.now()),
      warning,
    });
  }

  const neighbors = await txQuery<{ id: string; name: string; population: number; reputation: number }>(
    tx,
    `SELECT id, name, population, reputation FROM kingdoms
      WHERE channel_id = $1 AND status = 'active' AND id <> $2
      ORDER BY population DESC LIMIT 20`,
    [snapshot.channel.id, snapshot.kingdom.id],
  );

  const offers = await txQuery<MarketOfferRow>(
    tx,
    `SELECT * FROM market_offers WHERE channel_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 20`,
    [snapshot.channel.id],
  );

  const bulletins = await txQuery<{ summary: string; created_at: Date }>(
    tx,
    `SELECT summary, created_at FROM region_bulletins WHERE kingdom_id = $1 ORDER BY created_at DESC LIMIT 8`,
    [snapshot.kingdom.id],
  );

  return ok('Bölge istihbaratı okundu.', {
    neighbors: neighbors.map((n) => ({
      id: n.id,
      name: n.name,
      population: Math.round(n.population),
      reputation: Math.round(n.reputation),
      lowReputation: n.reputation < BALANCE.diplomacy.lowReputationThreshold,
    })),
    marketOffers: offers.map((o) => ({
      id: o.id,
      gives: `${o.offer_amount} ${resourceLabel(o.offer_resource)}`,
      wants: `${o.request_amount} ${resourceLabel(o.request_resource)}`,
    })),
    recentNews: bulletins.map((b) => b.summary),
  });
};

const HANDLERS: Record<string, Handler> = {
  build_structure: buildStructure,
  train_unit: trainUnit,
  hire_mercenaries: hireMercenaries,
  move_army: moveArmy,
  send_caravan: sendCaravan,
  host_festival: hostFestival,
  set_tax_rate: setTaxRate,
  set_strategy_note: setStrategyNote,
  choose_tactic: chooseTactic,
  deep_excavation: deepExcavation,
  deploy_spy: deploySpy,
  post_market_offer: postMarketOffer,
  accept_market_offer: acceptMarketOffer,
  send_diplomacy_message: sendDiplomacyMessage,
  propose_troop_rental: proposeTroopRental,
  respond_to_decision: respondToDecision,
  get_kingdom_status: getKingdomStatus,
  get_realm_intel: getRealmIntel,
};

// ---------------------------------------------------------------------------
// Ortak yardımcılar
// ---------------------------------------------------------------------------

/**
 * Bir miktarı kervan kapasitesine bölerek arka arkaya seferler kuyruğa alır.
 * Depo kervan kapasitesinden büyükse birden fazla sefer gerekir (§9) — kaynak
 * anında değil, zamanla kademeli olarak akar.
 */
export async function queueTradeCaravans(
  tx: Tx,
  params: {
    channelId: string;
    fromKingdomId: string;
    fromTileId: string | null;
    toKingdomId: string;
    toTileId: string | null;
    resource: Resource;
    amount: number;
    seconds: number;
    now: Date;
    relatedOfferId?: string | null;
    purpose?: 'trade' | 'tribute' | 'conquest_transfer';
  },
): Promise<number> {
  const perTrip = BALANCE.caravan.capacityPerTrip;
  const trips = Math.max(1, Math.ceil(params.amount / perTrip));
  let remaining = params.amount;

  for (let i = 0; i < trips; i += 1) {
    const load = Math.min(perTrip, remaining);
    remaining -= load;
    // Ardışık seferler birbirini takip eder; hepsi aynı anda varmaz.
    const arrivesAt = new Date(params.now.getTime() + params.seconds * (i + 1) * 1000);
    await txQuery(
      tx,
      `INSERT INTO caravans
         (kingdom_id, channel_id, origin_tile_id, target_tile_id, target_kingdom_id,
          resource_type, amount, arrives_at, purpose, related_offer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.fromKingdomId,
        params.channelId,
        params.fromTileId,
        params.toTileId,
        params.toKingdomId,
        params.resource,
        load,
        arrivesAt,
        params.purpose ?? 'trade',
        params.relatedOfferId ?? null,
      ],
    );
  }

  return trips;
}

const RESOURCE_LABELS: Record<Resource, string> = {
  gold: 'Altın',
  food: 'Yiyecek',
  stone: 'Taş',
  wood: 'Odun',
  iron: 'Demir',
  ale: 'Bira',
  wheat: 'Buğday',
  flour: 'Un',
  hops: 'Şerbetçiotu',
  milk: 'Süt',
  ore: 'Ham Cevher',
  weapons: 'Silah/Zırh',
  cheese: 'Peynir',
};

export function resourceLabel(resource: Resource): string {
  return RESOURCE_LABELS[resource];
}

export function describeBundle(bundle: ResourceBundle): string {
  const parts: string[] = [];
  for (const [resource, amount] of Object.entries(bundle) as [Resource, number][]) {
    if (amount > 0) parts.push(`${Math.ceil(amount)} ${resourceLabel(resource)}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'yok';
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} gün ${hours} saat`;
  if (hours > 0) return `${hours} saat ${minutes} dk`;
  if (minutes > 0) return `${minutes} dk`;
  return `${total} sn`;
}

function proposalTypeTr(type: ProposalType): string {
  const map: Record<ProposalType, string> = {
    ceasefire: 'ateşkes',
    alliance: 'ittifak',
    trade: 'ticaret anlaşması',
    protection_offer: 'koruma',
    vassalage_request: 'vasallık',
    betrayal_signal: 'gizli anlaşma',
    troop_rental: 'birlik kiralama',
  };
  return map[type];
}

/** Yeni bir idempotency nonce üretir — LLM katmanı her çağrı için kullanır. */
export { newNonce };

/** Arazi adını Türkçeleştirir (rapor metinleri için). */
export function terrainLabel(terrain: TerrainType): string {
  return TERRAIN[terrain].nameTr;
}

/** Kale seviyesinin açtığı yetenekler — onboarding ve durum özetleri için. */
export function keepUnlocks(level: number): string {
  return keepLevelDef(level).unlocksTr;
}
