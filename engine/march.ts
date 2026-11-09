/**
 * Seferin yol, hazırlık ve ikmal hesabı.
 *
 * Bu modül sunucudan ve arayüzden bağımsızdır: iki taraf aynı emri aynı
 * koordinatlarla okuduğunda aynı süreyi görür. Mutlak zaman damgasını sunucu
 * ekler; burada yalnızca oyun kuralı hesaplanır.
 */
import { terrainCatalog } from "./catalog";
import type { TerrainId } from "./types";
import { armyManpower, armyUpkeep, isUnitType, unitOf, type UnitType } from "./units";

export type MapPosition = { x: number; z: number };
export type CampaignUnits = Partial<Record<UnitType, number>>;

export type MarchEstimate = {
  distance: number;
  slowestSpeed: number;
  routeMultiplier: number;
  gameHours: number;
  durationMs: number;
};

/**
 * Seferler, ekonomi tikinin hızıyla bire bir akmaz. Bir ordunun toplanması,
 * erzak katarının hazırlanması ve haberleşme; hızlı sezonlarda dahi Kral'a
 * karar penceresi bırakmalıdır. Bu çarpan, sefer takviminde gerçekten geçen
 * oyun zamanını büyütür; ikmal hesabı ve başkentteki üretim de aynı zaman
 * çizelgesini izler.
 *
 * En uzun rota: Hızlı Taç'ta 1 gün, Sınır Boyu'nda 2 gün, standart sezonda
 * 4 gün sürer. Yeni bir speed değeri eklenirse güvenli, yavaş sezon davranışı
 * kullanılır; yönetici paneli şu an yalnız 1/4/24 kabul eder.
 */
export function campaignTempoMultiplier(channelSpeed: number): number {
  const speed = Math.max(1, Math.floor(Number(channelSpeed) || 1));
  if (speed >= 24) return 24;
  if (speed >= 4) return 8;
  return 4;
}

/** Sefer safhasının oyun zamanını gerçek channel temposuna çevirir. */
export function campaignDurationMs(gameHours: number, channelSpeed: number): number {
  const speed = Math.max(1, Number(channelSpeed) || 1);
  const hours = Math.max(0, Number(gameHours) || 0);
  return Math.round(hours * campaignTempoMultiplier(speed) * 3_600_000 / speed);
}

/** Çatışmanın ardışık safhaları arasındaki komuta ve haberleşme penceresi. */
export function battlePhaseDurationMs(channelSpeed: number): number {
  return Math.max(60_000, campaignDurationMs(1, channelSpeed));
}

/** Birlik kaydını katalog dışı, kesirli ve negatif değerlerden arındırır. */
export function normalizeCampaignUnits(units: Record<string, unknown>): CampaignUnits {
  const result: CampaignUnits = {};
  for (const [type, raw] of Object.entries(units)) {
    if (!isUnitType(type)) continue;
    const count = Math.max(0, Math.floor(Number(raw) || 0));
    if (count) result[type] = count;
  }
  return result;
}

export function campaignUnitCount(units: Record<string, number>): number {
  return Object.values(normalizeCampaignUnits(units)).reduce((total, count) => total + (count ?? 0), 0);
}

export function mapDistance(from: MapPosition, to: MapPosition): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** Ordunun içindeki en yavaş birlik yürüyüş hızını belirler. */
export function slowestCampaignSpeed(units: Record<string, number>): number | null {
  const speeds = Object.entries(normalizeCampaignUnits(units)).flatMap(([type, count]) => {
    const unit = unitOf(type);
    return count && unit ? [unit.speed] : [];
  });
  return speeds.length ? Math.min(...speeds) : null;
}

/**
 * Plan belgesindeki formül: mesafe / en yavaş hız × 1,5 / rota çarpanı.
 * Temel rota bir ile 24 oyun saati arasındadır. Sefer temposu bu zamanı
 * channel'a göre uzatır: en uzun rota Hızlı Taç'ta 1, Sınır Boyu'nda 2,
 * standart sezonda 4 gerçek gün sürer. `gameHours` bu uzatılmış takvimdir;
 * ikmal de aynı süreye göre ayrılır.
 */
export function estimateMarch(input: {
  from: MapPosition;
  to: MapPosition;
  units: Record<string, number>;
  targetTerrain: TerrainId;
  channelSpeed: number;
}): MarchEstimate | null {
  const slowestSpeed = slowestCampaignSpeed(input.units);
  if (!slowestSpeed) return null;
  const routeMultiplier = terrainCatalog[input.targetTerrain]?.travel ?? 1;
  const distance = mapDistance(input.from, input.to);
  const baseGameHours = Math.max(1, Math.min(24, distance / slowestSpeed * 1.5 / routeMultiplier));
  const gameHours = baseGameHours * campaignTempoMultiplier(input.channelSpeed);
  return {
    distance,
    slowestSpeed,
    routeMultiplier,
    gameHours,
    durationMs: campaignDurationMs(baseGameHours, input.channelSpeed),
  };
}

