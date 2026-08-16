/**
 * Satır → DTO dönüşümleri.
 *
 * Veritabanı şeması ile telden geçen biçim kasıtlı olarak ayrı (§16.5): şemayı
 * istemciyi bozmadan değiştirebilmek için. Bu dosya o iki dünyanın tek temas
 * noktası.
 */

import {
  BUILDINGS,
  computeProduction,
  decreeQuotaCap,
  decreeQuotaPerHour,
  mineReserveCapacity,
  tileDistance,
  caravanTripsNeeded,
  type BuildingDto,
  type Bottleneck,
  type ArmyDto,
  type CaravanDto,
  type ChannelDto,
  type KingdomStateDto,
  type LlmStatusDto,
  type MarketOfferDto,
  type NotificationDto,
  type PendingDecisionDto,
  type RentedTroopsDto,
  type ResourceBundle,
  type SiegeDto,
  type TrainingQueueDto,
} from '@krallik/shared';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import type {
  ArmyRow,
  CaravanRow,
  ChannelRow,
  MarketOfferRow,
  NotificationRow,
  PendingDecisionRow,
  SiegeRow,
  TroopRentalRow,
} from '../db/rows.js';
import {
  availableWorkersOf,
  buildingSlotsTotalOf,
  buildingSlotsUsedOf,
  keepLevelOf,
  ledgerOf,
  militaryPopulationOf,
  populationCapacityOf,
  storageCapacityOf,
  totalUpkeepFoodOf,
  type KingdomSnapshot,
} from '../game/state.js';
import { joinBlockedReason, remainingHours } from '../game/world.js';

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

export function toChannelDto(
  channel: ChannelRow,
  extras: { kingdomCount: number; joined: boolean },
): ChannelDto {
  const blocked = joinBlockedReason(channel);
  return {
    id: channel.id,
    name: channel.name,
    channelType: channel.channel_type,
    status: channel.status,
    llmRestriction: channel.llm_restriction,
    durationDays: channel.duration_days,
    startedAt: iso(channel.started_at),
    endsAt: iso(channel.ends_at),
    remainingHours: Math.round(remainingHours(channel)),
    kingdomCount: extras.kingdomCount,
    winnerAllianceId: channel.winner_alliance_id,
    joined: extras.joined,
    joinable: !extras.joined && blocked === null,
    ...(blocked ? { joinBlockedReason: blocked } : {}),
  };
}

export function toLlmStatusDto(snapshot: KingdomSnapshot): LlmStatusDto {
  const { kingdom } = snapshot;
  const configured = kingdom.api_key_encrypted !== null && kingdom.llm_provider !== null;

  // "Sessize düşme" (§14.6): son çağrı auth/rate-limit hatasıyla bittiyse ve
  // ondan sonra başarılı bir çağrı olmadıysa General susmuş demektir.
  const errored =
    kingdom.llm_last_error_at !== null &&
    (kingdom.llm_last_success_at === null ||
      kingdom.llm_last_error_at.getTime() > kingdom.llm_last_success_at.getTime());

  return {
    configured,
    provider: kingdom.llm_provider,
    model: kingdom.llm_model,
    silent: !configured || errored,
    lastErrorKind: kingdom.llm_last_error_kind,
    lastErrorAt: iso(kingdom.llm_last_error_at),
    lastSuccessAt: iso(kingdom.llm_last_success_at),
    restriction: snapshot.channel.llm_restriction,
    onboarded: kingdom.llm_onboarded_at !== null,
  };
}

/**
 * Binaları DTO'ya çevirirken üretim durumunu da hesaplar; Binalar panelindeki
 * "darboğaz" uyarısı (§4) bu veriden çiziliyor.
 */
