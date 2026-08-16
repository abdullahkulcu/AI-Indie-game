/**
 * Krallık Simülasyonu — çekirdek tip tanımları.
 *
 * Bu dosya backend, tick servisi, LLM bağlam paketi ve frontend arasındaki
 * ortak sözleşmedir. Oyun kurallarına dair hiçbir sabit burada tekrarlanmaz;
 * tablolar `buildings.ts` / `units.ts` / `terrain.ts`, hesaplar `formulas.ts`
 * içinde yaşar.
 */

// ---------------------------------------------------------------------------
// Kaynaklar
// ---------------------------------------------------------------------------

/**
 * Depoda tutulan her kalem. GDD §4'teki ana kaynaklar (altın, yiyecek, taş,
 * odun, demir, bira) ile üretim zincirlerinin ara ürünleri (buğday, un,
 * şerbetçiotu, süt, ham cevher, silah, peynir) aynı defterde tutulur — zincirin
 * bir halkası darboğaz olduğunda ara ürün stoğu şişer ve bunu doğrudan
 * ölçebiliriz.
 */
export const RESOURCES = [
  'gold',
  'food',
  'stone',
  'wood',
  'iron',
  'ale',
  'wheat',
  'flour',
  'hops',
  'milk',
  'ore',
  'weapons',
  'cheese',
] as const;

export type Resource = (typeof RESOURCES)[number];

/** GDD §4'te "ana kaynaklar" diye geçen, oyuncuya Defter sekmesinde gösterilenler. */
export const PRIMARY_RESOURCES = [
  'gold',
  'food',
  'stone',
  'wood',
  'iron',
  'ale',
] as const satisfies readonly Resource[];

export type PrimaryResource = (typeof PRIMARY_RESOURCES)[number];

/** Kaynak → miktar eşlemesi. Kısmi kullanım yaygın olduğu için tüm alanlar isteğe bağlı. */
export type ResourceBundle = Partial<Record<Resource, number>>;

/** Her kaynağın kesin bir değeri olduğu tam defter (krallık deposu). */
export type ResourceLedger = Record<Resource, number>;

