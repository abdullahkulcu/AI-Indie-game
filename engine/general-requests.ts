/**
 * General'in Kral'dan istedikleri.
 *
 * Şimdiye kadar ilişki tek yönlüydü: Kral ister, General uygular. Oysa bir
 * karakterin kendi talepleri olur. Talepler uydurulmaz, KRALLIĞIN DURUMUNDAN
 * türetilir: kışlasız ordu, maaşsız asker, yarım istihkakla yaşayan halk.
 * Böylece General "bir şey isteyen" değil, "durumu gören" biri gibi konuşur.
 *
 * Bu modül saftır: veritabanı ve tarih kullanmaz. Taleplerin ne zaman açıldığı
 * (`since`) ve karşılanıp karşılanmadığı `server/general-ledger.ts` içinde tutulur.
 */

export type RequestKind =
  | "barracks"
  | "soldier_pay"
  | "food_ration"
  | "festival"
  | "food_production"
  | "treasury";

export type RequestSeverity = "normal" | "urgent";

/**
 * Talebi karşılayan emirler. `buildingTypes` verilmişse `build_structure`
 * yalnızca o yapıyı kurduğunda sayılır; aksi hâlde taş ocağı emri "kışla
 * istiyorum" talebini karşılamış gibi görünürdü.
 */
export type RequestSatisfier = { actions: string[]; buildingTypes?: string[] };

export type DerivedRequest = {
  kind: RequestKind;
  /** Kral'a gösterilecek cümle; General'in ağzından. */
  text: string;
  severity: RequestSeverity;
  satisfiedBy: RequestSatisfier;
};

/** Talep üretimi için gereken durum özeti. */
export type RequestSignals = {
  resources: Record<string, number>;
  hourlyRates: Record<string, number>;
  buildings: Array<{ type?: string; name?: string; level?: number }>;
  populace?: {
    moodScore?: number;
    foodRation?: number;
    soldierPay?: number;
    soldierUnrest?: number;
    army?: number;
  };
};

const UNREST_DEMAND = 30;
const MOOD_UNHAPPY = 40;
const TREASURY_FLOOR = 120;
const RATION_THIN = 90;

/**
 * Yapı var mı? İstemcinin gönderdiği bağlamda binaların `type` alanı olmayabilir
 * (yalnızca Türkçe ad ve seviye gelir), bu yüzden ad da kabul edilir.
 */
const has = (signals: RequestSignals, type: string, label: string) =>
  signals.buildings.some(building =>
    (building.type === type || building.name === label) && (building.level ?? 1) >= 1);

/**
 * Şu an açık olan talepler. Sıra önemlidir: en acil olan başa gelir, çünkü
 * arayüz ve prompt ilk maddeleri öne çıkarır.
 */
