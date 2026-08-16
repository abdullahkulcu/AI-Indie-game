/**
 * Veritabanı satır tipleri.
 *
 * Migration'lardaki sütunların birebir karşılığı. API'ye giden DTO'lar
 * (`@krallik/shared`'daki `api.ts`) bunlardan türetilir — ikisini ayrı tutmak,
 * şemayı istemciyi bozmadan değiştirebilmemizi sağlıyor (§16.5 additive
 * migration deseni).
 */

import type {
  ArmyComposition,
  ArmyIntent,
  BuildingType,
  ChannelStatus,
  ChannelType,
  LlmProvider,
  LlmRestriction,
  ProposalType,
  Resource,
  Tactic,
  TerrainType,
  UnitType,
  WorldEventType,
} from '@krallik/shared';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_admin: boolean;
  created_at: Date;
  last_seen_at: Date | null;
}

export interface UserProfileRow {
  user_id: string;
  titles: string[];
  total_channels_won: number;
  highest_population_ever: number;
  total_kingdoms_conquered: number;
  updated_at: Date;
}

export interface ChannelRow {
  id: string;
  name: string;
  channel_type: ChannelType;
  llm_restriction: LlmRestriction | null;
  duration_days: number;
  started_at: Date | null;
  ends_at: Date | null;
  status: ChannelStatus;
  winner_alliance_id: string | null;
  winner_kingdom_id: string | null;
  balance_snapshot: Record<string, unknown>;
  next_slot_index: number;
  created_at: Date;
  created_by: string | null;
}

export interface KingdomRow {
  id: string;
  user_id: string;
  channel_id: string;
  name: string;
  capital_tile_id: string | null;

  gold: number;
  food: number;
  stone: number;
  wood: number;
  iron: number;
  ale: number;
  wheat: number;
  flour: number;
  hops: number;
  milk: number;
  ore: number;
  weapons: number;
  cheese: number;

  population: number;
  popularity: number;
  reputation: number;
  general_loyalty: number;
  tax_rate: number;

  protection_ends_at: Date | null;
  alliance_id: string | null;
  vassal_of_kingdom_id: string | null;

  decree_quota_remaining: number;
  decree_quota_last_refill_at: Date;

  llm_provider: LlmProvider | null;
  llm_model: string | null;
  llm_base_url: string | null;
  api_key_encrypted: Buffer | null;
  api_key_iv: Buffer | null;
  api_key_tag: Buffer | null;
  api_key_wrapped_dek: Buffer | null;
  llm_last_error_kind: string | null;
  llm_last_error_at: Date | null;
  llm_last_success_at: Date | null;
  llm_onboarded_at: Date | null;

  strategy_note: string;
  last_active_at: Date;
  last_tick_at: Date;
  last_passive_run_at: Date | null;

  festivals_in_window: number;
  festival_window_started_at: Date | null;
  festival_bonus_until: Date | null;
  festival_bonus_value: number;

  status: 'active' | 'fallen' | 'spectating' | 'refugee';
  fell_at: Date | null;
  conquered_by_kingdom_id: string | null;

  peak_population: number;
  tiles_conquered: number;

  created_at: Date;
}

export interface MapTileRow {
  id: string;
  channel_id: string;
  x: number;
  y: number;
  terrain_type: TerrainType;
  owner_kingdom_id: string | null;
  is_capital: boolean;
  mine_reserve_remaining: number | null;
  mine_reserve_capacity: number | null;
  created_at: Date;
}

export interface BuildingInstanceRow {
  id: string;
  kingdom_id: string;
  type: BuildingType;
  level: number;
  upgrading_to_level: number | null;
  upgrade_started_at: Date | null;
  upgrade_completes_at: Date | null;
  tile_id: string | null;
  deep_excavations_used: number;
  created_at: Date;
}

export interface UnitStockRow {
  kingdom_id: string;
  unit_type: UnitType;
  count: number;
}

export interface TrainingQueueRow {
  id: string;
  kingdom_id: string;
  unit_type: UnitType;
  count: number;
  started_at: Date;
  completes_at: Date;
  created_at: Date;
}

export interface ArmyRow {
  id: string;
  kingdom_id: string;
  channel_id: string;
  composition: ArmyComposition;
  origin_tile_id: string | null;
  target_tile_id: string | null;
  departs_at: Date;
  arrives_at: Date;
  intent: ArmyIntent;
  fatigue_factor: number;
  tactic: Tactic;
  distance_tiles: number;
  carried_resources: Partial<Record<Resource, number>>;
  status: 'marching' | 'engaged' | 'besieging' | 'returning' | 'disbanded' | 'garrisoned';
  created_at: Date;
}

export interface SiegeRow {
  id: string;
  channel_id: string;
  army_id: string;
  attacker_kingdom_id: string;
  defender_kingdom_id: string;
  target_tile_id: string;
  started_at: Date;
  current_round: number;
  max_rounds: number;
  wall_integrity: number;
  wall_integrity_max: number;
  next_round_at: Date;
  defender_tactic: Tactic;
  attacker_tactic: Tactic;
  status: 'ongoing' | 'attacker_won' | 'defender_won' | 'withdrawn';
  resolved_at: Date | null;
  created_at: Date;
}

export interface SiegeReinforcementRow {
  id: string;
  siege_id: string;
  army_id: string;
  kingdom_id: string;
  side: 'attacker' | 'defender';
  composition: ArmyComposition;
  joined_at: Date;
}

export interface CaravanRow {
  id: string;
  kingdom_id: string;
  channel_id: string;
  origin_tile_id: string | null;
  target_tile_id: string | null;
  target_kingdom_id: string | null;
  resource_type: Resource;
  amount: number;
  departs_at: Date;
  arrives_at: Date;
  purpose: 'conquest_transfer' | 'trade' | 'tribute';
  status: 'in_transit' | 'delivered' | 'cancelled';
  related_offer_id: string | null;
  created_at: Date;
}

