import { rand01 } from "./raids";
import type { Game, Key, Res, TerrainId } from "./types";

/**
 * Channel geneline yayılan doğa olayları.
 *
 * Akınlardan farklı olarak tohum krallıktan değil channel kimliğinden türetilir:
 * aynı channel'daki herkes aynı anda aynı mevsimi yaşar. Olayın etkisi ise
 * arazisine ve erzak hazırlığına göre her krallıkta farklılaşır.
 *
 * Her çevrim 72 OYUN SAATİ sürer. İlk 24 saatte olay yaşanır; kalan 48 saatte
 * General yaklaşan bir sonraki olayı önceden görebilir. Oyun saati kullanmak,
 * hızlı channel'larda dünyanın da aynı oranda canlı kalmasını sağlar.
 */
export const WORLD_EVENT_WINDOW_HOURS = 72;
export const WORLD_EVENT_ACTIVE_HOURS = 24;
export const WORLD_EVENT_EPOCH = Date.parse("2026-10-01T00:00:00.000Z");

export type WorldEventKind = "bountiful_harvest" | "mild_season" | "drought" | "harsh_winter";
export type WorldEventTone = "favorable" | "adverse";

export type WorldEvent = {
  kind: WorldEventKind;
  tone: WorldEventTone;
  label: string;
  summary: string;
  advice: string;
  startsAt: number;
  endsAt: number;
};

export type WorldEventStatus =
  | { phase: "active"; event: WorldEvent }
  | { phase: "warning"; event: WorldEvent; startsAt: number };

type WorldEventGame = Pick<Game, "channel" | "channelId" | "speed" | "terrain" | "buildings">;

const HOUR = 3_600_000;
const DEFAULT_RESOURCES: Res = { gold: 1, food: 1, stone: 1, wood: 1, iron: 1, ale: 1 };

const detail: Record<WorldEventKind, Omit<WorldEvent, "startsAt" | "endsAt">> = {
  bountiful_harvest: {
    kind: "bountiful_harvest", tone: "favorable", label: "Bereketli Hasat",
    summary: "Tarlalar beklenenden bol ürün veriyor.",
    advice: "Fazlayı ambara ayırın; iyi mevsim kalıcı değildir.",
  },
  mild_season: {
    kind: "mild_season", tone: "favorable", label: "Ilıman Mevsim",
    summary: "Yollar açık, atölyeler ve tarlalar düzenli çalışıyor.",
    advice: "Yapı malzemesi ve erzak biriktirmek için uygun zaman.",
  },
  drought: {
    kind: "drought", tone: "adverse", label: "Kuraklık",
    summary: "Toprak su tutmuyor; yiyecek üretimi baskı altında.",
    advice: "Ambarı, istihkakı ve pazar stoklarını gözden geçirin.",
  },
  harsh_winter: {
    kind: "harsh_winter", tone: "adverse", label: "Sert Kış",
    summary: "Soğuk ve kapalı yollar, tedarik ile çalışmayı yavaşlatıyor.",
    advice: "Depoları koruyun; özellikle dağ geçitlerinde malzeme ayırın.",
  },
};

const terrainFoodBonus: Record<TerrainId, number> = { plain: .20, forest: .14, mountain: .09, riverbank: .29 };
const droughtSeverity: Record<TerrainId, number> = { plain: .24, forest: .28, mountain: .34, riverbank: .17 };
const winterSeverity: Record<TerrainId, number> = { plain: .12, forest: .16, mountain: .27, riverbank: .14 };

function gameHoursAt(game: Pick<WorldEventGame, "speed">, at: number) {
  return (at - WORLD_EVENT_EPOCH) / HOUR * Math.max(1, Number(game.speed) || 1);
}

export function worldEventWindowAt(game: Pick<WorldEventGame, "speed">, at: number) {
  return Math.floor(gameHoursAt(game, at) / WORLD_EVENT_WINDOW_HOURS);
}

export function worldEventWindowStartAt(game: Pick<WorldEventGame, "speed">, window: number) {
  return WORLD_EVENT_EPOCH + window * WORLD_EVENT_WINDOW_HOURS * HOUR / Math.max(1, Number(game.speed) || 1);
}

/** Aynı channel kimliği aynı olay dizisini üretir; oyuncu kaydı yeniden yükleyerek olayı değiştiremez. */
export function worldEventInWindow(game: Pick<WorldEventGame, "channel" | "channelId" | "speed">, window: number): WorldEvent {
  const channel = game.channelId || game.channel || "local";
  const favorable = rand01(`world:${channel}:${window}:tone`) < .5;
  const kind: WorldEventKind = favorable
    ? (rand01(`world:${channel}:${window}:kind`) < .5 ? "bountiful_harvest" : "mild_season")
    : (rand01(`world:${channel}:${window}:kind`) < .5 ? "drought" : "harsh_winter");
  const startsAt = worldEventWindowStartAt(game, window);
  return { ...detail[kind], startsAt, endsAt: startsAt + WORLD_EVENT_ACTIVE_HOURS * HOUR / Math.max(1, Number(game.speed) || 1) };
}

