import { isConfirmationReply } from "./general-intent";
import { type PopulacePulse, populacePulse } from "../engine/faction";
/**
 * General'in itiraz kararı burada, kodda verilir; modelin insafına bırakılmaz.
 * Amaç: Kral riskli bir emir verdiğinde General'in gerçekten karşı çıkabilmesi,
 * ve bu itirazın sadakat düzeyine göre aşılabilir ya da aşılamaz olması.
 */

export type RiskLevel = "low" | "elevated" | "severe";

export type KingdomSnapshot = {
  resources: Record<string, number>;
  hourlyRates: Record<string, number>;
  population: number;
  popularity: number;
  loyalty: number;
  army: number;
  protectionHoursLeft: number;
  counterIntelligenceActive: boolean;
  /**
   * İç muhalefet baskısı — HALKIN NABZI göstergesinin ikinci girdisi
   * (plan belgesi Fikir 6). Opsiyonel: göndermeyen çağıran için baskı 0
   * sayılır, yani nabız yalnızca rızadan okunur ve gösterge yine çalışır.
   */
  factionPressure?: number;
};

export type ProposedAction = { name: string; arguments: Record<string, unknown> };

export type RiskAssessment = {
  level: RiskLevel;
  reasons: string[];
  /** Emrin tükettiği en yüksek kaynak oranı (0-1+). */
  spendRatio: number;
  /** Yiyeceğin biteceği tahmini saat; sonsuz ise açlık riski yok. */
  foodHoursLeft: number;
  /**
   * HALKIN NABZI (plan belgesi Fikir 6) — nitel, sayısız.
   *
   * Her kademede HESAPLANIR ama yalnızca `elevated`/`severe` kademelerinde
   * GÖSTERİLİR; kapı `pulseNote` içindedir. Alanın burada durması
   * bilinçli: değerlendirmenin bir parçası olduğu için testten doğrudan
   * ölçülebiliyor ve ileride başka bir gösterici (örn. panel) aynı yerden
   * okuyabilir — nabız ikinci bir yerde yeniden hesaplanmasın (kısıt #5).
   */
  pulse: PopulacePulse;
};

export type Verdict = {
  outcome: "apply" | "confirm" | "refuse";
  assessment: RiskAssessment;
  /** Kralın teyidi neden yetersiz sayıldı ya da neden yeterli sayıldı. */
  note: string;
};

/** Emrin bilinen maliyeti; bilinmiyorsa boş kalır ve harcama riski hesaplanmaz. */
export type ActionCost = Partial<Record<string, number>>;

const SPEND_ELEVATED = 0.4;
const SPEND_SEVERE = 0.65;
const FOOD_ELEVATED_HOURS = 12;
const FOOD_SEVERE_HOURS = 4;
const TAX_ELEVATED = 30;
const TAX_SEVERE = 42;

/** Sadakat eşikleri: düşük sadakatte General ağır riski hiç kabul etmez. */
export const LOYALTY = { obedient: 70, wary: 40 } as const;

function foodHoursLeft(state: KingdomSnapshot) {
  const rate = state.hourlyRates.food ?? 0;
  if (rate >= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, (state.resources.food ?? 0) / Math.abs(rate));
}

function highest(level: RiskLevel, candidate: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "elevated", "severe"];
  return order.indexOf(candidate) > order.indexOf(level) ? candidate : level;
}

