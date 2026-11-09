import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { councilBriefings, councilMeetingHistory, gameSaves, users } from "../db/schema";
import { defenseOf } from "../engine/raids";
import { rates, servedRations, tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { worldEventSummary } from "../engine/world-events";
import { completedCouncilVoices, fallbackVoice, generalCouncilPrompt, publicAdvisorPrompt, publicCouncilCues, sanitizeCouncilThought, type CouncilConnection, type CouncilRole, type CouncilSnapshot, type CouncilVoice } from "./council-advisors";
import { generalAiFor } from "./general-ai-desk";
import { callProviderText, describeProviderFailure, type ProviderFailure } from "./llm-provider";
import { populaceCredentialFor } from "./populace-ai-desk";
import { parseStoredSave } from "./save-validation";
import { councilCallMinimumGapMs, councilCycleMs, councilSourceKey } from "./council-schedule";
import { councilNeglectPressure } from "../engine/faction";
import { writeSaveIfUnchanged } from "./save-write";

/** Yarım kalmış bir cron çağrısının maliyet kilidini bırakma süresi. */
const CLAIM_TTL_MS = 2 * 60_000;
/** Her söz turu gerçek zamanda beş dakika sürer; channel hızı beklemeyi uzatmaz. */
const COUNCIL_DISCUSSION_STEP_MS = 5 * 60_000;

export type CouncilDiscussionStage = "opening" | "moderation" | "reply" | "concluded";
export type CouncilDiscussionLine = {
  role: CouncilRole;
  speaker: string;
  text: string;
  phase: "opening" | "moderation" | "reply" | "conclusion";
  at: number;
  mode: "ai" | "rules";
};

export type CouncilBriefing = {
  voices: CouncilVoice[];
  connections: CouncilConnection[];
  generatedAt: number;
  nextAt: number | null;
  callRequestedAt: number | null;
  callDueAt: number | null;
  discussion: CouncilDiscussionLine[];
  sessionStage: CouncilDiscussionStage;
  sessionNextAt: number | null;
  sessionEndsAt: number | null;
  readAt: number | null;
  reminderCount: number;
};

/** Defter ve Meclis'te gösterilen, okunabilir en son üç Divan oturumu. */
export type CouncilMeeting = {
  id: string;
  voices: CouncilVoice[];
  generatedAt: number;
  nextAt: number | null;
  meetingType: "ordinary" | "called" | "emergency";
  discussion: CouncilDiscussionLine[];
  sessionStage: CouncilDiscussionStage;
  readAt: number | null;
  outcome: string;
};

type Thought = { text: string; failure?: ProviderFailure };

function parse<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function discussionStage(value: string | null | undefined): CouncilDiscussionStage {
  return value === "opening" || value === "moderation" || value === "reply" ? value : "concluded";
}

function openingDiscussion(voices: CouncilVoice[], now: number): CouncilDiscussionLine[] {
  return voices.map(voice => ({ role: voice.role, speaker: voice.speaker, text: voice.text, phase: "opening", at: now, mode: voice.mode }));
}

function transcriptForPrompt(lines: CouncilDiscussionLine[]) {
  return lines.map(line => `${line.speaker}: ${line.text}`).join("\n").slice(0, 2_400);
}

function moderatorFallback(lines: CouncilDiscussionLine[]) {
  const commons = lines.find(line => line.role === "commons")?.text ?? "Halkın görüşü kayda geçti.";
  const garrison = lines.find(line => line.role === "garrison")?.text ?? "Garnizonun görüşü kayda geçti.";
  return `Halkın talebi ile Garnizonun kaygısını aynı kararda dengelemeliyiz. Önce ${commons.charAt(0).toLocaleLowerCase("tr-TR")}${commons.slice(1)} Ardından ${garrison.charAt(0).toLocaleLowerCase("tr-TR")}${garrison.slice(1)}`;
}

function conclusionFallback(lines: CouncilDiscussionLine[]) {
  const hasUrgent = lines.some(line => /açık|risk|boş|huzursuz|tehdit/i.test(line.text));
  return hasUrgent
    ? "Divan, önce mevcut baskıyı azaltmayı; ardından üretim ve savunma dengesini yeniden değerlendirmeyi öneriyor. Karar ve uygulama mührü Kralın elindedir."
    : "Divan, mevcut düzenin korunmasını ve bir sonraki büyük taahhütten önce üretim ile savunmanın birlikte gözden geçirilmesini öneriyor. Karar ve uygulama mührü Kralın elindedir.";
}

/** Sunucunun gerçek oyun kaydından Divan'ın okuyacağı kısa ve güvenli özet. */
export function councilSnapshotOf(game: Game): CouncilSnapshot {
  const rations = servedRations(game);
  const defense = defenseOf(game);
  return {
    popularity: game.popularity,
    taxRate: game.taxRate,
    population: game.population,
    resources: game.resources,
    hourlyRates: rates(game),
    worldEvent: worldEventSummary(game, game.lastTickAt),
    strategyNote: game.strategyNote,
    protectionHoursLeft: Math.max(0, (game.protectionEndsAt - game.lastTickAt) / 3_600_000),
    activeConstruction: (() => {
      const job = game.constructionQueue?.find(item => item.startedAt !== null) ?? game.queue;
      return job ? { name: job.name, secondsRemaining: Math.max(0, Math.ceil(((job.completesAt ?? game.lastTickAt) - game.lastTickAt) / 1000)) } : null;
    })(),
    populace: {
      servedFood: rations.food,
      capacity: game.capacity,
      army: Object.values(game.units).reduce((total, count) => total + (Number(count) || 0), 0),
      soldierUnrest: game.soldierUnrest ?? 0,
      soldierPay: game.soldierPay ?? 100,
    },
    defense: {
      watchRatio: defense.watch,
      power: defense.power,
      recentRaids: game.notices.filter(notice => notice.kind === "AKIN").slice(0, 3).map(notice => ({ text: notice.text, hoursAgo: Math.max(0, Math.round((game.lastTickAt - notice.at) / 3_600_000)) })),
    },
  };
}

async function think(input: { provider: string; model: string; apiKey: string; temperature?: number | null; system: string; user: string }): Promise<Thought> {
  try {
    const { temperature, ...providerInput } = input;
    const text = sanitizeCouncilThought(await callProviderText({ ...providerInput, maxTokens: 110, temperature: temperature ?? .55 }));
    return text ? { text } : { text: "", failure: { ok: false, code: "empty", message: "Model boş yanıt verdi." } };
  } catch (error) { return { text: "", failure: describeProviderFailure(error) }; }
}

function reminderText(text: string) {
  return `Daha önce Divanda belirttiğimiz gibi, ${text.charAt(0).toLocaleLowerCase("tr-TR")}${text.slice(1)}`;
}

/** Eski, hız-temelli takvim kayıtları ekranda bir saatlikmiş gibi görünmesin. */
function ordinaryCouncilAt(generatedAt: number) {
  return generatedAt + councilCycleMs();
}

async function createBriefing(userId: string, snapshot: CouncilSnapshot, masterKey: string, reminder: boolean): Promise<Pick<CouncilBriefing, "voices" | "connections">> {
  const [general, publicAi] = await Promise.all([generalAiFor(userId, masterKey), populaceCredentialFor(userId, masterKey)]);
  const generalConnected = general.state === "connected";
  const publicConnected = Boolean(publicAi);
  const connections: CouncilConnection[] = [
    { role: "general", label: "General AI", state: generalConnected ? "connected" : "fallback", source: generalConnected ? "player" : "rules", ...(generalConnected ? { provider: general.credential.provider, model: general.credential.model } : {}) },
    ...(["commons", "garrison"] as const).map(role => ({ role, label: role === "commons" ? "Halk AI" : "Garnizon AI", state: publicConnected ? "connected" as const : "fallback" as const, source: publicAi?.source ?? "rules" as const, ...(publicAi ? { provider: publicAi.provider, model: publicAi.model } : {}) })),
  ];
  const cues = publicCouncilCues(snapshot);
  const [generalThought, commonsThought, garrisonThought] = await Promise.all([
    general.state === "connected" ? think({ ...general.credential, ...generalCouncilPrompt(snapshot) }) : Promise.resolve({ text: "" }),
    publicAi ? think({ ...publicAi, ...publicAdvisorPrompt("commons", cues.commons) }) : Promise.resolve({ text: "" }),
    publicAi ? think({ ...publicAi, ...publicAdvisorPrompt("garrison", cues.garrison) }) : Promise.resolve({ text: "" }),
  ]);
  const thoughts: Record<CouncilRole, Thought> = { general: generalThought, commons: commonsThought, garrison: garrisonThought };
  const voices = (["commons", "garrison", "general"] as const).map(role => {
    const fallback = fallbackVoice(role, snapshot);
    const text = thoughts[role].text || fallback.text;
    return { ...fallback, text: reminder ? reminderText(text) : text, mode: thoughts[role].text ? "ai" as const : "rules" as const };
  });
  const finalConnections = connections.map(connection => {
    if (connection.state !== "connected" || thoughts[connection.role].text) return connection;
    const failure = thoughts[connection.role].failure;
    return { ...connection, state: "error" as const, ...(failure ? { detail: failure.message } : {}) };
  });
  return { voices, connections: finalConnections };
}

function fromRow(row: typeof councilBriefings.$inferSelect): CouncilBriefing {
  return {
    // Bu satır, yeni kod gelmeden üretilmiş metinleri de gösterim anında
    // temizler. Yarım bir ses kaybolursa istemci deterministik yedeğini gösterir.
    voices: completedCouncilVoices(parse<CouncilVoice[]>(row.voices, [])),
    connections: parse(row.connections, []),
    generatedAt: row.generatedAt,
    nextAt: row.callDueAt ?? ordinaryCouncilAt(row.generatedAt),
    callRequestedAt: row.callRequestedAt ?? null,
    callDueAt: row.callDueAt ?? null,
    discussion: parse<CouncilDiscussionLine[]>(row.discussion, []).map(line => ({ ...line, text: sanitizeCouncilThought(line.text) })).filter(line => line.text),
    sessionStage: discussionStage(row.sessionStage),
    sessionNextAt: row.sessionNextAt ?? null,
    sessionEndsAt: row.sessionEndsAt ?? null,
    readAt: row.readAt ?? null,
    reminderCount: row.reminderCount,
  };
}

function meetingFromRow(row: typeof councilMeetingHistory.$inferSelect): CouncilMeeting {
  return {
    id: row.id,
    voices: completedCouncilVoices(parse<CouncilVoice[]>(row.voices, [])),
    generatedAt: row.generatedAt,
    nextAt: row.nextAt ?? ordinaryCouncilAt(row.generatedAt),
    meetingType: row.meetingType === "called" || row.meetingType === "emergency" ? row.meetingType : "ordinary",
    discussion: parse<CouncilDiscussionLine[]>(row.discussion, []).map(line => ({ ...line, text: sanitizeCouncilThought(line.text) })).filter(line => line.text),
    sessionStage: discussionStage(row.sessionStage),
    readAt: row.readAt ?? null,
    outcome: row.outcome,
  };
}

export async function briefingFor(userId: string): Promise<CouncilBriefing | null> {
  const [row] = await getDb().select().from(councilBriefings).where(eq(councilBriefings.userId, userId)).limit(1);
  return row ? fromRow(row) : null;
}

/** Eski görüşler silinmez; ekranda son üç toplantı gösterilir. */
export async function recentCouncilMeetingsFor(userId: string, limit = 3): Promise<CouncilMeeting[]> {
  const rows = await getDb().select().from(councilMeetingHistory)
    .where(eq(councilMeetingHistory.userId, userId))
    .orderBy(desc(councilMeetingHistory.generatedAt)).limit(Math.max(1, Math.min(3, limit)));
  return rows.map(meetingFromRow);
}

/**
 * Kralın çağrısı derhal model çalıştırmaz. Talep, son toplantıdan en az on iki
 * gerçek saat sonraki uygun vakte yazılır; cron o saatte gündemi üretir.
 */
export async function requestCouncilCall(userId: string, game: Game, now: number) {
  const db = getDb();
  const [current] = await db.select().from(councilBriefings).where(eq(councilBriefings.userId, userId)).limit(1);
  if (current && !current.readAt && current.voices !== "[]") {
    return { error: "Açık Divan gündemi önce okunmalı; ikinci bir toplantı üst üste çağrılamaz." } as const;
  }
  if (current?.callDueAt) return { briefing: fromRow(current), scheduledAt: current.callDueAt, alreadyScheduled: true } as const;

  const earliest = current ? Math.max(now, current.generatedAt + councilCallMinimumGapMs(game.speed)) : now;
  // Olağan toplantı daha erkense Kralın çağrısı ayrı bir belge açmaz; aynı
  // oturumda ele alınır. Böylece aynı gün iki kez model çağrısı oluşmaz.
  const scheduledAt = current ? Math.min(earliest, ordinaryCouncilAt(current.generatedAt)) : earliest;
  const snapshot = councilSnapshotOf(game);
  if (!current) {
    await db.insert(councilBriefings).values({
      userId,
      voices: "[]",
      connections: "[]",
      sourceKey: councilSourceKey(snapshot),
      generatedAt: now,
      nextAt: scheduledAt,
      callRequestedAt: now,
      callDueAt: scheduledAt,
      readAt: now,
      reminderCount: 0,
    });
  } else {
    await db.update(councilBriefings).set({
      nextAt: scheduledAt,
      callRequestedAt: now,
      callDueAt: scheduledAt,
    }).where(eq(councilBriefings.userId, userId));
  }
  const briefing = await briefingFor(userId);
  return { briefing, scheduledAt, alreadyScheduled: false } as const;
}

export async function acknowledgeBriefing(userId: string, now: number) {
  const db = getDb();
  const [current] = await db.select().from(councilBriefings).where(eq(councilBriefings.userId, userId)).limit(1);
  if (!current) return null;
  await db.update(councilBriefings).set({ readAt: now }).where(and(eq(councilBriefings.userId, userId), isNull(councilBriefings.readAt)));
  await db.update(councilMeetingHistory)
    .set({ readAt: now, outcome: "Kral gündemi okudu; bağlayıcı kararlar Krallık Defteri'ne işlendi." })
    .where(and(eq(councilMeetingHistory.userId, userId), eq(councilMeetingHistory.generatedAt, current.generatedAt), isNull(councilMeetingHistory.readAt)));
  return briefingFor(userId);
}

/**
 * AI belgesi henüz üretilmemiş olsa da Kral, ekrandaki deterministik gündemi
 * kapatabilir. Aynı karar bağlamında cron yeniden konu açmaz; anlamlı değişim
 * olduğunda normal yenileme kuralı yeniden devreye girer.
 */
export async function acknowledgeFallbackBriefing(userId: string, game: Game, now: number) {
  const snapshot = councilSnapshotOf(game);
  const nextAt = now + councilCycleMs(game.speed);
  await getDb().insert(councilBriefings).values({
    userId,
    voices: "[]",
    connections: "[]",
    sourceKey: councilSourceKey(snapshot),
    generatedAt: now,
    nextAt,
    callRequestedAt: null,
    callDueAt: null,
    readAt: now,
    reminderCount: 0,
  }).onConflictDoNothing();
  await getDb().insert(councilMeetingHistory).values({
    id: `${userId}:${now}`,
    userId,
    sourceKey: councilSourceKey(snapshot),
    voices: "[]",
    generatedAt: now,
    nextAt,
    meetingType: "ordinary",
    readAt: now,
    outcome: "Kral gündemi okudu; bağlayıcı karar verilmedi.",
  }).onConflictDoNothing();
  return acknowledgeBriefing(userId, now);
}

/**
 * Açılan Divan tek bir kart olarak donmaz. General önce iki kesimin sözünü
 * tartar, sonra kesimler onun yönettiği tartışmaya karşılık verir ve General
 * Kralın önüne bir sonuç bırakır. Her basamak cron ritminde ilerler; ekran
 * açılışı asla yeni model çağrısı başlatmaz.
 */
async function advanceCouncilDiscussion(input: { row: typeof councilBriefings.$inferSelect; snapshot: CouncilSnapshot; masterKey: string; now: number }) {
  const stage = discussionStage(input.row.sessionStage);
  const discussion = parse<CouncilDiscussionLine[]>(input.row.discussion, []);
  const [general, publicAi] = await Promise.all([generalAiFor(input.row.userId, input.masterKey), populaceCredentialFor(input.row.userId, input.masterKey)]);
  let lines = discussion;
  let nextStage: CouncilDiscussionStage = stage;
  let nextAt: number | null = input.now + COUNCIL_DISCUSSION_STEP_MS;

  if (stage === "opening") {
    const prompt = generalCouncilPrompt(input.snapshot);
    const thought = general.state === "connected"
      ? await think({ ...general.credential, system: `${prompt.system}\nBu Divanı yönetiyorsun. Halk ve Garnizonun sözlerini karşılaştır; ortak gerilimi açıkla ve ikisine birer kısa soru yönelt.`, user: `DİVAN TUTANAĞI:\n${transcriptForPrompt(lines)}\n\nYalnızca Generalin ara değerlendirmesini, en fazla iki tamamlanmış cümlede söyle.` })
      : { text: "" };
    lines = [...lines, { role: "general", speaker: "GENERAL", text: thought.text || moderatorFallback(lines), phase: "moderation", at: input.now, mode: thought.text ? "ai" : "rules" }];
    nextStage = "moderation";
  } else if (stage === "moderation") {
    const moderator = [...lines].reverse().find(line => line.phase === "moderation")?.text ?? "General görüşleri karşılaştırdı.";
    const cues = publicCouncilCues(input.snapshot);
    const replies = await Promise.all((["commons", "garrison"] as const).map(async role => {
      const prompt = publicAdvisorPrompt(role, cues[role]);
      const thought = publicAi
        ? await think({ ...publicAi, system: `${prompt.system}\nGeneralin sorusuna yalnız kendi kesiminin çıkarı açısından cevap ver; General gibi karar verme.`, user: `${prompt.user}\n\nGENERALİN ARA DEĞERLENDİRMESİ: ${moderator}\nBuna cevap olarak yalnızca bir kısa, tamamlanmış cümle söyle.` })
        : { text: "" };
      const fallback = fallbackVoice(role, input.snapshot);
      return { role, speaker: fallback.speaker, text: thought.text || fallback.text, phase: "reply" as const, at: input.now, mode: thought.text ? "ai" as const : "rules" as const };
    }));
    lines = [...lines, ...replies];
    nextStage = "reply";
  } else if (stage === "reply") {
    const prompt = generalCouncilPrompt(input.snapshot);
    const thought = general.state === "connected"
      ? await think({ ...general.credential, system: `${prompt.system}\nDivanı kapatan Generalsin. Tutanağı iki uygulanabilir önceliğe indir; Kralın yerine karar verme.`, user: `DİVAN TUTANAĞI:\n${transcriptForPrompt(lines)}\n\nKralın önüne bırakacağın sonuç en fazla iki tamamlanmış cümle olsun.` })
      : { text: "" };
    lines = [...lines, { role: "general", speaker: "GENERAL", text: thought.text || conclusionFallback(lines), phase: "conclusion", at: input.now, mode: thought.text ? "ai" : "rules" }];
    nextStage = "concluded";
    nextAt = null;
  } else return fromRow(input.row);

  const outcome = nextStage === "concluded"
    ? "General Divanı kapattı; tutanak ve önerilen öncelikler Kralın kararını bekliyor."
    : "Divan oturumu sürüyor; yeni sözler ve Generalin yönetimi tutanağa işleniyor.";
  const next = {
    discussion: JSON.stringify(lines),
    sessionStage: nextStage,
    sessionNextAt: nextAt,
    sessionEndsAt: nextStage === "concluded" ? input.now : null,
    refreshingAt: null,
  };
  const [row] = await getDb().update(councilBriefings).set(next).where(eq(councilBriefings.userId, input.row.userId)).returning();
  await getDb().update(councilMeetingHistory).set({ discussion: next.discussion, sessionStage: nextStage, outcome })
    .where(and(eq(councilMeetingHistory.userId, input.row.userId), eq(councilMeetingHistory.generatedAt, input.row.generatedAt)));
  return row ? fromRow(row) : null;
}

/** Divan her kontrolde bağlamı okur; çağrı, kritik değişim veya oyun gününde yeni görüş üretir. */
export async function refreshCouncilBriefing(input: { userId: string; game: Game; now: number; masterKey: string; applyMissedAgenda?: (priority: "watch" | "urgent") => Promise<boolean> }) {
  const db = getDb();
  const snapshot = councilSnapshotOf(input.game);
  const sourceKey = councilSourceKey(snapshot);
  const [current] = await db.select().from(councilBriefings).where(eq(councilBriefings.userId, input.userId)).limit(1);
  const sessionOpen = Boolean(current && discussionStage(current.sessionStage) !== "concluded");
  // Yeni tutanak akışı gelmeden açılmış, hâlâ okunmamış gündemler de yeni
  // düzene alınır; Kral mevcut açık Divanını kaybetmeden konuşmayı görür.
  const unseededSession = Boolean(current && !current.readAt && current.voices !== "[]" && !parse<CouncilDiscussionLine[]>(current.discussion, []).length && !sessionOpen);
  const discussionDue = Boolean(current && sessionOpen && (!current.sessionNextAt || input.now >= current.sessionNextAt));
  const reminder = Boolean(!sessionOpen && current && input.now - current.generatedAt >= councilCycleMs(input.game.speed));
  const called = Boolean(!sessionOpen && current?.callDueAt && input.now >= current.callDueAt);
  const cues = publicCouncilCues(snapshot);
  const priority = cues.commons.priority === "urgent" || cues.garrison.priority === "urgent"
    ? "urgent" as const
    : cues.commons.priority === "watch" || cues.garrison.priority === "watch" ? "watch" as const : null;
  // Olağan değişimler on iki saatlik ritmi bozmaz. Yalnız gerçekten acil bir
  // talep takvimden önce Divanı yeniden toplar.
  const emergency = Boolean(!sessionOpen && current?.readAt && current.sourceKey !== sourceKey && priority === "urgent");
  const due = !current || unseededSession || discussionDue || called || reminder || emergency;
  if (!due) return { generated: false, briefing: current ? fromRow(current) : null, penalized: false };

  const claimCutoff = input.now - CLAIM_TTL_MS;
  const claimed = current
    ? await db.update(councilBriefings).set({ refreshingAt: input.now }).where(and(eq(councilBriefings.userId, input.userId), or(isNull(councilBriefings.refreshingAt), lt(councilBriefings.refreshingAt, claimCutoff)))).returning({ userId: councilBriefings.userId })
    : await db.insert(councilBriefings).values({ userId: input.userId, voices: "[]", connections: "[]", sourceKey, generatedAt: input.now, refreshingAt: input.now }).onConflictDoNothing().returning({ userId: councilBriefings.userId });
  if (!claimed.length) return { generated: false, briefing: current ? fromRow(current) : null, penalized: false };

  if (current && unseededSession) {
    const discussion = JSON.stringify(openingDiscussion(completedCouncilVoices(parse<CouncilVoice[]>(current.voices, [])), input.now));
    const nextAt = input.now + COUNCIL_DISCUSSION_STEP_MS;
    const [row] = await db.update(councilBriefings).set({ discussion, sessionStage: "opening", sessionNextAt: nextAt, sessionEndsAt: null, refreshingAt: null }).where(eq(councilBriefings.userId, input.userId)).returning();
    await db.update(councilMeetingHistory).set({ discussion, sessionStage: "opening", outcome: "Divan oturumu sürüyor; General sözleri yönetmeye hazırlanıyor." })
      .where(and(eq(councilMeetingHistory.userId, input.userId), eq(councilMeetingHistory.generatedAt, current.generatedAt)));
    return { generated: false, briefing: row ? fromRow(row) : null, penalized: false };
  }

  if (current && discussionDue) {
    const briefing = await advanceCouncilDiscussion({ row: current, snapshot, masterKey: input.masterKey, now: input.now });
    return { generated: false, briefing, penalized: false };
  }

  const missed = Boolean(reminder && current && !current.readAt && priority);
  if (missed && priority && input.applyMissedAgenda && !(await input.applyMissedAgenda(priority))) {
    await db.update(councilBriefings).set({ refreshingAt: null }).where(eq(councilBriefings.userId, input.userId));
    return { generated: false, briefing: current ? fromRow(current) : null, penalized: false };
  }

  const generated = await createBriefing(input.userId, snapshot, input.masterKey, reminder);
  const nextAt = input.now + councilCycleMs(input.game.speed);
  const meetingType = called ? "called" : emergency ? "emergency" : "ordinary";
  const discussion = openingDiscussion(generated.voices, input.now);
  const next = { voices: JSON.stringify(generated.voices), connections: JSON.stringify(generated.connections), sourceKey, generatedAt: input.now, nextAt, callRequestedAt: null, callDueAt: null, discussion: JSON.stringify(discussion), sessionStage: "opening" as const, sessionNextAt: input.now + COUNCIL_DISCUSSION_STEP_MS, sessionEndsAt: null, readAt: null, refreshingAt: null, reminderCount: reminder ? (current?.reminderCount ?? 0) + 1 : 0 };
  const [row] = await db.update(councilBriefings).set(next).where(eq(councilBriefings.userId, input.userId)).returning();
  await db.insert(councilMeetingHistory).values({
    id: `${input.userId}:${input.now}`,
    userId: input.userId,
    sourceKey,
    voices: next.voices,
    generatedAt: input.now,
    nextAt,
    meetingType,
    discussion: next.discussion,
    sessionStage: next.sessionStage,
    outcome: meetingType === "called" ? "Kralın çağrısıyla Divan toplandı; General oturumu yönetiyor." : meetingType === "emergency" ? "Acil durum Divanı toplandı; General oturumu yönetiyor." : "Olağan Divan toplandı; General oturumu yönetiyor.",
  }).onConflictDoNothing();
  return { generated: true, briefing: row ? fromRow(row) : null, penalized: Boolean(missed) };
}

/** Cron girişinde bütün kayıtlar okunur; yalnızca gerçekten due olanlar model çağrısı yapar. */
export async function refreshDueCouncilBriefings(now: number, masterKey: string) {
  // Eski geliştirme verilerinde hesabı silinmiş ama oyun kaydı kalmış olabilir.
  // Divan belgesi kullanıcıya bağlıdır; bu yetim satırlar bir foreign-key
  // hatasıyla bütün krallıkların toplantı turunu durdurmamalı.
  const saves = await getDb().select({ userId: gameSaves.userId, gameState: gameSaves.gameState, revision: gameSaves.revision })
    .from(gameSaves)
    .innerJoin(users, eq(users.id, gameSaves.userId));
  const reports: Array<{ userId: string; generated: boolean; penalized: boolean }> = [];
  for (const save of saves) {
    const game = parseStoredSave(save.gameState);
    if (!game) continue;
    // Divan, son istemci kaydının değil cron anına taşınmış oyunun nabzını
    // okur. `tick` saftır; burada kayda yazmaz, yalnızca görüş bağlamını
    // oyun zamanıyla eşitler.
    const current = tick(game as Game, now);
    const result = await refreshCouncilBriefing({
      userId: save.userId, game: current, now, masterKey,
      applyMissedAgenda: async priority => {
        const pressure = councilNeglectPressure(current.factionPressure ?? 0, current.popularity, priority);
        // Rıza zaten toparlanmışsa ihmal ters yönde çalışmaz; yeni Divan yine
        // gelir ama oyun durumuna görünmez bir ceza yazılmaz.
        if (pressure <= (current.factionPressure ?? 0)) return true;
        const notice = priority === "urgent"
          ? "Acil Divan gündemi bir oyun günü boyunca yanıtsız kaldı; meydandaki huzursuzluk sertleşti."
          : "Divan gündemi bir oyun günü boyunca yanıtsız kaldı; meydandaki huzursuzluk arttı.";
        const next = { ...current, factionPressure: pressure, notices: [{ kind: "DİVAN", text: notice, at: now }, ...current.notices].slice(0, 20) };
        return writeSaveIfUnchanged(save.userId, save.revision, next);
      },
    });
    reports.push({ userId: save.userId, generated: result.generated, penalized: result.penalized });
  }
  return reports;
}