/**
 * Toplanma en az 30 oyun dakikasıdır. Ağır kuşatma konvoyu ya da çoğunluğu
 * süvari olan kuvvet, düzen ve yem hazırlığı için ek 15 dakika ister. Rota
 * gibi bu süre de sefer temposuna bağlanır; hazırlık ve yürüyüş farklı takvim
 * kullanmaz.
 */
export function gatheringDurationMs(units: Record<string, number>, channelSpeed: number): number | null {
  const clean = normalizeCampaignUnits(units);
  const total = campaignUnitCount(clean);
  if (!total) return null;
  const cavalry = clean.cavalry ?? 0;
  const extra = (clean.siege_team ?? 0) > 0 || cavalry / total > .5 ? .25 : 0;
  return campaignDurationMs(.5 + extra, channelSpeed);
}

/**
 * Gidiş, öngörülen üç saatlik temas ve dönüş için ayrılacak yiyecek. Seferde
 * katalogdaki barış rasyonunun iki katı tüketilir; %20 emniyet payı vardır.
 */
export function campaignSupplyFood(input: {
  units: Record<string, number>;
  oneWayGameHours: number;
  expectedBattleHours?: number;
}): number {
  return campaignSupplyPlan(input).totalFood;
}

/**
 * Sefer Masası'nın gösterdiği ikmal kalemleri. Hesap sunucu ve arayüz için
 * aynı kaynaktan gelir: Kral yalnız toplamı değil, neden o toplamın istendiğini
 * de görür. Her safha yukarı yuvarlanır; yarım rasyon taşıma planının altında
 * kalamaz. Güvenlik payı son toplamın %20'sidir.
 */
export function campaignSupplyPlan(input: {
  units: Record<string, number>;
  oneWayGameHours: number;
  expectedBattleHours?: number;
}) {
  const clean = normalizeCampaignUnits(input.units);
  const oneWayGameHours = Math.max(0, Number(input.oneWayGameHours) || 0);
  const battleGameHours = Math.max(0, Number(input.expectedBattleHours ?? 3) || 0);
  const hourlyFood = armyUpkeep(clean).food * 2;
  const foodFor = (hours: number) => Math.ceil(hourlyFood * hours);
  const outboundFood = foodFor(oneWayGameHours);
  const battleFood = foodFor(battleGameHours);
  const returnFood = foodFor(oneWayGameHours);
  const baseFood = outboundFood + battleFood + returnFood;
  const safetyFood = Math.ceil(baseFood * .2);
  return { oneWayGameHours, battleGameHours, outboundFood, battleFood, returnFood, baseFood, safetyFood, totalFood: baseFood + safetyFood };
}

/**
 * Sefer alanından başkente dönen haberci, ordudan hızlıdır ama anlık değildir.
 * Ordu yürüyüşünün %40'ı kullanılır; çok yakın/çok hızlı channel'larda dahi
 * Kralın savaş sonucunu aynı saniyede görmemesi için en az bir gerçek dakika
 * beklenir. Girdi yalnız seferin mutlak rota süresidir; hesap tekrarlandığında
 * aynı sonucu verir.
 */
export function courierTravelMs(oneWayMarchMs: number): number {
  const march = Math.max(0, Math.floor(oneWayMarchMs) || 0);
  return Math.max(60_000, Math.round(march * .4));
}

/** Dış krallıktan çıkan erzak konvoyu ordudan hızlı ama haberciden yavaştır. */
export function supportConvoyTravelMs(oneWayMarchMs: number): number {
  const march = Math.max(0, Math.floor(oneWayMarchMs) || 0);
  return Math.max(60_000, Math.round(march * .6));
}

/**
 * Geçiş hakkı, saldıran ordunun kalan rota süresini %15 kısaltır. Toplanma
 * safhasında rota henüz başlamadığından başlangıç `departsAt`; yürüyüşteyse
 * karar anı kullanılır. En az bir dakika, olayların aynı anda çözülmesini
 * önleyen ortak sefer tabanıdır.
 */
export function passageArrivalAt(input: { departsAt: number; arrivesAt: number; now: number; gathering: boolean }) {
  const routeStart = input.gathering ? input.departsAt : input.now;
  const remaining = Math.max(0, input.arrivesAt - routeStart);
  // Son dakika içinde gelen bir geçiş fermanı, mevcut varış anını geriye
  // değil ileri iterse bir fayda üretmemiş olur; çizelgeyi koruruz.
  return Math.min(input.arrivesAt, routeStart + Math.max(60_000, Math.round(remaining * .85)));
}

/** Seferdeki insan yükü, nüfus/moral ve taşıma hesaplarında birlik sayısı değildir. */
export function campaignManpower(units: Record<string, number>): number {
  return armyManpower(normalizeCampaignUnits(units));
}
