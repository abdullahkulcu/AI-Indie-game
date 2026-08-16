/**
 * HTTP API sözleşmesi.
 *
 * Frontend ve backend bu tipleri paylaşır; bir uç değişirse diğeri derlenmez.
 * Sunucu tarafındaki satır tipleri (DB şeması) burada değil `server` paketinde
 * yaşar — bunlar yalnızca telden geçen biçimlerdir.
 */

import type {
  ActionErrorCode,
  ArmyComposition,
  ArmyIntent,
  BuildingType,
  ChannelStatus,
  ChannelType,
  DecisionTier,
  DiplomacyStatus,
  KingdomMode,
  LlmProvider,
  LlmRestriction,
  NotificationKind,
  NotificationSeverity,
  ProposalType,
  RelationState,
  Resource,
  ResourceBundle,
  ResourceLedger,
  SiegeStatus,
  Tactic,
  TerrainType,
  UnitType,
  WorldEventType,
} from './types.js';
import type { Bottleneck } from './formulas.js';

// ---------------------------------------------------------------------------
// Kimlik
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface UserProfileDto {
  userId: string;
  displayName: string;
  titles: string[];
  totalChannelsWon: number;
  highestPopulationEver: number;
  totalKingdomsConquered: number;
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export interface ChannelDto {
  id: string;
  name: string;
  channelType: ChannelType;
  status: ChannelStatus;
  llmRestriction: LlmRestriction | null;
  durationDays: number;
  startedAt: string | null;
  endsAt: string | null;
  /** Kalan süre (saat); bitmiş channel için 0. */
  remainingHours: number;
  kingdomCount: number;
  winnerAllianceId: string | null;
  /** Bu kullanıcı bu channel'da bir krallık yönetiyor mu. */
  joined: boolean;
  /** GDD §16.2: kalan süre korumadan kısaysa katılım kapalıdır. */
  joinable: boolean;
  joinBlockedReason?: string;
}

export interface ChannelListResponse {
  /** Kullanıcının bağlı olduğu channel'lar (§16.3). */
  joined: ChannelDto[];
  /** Katılabileceği açık channel'lar. */
  open: ChannelDto[];
  /**
   * Channel kimliği → o channel'daki krallığın kimliği.
   *
   * İstemcinin krallığına girebilmek için yerel bir kayda bağlı kalmaması
   * gerekiyor: bir hesap birden fazla channel'da ayrı krallık yönetebiliyor
   * (§16.4) ve farklı bir tarayıcıdan giriş yapabiliyor.
   */
  kingdomsByChannel: Record<string, string>;
}

export interface JoinChannelRequest {
  channelId: string;
  kingdomName: string;
}

// ---------------------------------------------------------------------------
// Krallık durumu
// ---------------------------------------------------------------------------

export interface BuildingDto {
  id: string;
  type: BuildingType;
  level: number;
  /** Yükseltme sürüyorsa hedef seviye ve bitiş zamanı. */
  upgradingToLevel: number | null;
  upgradeCompletesAt: string | null;
  upgradeStartedAt: string | null;
  tileId: string | null;
  terrain: TerrainType;
  /** Yalnızca maden için. */
  mineReserveRemaining: number | null;
  mineReserveCapacity: number | null;
  deepExcavationsUsed: number;
  /** Bu binanın mevcut durum özeti (üretiyor / boşta / darboğaz). */
  status: 'producing' | 'idle' | 'upgrading' | 'bottleneck' | 'depleted';
  /** Darboğaz varsa nedeni. */
  bottleneck: Bottleneck | null;
  /** Saatlik net çıktı (oyuncuya gösterilen). */
  outputPerHour: ResourceBundle;
}

export interface TrainingQueueDto {
  id: string;
  unitType: UnitType;
  count: number;
  startedAt: string;
  completesAt: string;
}

export interface ArmyDto {
  id: string;
  composition: ArmyComposition;
  originTileId: string;
  targetTileId: string | null;
  targetX: number | null;
  targetY: number | null;
  departsAt: string | null;
  arrivesAt: string | null;
  intent: ArmyIntent;
  fatigueFactor: number;
  /** Karşı taraftan görülüyorsa yalnızca kaba büyüklük paylaşılır. */
  ownerKingdomId: string;
  ownerKingdomName: string;
}

export interface SiegeDto {
  id: string;
  armyId: string;
  attackerKingdomId: string;
  attackerKingdomName: string;
  defenderKingdomId: string;
  defenderKingdomName: string;
  targetTileId: string;
  startedAt: string;
  currentRound: number;
  maxRounds: number;
  wallIntegrity: number;
  wallIntegrityMax: number;
  nextRoundAt: string;
  status: SiegeStatus;
  /** Savunanın seçtiği taktik. */
  defenderTactic: Tactic;
  attackerTactic: Tactic;
  /** Bu kuşatmaya takviye yetiştirebilecek müttefikler (§8.2). */
  reinforcementWindowClosesAt: string;
}

export interface CaravanDto {
  id: string;
  originTileId: string;
  targetTileId: string;
  resourceType: Resource;
  amount: number;
  departsAt: string;
  arrivesAt: string;
  purpose: 'conquest_transfer' | 'trade' | 'tribute';
}

export interface KingdomScoresDto {
  popularity: number;
  reputation: number;
  generalLoyalty: number;
  population: number;
  populationCapacity: number;
  /** Nüfusun orduya gitmemiş, çalışabilir kısmı. */
  availableWorkers: number;
  militaryPopulation: number;
  taxRate: number;
  decreeQuotaRemaining: number;
  decreeQuotaCap: number;
  decreeQuotaPerHour: number;
  nextQuotaRefillAt: string;
}

export interface KingdomStateDto {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  ownerUserId: string;
  capitalTileId: string;
  capitalX: number;
  capitalY: number;
  capitalTerrain: TerrainType;
  resources: ResourceLedger;
  storageCapacity: number;
  scores: KingdomScoresDto;
  keepLevel: number;
  buildingSlotsUsed: number;
  buildingSlotsTotal: number;
  buildings: BuildingDto[];
  trainingQueue: TrainingQueueDto[];
  /** Evdeki garnizon. */
  garrison: ArmyComposition;
  /** Yolda/seferdeki ordular. */
  armies: ArmyDto[];
  /** Bu krallığı hedefleyen ya da bu krallığın yürüttüğü kuşatmalar. */
  sieges: SiegeDto[];
  caravans: CaravanDto[];
  /** Kiralanmış olarak bu krallığın garnizonunda duran birlikler (§10.5). */
  rentedIn: RentedTroopsDto[];
  rentedOut: RentedTroopsDto[];
  protectionEndsAt: string | null;
  allianceId: string | null;
  allianceName: string | null;
  vassalOfKingdomId: string | null;
  vassalOfKingdomName: string | null;
  vassals: { id: string; name: string }[];
  ownedTileIds: string[];
  mode: KingdomMode;
  strategyNote: string;
  /** Saatlik net üretim özeti (oyuncuya gösterilen). */
  netProductionPerHour: ResourceBundle;
  foodBalancePerHour: number;
  bottlenecks: Bottleneck[];
  /** LLM bağlantısının durumu (§14.6). */
  llm: LlmStatusDto;
  activeWorldEvents: WorldEventDto[];
  lastTickAt: string;
  serverTime: string;
}

export interface RentedTroopsDto {
  id: string;
  counterpartyKingdomId: string;
  counterpartyKingdomName: string;
  unitType: UnitType;
  count: number;
  feeGold: number;
  startedAt: string;
  endsAt: string;
  status: 'active' | 'returned' | 'recalled' | 'lost';
}

export interface LlmStatusDto {
  configured: boolean;
  provider: LlmProvider | null;
  model: string | null;
  /** Anahtar geçersiz/rate-limit ise General "sessize" düşmüştür. */
  silent: boolean;
  lastErrorKind: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  /** Bu channel'ın izin verdiği sağlayıcı/modeller (§16.1). */
  restriction: LlmRestriction | null;
  /** Onboarding tanışma çağrısı yapıldı mı (§14.7). */
  onboarded: boolean;
}

// ---------------------------------------------------------------------------
// Harita
// ---------------------------------------------------------------------------

export interface MapTileDto {
  id: string;
  x: number;
  y: number;
  terrain: TerrainType;
  ownerKingdomId: string | null;
  ownerKingdomName: string | null;
  isCapital: boolean;
  /** Maden tile'ı ise kalan rezervin oranı (0..1); bilinmiyorsa null. */
  mineReserveRatio: number | null;
}

export interface NeighborKingdomDto {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Kaba büyüklük göstergeleri — tam istihbarat için casus gerekir. */
  population: number;
  reputation: number;
  relation: RelationState;
  distanceTiles: number;
  allianceId: string | null;
  allianceName: string | null;
  isProtected: boolean;
}

/**
 * Zoom-out sahnesinin çizdiği ilişki ağı. Üçüncü taraf ilişkiler de dahildir —
 * sana dokunmayan savaşlar ve ticaret hatları da görünür.
 */
export interface RelationEdgeDto {
  fromKingdomId: string;
  toKingdomId: string;
  kind: 'trade' | 'hostility' | 'alliance' | 'protection';
}

export interface RealmViewDto {
  self: { id: string; name: string; x: number; y: number };
  neighbors: NeighborKingdomDto[];
  edges: RelationEdgeDto[];
  tiles: MapTileDto[];
  contestedTiles: { x: number; y: number; label: string }[];
  scoreboard: { kingdomId: string; name: string; population: number; rank: number }[];
}

// ---------------------------------------------------------------------------
// Diplomasi / pazar
// ---------------------------------------------------------------------------

export interface DiplomacyThreadDto {
  id: string;
  counterpartyKingdomId: string;
  counterpartyKingdomName: string;
  counterpartyReputation: number;
  proposalType: ProposalType;
  status: DiplomacyStatus;
  terms: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Danışman-danışman görüşmesinin salt-okunur transkripti (§10). */
  transcript: DiplomacyTurnDto[];
  /** Oyuncu yalnızca kendi General'ını yönlendirebilir. */
  canSteer: boolean;
}

export interface DiplomacyTurnDto {
  id: string;
  speakerKingdomId: string;
  speakerKingdomName: string;
  /** Bu tur bizim General'ımıza mı ait. */
  isOwn: boolean;
  message: string;
  stance: 'open' | 'accept' | 'counter' | 'reject' | 'stall';
  createdAt: string;
}

export interface MarketOfferDto {
  id: string;
  kingdomId: string;
  kingdomName: string;
  kingdomReputation: number;
  offerResource: Resource;
  offerAmount: number;
  requestResource: Resource;
  requestAmount: number;
  createdAt: string;
  expiresAt: string;
  distanceTiles: number;
  /** Kabul edilirse kervanın kaç sefer süreceği. */
  estimatedTrips: number;
  isOwn: boolean;
}

export interface TradeAgreementDto {
  id: string;
  counterpartyKingdomId: string;
  counterpartyKingdomName: string;
  giveResource: Resource;
  giveAmount: number;
  receiveResource: Resource;
  receiveAmount: number;
  frequencyHours: number;
  startedAt: string;
  nextDeliveryAt: string;
  status: 'active' | 'cancelled' | 'broken';
}

export interface ProtectionRelationshipDto {
  id: string;
  protectorKingdomId: string;
  protectorKingdomName: string;
  vassalKingdomId: string;
  vassalKingdomName: string;
  tributeRate: number;
  startedAt: string;
  status: 'active' | 'ended' | 'broken';
  nextTributeAt: string;
}

// ---------------------------------------------------------------------------
// Bölgesel duyum akışı (§10.4)
// ---------------------------------------------------------------------------

export interface RegionBulletinDto {
  id: string;
  /** 6 saatlik toplu bülten mi, yoksa anında gelen büyük olay mı. */
  kind: 'routine_digest' | 'major_event';
  summary: string;
  createdAt: string;
  relatedKingdomIds: string[];
}

// ---------------------------------------------------------------------------
// Bildirim ve raporlar
// ---------------------------------------------------------------------------

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  /** İlgili kayda derin bağlantı (kuşatma, karar, ordu...). */
  relatedId: string | null;
  payload: Record<string, unknown> | null;
}