export function assessAction(action: ProposedAction, state: KingdomSnapshot, cost: ActionCost = {}): RiskAssessment {
  const reasons: string[] = [];
  let level: RiskLevel = "low";

  // 1) Hazine tüketimi
  // Oran EN SIKIŞAN kaynaktan gelir; adı da ondan gelmeli. Eskiden ad
  // maliyetin en BÜYÜK kalemine göre seçiliyordu, dolayısıyla "odun stokunun
  // %194'ü" derken oran taşa ait olabiliyordu: rakam bir kaynağı, isim
  // başkasını anlatıyordu.
  let spendRatio = 0, tightest = "";
  for (const [key, amount] of Object.entries(cost)) {
    if (!amount) continue;
    const held = Math.max(1, state.resources[key] ?? 0);
    const ratio = amount / held;
    if (ratio > spendRatio) { spendRatio = ratio; tightest = key; }
  }
  if (spendRatio >= SPEND_SEVERE) {
    level = highest(level, "severe");
    reasons.push(`Bu emir ${labelOf(tightest) || key0(cost)} stokunun %${Math.round(spendRatio * 100)}'ini tüketiyor; hazine savunmasız kalır.`);
  } else if (spendRatio >= SPEND_ELEVATED) {
    level = highest(level, "elevated");
    reasons.push(`Emir kaynakların %${Math.round(spendRatio * 100)}'ini bağlıyor; beklenmedik bir saldırıda hareket alanımız kalmaz.`);
  }

  // 2) Yiyecek/açlık
  const hours = foodHoursLeft(state);
  const feedsPeople = action.name === "build_structure" &&
    (action.arguments.building_type === "wheat_farm" || action.arguments.building_type === "apple_orchard" || action.arguments.building_type === "mill");
  if (!feedsPeople && Number.isFinite(hours)) {
    if (hours <= FOOD_SEVERE_HOURS) {
      level = highest(level, "severe");
      reasons.push(`Yiyecek ${Math.floor(hours)} saat içinde tükeniyor; bu emir halkı aç bırakır.`);
    } else if (hours <= FOOD_ELEVATED_HOURS) {
      level = highest(level, "elevated");
      reasons.push(`Yiyecek ancak ${Math.floor(hours)} saat yeter; önce üretimi düzeltmeliyiz.`);
    }
  }

  // 3) Vergi
  if (action.name === "set_tax_rate") {
    const rate = Math.floor(Number(action.arguments.rate_percent));
    if (rate >= TAX_SEVERE) {
      level = highest(level, "severe");
      reasons.push(`%${rate} vergi halkı isyana sürükler; rıza zaten ${Math.round(state.popularity)} puanda.`);
    } else if (rate > TAX_ELEVATED) {
      level = highest(level, "elevated");
      reasons.push(`%${rate} vergi halkın rızasını hızla aşındırır.`);
    }
  }

  // 4) Asker eğitimi nüfusu boşaltıyor mu
  if (action.name === "train_unit") {
    const count = Math.floor(Number(action.arguments.count)) || 0;
    if (count > state.population * 0.25) {
      level = highest(level, "severe");
      reasons.push(`${count} kişi nüfusun dörtte birinden fazlası; tarlalar boş kalır.`);
    }
  }

  // 5) Koruma biterken savunmasızlık
  if (state.protectionHoursLeft > 0 && state.protectionHoursLeft <= 24 && state.army === 0 && action.name !== "train_unit") {
    level = highest(level, "elevated");
    reasons.push(`Koruma ${Math.ceil(state.protectionHoursLeft)} saat sonra bitiyor ve tek askerimiz yok.`);
  }

  // 6) Ajan göndermek nöbet yokken karşılık davet eder
  if (action.name === "send_scout" && !state.counterIntelligenceActive) {
    level = highest(level, "elevated");
    reasons.push("Kendi nöbetimiz kurulu değilken ajan yollamak misilleme davet eder.");
  }

  return {
    level, reasons, spendRatio, foodHoursLeft: hours,
    pulse: populacePulse(state.popularity, state.factionPressure ?? 0),
  };
}

/** Maliyette en ağır basan kaynağın adı; mesajı somutlaştırmak için. */
const RESOURCE_LABELS: Record<string, string> = { gold: "altın", food: "yiyecek", stone: "taş", wood: "odun", iron: "demir", ale: "bira" };

export const labelOf = (key: string) => RESOURCE_LABELS[key] ?? "";

function key0(cost: ActionCost) {
  const entries = Object.entries(cost).filter(([, value]) => Boolean(value));
  if (!entries.length) return "hazine";
  return RESOURCE_LABELS[entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0]] ?? "hazine";
}

/**
 * Kralın ısrarının yeterli olup olmadığına sadakat karar verir.
 * Düşük sadakatte General ağır riskli emri reddeder; Kral "yap" diyerek geçemez.
 */
export function decide(assessment: RiskAssessment, loyalty: number, kingInsisted: boolean, justified: boolean): Verdict {
  if (assessment.level === "low") {
    return { outcome: "apply", assessment, note: "Rutin emir; doğrudan uygulanır." };
  }

  if (assessment.level === "severe") {
    if (loyalty < LOYALTY.wary) {
      return { outcome: "refuse", assessment, note: "Sadakat düşük; General ağır riskli emri reddediyor." };
    }
    // Ağır riskte yalnızca "yap" yetmez; Kral sonucu anladığını gösteren gerekçe sunmalı.
    if (kingInsisted && justified) {
      return { outcome: "apply", assessment, note: "Kral gerekçeli ısrar etti; sorumluluk Kralda olmak üzere uygulanıyor." };
    }
    if (kingInsisted && loyalty >= LOYALTY.obedient) {
      return { outcome: "apply", assessment, note: "Sadakat yüksek; General gerekçesiz ısrara da uyuyor." };
    }
    return { outcome: "confirm", assessment, note: "Ağır risk; General gerekçeli teyit istiyor." };
  }

  // elevated
  if (kingInsisted) {
    return { outcome: "apply", assessment, note: "Kral ısrar etti; orta riskli emir uygulanıyor." };
  }
  if (loyalty >= LOYALTY.obedient) {
    return { outcome: "confirm", assessment, note: "Orta risk; General uyarıp teyit istiyor." };
  }
  return { outcome: "confirm", assessment, note: "Sadakat sınırlı; General teyit olmadan ilerlemiyor." };
}

