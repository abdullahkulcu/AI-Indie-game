/**
 * Uzun süreli ablukanın saf hesapları.
 *
 * Abluka zamanını cron değil, mutlak başlangıç/bitiş damgaları belirler.
 * Böylece bir saatlik tek tur ile on iki adet beş dakikalık tur aynı erzak
 * tüketimini, aynı baskı eşiğini ve aynı deneyimi üretir.
 */
import { armyUpkeep } from "./units";
import { normalizeCampaignUnits, type CampaignUnits } from "./march";

/** Hedef halkı her on iki oyun saatinde sınırdaki ordunun baskısını hisseder. */
export const BLOCKADE_PRESSURE_GAME_HOURS = 12;
/** Sınırda geçen her tam gün, sağ kalan birliğe bir saha deneyimi kazandırır. */
export const BLOCKADE_EXPERIENCE_GAME_HOURS = 24;

export function blockadeGameHours(startedAt: number, at: number, channelSpeed: number) {
  const elapsedMs = Math.max(0, Math.floor(at) - Math.floor(startedAt));
  return elapsedMs * Math.max(1, Number(channelSpeed) || 1) / 3_600_000;
}

/** Sefer rasyonunun iki katı: sınır hattındaki nöbet ve taşıma kaybını da kapsar. */
export function blockadeFoodSpent(units: CampaignUnits, elapsedGameHours: number) {
  const hourlyFood = blockadeHourlyFood(units);
  return Math.max(0, Math.floor(hourlyFood * Math.max(0, elapsedGameHours)));
}

/** Erzak bittiğinde baskının gerçekte ilerleyebileceği son oyun saati. */
export function blockadeHoursCoveredBySupply(units: CampaignUnits, previousGameHours: number, supply: number, upperGameHours: number) {
  const hourlyFood = blockadeHourlyFood(units);
  if (!hourlyFood) return Math.max(0, upperGameHours);
  const previous = Math.max(0, previousGameHours);
  const budget = blockadeFoodSpent(units, previous) + Math.max(0, Math.floor(supply));
  // Tamsayı erzakta önceki kesintinin yuvarlaması, sınırın teorik olarak
  // geçmişe düşmesine yol açabilir. Zaman geri akmaz: en az son hesap kadar
  // ilerleme korunur; sonraki tur yalnız yeni maliyeti değerlendirir.
  return Math.max(previous, Math.min(Math.max(0, upperGameHours), budget / hourlyFood));
}

function blockadeHourlyFood(units: CampaignUnits) {
  return armyUpkeep(normalizeCampaignUnits(units)).food * 2;
}

/** İki gözlem arasındaki yeni halk baskısı eşiklerinin sayısı. */
export function blockadePressureSteps(previousGameHours: number, nextGameHours: number) {
  const previous = Math.floor(Math.max(0, previousGameHours) / BLOCKADE_PRESSURE_GAME_HOURS);
  const next = Math.floor(Math.max(0, nextGameHours) / BLOCKADE_PRESSURE_GAME_HOURS);
  return Math.max(0, next - previous);
}

/** İki gözlem arasındaki yeni birlik deneyimi eşiklerinin sayısı. */
export function blockadeExperienceSteps(previousGameHours: number, nextGameHours: number) {
  const previous = Math.floor(Math.max(0, previousGameHours) / BLOCKADE_EXPERIENCE_GAME_HOURS);
  const next = Math.floor(Math.max(0, nextGameHours) / BLOCKADE_EXPERIENCE_GAME_HOURS);
  return Math.max(0, next - previous);
}