export interface TileStockpileRow {
  tile_id: string;
  resource: Resource;
  amount: number;
  updated_at: Date;
}

export interface BattleReportRow {
  id: string;
  channel_id: string;
  attacker_kingdom_id: string | null;
  defender_kingdom_id: string | null;
  tile_id: string | null;
  siege_id: string | null;
  intent: ArmyIntent;
  mode: 'raid' | 'siege_round' | 'siege_final';
  attacker_won: boolean;
  attack_power: number;
  defense_power: number;
  attacker_losses: ArmyComposition;
  defender_losses: ArmyComposition;
  plunder: Partial<Record<Resource, number>>;
  wall_damage: number;
  wall_integrity_after: number | null;
  capital_fell: boolean;
  narrative: string;
  created_at: Date;
}

export interface AllianceRow {
  id: string;
  channel_id: string;
  name: string;
  leader_kingdom_id: string | null;
  shared_goal: Record<string, unknown> | null;
  created_at: Date;
}

export interface KingdomRelationRow {
  channel_id: string;
  kingdom_a_id: string;
  kingdom_b_id: string;
  state: 'neutral' | 'ally' | 'war' | 'ceasefire' | 'vassal' | 'protector';
  updated_at: Date;
}

export interface DiplomacyThreadRow {
  id: string;
  channel_id: string;
  from_kingdom_id: string;
  to_kingdom_id: string;
  proposal_type: ProposalType;
  terms: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  steering_note: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  resolved_at: Date | null;
}

export interface DiplomacyTurnRow {
  id: string;
  thread_id: string;
  speaker_kingdom_id: string;
  message: string;
  stance: 'open' | 'accept' | 'counter' | 'reject' | 'stall';
  counter_terms: Record<string, unknown> | null;
  created_at: Date;
}

export interface ProtectionRelationshipRow {
  id: string;
  channel_id: string;
  protector_kingdom_id: string;
  vassal_kingdom_id: string;
  tribute_rate: number;
  initiated_by: 'vassal' | 'protector' | 'coercion';
  started_at: Date;
  next_tribute_at: Date;
  status: 'active' | 'ended' | 'broken';
  ended_at: Date | null;
}

export interface TroopRentalRow {
  id: string;
  channel_id: string;
  lender_kingdom_id: string;
  borrower_kingdom_id: string;
  unit_type: UnitType;
  count: number;
  count_lost: number;
  fee_gold: number;
  started_at: Date;
  ends_at: Date;
  status: 'active' | 'returned' | 'recalled' | 'lost';
  returned_at: Date | null;
}

export interface MarketOfferRow {
  id: string;
  channel_id: string;
  kingdom_id: string;
  offer_resource: Resource;
  offer_amount: number;
  request_resource: Resource;
  request_amount: number;
  status: 'open' | 'accepted' | 'expired' | 'cancelled';
  accepted_by_kingdom_id: string | null;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
}

export interface TradeAgreementRow {
  id: string;
  channel_id: string;
  kingdom_a_id: string;
  kingdom_b_id: string;
  resource_a: Resource;
  amount_a: number;
  resource_b: Resource;
  amount_b: number;
  frequency_hours: number;
  started_at: Date;
  next_delivery_at: Date;
  status: 'active' | 'cancelled' | 'broken';
  missed_deliveries: number;
  ended_at: Date | null;
}

export interface SpyMissionRow {
  id: string;
  channel_id: string;
  origin_kingdom_id: string;
  target_kingdom_id: string;
  mission: 'gather_intel' | 'sabotage';
  departs_at: Date;
  resolves_at: Date;
  status: 'in_transit' | 'succeeded' | 'caught' | 'failed';
  result: Record<string, unknown> | null;
  created_at: Date;
}

export interface ChatMessageRow {
  id: string;
  kingdom_id: string;
  role: 'king' | 'general' | 'system';
  content: string;
  actions: unknown[];
  is_passive_summary: boolean;
  token_usage: Record<string, number> | null;
  created_at: Date;
}

export interface PendingDecisionRow {
  id: string;
  kingdom_id: string;
  proposed_action_json: { name: string; arguments: Record<string, unknown> };
  general_recommendation_text: string;
  risk_reasons: string[];
  risk_severity: number;
  created_at: Date;
  expires_at: Date;
  status: 'awaiting' | 'approved' | 'rejected' | 'expired_safe_default';
  resolved_at: Date | null;
  resolution_note: string | null;
}

export interface NotificationRow {
  id: string;
  kingdom_id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  related_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
  read_at: Date | null;
}

export interface WorldEventRow {
  id: string;
  channel_id: string;
  type: WorldEventType;
  affected_kingdom_id: string | null;
  region_id: string | null;
  triggered_at: Date;
  expires_at: Date | null;
  effect_json: Record<string, unknown>;
  applied: boolean;
}

export interface RegionBulletinRow {
  id: string;
  kingdom_id: string;
  kind: 'routine_digest' | 'major_event';
  summary: string;
  related_kingdom_ids: string[];
  created_at: Date;
}

export interface RegionActivityRow {
  id: string;
  channel_id: string;
  origin_x: number;
  origin_y: number;
  severity: 'routine' | 'major';
  summary: string;
  related_kingdom_ids: string[];
  created_at: Date;
}

export interface ActionLogRow {
  id: string;
  kingdom_id: string;
  action_name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error_code: string | null;
  message: string;
  quota_spent: number;
  tier: 'routine' | 'major';
  source: 'active' | 'passive' | 'system';
  created_at: Date;
}
