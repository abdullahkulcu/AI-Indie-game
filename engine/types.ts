/**
 * Oyun motorunun ortak tipleri. Bu klasör hem tarayıcı hem sunucu tarafından
 * kullanılır; buraya Cloudflare, React veya DOM'a bağlı hiçbir şey girmemeli.
 */

export type Key = "gold" | "food" | "stone" | "wood" | "iron" | "ale";
export type Res = Record<Key, number>;
export type TerrainId = "plain" | "forest" | "mountain" | "riverbank";

export type Building = { type: string; name: string; category: string; level: number };

export type Queue = {
  kind: "building" | "unit";
  type: string;
  name: string;
  targetLevel?: number;
  count?: number;
  startedAt?: number;
  completesAt: number;
  /** Dışarıdan işçi tutulup hızlandırıldı mı? Aynı iş bir kereden fazla hızlandırılamaz. */
  hastened?: boolean;
};

/**
 * Pazara verilen açık teklif. Mal ambardan (ya da altın hazineden) emir
 * verilince çıkar, karşılığı ancak teklif kapandığında gelir. Yüklü teklif
 * daha uzun sürer; pazar anlık bir takas masası değildir.
 */
export type MarketOrder = {
  id: string;
  resource: Key;
  amount: number;
  direction: "sell" | "buy";
  /** Satışta gelecek altın, alışta ödenmiş altın. */
  gold: number;
  placedAt: number;
  completesAt: number;
};

export type Notice = { kind: string; text: string; at: number };

export type Game = {
  version: 2;
  kingdomName: string;
  rulerName: string;
  channel: string;
  channelId?: string;
  speed: number;
  terrain: TerrainId;
  foundedAt: number;
  lastTickAt: number;
  protectionEndsAt: number;
  resources: Res;
  population: number;
  capacity: number;
  popularity: number;
  reputation: number;
  loyalty: number;
  taxRate: number;
  /**
   * KULLANILMIYOR — eski emir kotası. Motor (tick/actions) bu iki alana artık
   * hiç dokunmaz; emir sayısına kota yoktur.
   *
   * Alanlar tipten SİLİNMEDİ, çünkü:
   *  1) Eski kayıtlarda mevcutlar ve save şeması `.strict()`; sessizce silmek
   *     bütün eski kayıtları reddettirirdi (şemada `.optional()` yapıldı).
   *  2) `components/KingdomGame.tsx` bunları hâlâ okuyor. Opsiyonel yapmak o
   *     dosyada tip hatası üretirdi; arayüz sadeleşmesi ayrı bir iş.
   * Arayüz kotayı göstermeyi bıraktığında ikisi de kaldırılabilir.
   */
  quota: number;
  quotaAt: number;
  buildings: Building[];
  units: Record<string, number>;
  queue: Queue | null;
  notices: Notice[];
  provider: string | null;
  model: string | null;
  generalConnected: boolean;
  strategyNote?: string;
  startingReserveGranted?: boolean;
  /** Halk sistemi. Eski kayıtlarda bulunmayabilir; motor varsayılanları uygular. */
  foodRation?: number;
  aleRation?: number;
  soldierPay?: number;
  /** Maaşı eksik ödenen askerlerin biriken huzursuzluğu (0-100). */
  soldierUnrest?: number;
  /** Ortak madene gönderilen işçi. Bunlar halkın içinden çıkar: tarlada değil
   *  madende çalışırlar, yani yerel üretime katkı vermezler ama yemek yerler. */
  mineWorkers?: number;
  /** Nüfus defteri: krallık kurulduğundan beri kapıdan giren ve çıkan insan sayısı. */
  peopleJoined?: number;
  peopleLeft?: number;
  /** Deftere henüz tam sayı olarak yazılmamış kesirli hareket. */
  migrationDrift?: number;
  /** Son göçmen çağrısı; ard arda çağrı yapılmasın diye bekleme süresi buradan sayılır. */
  lastSettlerCallAt?: number;
  /** Pazarda bugün alınıp satılan toplam birim ve o günün başlangıcı. */
  marketVolume?: number;
  marketDayAt?: number;
  /** Pazarda bekleyen açık teklifler; yuva sayısı Pazar seviyesidir. */
  marketOrders?: MarketOrder[];
  /** Son depo taşması bildirimi; defteri saniyede bir uyarıyla doldurmamak için. */
  lastSpoilNoticeAt?: number;
  /** Akın ve nöbet sistemi. Eski kayıtlarda yok; motor varsayılan uygular. */
  watchRatio?: number;
  lastRaidAt?: number;
  raidsRepelled?: number;
  raidsSuffered?: number;
};

export type GameAction = { name: string; arguments: Record<string, unknown> };

export const RESOURCE_KEYS: Key[] = ["gold", "food", "stone", "wood", "iron", "ale"];
