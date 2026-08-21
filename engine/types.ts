/**
 * Oyun motorunun ortak tipleri. Bu klasör hem tarayıcı hem sunucu tarafından
 * kullanılır; buraya Cloudflare, React veya DOM'a bağlı hiçbir şey girmemeli.
 */

export type Key = "gold" | "food" | "stone" | "wood" | "iron" | "ale";
export type Res = Record<Key, number>;
export type TerrainId = "plain" | "forest" | "mountain" | "riverbank";

/** Yerel pazarda işlem gören kaynaklar. Altın bir mal değil, ödeme aracıdır. */
export type TradeKey = "food" | "wood" | "stone" | "iron" | "ale";

/**
 * Halkın kendi stoğu — krallığın İKİNCİ defteri. Kale ambarı (`Game.resources`)
 * Kralın malıdır; bu ise halkın elindekidir ve yerel pazarın fiyatı buradan
 * doğar. Kurallar `engine/market.ts` içindedir.
 */
export type Commons = Record<TradeKey, number>;

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
  /**
   * Halkın kendi stoğu; yerel pazarın fiyatı buradan doğar. Eski kayıtlarda
   * yoktur — motor o zaman halkı normal stoğunda kabul eder (fiyat = taban).
   */
  commons?: Commons;
  /** Pazarda bugün alınıp satılan toplam birim ve o günün başlangıcı. */
  marketVolume?: number;
  marketDayAt?: number;
  /** Pazarda bekleyen açık teklifler; yuva sayısı Pazar seviyesidir. */
  marketOrders?: MarketOrder[];
  /** Son depo taşması bildirimi; defteri saniyede bir uyarıyla doldurmamak için. */
  lastSpoilNoticeAt?: number;
  /**
   * İç hizip baskısı (0-100). Rıza uzun süre düşük kalınca birikir, düzelince
   * erir; askerin zapt gücünü zayıflatır (bkz. engine/faction.ts).
   *
   * SUNUCU-TÜREVİDİR: istemcinin bildirdiği değer yok sayılır, sunucunun kendi
   * `tick()`'i esas alınır (bkz. server/save-validation.ts → SERVER_DERIVED).
   */
  factionPressure?: number;
  /**
   * DIŞ KESE taşıyıcıları (bkz. engine/agitation.ts). Değerler `agitationAt`
   * ANINDAKİ değerdir; sönüm okuma anında kapalı çözümle hesaplanır. Üçü de
   * SUNUCU-TÜREVİDİR: istemci bunları ne yazabilir ne silebilir.
   */
  agitationPressure?: number;
  agitationBribe?: number;
  agitationAt?: number;
  /** Yakalanan kesenin hedefe verdiği kalkanın bitiş anı. */
  agitationShieldUntil?: number;
  /**
   * MAL KESESİ: yabancının pazara yığdığı mal, referans stoğun katı olarak.
   * Fiyat hesabının yalnızca SATIŞ koluna girer; alışa ve rızaya girmez, yani
   * hedef bu maldan ne ambar doldurabilir ne rıza kazanabilir.
   * SUNUCU-TÜREVİDİR.
   */
  commonsGlut?: Partial<Record<TradeKey, number>>;
  commonsGlutAt?: number;
  /** Akın ve nöbet sistemi. Eski kayıtlarda yok; motor varsayılan uygular. */
  watchRatio?: number;
  lastRaidAt?: number;
  raidsRepelled?: number;
  raidsSuffered?: number;
};

export type GameAction = { name: string; arguments: Record<string, unknown> };

export const RESOURCE_KEYS: Key[] = ["gold", "food", "stone", "wood", "iron", "ale"];