export function toBuildingDtos(
  snapshot: KingdomSnapshot,
  bottlenecks: Bottleneck[],
): BuildingDto[] {
  const bottleneckById = new Map(bottlenecks.map((b) => [b.buildingId, b]));

  return snapshot.buildings.map((row): BuildingDto => {
    const def = BUILDINGS[row.type];
    const tile = snapshot.buildingTiles.get(row.id);
    const terrain = tile?.terrain_type ?? snapshot.capitalTile?.terrain_type ?? 'plains';
    const bottleneck = bottleneckById.get(row.id) ?? null;

    const reserveCapacity = def.hasMineReserve
      ? (tile?.mine_reserve_capacity ?? mineReserveCapacity(Math.max(1, row.level)))
      : null;
    const reserveRemaining = def.hasMineReserve ? (tile?.mine_reserve_remaining ?? 0) : null;

    let status: BuildingDto['status'] = 'idle';
    if (row.upgrade_completes_at) status = 'upgrading';
    else if (bottleneck?.reason === 'reserve_depleted') status = 'depleted';
    else if (bottleneck) status = 'bottleneck';
    else if (def.outputs && row.level > 0) status = 'producing';

    // Saatlik brüt çıktı — arazi çarpanı dahil, girdi darboğazı hariç
    // (darboğaz ayrı alanda gösteriliyor).
    const outputPerHour: ResourceBundle = {};
    if (def.outputs && row.level > 0) {
      const terrainMult = def.terrainMultiplier?.[terrain] ?? 1;
      for (const [resource, perLevel] of Object.entries(def.outputs)) {
        outputPerHour[resource as keyof ResourceBundle] =
          Math.round(perLevel * row.level * terrainMult * 10) / 10;
      }
    }

    return {
      id: row.id,
      type: row.type,
      level: row.level,
      upgradingToLevel: row.upgrading_to_level,
      upgradeCompletesAt: iso(row.upgrade_completes_at),
      upgradeStartedAt: iso(row.upgrade_started_at),
      tileId: row.tile_id,
      terrain,
      mineReserveRemaining: reserveRemaining,
      mineReserveCapacity: reserveCapacity,
      deepExcavationsUsed: row.deep_excavations_used,
      status,
      bottleneck,
      outputPerHour,
    };
  });
}

export function toTrainingDtos(snapshot: KingdomSnapshot): TrainingQueueDto[] {
  return snapshot.trainingQueue.map((row) => ({
    id: row.id,
    unitType: row.unit_type,
    count: row.count,
    startedAt: row.started_at.toISOString(),
    completesAt: row.completes_at.toISOString(),
  }));
}

export async function toArmyDtos(rows: ArmyRow[]): Promise<ArmyDto[]> {
  if (rows.length === 0) return [];
  const tileIds = [...new Set(rows.map((r) => r.target_tile_id).filter((id): id is string => !!id))];
  const tiles =
    tileIds.length > 0
      ? await query<{ id: string; x: number; y: number }>(
          'SELECT id, x, y FROM map_tiles WHERE id = ANY($1::uuid[])',
          [tileIds],
        )
      : [];
  const tileById = new Map(tiles.map((t) => [t.id, t]));

  const kingdomIds = [...new Set(rows.map((r) => r.kingdom_id))];
  const kingdoms = await query<{ id: string; name: string }>(
    'SELECT id, name FROM kingdoms WHERE id = ANY($1::uuid[])',
    [kingdomIds],
  );
  const nameById = new Map(kingdoms.map((k) => [k.id, k.name]));

  return rows.map((row) => {
    const tile = row.target_tile_id ? tileById.get(row.target_tile_id) : undefined;
    return {
      id: row.id,
      composition: row.composition,
      originTileId: row.origin_tile_id ?? '',
      targetTileId: row.target_tile_id,
      targetX: tile?.x ?? null,
      targetY: tile?.y ?? null,
      departsAt: iso(row.departs_at),
      arrivesAt: iso(row.arrives_at),
      intent: row.intent,
      fatigueFactor: row.fatigue_factor,
      ownerKingdomId: row.kingdom_id,
      ownerKingdomName: nameById.get(row.kingdom_id) ?? 'Bilinmeyen',
    };
  });
}

