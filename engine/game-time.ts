/** Demirkale'de bütün "oyun günü" ifadelerinin tek kaynağı. */
export const GAME_DAY_HOURS = 24;

/** Oyun saatini, channel temposuna göre gerçek zamana dönüştürür. */
export function gameHoursToRealMs(hours: number, speed: number) {
  return Math.max(0, Number(hours) || 0) * 3_600_000 / Math.max(1, Number(speed) || 1);
}

export function gameDayMs(speed: number) {
  return gameHoursToRealMs(GAME_DAY_HOURS, speed);
}