/** Şu anda uygulanan olay; uyarı safhasında null döner. */
export function activeWorldEventAt(game: Pick<WorldEventGame, "channel" | "channelId" | "speed">, at: number): WorldEvent | null {
  const event = worldEventInWindow(game, worldEventWindowAt(game, at));
  return at >= event.startsAt && at < event.endsAt ? event : null;
}

/** Harita ve General için şimdi yaşanan olay ya da yaklaşan olaya dair erken uyarı. */
export function worldEventStatusAt(game: Pick<WorldEventGame, "channel" | "channelId" | "speed">, at: number): WorldEventStatus {
  const active = activeWorldEventAt(game, at);
  if (active) return { phase: "active", event: active };
  const event = worldEventInWindow(game, worldEventWindowAt(game, at) + 1);
  return { phase: "warning", event, startsAt: event.startsAt };
}

const levelOf = (game: Pick<WorldEventGame, "buildings">, type: string) =>
  game.buildings.find(building => building.type === type)?.level ?? 0;

/**
 * Olayın saatlik brüt üretime çarpanı. Hazırlık bina seviyesiyle okunur:
 * ambar/değirmen gıda şokunu, depo ise sert kışın malzeme kaybını sınırlar.
 * Kaynaklar harcanmaz; yalnızca olay süresindeki üretim değişir.
 */
export function worldEventMultiplier(game: WorldEventGame, event: WorldEvent | null): Res {
  if (!event) return { ...DEFAULT_RESOURCES };
  const terrain = game.terrain;
  const granary = levelOf(game, "granary"), mill = levelOf(game, "mill"), warehouse = levelOf(game, "warehouse");
  const foodPreparedness = Math.min(.16, granary * .04 + mill * .02);
  const materialPreparedness = Math.min(.12, warehouse * .04);
  const next = { ...DEFAULT_RESOURCES };
  if (event.kind === "bountiful_harvest") {
    next.food += terrainFoodBonus[terrain] + Math.min(.08, granary * .015 + mill * .025);
  } else if (event.kind === "mild_season") {
    next.food += .08 + (terrain === "riverbank" ? .05 : 0);
    next.wood += terrain === "forest" ? .20 : .08;
    next.stone += terrain === "mountain" ? .12 : .04;
  } else if (event.kind === "drought") {
    next.food = Math.max(.55, 1 - droughtSeverity[terrain] + foodPreparedness);
  } else {
    const severity = Math.max(.08, winterSeverity[terrain] - foodPreparedness * .6);
    next.food = 1 - severity;
    next.wood = Math.max(.72, 1 - winterSeverity[terrain] * .45 + materialPreparedness);
    next.stone = Math.max(.72, 1 - winterSeverity[terrain] * .55 + materialPreparedness);
    next.iron = Math.max(.72, 1 - winterSeverity[terrain] * .55 + materialPreparedness);
  }
  return next;
}

/** Tek tick içinde olay sınırlarını ayırır; üretim hesabı adım-bölünmesinden bağımsız kalır. */
export function worldEventIntervals(game: Pick<WorldEventGame, "channel" | "channelId" | "speed">, from: number, to: number) {
  const intervals: Array<{ from: number; to: number; event: WorldEvent | null }> = [];
  let cursor = from;
  while (cursor < to) {
    const event = activeWorldEventAt(game, cursor);
    const index = worldEventWindowAt(game, cursor);
    const windowStart = worldEventWindowStartAt(game, index);
    const activeEnd = windowStart + WORLD_EVENT_ACTIVE_HOURS * HOUR / Math.max(1, Number(game.speed) || 1);
    const windowEnd = worldEventWindowStartAt(game, index + 1);
    const boundary = event ? activeEnd : windowEnd;
    const end = Math.min(to, boundary);
    intervals.push({ from: cursor, to: end, event });
    cursor = end;
  }
  return intervals;
}

/** Aralık içinde başlayan olaylar; tick bunları bir kez Defter'e işler. */
export function worldEventsStartedBetween(game: Pick<WorldEventGame, "channel" | "channelId" | "speed">, from: number, to: number) {
  const firstWindow = worldEventWindowAt(game, from);
  const first = worldEventWindowStartAt(game, firstWindow) <= from ? firstWindow + 1 : firstWindow;
  const events: WorldEvent[] = [];
  for (let window = first; ; window += 1) {
    const event = worldEventInWindow(game, window);
    if (event.startsAt > to) break;
    events.push(event);
  }
  return events;
}

export const worldEventNotice = (event: WorldEvent) =>
  `${event.label} channel genelinde başladı. ${event.summary} ${event.advice}`;

/** Harita ve General bağlamı için küçük, modele güvenle gönderilebilir özet. */
export function worldEventSummary(game: WorldEventGame, at: number) {
  const status = worldEventStatusAt(game, at);
  const multiplier = worldEventMultiplier(game, status.phase === "active" ? status.event : null);
  return {
    phase: status.phase,
    label: status.event.label,
    tone: status.event.tone,
    summary: status.event.summary,
    advice: status.event.advice,
    startsAt: status.phase === "active" ? status.event.startsAt : status.startsAt,
    endsAt: status.phase === "active" ? status.event.endsAt : null,
    multiplier,
  };
}

/** Key dizisi yalnız bu modülde tip denetimi için görünür; kaynak seti sabittir. */
void (Object.keys(DEFAULT_RESOURCES) as Key[]);