export interface BattleReportDto {
  id: string;
  createdAt: string;
  attackerKingdomId: string;
  attackerKingdomName: string;
  defenderKingdomId: string;
  defenderKingdomName: string;
  tileId: string;
  intent: ArmyIntent;
  mode: 'raid' | 'siege_round' | 'siege_final';
  attackerWon: boolean;
  attackPower: number;
  defensePower: number;
  attackerLosses: ArmyComposition;
  defenderLosses: ArmyComposition;
  plunder: ResourceBundle;
  wallDamage: number;
  wallIntegrityAfter: number;
  narrative: string;
  /** Başkent düştüyse fetih bilgisi (§12). */
  capitalFell: boolean;
}

export interface WorldEventDto {
  id: string;
  type: WorldEventType;
  title: string;
  description: string;
  triggeredAt: string;
  expiresAt: string | null;
  effect: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Meclis (chat) ve kademeli karar
// ---------------------------------------------------------------------------

export interface ChatMessageDto {
  id: string;
  role: 'king' | 'general' | 'system';
  content: string;
  createdAt: string;
  /** General bu turda hangi aksiyonları yürüttü. */
  actions: ExecutedActionDto[];
  /** Pasif modda alınmış bir karar paketi mi (§14.2). */
  isPassiveSummary: boolean;
}

export interface ExecutedActionDto {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  message: string;
  errorCode: ActionErrorCode | null;
  quotaSpent: number;
  tier: DecisionTier;
}

export interface PendingDecisionDto {
  id: string;
  proposedAction: { name: string; arguments: Record<string, unknown> };
  generalRecommendation: string;
  /** Neden büyük karar sayıldığı (§14.5). */
  riskReasons: string[];
  createdAt: string;
  expiresAt: string;
  status: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  messages: ChatMessageDto[];
  pendingDecisions: PendingDecisionDto[];
  /** General sessize düştüyse dolu (§14.6). */
  llmError: { kind: string; message: string } | null;
  quotaRemaining: number;
}

// ---------------------------------------------------------------------------
// Ayarlar (BYOK)
// ---------------------------------------------------------------------------

export interface LlmSettingsRequest {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  /** `openai_compatible` için zorunlu. */
  baseUrl?: string;
}

export interface LlmSettingsResponse {
  ok: boolean;
  status: LlmStatusDto;
  /** Onboarding tanışma çağrısının yanıtı (§14.7). */
  greeting?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Sezon sonu (§12)
// ---------------------------------------------------------------------------

export interface DefeatChoiceRequest {
  /** GDD §12: oyuncu raporu gördükten sonra bilinçli olarak seçer. */
  choice: 'spectate' | 'restart_as_refugee';
}

export interface SeasonResultDto {
  channelId: string;
  channelName: string;
  finishedAt: string;
  winnerAllianceId: string | null;
  winnerAllianceName: string | null;
  standings: {
    rank: number;
    kingdomId: string;
    kingdomName: string;
    ownerDisplayName: string;
    survivedUntil: string | null;
    tilesConquered: number;
    peakPopulation: number;
  }[];
}

// ---------------------------------------------------------------------------
// Ortak hata gövdesi
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  code?: ActionErrorCode | string;
  details?: unknown;
}