export const RESOURCE_LABELS_TR: Record<Resource, string> = {
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

// ---------------------------------------------------------------------------
// Arazi
// ---------------------------------------------------------------------------

export const TERRAIN_TYPES = [
  'plains',
  'forest',
  'mountain',
  'riverbank',
  'pass',
  'barren',
] as const;

export type TerrainType = (typeof TERRAIN_TYPES)[number];

// ---------------------------------------------------------------------------
// Binalar
// ---------------------------------------------------------------------------

export const BUILDING_CATEGORIES = ['economy', 'military', 'administration'] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export const BUILDING_TYPES = [
  // Ekonomi (14)
  'wheat_farm',
  'apple_orchard',
  'mill',
  'bakery',
  'hops_farm',
  'brewery',
  'dairy_farm',
  'cheesemaker',
  'quarry',
  'mine',
  'foundry',
  'woodcutter',
  'market',
  'granary',
  // Askeri (9)
  'barracks',
  'archery_range',
  'stable',
  'armory',
  'siege_workshop',
  'tower',
  'wall',
  'moat',
  'gate',
  // Yönetim (3)
  'keep',
  'town_square',
  'chapel',
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number];

// ---------------------------------------------------------------------------
// Birimler
// ---------------------------------------------------------------------------

export const UNIT_CATEGORIES = ['infantry', 'siege', 'special'] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export const UNIT_TYPES = [
  // Temel kara birimleri (8)
  'spearman',
  'macebearer',
  'swordsman',
  'archer',
  'crossbowman',
  'horse_archer',
  'knight',
  'light_cavalry',
  // Kuşatma birimleri (5)
  'catapult',
  'trebuchet',
  'siege_tower',
  'battering_ram',
  'ladderman',
  // Özel/destek (4)
  'engineer',
  'assassin',
  'spy',
  'mercenary',
] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

/** Ordu bileşimi: birim tipi → adet. */
export type ArmyComposition = Partial<Record<UnitType, number>>;

// ---------------------------------------------------------------------------
// Savaş
// ---------------------------------------------------------------------------

export const ARMY_INTENTS = ['attack', 'reinforce', 'scout', 'raid', 'return'] as const;
export type ArmyIntent = (typeof ARMY_INTENTS)[number];

export const TACTICS = ['ambush', 'frontal', 'withdraw_to_keep', 'terrain_advantage'] as const;
export type Tactic = (typeof TACTICS)[number];

export const SIEGE_STATUSES = ['ongoing', 'attacker_won', 'defender_won', 'withdrawn'] as const;
export type SiegeStatus = (typeof SIEGE_STATUSES)[number];

export interface BattleCasualties {
  attacker: ArmyComposition;
  defender: ArmyComposition;
}

export interface BattleOutcome {
  attackerPower: number;
  defenderPower: number;
  /** Saldıranın kazanma oranı; 0.5 üstü saldıran üstün demek. */
  attackerShare: number;
  attackerWon: boolean;
  casualties: BattleCasualties;
  /** Yağmalanan kaynaklar (yalnızca `raid`/kazanılmış `attack` için dolu). */
  plunder: ResourceBundle;
  /** Kuşatmada bu round'da sur/kaleye verilen hasar. */
  wallDamage: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Diplomasi
// ---------------------------------------------------------------------------

export const PROPOSAL_TYPES = [
  'ceasefire',
  'alliance',
  'trade',
  'protection_offer',
  'vassalage_request',
  'betrayal_signal',
  'troop_rental',
] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export const DIPLOMACY_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type DiplomacyStatus = (typeof DIPLOMACY_STATUSES)[number];

export const RELATION_STATES = ['neutral', 'ally', 'war', 'ceasefire', 'vassal', 'protector'] as const;
export type RelationState = (typeof RELATION_STATES)[number];

// ---------------------------------------------------------------------------
// Dünya olayları
// ---------------------------------------------------------------------------

export const WORLD_EVENT_TYPES = [
  'bountiful_harvest',
  'plague',
  'bandit_raid',
  'traveling_merchant',
] as const;

export type WorldEventType = (typeof WORLD_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export const CHANNEL_TYPES = ['season', 'short', 'recurring'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_STATUSES = ['pending', 'active', 'finished'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

/**
 * Admin'in channel'a koyduğu LLM kısıtı (GDD §16.1). `allowedProviders` boşsa
 * kısıt yok; `minTier` verilirse yalnızca o kademe ve üstü modeller kabul edilir.
 */
export interface LlmRestriction {
  allowedProviders?: LlmProvider[];
  allowedModels?: string[];
  minTier?: ModelTier;
}

// ---------------------------------------------------------------------------
// LLM / BYOK
// ---------------------------------------------------------------------------

export const LLM_PROVIDERS = ['anthropic', 'openai', 'google', 'openai_compatible'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const MODEL_TIERS = ['small', 'standard', 'frontier'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** Bir sağlayıcının adaptör katmanına verdiği tek mesaj. */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Asistanın bu turda istediği araç çağrıları. */
  toolCalls?: LlmToolCall[];
  /** Bu mesaj bir araç sonucu taşıyorsa (role: 'user') dolu olur. */
  toolResults?: LlmToolResult[];
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

/** Sağlayıcıdan bağımsız araç tanımı (GDD §15.4 adaptör katmanı). */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: string;
}

/**
 * Adaptör hatalarının sınıflandırması. `auth` ve `rate_limit` durumlarında
 * General "sessize düşer" (GDD §14.6) — krallık ölmez, yalnızca yeni inisiyatif
 * durur.
 */
export const LLM_ERROR_KINDS = [
  'auth',
  'rate_limit',
  'context_length',
  'provider_unavailable',
  'invalid_request',
  'unknown',
] as const;
export type LlmErrorKind = (typeof LLM_ERROR_KINDS)[number];

// ---------------------------------------------------------------------------
// Kral–General etkileşimi
// ---------------------------------------------------------------------------

/**
 * Bir aksiyonun kademeli karar sistemindeki (GDD §14.5) sınıfı.
 * `routine` → General kendi başına uygular. `major` → Kral'ın onayı beklenir.
 */
export const DECISION_TIERS = ['routine', 'major'] as const;
export type DecisionTier = (typeof DECISION_TIERS)[number];

export const PENDING_DECISION_STATUSES = [
  'awaiting',
  'approved',
  'rejected',
  'expired_safe_default',
] as const;
export type PendingDecisionStatus = (typeof PENDING_DECISION_STATUSES)[number];

export const KINGDOM_MODES = ['active', 'passive'] as const;
export type KingdomMode = (typeof KINGDOM_MODES)[number];

// ---------------------------------------------------------------------------
// Aksiyonlar (LLM tool çağrılarının backend karşılığı)
// ---------------------------------------------------------------------------

export const ACTION_NAMES = [
  'build_structure',
  'train_unit',
  'move_army',
  'send_caravan',
  'host_festival',
  'set_tax_rate',
  'send_diplomacy_message',
  'post_market_offer',
  'accept_market_offer',
  'propose_troop_rental',
  'deploy_spy',
  'hire_mercenaries',
  'deep_excavation',
  'set_strategy_note',
  'choose_tactic',
  'respond_to_decision',
  'get_kingdom_status',
  'get_realm_intel',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

/** Backend'in bir aksiyonu yürütmesinin sonucu. */
export interface ActionResult {
  ok: boolean;
  /** Oyuncuya/LLM'e gösterilecek insan-okur özet. */
  message: string;
  /** Başarısızlık nedeni — LLM'in kendini düzeltebilmesi için makine-okur. */
  errorCode?: ActionErrorCode;
  /** Emir kotasından düşülen miktar (0 olabilir). */
  quotaSpent?: number;
  /** Aksiyon onay beklemeye alındıysa oluşan kaydın kimliği. */
  pendingDecisionId?: string;
  data?: Record<string, unknown>;
}

export const ACTION_ERROR_CODES = [
  'insufficient_resources',
  'insufficient_quota',
  'insufficient_population',
  'requirement_not_met',
  'building_busy',
  'building_missing',
  'invalid_target',
  'out_of_range',
  'not_authorized',
  'protection_active',
  'storage_full',
  'invalid_arguments',
  'duplicate_request',
  'rate_limited',
  'internal_error',
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Bildirim
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  'attack_incoming',
  'siege_round',
  'battle_report',
  'passive_summary',
  'protection_ending',
  'decision_required',
  'diplomacy',
  'world_event',
  'caravan_arrived',
  'llm_error',
  'region_bulletin',
  'conquest',
  'season_end',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