export async function toSiegeDtos(rows: SiegeRow[]): Promise<SiegeDto[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.attacker_kingdom_id, r.defender_kingdom_id]))];
  const kingdoms = await query<{ id: string; name: string }>(
    'SELECT id, name FROM kingdoms WHERE id = ANY($1::uuid[])',
    [ids],
  );
  const nameById = new Map(kingdoms.map((k) => [k.id, k.name]));

  return rows.map((row) => ({
    id: row.id,
    armyId: row.army_id,
    attackerKingdomId: row.attacker_kingdom_id,
    attackerKingdomName: nameById.get(row.attacker_kingdom_id) ?? 'Bilinmeyen',
    defenderKingdomId: row.defender_kingdom_id,
    defenderKingdomName: nameById.get(row.defender_kingdom_id) ?? 'Bilinmeyen',
    targetTileId: row.target_tile_id,
    startedAt: row.started_at.toISOString(),
    currentRound: row.current_round,
    maxRounds: row.max_rounds,
    wallIntegrity: row.wall_integrity,
    wallIntegrityMax: row.wall_integrity_max,
    nextRoundAt: row.next_round_at.toISOString(),
    status: row.status,
    defenderTactic: row.defender_tactic,
    attackerTactic: row.attacker_tactic,
    // Takviye penceresi kuşatma devam ettiği sürece açıktır (§8.2); pratikte
    // kalan round sayısı kadar zaman var.
    reinforcementWindowClosesAt: new Date(
      row.next_round_at.getTime() + (row.max_rounds - row.current_round) * 3 * 3600_000,
    ).toISOString(),
  }));
}

export function toCaravanDtos(rows: CaravanRow[]): CaravanDto[] {
  return rows.map((row) => ({
    id: row.id,
    originTileId: row.origin_tile_id ?? '',
    targetTileId: row.target_tile_id ?? '',
    resourceType: row.resource_type,
    amount: row.amount,
    departsAt: row.departs_at.toISOString(),
    arrivesAt: row.arrives_at.toISOString(),
    purpose: row.purpose,
  }));
}

export function toRentalDtos(
  rows: TroopRentalRow[],
  side: 'in' | 'out',
  nameById: Map<string, string>,
): RentedTroopsDto[] {
  return rows.map((row) => {
    const counterpartyId = side === 'in' ? row.lender_kingdom_id : row.borrower_kingdom_id;
    return {
      id: row.id,
      counterpartyKingdomId: counterpartyId,
      counterpartyKingdomName: nameById.get(counterpartyId) ?? 'Bilinmeyen',
      unitType: row.unit_type,
      count: Math.max(0, row.count - row.count_lost),
      feeGold: row.fee_gold,
      startedAt: row.started_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      status: row.status,
    };
  });
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    kind: row.kind as NotificationDto['kind'],
    severity: row.severity,
    title: row.title,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    readAt: iso(row.read_at),
    relatedId: row.related_id,
    payload: row.payload,
  };
}

export function toPendingDecisionDto(row: PendingDecisionRow): PendingDecisionDto {
  return {
    id: row.id,
    proposedAction: row.proposed_action_json,
    generalRecommendation: row.general_recommendation_text,
    riskReasons: row.risk_reasons,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
  };
}

export function toMarketOfferDtos(
  rows: MarketOfferRow[],
  context: {
    selfKingdomId: string;
    selfPosition: { x: number; y: number } | null;
    kingdomInfo: Map<string, { name: string; reputation: number; x: number; y: number }>;
  },
): MarketOfferDto[] {
  return rows.map((row) => {
    const info = context.kingdomInfo.get(row.kingdom_id);
    const distance =
      context.selfPosition && info ? tileDistance(context.selfPosition, info) : 0;
    return {
      id: row.id,
      kingdomId: row.kingdom_id,
      kingdomName: info?.name ?? 'Bilinmeyen',
      kingdomReputation: Math.round(info?.reputation ?? 50),
      offerResource: row.offer_resource,
      offerAmount: row.offer_amount,
      requestResource: row.request_resource,
      requestAmount: row.request_amount,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      distanceTiles: distance,
      estimatedTrips: caravanTripsNeeded(row.offer_amount),
      isOwn: row.kingdom_id === context.selfKingdomId,
    };
  });
}