/**
 * HALKIN NABZI KAPISI (plan belgesi Fikir 6, "Karar 2026-08-22").
 *
 * Gösterge `elevated` VE `severe` kademelerinde görünür, yalnızca `severe`
 * değil — kararın birinci maddesi. `low` kademede boş dize döner: rutin bir
 * emirde halkın nabzını basmak göstergeyi gürültüye çevirir ve Kral onu okumayı
 * bırakır (halkın sesinin `MAX_OPEN_DEMANDS` tavanıyla aynı disiplin).
 *
 * Metin `assessment.pulse`ten OLDUĞU GİBİ alınır; burada yeni bir cümle
 * kurulmaz ve hiçbir sayı eklenmez (kararın ikinci maddesi: nitel etiket,
 * sayısal tahmin yok).
 *
 * DIŞA AÇIK OLMASININ SEBEBİ TESTTİR, ikinci bir çağıran değil. `low` kademede
 * `reviewProposedActions` zaten hiç not üretmiyor, yani kapı o yoldan
 * sınanamıyordu: kapıyı kaldıran bir mutasyon tek bir testi bile kırmadan
 * geçiyordu. Kapı burada durup doğrudan çağrılabildiği için artık kırıyor.
 */
export function pulseNote(assessment: Pick<RiskAssessment, "level" | "pulse">): string {
  if (assessment.level === "low") return "";
  return ` HALKIN NABZI: ${assessment.pulse.label} ${assessment.pulse.note}`;
}

export type ReviewOutcome = {
  /** Motora iletilecek eylemler; teyit gerektirenler burada yer almaz. */
  approved: ProposedAction[];
  /** Krala gösterilecek itiraz/uyarı/ret metinleri. */
  notes: string[];
  /** Teyit beklemek üzere saklanacak emir; yoksa null. */
  toStore: { action: ProposedAction; reasons: string[]; riskLevel: "elevated" | "severe" } | null;
  /** Onaylanıp uygulanan bekleyen emir varsa kaydı silinmeli. */
  clearPending: boolean;
};

/**
 * Önerilen eylemleri risk modelinden geçirir. Saf fonksiyondur: veritabanına
 * dokunmaz, yalnızca ne yapılması gerektiğini söyler.
 */
export function reviewProposedActions(
  actions: ProposedAction[],
  state: KingdomSnapshot,
  costFor: (action: ProposedAction) => ActionCost,
  pendingActionName: string | null,
  confirmation: { insisted: boolean; justified: boolean },
): ReviewOutcome {
  const approved: ProposedAction[] = [], notes: string[] = [];
  let toStore: ReviewOutcome["toStore"] = null, clearPending = false;

  for (const action of actions) {
    const assessment = assessAction(action, state, costFor(action));
    const isPendingAction = pendingActionName === action.name;
    const insisted = confirmation.insisted && isPendingAction;
    const verdict = decide(assessment, state.loyalty, insisted, confirmation.justified);

    if (verdict.outcome === "apply") {
      // Modelin kendi confirmed_risk iddiasına güvenilmez; bayrağı motor kararı belirler.
      approved.push(assessment.level === "low" ? action : { ...action, arguments: { ...action.arguments, confirmed_risk: true } });
      if (isPendingAction) clearPending = true;
      if (assessment.level !== "low") notes.push(`⚠ ${assessment.reasons[0]} Sorumluluk sizde olmak üzere uyguluyorum.${pulseNote(assessment)}`);
      continue;
    }
    if (verdict.outcome === "refuse") {
      notes.push(`✕ Bu emri uygulamayacağım. ${assessment.reasons.join(" ")} Sadakatim bu riski üstlenmeme yetmiyor; önce beni ikna etmelisiniz.${pulseNote(assessment)}`);
      continue;
    }
    if (!toStore && assessment.level !== "low") {
      toStore = { action, reasons: assessment.reasons, riskLevel: assessment.level };
    }
    notes.push(`⏸ ${assessment.reasons.join(" ")} Onayınızı bekliyorum — gerekçenizi de söylerseniz derhal uygularım.${pulseNote(assessment)}`);
  }
  return { approved, notes, toStore, clearPending };
}

/**
 * Kralın mesajı bekleyen bir emri onaylıyor mu, ve gerekçe sunuyor mu?
 *
 * Kısa onaylar (evet / tamam / onay / onay veriyorum) tek bir yerden okunur:
 * isConfirmationReply. Burada ayrıca ısrar ve emir kipleri aranır. Eskiden bu
 * liste kendi başınaydı ve "onay" ile "onay veriyorum" hiç eşleşmiyordu; Kral
 * onay verdiğini sanıyor, bekleyen emir hiç uygulanmıyordu.
 */
export function readConfirmation(message = "") {
  const normalized = message.toLocaleLowerCase("tr-TR");
  const insisted = isConfirmationReply(message)
    || /(yap|uygula|onaylıyorum|onayla|onay ver|ısrar ediyorum|israr ediyorum|devam et|emrediyorum|yine de|buna rağmen|ragmen)/.test(normalized);
  const cancelled = /(vazgeçtim|vazgectim|iptal|boş ver|bos ver|gerek yok|yapma)/.test(normalized);
  // Gerekçe: "çünkü", "zira" gibi bir bağlaç ya da yeterince uzun bir açıklama.
  const justified = /(çünkü|cunku|zira|nedeni|bu yüzden|bu yuzden|amacım|amacim|sebebi)/.test(normalized) || normalized.trim().split(/\s+/).length >= 8;
  return { insisted: insisted && !cancelled, cancelled, justified };
}