export function deriveRequests(signals: RequestSignals): DerivedRequest[] {
  const requests: DerivedRequest[] = [];
  const populace = signals.populace ?? {};
  const army = populace.army ?? 0;
  const unrest = populace.soldierUnrest ?? 0;
  const pay = populace.soldierPay ?? 100;
  const ration = populace.foodRation ?? 100;
  const mood = populace.moodScore ?? 50;
  const gold = signals.resources.gold ?? 0;
  const foodRate = signals.hourlyRates.food ?? 0;
  const goldRate = signals.hourlyRates.gold ?? 0;

  // 1) Maaşsız asker her şeyden önce gelir: firar ordunun kendisini eritir.
  if (army > 0 && (unrest >= UNREST_DEMAND || pay < 100)) {
    requests.push({
      kind: "soldier_pay",
      severity: unrest >= UNREST_DEMAND ? "urgent" : "normal",
      text: unrest >= UNREST_DEMAND
        ? `Adamlarım maaşlarını istiyor; huzursuzluk ${Math.round(unrest)} puana çıktı. Maaşı %100'e döndürmezsek firar başlar.`
        : `Asker maaşı %${Math.round(pay)}'de duruyor. Kışlada homurdanma başlamadan tamamlamalıyız.`,
      satisfiedBy: { actions: ["set_soldier_pay"] },
    });
  }

  // 2) Yiyecek üretimi eksideyse istihkak tartışması anlamsız; önce tarla.
  if (foodRate < 0) {
    const food = signals.resources.food ?? 0;
    const hours = Math.abs(foodRate) > 0 ? Math.floor(food / Math.abs(foodRate)) : 0;
    requests.push({
      kind: "food_production",
      severity: hours <= 12 ? "urgent" : "normal",
      text: `Ambar eriyor: yiyecek ${hours} saat sonra bitiyor. Bir Buğday Tarlası ya da Elma Bahçesi emri bekliyorum.`,
      // Değirmen yalnızca TARLASI OLANA yiyecek getirir: tarlanın ürününü
      // öğütür, kendi başına buğday ekmez (bkz. engine/catalog.ts,
      // millMultiplier). Tarlası olmayana Değirmen önermek, aç Kralı boş bir
      // masrafa sokardı; o yüzden liste duruma göre kurulur.
      satisfiedBy: {
        actions: ["build_structure"],
        buildingTypes: has(signals, "wheat_farm", "Buğday Tarlası")
          ? ["wheat_farm", "apple_orchard", "mill"]
          : ["wheat_farm", "apple_orchard"],
      },
    });
  }

  // 3) Halk yarım istihkakla yaşıyorsa General bunu dile getirir.
  if (ration < RATION_THIN) {
    requests.push({
      kind: "food_ration",
      severity: ration < 60 ? "urgent" : "normal",
      text: `Halk %${Math.round(ration)} istihkakla yaşıyor. Karınları doymadan ne tezgâh döner ne de sadakat kalır.`,
      satisfiedBy: { actions: ["set_food_ration"] },
    });
  }

  // 4) Ordu yok ve kışla da yoksa savunma diye bir şey yok.
  if (!has(signals, "barracks", "Kışla")) {
    requests.push({
      kind: "barracks",
      severity: army === 0 ? "normal" : "urgent",
      text: "Adamlarım kışlasız kaldı; eğitim yapacak yerimiz yok. Bir Kışla emri verirseniz savunmayı kurarım.",
      satisfiedBy: { actions: ["build_structure"], buildingTypes: ["barracks"] },
    });
  }

  // 5) Rıza düşükse ve halk açsa değil, karnı tokken şenlik işe yarar.
  if (mood < MOOD_UNHAPPY && ration >= RATION_THIN) {
    requests.push({
      kind: "festival",
      severity: "normal",
      text: `Halkın rızası ${Math.round(mood)} puana düştü. Karınları tok; bir şenlik borçlusunuz.`,
      satisfiedBy: { actions: ["host_festival", "set_ale_ration"] },
    });
  }

  // 6) Hazine dibe vuruyorsa vergi konuşulmalı.
  if (gold < TREASURY_FLOOR || goldRate < 0) {
    requests.push({
      kind: "treasury",
      severity: gold < TREASURY_FLOOR / 2 ? "urgent" : "normal",
      text: `Hazine beni kaygılandırıyor: ${Math.round(gold)} altın kaldı. Vergiyi bir süre yükseltmeliyiz.`,
      satisfiedBy: { actions: ["set_tax_rate"] },
    });
  }

  return requests;
}

/** Bu turda uygulanan emirler hangi talepleri karşılıyor? */
export function requestsSatisfiedBy(
  requests: Array<{ kind: RequestKind; satisfiedBy: RequestSatisfier }>,
  actions: Array<{ name: string; arguments?: Record<string, unknown> }>,
): RequestKind[] {
  return requests
    .filter(request => actions.some(action => {
      if (!request.satisfiedBy.actions.includes(action.name)) return false;
      const types = request.satisfiedBy.buildingTypes;
      if (!types) return true;
      return types.includes(String(action.arguments?.building_type ?? ""));
    }))
    .map(request => request.kind);
}

/** Talepleri modele verilecek kısa metne çevirir. */
export function renderRequests(requests: Array<{ text: string; severity: RequestSeverity }>): string {
  if (!requests.length) return "";
  return requests.map(request => `- ${request.severity === "urgent" ? "[ACİL] " : ""}${request.text}`).join("\n");
}