/** Krallığın tam durumu — Meclis/Binalar/Defter/Diyar sekmeleri bunu tüketir. */
export async function toKingdomStateDto(snapshot: KingdomSnapshot): Promise<KingdomStateDto> {
  const { kingdom, channel } = snapshot;
  const now = config.now();

  const keepLevel = keepLevelOf(snapshot);
  const capacity = storageCapacityOf(snapshot);
  const availableWorkers = availableWorkersOf(snapshot);

  // Bir saatlik ileri projeksiyon: oyuncuya "saatte ne üretiyoruz" ve hangi
  // binanın darboğaz olduğunu göstermek için. Durumu değiştirmez.
  const projection = computeProduction({
    buildings: snapshot.buildings
      .filter((b) => b.level > 0)
      .map((b) => {
        const tile = snapshot.buildingTiles.get(b.id);
        const base = {
          id: b.id,
          type: b.type,
          level: b.level,
          terrain: tile?.terrain_type ?? snapshot.capitalTile?.terrain_type ?? 'plains',
        } as const;
        return BUILDINGS[b.type].hasMineReserve
          ? { ...base, mineReserveRemaining: tile?.mine_reserve_remaining ?? 0 }
          : base;
      }),
    stock: ledgerOf(kingdom),
    capacity,
    hours: 1,
    population: kingdom.population,
    availableWorkers,
    taxRate: kingdom.tax_rate,
    armyUpkeepFoodPerHour: totalUpkeepFoodOf(snapshot),
  });

  const netProduction: ResourceBundle = {};
  for (const [resource, produced] of Object.entries(projection.produced)) {
    const consumed = projection.consumed[resource as keyof ResourceBundle] ?? 0;
    netProduction[resource as keyof ResourceBundle] =
      Math.round(((produced ?? 0) - consumed) * 10) / 10;
  }

  const [sieges, caravans, vassals, allianceRow, counterpartyNames] = await Promise.all([
    query<SiegeRow>(
      `SELECT * FROM sieges
        WHERE status = 'ongoing' AND (attacker_kingdom_id = $1 OR defender_kingdom_id = $1)`,
      [kingdom.id],
    ),
    query<CaravanRow>(
      `SELECT * FROM caravans
        WHERE status = 'in_transit' AND (kingdom_id = $1 OR target_kingdom_id = $1)
        ORDER BY arrives_at`,
      [kingdom.id],
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM kingdoms WHERE vassal_of_kingdom_id = $1 AND status = 'active'`,
      [kingdom.id],
    ),
    kingdom.alliance_id
      ? query<{ name: string }>('SELECT name FROM alliances WHERE id = $1', [kingdom.alliance_id])
      : Promise.resolve([]),
    query<{ id: string; name: string }>(
      'SELECT id, name FROM kingdoms WHERE id = ANY($1::uuid[])',
      [
        [
          ...snapshot.rentedIn.map((r) => r.lender_kingdom_id),
          ...snapshot.rentedOut.map((r) => r.borrower_kingdom_id),
          ...(kingdom.vassal_of_kingdom_id ? [kingdom.vassal_of_kingdom_id] : []),
        ],
      ],
    ),
  ]);

  const nameById = new Map(counterpartyNames.map((k) => [k.id, k.name]));

  const activeEvents = await query<{
    id: string;
    type: string;
    triggered_at: Date;
    expires_at: Date | null;
    effect_json: Record<string, unknown>;
  }>(
    `SELECT id, type, triggered_at, expires_at, effect_json FROM world_events
      WHERE affected_kingdom_id = $1 AND (expires_at IS NULL OR expires_at > now())
      ORDER BY triggered_at DESC LIMIT 10`,
    [kingdom.id],
  );

  const eventTitles: Record<string, string> = {
    bountiful_harvest: 'Bereketli Hasat',
    plague: 'Veba',
    bandit_raid: 'Haydut Baskını',
    traveling_merchant: 'Gezgin Tüccar',
  };

  return {
    id: kingdom.id,
    name: kingdom.name,
    channelId: channel.id,
    channelName: channel.name,
    ownerUserId: kingdom.user_id,
    capitalTileId: kingdom.capital_tile_id ?? '',
    capitalX: snapshot.capitalTile?.x ?? 0,
    capitalY: snapshot.capitalTile?.y ?? 0,
    capitalTerrain: snapshot.capitalTile?.terrain_type ?? 'plains',
    resources: ledgerOf(kingdom),
    storageCapacity: capacity,
    scores: {
      popularity: Math.round(kingdom.popularity * 10) / 10,
      reputation: Math.round(kingdom.reputation * 10) / 10,
      generalLoyalty: Math.round(kingdom.general_loyalty * 10) / 10,
      population: Math.round(kingdom.population),
      populationCapacity: populationCapacityOf(snapshot),
      availableWorkers: Math.round(availableWorkers),
      militaryPopulation: militaryPopulationOf(snapshot),
      taxRate: kingdom.tax_rate,
      decreeQuotaRemaining: kingdom.decree_quota_remaining,
      decreeQuotaCap: decreeQuotaCap(keepLevel),
      decreeQuotaPerHour: decreeQuotaPerHour(keepLevel),
      nextQuotaRefillAt: new Date(
        kingdom.decree_quota_last_refill_at.getTime() + 3_600_000,
      ).toISOString(),
    },
    keepLevel,
    buildingSlotsUsed: buildingSlotsUsedOf(snapshot),
    buildingSlotsTotal: buildingSlotsTotalOf(snapshot),
    buildings: toBuildingDtos(snapshot, projection.bottlenecks),
    trainingQueue: toTrainingDtos(snapshot),
    garrison: snapshot.garrison,
    armies: await toArmyDtos(snapshot.armies),
    sieges: await toSiegeDtos(sieges),
    caravans: toCaravanDtos(caravans),
    rentedIn: toRentalDtos(snapshot.rentedIn, 'in', nameById),
    rentedOut: toRentalDtos(snapshot.rentedOut, 'out', nameById),
    protectionEndsAt: iso(kingdom.protection_ends_at),
    allianceId: kingdom.alliance_id,
    allianceName: allianceRow[0]?.name ?? null,
    vassalOfKingdomId: kingdom.vassal_of_kingdom_id,
    vassalOfKingdomName: kingdom.vassal_of_kingdom_id
      ? (nameById.get(kingdom.vassal_of_kingdom_id) ?? null)
      : null,
    vassals: vassals.map((v) => ({ id: v.id, name: v.name })),
    ownedTileIds: snapshot.ownedTiles.map((t) => t.id),
    mode:
      now.getTime() - kingdom.last_active_at.getTime() > 45 * 60_000 ? 'passive' : 'active',
    strategyNote: kingdom.strategy_note,
    netProductionPerHour: netProduction,
    foodBalancePerHour: Math.round(projection.foodBalancePerHour * 10) / 10,
    bottlenecks: projection.bottlenecks,
    llm: toLlmStatusDto(snapshot),
    activeWorldEvents: activeEvents.map((e) => ({
      id: e.id,
      type: e.type as WorldEventDtoType,
      title: eventTitles[e.type] ?? e.type,
      description: '',
      triggeredAt: e.triggered_at.toISOString(),
      expiresAt: iso(e.expires_at),
      effect: e.effect_json,
    })),
    lastTickAt: kingdom.last_tick_at.toISOString(),
    serverTime: now.toISOString(),
  };
}

type WorldEventDtoType = KingdomStateDto['activeWorldEvents'][number]['type'];
