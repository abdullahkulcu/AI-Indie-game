import { env } from "cloudflare:workers";
import { and, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import { applyActions } from "../../../engine/actions";
import { capacityFor, tick } from "../../../engine/tick";
import type { Game, GameAction, Key } from "../../../engine/types";
import { getDb } from "../../../db";
import { agitations, agreements, channelMembers, channels, gameSaves, intelDefenses, llmCredentials, migrations, negotiationMessages, negotiations, pendingDecisions, standingOrders } from "../../../db/schema";
import {
  AGITATION, AGITATION_NOTICE, type AgitationKind,
  agitationExposedNotice, agitationSenderNotice, applyAgitation, applyGlut, applyLure,
} from "../../../engine/agitation";
import { isTraded } from "../../../engine/market";
import { arrivingMigrants, migrationArrivalNotice, pickMigrationTarget } from "../../../engine/migration";
import { queueEmigrants } from "../../../server/migration-desk";
import {
  LIMITS, MAX_KING_NOTE_LENGTH, MAX_MESSAGE_LENGTH, MISSES_BEFORE_BREACH, TRIBUTE_TOPICS,
  canProposeTerms, clampTerms, duePayments, isKingPresent, otherSide, settleTribute,
  shouldGeneralAnswer, tributeRateFromPercent, validateTerms,
  type Side, type Terms, type TributeSettlement,
} from "../../../engine/negotiation";
import { reputationChange } from "../../../engine/diplomacy";
import { OFFLINE_DESK_PROMPT, briefTable, offlineDeskTools, payerSideOf, renderNegotiationTranscript, tableMeta } from "../../../server/negotiation-brief";
// Sağlayıcı çağrısı paylaşılan modülden gelir; bu dosyada artık `fetch` yok.
import { callProvider } from "../../../server/llm-provider";
import { displayNameOf, toEngine } from "../../../server/negotiation-desk";
import { decryptByok } from "../../../server/byok-crypto";
import { pruneExpiredSessions } from "../../../server/account-auth";
import { noteToKing } from "../../../server/king-notice";
import { pruneRateLimits } from "../../../server/rate-limit";
import { WAKE_INTERVAL_MS, compactContext, rollDailyWindow, shouldWake, type StandingOrder } from "../../../server/night-shift";
import { parseStoredSave } from "../../../server/save-validation";
// Koşullu (sürüm korumalı) yazma tek kopyadır; ortak maden de aynı kapıyı kullanır.
import { writeSaveIfUnchanged } from "../../../server/save-write";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

type WakeReport = { userId: string; acted: boolean; detail: string; tokensUsed: boolean };

/** Gece vardiyasında General yalnızca bu araçları kullanabilir; hepsi tek adımlıktır. */
const nightTools = [
  { name: "build_structure", description: "Bir yapı kurar veya bir seviye yükseltir.", parameters: { type: "object", properties: { building_type: { type: "string" }, target_level: { type: "integer" } }, required: ["building_type", "target_level"], additionalProperties: false } },
  { name: "train_unit", description: "Mızrakçı eğitir.", parameters: { type: "object", properties: { unit_type: { type: "string", enum: ["spearman"] }, count: { type: "integer", minimum: 1, maximum: 20 } }, required: ["unit_type", "count"], additionalProperties: false } },
  { name: "host_festival", description: "Halkın rızasını artırmak için şenlik düzenler.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "no_action", description: "Bu saatte beklemek daha doğruysa hiçbir şey yapma.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false } },
];

const NIGHT_PROMPT = [
  "Sen Demirkale'deki General Aldric'sin ve Kral uyurken tek bir karar veriyorsun.",
  "Kralın kalıcı gece emrine sadık kal. Bu uyanmada EN FAZLA BİR araç çağır.",
  "Yalnızca `secenekler` listesinde gerçekten bulunan bir eylemi seç; listede olmayanı önerme.",
  "Acil durum bildirildiyse kalıcı emrin önüne geçebilirsin, ama gerekçeni tek cümleyle yaz.",
  "Beklemek daha doğruysa no_action çağır. Uzun açıklama yazma; en fazla iki cümle.",
].join("\n");

/**
 * Arka plandaki tek sağlayıcı çağrısı ARTIK BU DOSYADA DEĞİL: gövdesi
 * `server/llm-provider.ts`'e taşındı ve orada araçsız (düz metin) bir kardeş
 * kip kazandı. Sebep kısıt #5 — Halk-AI'nın sesi (plan belgesi Fikir 2) aynı
 * uç noktalara, aynı zaman aşımıyla gitmek zorundaydı; burada bırakılsaydı
 * üçüncü bir `fetch` kopyası doğardı. Bu yolun davranışı DEĞİŞMEDİ: aynı
 * fonksiyon, aynı araç şeması, aynı 30 saniye.
 */

async function runOne(row: typeof standingOrders.$inferSelect, now: number): Promise<WakeReport> {
  const db = getDb();
  const finish = async (detail: string, acted: boolean, tokensUsed: boolean) => {
    await db.update(standingOrders).set({ lastRunAt: now, lastOutcome: detail }).where(eq(standingOrders.id, row.id));
    return { userId: row.userId, acted, detail, tokensUsed };
  };

  const [save] = await db.select().from(gameSaves).where(eq(gameSaves.userId, row.userId)).limit(1);
  const baseRevision = save?.revision ?? -1;
  const stored = save ? parseStoredSave(save.gameState) : null;
  if (!stored) return finish("Okunabilir bulut kaydı yok.", false, false);

  const game = tick(stored as Game, now);
  const order: StandingOrder = { ...row, lastRunAt: row.lastRunAt ?? null };
  const window = rollDailyWindow(order, now);
  const decision = shouldWake({ ...order, ...window }, game, now);

  // Ön eleme: model çağrılmadan karar verilir, bu uyanma sıfır token harcar.
  if (!decision.act) return finish(decision.reason, false, false);

  // Saatlik dilimi modele gitmeden ÖNCE kilitle. Aynı anda düşen iki tetikleme
  // (elle deneme, tekrar eden cron, çakışan iki konteyner) yukarıdaki ön elemeyi
  // birlikte geçerdi: ikisi de token harcar ve ikisi de eylem uygulardı. Koşullu
  // UPDATE'i yalnızca bir istek kazanır; kaybeden sıfır token ile döner.
  // Gün penceresinin sıfırlanması da burada kalıcılaşır, böylece aşağıdaki artış
  // saf SQL toplaması olabilir ve iki istek birbirinin sayacını ezemez.
  // Kilit KRALLIK başınadır, emir başına değil: bir Kralın birden fazla kalıcı
  // emri olsa bile saatte tek hamle yapılır. Koşul "bu Kralın HİÇBİR emri son
  // bir saatte çalışmamış olmalı" biçiminde; emir başına yazılsaydı iki emri
  // olan Kral saatte iki hamle yapardı.
  const claimed = await db.update(standingOrders)
    .set({ lastRunAt: now, actionsToday: window.actionsToday, dayStartedAt: window.dayStartedAt })
    .where(and(
      eq(standingOrders.id, row.id),
      sql`not exists (select 1 from ${standingOrders} recent where recent.user_id = ${row.userId} and recent.last_run_at > ${now - WAKE_INTERVAL_MS})`,
    ))
    .returning({ id: standingOrders.id });
  if (!claimed.length) return { userId: row.userId, acted: false, detail: "Bu saatlik dilimde zaten uyanıldı.", tokensUsed: false };

  const [credential] = await db.select().from(llmCredentials).where(eq(llmCredentials.userId, row.userId)).limit(1);
  if (!credential) return finish("BYOK bağlantısı yok; General sessiz.", false, false);

  let proposed: GameAction | null = null;
  try {
    const apiKey = await decryptByok(credential.encryptedKey, credential.iv, env.BYOK_MASTER_KEY, row.userId, credential.provider, credential.model, credential.keyVersion);
    proposed = await callProvider({
      provider: credential.provider, model: credential.model, apiKey,
      system: NIGHT_PROMPT, tools: nightTools,
      user: `DURUM=${JSON.stringify(compactContext(game, order, decision))}`,
    });
  } catch (error) {
    return finish(`Sağlayıcı hatası: ${error instanceof Error ? error.message : "bilinmiyor"}`, false, true);
  }
  if (!proposed || proposed.name === "no_action") {
    return finish(`General beklemeyi seçti: ${String(proposed?.arguments.reason ?? "gerekçe yok")}`, false, true);
  }

  // Yalnızca öneri yetkisi varsa uygulamayız; Kralın onayına bırakılır.
  if (row.autonomy === "ask") {
    await db.insert(pendingDecisions).values({
      userId: row.userId, action: JSON.stringify(proposed), reasons: JSON.stringify([`Gece emriniz gereği önerim: ${proposed.name}`]),
      riskLevel: "elevated", expiresAt: now + 12 * 3_600_000,
    }).onConflictDoUpdate({
      target: pendingDecisions.userId,
      set: { action: JSON.stringify(proposed), reasons: JSON.stringify([`Gece emriniz gereği önerim: ${proposed.name}`]), riskLevel: "elevated", expiresAt: now + 12 * 3_600_000 },
    });
    return finish(`Öneri hazırlandı, onayınız bekleniyor: ${proposed.name}`, false, true);
  }

  const applied = applyActions(game, [proposed], now);
  const succeeded = applied.results.some(line => line.startsWith("✓"));
  const summary = applied.results[0] ?? "Motor eylemi uygulamadı.";
  const next: Game = {
    ...applied.game,
    notices: [{ kind: "GECE VARDİYASI", text: summary.replace(/^[✓✕] /, ""), at: now }, ...applied.game.notices].slice(0, 20),
  };
  const written = await writeSaveIfUnchanged(row.userId, baseRevision, next);
  if (!written) {
    // Kral bu arada oynadı. Onun ilerlemesini EZMEYİZ: taze durumu okuyup
    // eylemi onun üstüne uygularız.
    const [fresh] = await db.select().from(gameSaves).where(eq(gameSaves.userId, row.userId)).limit(1);
    const freshGame = fresh ? parseStoredSave(fresh.gameState) : null;
    if (!freshGame) return finish("Kayıt bu arada değişti; hamle uygulanmadı.", false, true);
    const redone = applyActions(tick(freshGame as Game, now), [proposed], now);
    const ok = redone.results.some(line => line.startsWith("✓"));
    const again = { ...redone.game, notices: [{ kind: "GECE VARDİYASI", text: (redone.results[0] ?? summary).replace(/^[✓✕] /, ""), at: now }, ...redone.game.notices].slice(0, 20) };
    const retried = await writeSaveIfUnchanged(row.userId, fresh!.revision, again);
    if (!retried) return finish("Kayıt eşzamanlı değişti; hamle atlandı.", false, true);
    // Göç kuyruğu: bu tur GERÇEKTEN yazılan `peopleLeft` artışı kuyruğa girer
    // (bkz. server/migration-desk.ts). `game`in kendi tick()'i değil, taze
    // durumun üstüne yeniden atılan `freshGame`/`redone.game` çifti okunur —
    // asıl kalıcı olan budur.
    try {
      await queueEmigrants({
        channelId: row.channelId, sourceUserId: row.userId,
        before: freshGame.peopleLeft, after: redone.game.peopleLeft, now,
      });
    } catch { /* göç kuyruğu düşerse bile gece vardiyası düşmesin */ }
    if (ok) await db.update(standingOrders).set({ actionsToday: sql`${standingOrders.actionsToday} + 1` }).where(eq(standingOrders.id, row.id));
    return finish(redone.results[0] ?? summary, ok, true);
  }
  // Göç kuyruğu: `stored` (bu turun BAŞINDAKİ kayıt) ile `applied.game` (bu
  // turun SONUNDA GERÇEKTEN yazılan durum) arasındaki `peopleLeft` farkı.
  try {
    await queueEmigrants({
      channelId: row.channelId, sourceUserId: row.userId,
      before: stored.peopleLeft, after: applied.game.peopleLeft, now,
    });
  } catch { /* göç kuyruğu düşerse bile gece vardiyası düşmesin */ }
  if (succeeded) {
    await db.update(standingOrders).set({ actionsToday: sql`${standingOrders.actionsToday} + 1` }).where(eq(standingOrders.id, row.id));
  }
  return finish(summary, succeeded, true);
}

/**
 * Kral çevrimdışıyken masada bekleyen cevabı Generali yazar.
 *
 * Kralın kararı harfiyen uygulanır: "Cevap versin ama imza atamasın."
 * General konuşur, blöf yapar, bilgi toplar, hatta şart önerebilir; ama hiçbir
 * anlaşmayı BAĞLAYAMAZ — bu yol onay ucuna (canBind) hiç uğramaz, elindeki araç
 * listesinde imza diye bir şey yoktur ve önerdiği şart Kralın onayına düşer.
 *
 * Harcama üç yerden tavanlanır: masa başına LIMITS.maxTurns söz, cron turu
 * başına NEGOTIATION_REPLY_BUDGET çağrı ve masa ömrü. Ayrıca konuşma hakkı
 * paylaşılan kuraldan (shouldGeneralAnswer) sorulur; kural motorda, testi de
 * aynı motorun üstünde durur.
 */
const NEGOTIATION_REPLY_BUDGET = 4;

type DeskReport = { negotiationId: string; userId: string; spoke: boolean; detail: string; tokensUsed: boolean };

/** Haraç turunun raporu; `error` doluysa tur düşmüştür ama cron ayaktadır. */
type TributeRound = { deals: number; paid: number; missed: number; error: string | null };

async function answerNegotiations(now: number): Promise<DeskReport[]> {
  const db = getDb();
  const rows = await db.select({ table: negotiations, channelName: channels.name })
    .from(negotiations)
    .innerJoin(channels, eq(channels.id, negotiations.channelId))
    .where(and(
      eq(channels.status, "active"),
      inArray(negotiations.status, ["open", "awaiting_king"]),
      gt(negotiations.expiresAt, now),
      lt(negotiations.turns, LIMITS.maxTurns),
    ))
    .orderBy(negotiations.lastTurnAt);

  const reports: DeskReport[] = [];
  let spent = 0;

  for (const row of rows) {
    if (spent >= NEGOTIATION_REPLY_BUDGET) break;
    const table = toEngine(row.table);
    const messages = await db.select().from(negotiationMessages)
      .where(eq(negotiationMessages.negotiationId, table.id)).orderBy(negotiationMessages.at);
    const last = messages.at(-1) ?? null;
    // Cevap sırası son sözü söyleyenin karşısındadır.
    const side: Side | null = last ? otherSide(last.side) : null;
    if (!side) continue;
    const userId = side === "initiator" ? table.initiatorId : table.targetId;

    const [saveRow] = await db.select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
    const game = saveRow ? parseStoredSave(saveRow.gameState) : null;
    if (!game) continue;

    const allowed = shouldGeneralAnswer({
      negotiation: table, side, lastMessageSide: last!.side,
      // Generalin kendi payı: Kralın yazdıkları sayılmaz, token harcamıyorlar.
      generalTurnsUsed: messages.filter(message => message.side === side && message.speaker === "general").length,
      kingPresent: isKingPresent(game.lastTickAt, now), now,
    });
    if (!allowed.ok) continue;

    const [credential] = await db.select().from(llmCredentials).where(eq(llmCredentials.userId, userId)).limit(1);
    if (!credential) {
      reports.push({ negotiationId: table.id, userId, spoke: false, detail: "BYOK bağlantısı yok; General masada sessiz.", tokensUsed: false });
      continue;
    }

    // Turu modele gitmeden ÖNCE kapat. Çakışan iki tetikleme (elle deneme,
    // gecikmiş cron, ikinci konteyner) yukarıdaki kontrolü birlikte geçerdi ve
    // iki General aynı masaya arka arkaya yazardı. Koşullu UPDATE'i yalnızca
    // biri kazanır; kaybeden sıfır token ile döner.
    const claimed = await db.update(negotiations).set({ lastTurnAt: now })
      .where(and(eq(negotiations.id, table.id), eq(negotiations.turns, table.turns), eq(negotiations.lastTurnAt, table.lastTurnAt)))
      .returning({ id: negotiations.id });
    if (!claimed.length) continue;

    const counterpart = await displayNameOf(side === "initiator" ? table.targetId : table.initiatorId, row.channelName);
    // Şart sunma hakkı ayrı sorulur: karşı taraf şart sunmuşsa o şart Kralın
    // imzasını bekliyordur ve General onun üstüne yazıp Kralın hiç görmediği
    // teklifi silemez. Model o aracı hiç görmez.
    const canPropose = canProposeTerms(table, side, false, now).ok;
    const own = await displayNameOf(userId, row.channelName);
    const brief = briefTable({ negotiation: table, messages, side, counterpart, own, ordinal: 1 });
    // Masanın özeti ile masada söylenen sözler AYRI taşınır ve ikisi de Kralın
    // oturumundaki General ile AYNI kaynaktan (server/negotiation-brief) gelir.
    // Karşı oyuncunun ham metni hiçbir yolda sistem promptuna girmez; iki yol
    // ayrı yazılsaydı biri sertleşir öbürü gevşerdi.
    const context = {
      bizim_krallik: {
        ad: game.kingdomName,
        kaleSeviyesi: game.buildings.find(building => building.type === "keep")?.level ?? 1,
        nufus: Math.round(game.population),
        ordu: Object.values(game.units).reduce((total, amount) => total + amount, 0),
        ambar: game.resources,
        halkinRizasi: Math.round(game.popularity),
        doktrin: game.strategyNote ?? "",
      },
      masa: tableMeta(brief),
    };
    const transcript = renderNegotiationTranscript([brief]);

    spent += 1;
    let call: GameAction | null = null;
    try {
      const apiKey = await decryptByok(credential.encryptedKey, credential.iv, env.BYOK_MASTER_KEY, userId, credential.provider, credential.model, credential.keyVersion);
      call = await callProvider({
        provider: credential.provider, model: credential.model, apiKey,
        system: OFFLINE_DESK_PROMPT, tools: offlineDeskTools(canPropose),
        user: transcript ? `DURUM=${JSON.stringify(context)}\n\n${transcript}` : `DURUM=${JSON.stringify(context)}`,
        maxTokens: 600,
      });
    } catch (error) {
      reports.push({ negotiationId: table.id, userId, spoke: false, detail: `Sağlayıcı hatası: ${error instanceof Error ? error.message : "bilinmiyor"}`, tokensUsed: true });
      continue;
    }
    if (!call) {
      reports.push({ negotiationId: table.id, userId, spoke: false, detail: "General araç çağırmadı; masaya bir şey yazılmadı.", tokensUsed: true });
      continue;
    }

    const body = String(call.arguments.message ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
    const kingNote = String(call.arguments.king_note ?? "").trim().slice(0, MAX_KING_NOTE_LENGTH);
    if (!body) {
      reports.push({ negotiationId: table.id, userId, spoke: false, detail: "General boş mesaj döndürdü.", tokensUsed: true });
      continue;
    }

    let terms: Terms | null = null;
    if (call.name === "negotiation_propose" && canPropose) {
      const checked = validateTerms({
        ...clampTerms({
          topic: table.topic,
          payerSide: payerSideOf(call.arguments.payer, side),
          resource: String(call.arguments.resource ?? "gold") as Terms["resource"],
          tributeAmount: Math.floor(Number(call.arguments.amount_per_payment) || 0),
          // Oranlı haraç: model yüzde gönderir, motor oranı saklar. Bu bağ
          // kurulmadan önce tributeRate'i yazan tek yer clampTerms'ti ve hiçbir
          // araç şeması oran sunmadığı için oranlı haraç hiç kurulamıyordu.
          tributeRate: tributeRateFromPercent(call.arguments.rate_percent),
          everyHours: Math.floor(Number(call.arguments.every_hours) || 6),
          hours: Math.floor(Number(call.arguments.hours) || 24),
        }),
        topic: table.topic,
      });
      if (!checked.ok) {
        reports.push({ negotiationId: table.id, userId, spoke: false, detail: `Şart sınırlara oturmadı: ${checked.reason}`, tokensUsed: true });
        continue;
      }
      terms = checked.terms;
    }

    // Mesaj kimliği masayı da taşır: aynı milisaniyede iki masaya yazıldığında
    // yalnızca zaman + tur sayısı çakışabiliyordu.
    await db.insert(negotiationMessages).values({
      id: `nm_${table.id}_${now}_${table.turns}`, negotiationId: table.id,
      side, speaker: "general", body, at: now,
    });
    await db.update(negotiations).set({
      turns: table.turns + 1,
      ...(terms ? { proposed: JSON.stringify(terms), proposedBy: side, status: "awaiting_king" as const } : {}),
    }).where(eq(negotiations.id, table.id));

    const summary = terms
      ? `${counterpart} masasında şart sundum; imza Kralındır. ${kingNote}`
      : `${counterpart} masasına cevap yazdım. ${kingNote}`;
    await noteToKing(userId, "MÜZAKERE", summary, now);
    reports.push({ negotiationId: table.id, userId, spoke: true, detail: summary.trim(), tokensUsed: true });
  }

  return reports;
}

/**
 * Bildirimi ve itibar cezasını kaydeder; sürüm çakışırsa TAZE durumla tekrar
 * dener.
 *
 * Tek denemede yazılıyordu: Kralın tarayıcısı o aralıkta kaydettiyse yazma
 * düşer, vade kaçmış sayılır ama bildirim ve itibar cezası uçardı — oyuncu
 * neden cezalandırıldığını hiç öğrenmezdi. Yazılacak kayıt yoksa (silinmiş
 * hesap) deneme tekrarlanmaz; yazacak bir şey yoktur.
 */
const PENALTY_WRITE_ATTEMPTS = 3;

async function applyTributeNotice(userId: string, text: string, penalty: number, now: number): Promise<boolean> {
  const db = getDb();
  for (let attempt = 0; attempt < PENALTY_WRITE_ATTEMPTS; attempt++) {
    const [row] = await db.select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
    const game = row ? parseStoredSave(row.gameState) : null;
    if (!game) return true;
    const written = await writeSaveIfUnchanged(userId, row!.revision, {
      ...game,
      reputation: Math.max(0, Math.min(100, game.reputation + penalty)),
      notices: [{ kind: "HARAÇ", text, at: now }, ...game.notices].slice(0, 20),
    });
    if (written) return true;
  }
  return false;
}

/**
 * Vadeleri deftere yazar ve kaçırılanı cezalandırır. Vadeyi bu tur kapatabildiyse
 * true döner; kapatamadıysa (çakışan tetikleme kazandı ya da ceza yazılamadı)
 * false döner ve vade bir sonraki tura kalır.
 *
 * Eskiden ödenemeyen vade de "ödendi" sayılıyordu: ambarı boş olan taraf
 * bedelsiz sıyrılıyordu — ne bildirim, ne itibar kaybı, ne anlaşmanın bozulması.
 */
async function recordTribute(
  deal: typeof agreements.$inferSelect,
  due: number,
  settlement: TributeSettlement,
  now: number,
): Promise<boolean> {
  const db = getDb();
  // Vadeyi KOŞULLU kapatırız: sayaçlar okuduğumuz hâlde duruyorsa bizimdir.
  // Gece vardiyasının saatlik dilimi nasıl kilitleniyorsa aynı desen — kilit
  // veritabanının kendisindedir, dışarıdan bir servise (Redis) bağlı değildir,
  // dolayısıyla tur tek nokta arızaya açılmaz. Çakışan iki tetikleme (docker
  // cron + elle curl) kaynak transferini sürüm koruması sayesinde ikilemiyordu
  // ama moved === 0 yolunda koruma yoktu: missedCount iki kez artıp anlaşmayı
  // erken bozabiliyordu. Kaybeden tetikleme buradan sessizce döner.
  const claim = (missed: number, status: "active" | "broken") => db.update(agreements)
    .set({ paidCount: deal.paidCount + due, missedCount: missed, status })
    .where(and(
      eq(agreements.id, deal.id),
      eq(agreements.paidCount, deal.paidCount),
      eq(agreements.missedCount, deal.missedCount),
      eq(agreements.status, "active"),
    ))
    .returning({ id: agreements.id });

  if (settlement.missed === 0) {
    const claimed = await claim(deal.missedCount, "active");
    return claimed.length > 0;
  }

  const missed = deal.missedCount + settlement.missed;
  const breached = missed >= MISSES_BEFORE_BREACH;
  const claimed = await claim(missed, breached ? "broken" : "active");
  if (!claimed.length) return false;

  const notes: Array<[string, string, number]> = [
    [deal.payerId, breached
      ? "Haracı ödeyemediniz; anlaşma bozuldu ve itibarınız zedelendi."
      : `Haraç vadesi ödenemedi (${missed}/${MISSES_BEFORE_BREACH}). Ambar yetmiyor; anlaşma bozulmak üzere.`,
      breached ? reputationChange("betrayal") : 0],
    [deal.payeeId, breached
      ? "Karşı taraf haracı ödemedi; anlaşma bozuldu. Sözünü tutmayanın itibarı düştü."
      : `Beklenen haraç gelmedi (${missed}/${MISSES_BEFORE_BREACH} vade kaçtı).`, 0],
  ];
  let payerNotified = true;
  for (const [userId, text, penalty] of notes) {
    const ok = await applyTributeNotice(userId, text, penalty, now);
    if (!ok && userId === deal.payerId) payerNotified = false;
  }
  if (!payerNotified) {
    // Ceza SESSİZCE kaybolmaz. Bildirimi ve itibar düşüşünü üç denemede de
    // yazamadıysak kaçırma sayacını GERİ ALIRIZ: bilmediği bir sebeple
    // cezalanan oyuncu kalmaz, çünkü bildirim yazılmadan ceza sayılmaz.
    //
    // Vade sayacı yalnızca hiçbir kaynak taşınmadıysa geri alınır; kısmi ödeme
    // yapıldıysa paidCount yerinde bırakılır, yoksa bir sonraki tur aynı vadeyi
    // yeniden tahsil eder ve ödeyen iki kez ödemiş olur.
    await db.update(agreements)
      .set({
        paidCount: settlement.moved > 0 ? deal.paidCount + due : deal.paidCount,
        missedCount: deal.missedCount,
        status: "active",
      })
      .where(and(
        eq(agreements.id, deal.id),
        eq(agreements.paidCount, deal.paidCount + due),
        eq(agreements.missedCount, missed),
      ));
    return false;
  }
  return true;
}

/**
 * Onaylanmış haraç anlaşmalarını öder.
 *
 * Ödeme ambardan çıkar ve karşı tarafın ambarına girer. Vadesi geçmiş ödemeler
 * duePayments ile birikimli sayılır: cron bir tur gecikirse ödeme atlanmaz.
 * Ambar yetmiyorsa ya da tavana takılıyorsa olan gider — borç birikmez, ama vade
 * de kapanmaz; kaçırılmış sayılır. Tek ödemede ambarın yarısından fazlası hiçbir
 * koşulda çıkmaz.
 */
async function settleTributes(now: number) {
  const db = getDb();
  // Haraç taşıyan konular TEK YERDE yazar (engine/negotiation.ts → TRIBUTE_TOPICS)
  // ve şartın geçerliliğini denetleyen validateTerms de oradan okur. Burada
  // yalnızca "tribute" filtreleniyordu: ültimatom imzalanıyor, panelde aktif
  // anlaşma görünüyor, ama tek bir kaynak bile akmıyordu.
  const deals = await db.select().from(agreements)
    .where(and(eq(agreements.status, "active"), inArray(agreements.topic, [...TRIBUTE_TOPICS])));
  let paid = 0, missedTotal = 0;

  for (const deal of deals) {
    let terms: { resource?: Key; tributeRate?: number; tributeAmount?: number };
    try { terms = JSON.parse(deal.terms) as typeof terms; } catch { continue; }
    const due = duePayments({ startedAt: deal.startedAt, everyHours: deal.everyHours, paidCount: deal.paidCount, endsAt: deal.endsAt }, now);

    if (due > 0) {
      const [payerRow] = await db.select().from(gameSaves).where(eq(gameSaves.userId, deal.payerId)).limit(1);
      const [payeeRow] = await db.select().from(gameSaves).where(eq(gameSaves.userId, deal.payeeId)).limit(1);
      const payer = payerRow ? parseStoredSave(payerRow.gameState) : null;
      const payee = payeeRow ? parseStoredSave(payeeRow.gameState) : null;
      if (payer && payee) {
        const key = (terms.resource ?? "gold") as Key;
        // Kaçırılan vade artık "ödendi" sayılmıyor; ayrı sayılıyor.
        const settlement = settleTribute(payer.resources[key], due, terms);
        const moved = settlement.moved, stock = payer.resources[key] - moved;
        if (moved > 0) {
          const nextPayer = { ...payer, resources: { ...payer.resources, [key]: stock },
            notices: [{ kind: "HARAÇ", text: `Anlaşma gereği ${moved} ${key} ödendi.`, at: now }, ...payer.notices].slice(0, 20) };
          const nextPayee = { ...payee, resources: { ...payee.resources, [key]: payee.resources[key] + moved },
            notices: [{ kind: "HARAÇ", text: `Anlaşma gereği ${moved} ${key} tahsil edildi.`, at: now }, ...payee.notices].slice(0, 20) };
          // İki yazım TEK İŞLEMDE olmalı: biri geçip diğeri düşerse ödeyenin
          // ambarından çıkan kaynak hiçbir yere ulaşmadan yok olur.
          // Sürüm korumalı: oyunculardan biri bu arada oynadıysa ilerlemesini
          // ezmeyiz; ödeme bir sonraki tura kalır ve vade sayacı artmaz.
          const settled = await db.transaction(async trx => {
            const payerWrite = await trx.update(gameSaves)
              .set({ gameState: JSON.stringify(nextPayer), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
              .where(and(eq(gameSaves.userId, deal.payerId), eq(gameSaves.revision, payerRow!.revision)))
              .returning({ userId: gameSaves.userId });
            if (!payerWrite.length) return false;
            const payeeWrite = await trx.update(gameSaves)
              .set({ gameState: JSON.stringify(nextPayee), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
              .where(and(eq(gameSaves.userId, deal.payeeId), eq(gameSaves.revision, payeeRow!.revision)))
              .returning({ userId: gameSaves.userId });
            if (!payeeWrite.length) { trx.rollback(); return false; }
            return true;
          }).catch(() => false);
          if (settled) paid += moved; else continue;
        }
        // Vadeyi yalnızca bu tur kapatabildiyse sayarız: çakışan ikinci
        // tetikleme aynı kaçırmayı ikinci kez deftere yazmaz.
        if (await recordTribute(deal, due, settlement, now)) missedTotal += settlement.missed;
      }
    }
    if (now >= deal.endsAt) {
      // Yalnızca hâlâ yürürlükteki anlaşma tamamlanmış sayılır; bu turda bozulan
      // anlaşma "completed" damgası yiyip ihlali silemez.
      await db.update(agreements).set({ status: "completed" })
        .where(and(eq(agreements.id, deal.id), eq(agreements.status, "active")));
    }
  }
  return { deals: deals.length, paid, missed: missedTotal, error: null };
}

/**
 * DIŞ KESELERİN VARIŞI.
 *
 * Omurga: maliyet gönderenin kaydından zaten düşmüştü (POST /api/world, tek
 * işlem, sürüm korumalı); burada yalnızca ETKİ hedefin kaydına yazılır ve
 * `completesAt` anına GERİYE DÖNÜK damgalanır — cron bir tur gecikse de sonuç
 * değişmez, çünkü sönüm damgadan okunur (bkz. engine/agitation.ts).
 *
 * Hedefte HİÇBİR KAYNAK ALANI yazılmaz: yalnızca üç taşıyıcı alan ve bir
 * bildirim. İfşa zarsızdır — hedefin karşı-istihbaratı kesenin VARDIĞI anda
 * ayaktaysa gönderenin adı açılır, itibarı düşer ve hedefe kalkan verilir.
 */
async function settleAgitations(now: number) {
  const db = getDb();
  const due = await db.select({ row: agitations, speed: channels.speed, channelName: channels.name })
    .from(agitations)
    .innerJoin(channels, eq(channels.id, agitations.channelId))
    .where(and(eq(agitations.status, "pending"), lte(agitations.completesAt, now), eq(channels.status, "active")))
    .orderBy(agitations.completesAt);

  let landed = 0, exposedCount = 0;
  for (const { row, speed, channelName } of due) {
    const [targetRow] = await db.select().from(gameSaves).where(eq(gameSaves.userId, row.targetUserId)).limit(1);
    const target = targetRow ? parseStoredSave(targetRow.gameState) : null;
    if (!target) {
      await db.update(agitations).set({ status: "settled", settledAt: now }).where(eq(agitations.id, row.id));
      continue;
    }
    // Kalkan yalnızca kesenin VARDIĞI anda ayakta olan nöbete bakar; cron'un
    // gecikmesi ifşayı ne açar ne kapatır.
    const [shield] = await db.select().from(intelDefenses).where(eq(intelDefenses.userId, row.targetUserId)).limit(1);
    const exposed = Boolean(shield?.activeUntil && shield.activeUntil > row.completesAt);
    const kind = row.kind as AgitationKind;
    // Mal kesesi yığın taşıyıcısına, altın kesesi baskı/kese taşıyıcılarına
    // yazar. İkisi ayrı silahtır: mal kesesi muhalefet baskısı üretmez, çünkü bol
    // mal rızayı yükseltir ve ikisi bindirilirse birbirini götürür.
    const patch = kind === "goods_glut"
      ? applyGlut({ ...target, speed }, isTraded(row.costResource) ? row.costResource : "food", row.completesAt)
      : kind === "raid_lure"
        // Yönlendirme `completesAt`e damgalanır; akın penceresi bu damgayı
        // pencerenin BAŞLANGICINA göre okur, yani sonuç iki okumada da aynı.
        ? applyLure({ ...target, speed }, row.completesAt)
        : applyAgitation({ ...target, speed }, kind, row.completesAt);
    const senderName = exposed ? await displayNameOf(row.sourceUserId, channelName) : "";
    const text = exposed ? agitationExposedNotice(senderName, kind) : AGITATION_NOTICE[kind];

    const written = await writeSaveIfUnchanged(row.targetUserId, targetRow!.revision, {
      ...target,
      ...patch,
      // Yakalanan kese hedefe kalkan bırakır: sönüm hızlanır, gelen keseler yarılanır.
      ...(exposed ? { agitationShieldUntil: row.completesAt + AGITATION.shieldHours * 3_600_000 / Math.max(1, speed) } : {}),
      notices: [{ kind: "KESE", text, at: row.completesAt }, ...target.notices].slice(0, 20),
    });
    // Yazma düşerse satır PENDING kalır ve bir sonraki tur tekrar denenir; etki
    // `completesAt`e damgalandığı için gecikme sonucu değiştirmez.
    if (!written) continue;

    if (exposed) {
      exposedCount += 1;
      await punishAgitator(row.sourceUserId, row.targetUserId, await displayNameOf(row.targetUserId, channelName), kind, now);
    }
    await db.update(agitations)
      .set({ status: exposed ? "exposed" : "settled", settledAt: now })
      .where(and(eq(agitations.id, row.id), eq(agitations.status, "pending")));
    landed += 1;
  }
  return { due: due.length, landed, exposed: exposedCount };
}

/**
 * GÖÇÜN VARIŞI (Faz 6).
 *
 * Kaynaktan ayrılan halk, kuyruğa alındığı anda DEĞİL, cron bu satırı işlerken
 * o anın GÜNCEL aday listesinden seçilen TEK bir hedefe gider (bkz.
 * engine/migration.ts → pickMigrationTarget). Hedef kuyruğa alma anında
 * SEÇİLMEZ: aradaki sürede adayların boş konutu değişmiş olabilir, "an
 * fotoğrafı" hemen bayatlardı.
 *
 * Kuruluş koruması süren krallık ADAY OLARAK BİLE değerlendirilmez — dış
 * kesenin (`server/agitation-desk.ts` → `sendAgitation`) koruma süren hedefe
 * gösterdiği saygının aynısı: henüz ilk günlerini yaşayan, dengesi oturmamış
 * bir krallığa habersiz bir nüfus dalgası göndermek de kendi başına bir
 * istismar yüzeyi açardı (kuruluşun hemen ardından sürekli göçmen alıp normalde
 * imkânsız bir hızda büyümek gibi).
 *
 * Hedef seçilemezse (uygun aday yok ya da hiçbirinde boş konut kalmamış)
 * göçmenler kaybolur — bu, `tick()`'in bugüne kadarki davranışının aynısı;
 * FARK şu ki artık ÇOĞU zaman gerçekten bir yer buluyorlar.
 */
async function settleMigrations(now: number) {
  const db = getDb();
  const due = await db.select({ row: migrations })
    .from(migrations)
    .innerJoin(channels, eq(channels.id, migrations.channelId))
    .where(and(eq(migrations.status, "pending"), lte(migrations.completesAt, now), eq(channels.status, "active")))
    .orderBy(migrations.completesAt);

  const settle = (id: string) =>
    db.update(migrations).set({ status: "settled", settledAt: now }).where(and(eq(migrations.id, id), eq(migrations.status, "pending")));

  let landed = 0, lost = 0;
  for (const { row } of due) {
    const members = await db.select({ userId: channelMembers.userId }).from(channelMembers)
      .where(and(eq(channelMembers.channelId, row.channelId), eq(channelMembers.status, "active")));
    const candidateIds = members.map(member => member.userId).filter(id => id !== row.sourceUserId);
    const rows = candidateIds.length
      ? await db.select({ userId: gameSaves.userId, gameState: gameSaves.gameState, revision: gameSaves.revision })
          .from(gameSaves).where(inArray(gameSaves.userId, candidateIds))
      : [];
    const parsed = rows
      .map(entry => ({ userId: entry.userId, revision: entry.revision, save: parseStoredSave(entry.gameState) }))
      // Kaydı okunamayan ve kuruluş koruması süren krallık aday değildir.
      .filter(entry => entry.save && entry.save.protectionEndsAt <= now)
      .map(entry => ({ userId: entry.userId, revision: entry.revision, save: entry.save! }));

    const pick = parsed.length
      ? pickMigrationTarget(
          parsed.map(entry => ({
            userId: entry.userId, population: entry.save.population,
            capacity: capacityFor(entry.save.buildings), popularity: entry.save.popularity,
          })),
          row.id,
        )
      : null;
    if (!pick) { lost += row.count; await settle(row.id); continue; }

    const target = parsed.find(entry => entry.userId === pick.userId)!;
    const arrived = arrivingMigrants(row.count, pick.room);
    if (arrived <= 0) { lost += row.count; await settle(row.id); continue; }

    const written = await writeSaveIfUnchanged(target.userId, target.revision, {
      ...target.save,
      population: target.save.population + arrived,
      // Kaynağı ne olursa olsun "krallığa katılan" ledger'ıdır (bkz.
      // engine/tick.ts). Yeni bir taşıyıcı alan açmak yerine mevcut deftere
      // yazılır — tek doğru kaynak, ikinci bir "nereden geldi" alanı yok.
      peopleJoined: (target.save.peopleJoined ?? 0) + arrived,
      notices: [{ kind: "GÖÇ", text: migrationArrivalNotice(arrived), at: now }, ...target.save.notices].slice(0, 20),
    });
    // Yazma düşerse satır PENDING kalır; sonraki tur GÜNCEL adaylarla yeniden dener.
    if (!written) continue;
    landed += arrived;
    await settle(row.id);
  }
  return { due: due.length, landed, lost };
}

/**
 * Yakalanan Kralın bedeli: itibar cezası ve — imzalı barışı varsa — ihanet.
 * İki olay ayrıdır: `caught_agitating` her yakalanmada, `betrayal` yalnızca
 * imzalı saldırmazlık/ittifak varken uygulanır ve anlaşma bozulur.
 */
async function punishAgitator(sourceUserId: string, targetUserId: string, targetName: string, kind: AgitationKind, now: number) {
  const db = getDb();
  const pacts = await db.select().from(agreements).where(and(
    eq(agreements.status, "active"),
    inArray(agreements.topic, ["non_aggression", "alliance"]),
    or(
      and(eq(agreements.payerId, sourceUserId), eq(agreements.payeeId, targetUserId)),
      and(eq(agreements.payerId, targetUserId), eq(agreements.payeeId, sourceUserId)),
    ),
  ));
  const betrayed = pacts.length > 0;
  const penalty = reputationChange("caught_agitating") + (betrayed ? reputationChange("betrayal") : 0);
  for (const pact of pacts) {
    await db.update(agreements).set({ status: "broken" }).where(eq(agreements.id, pact.id));
  }
  const [row] = await db.select().from(gameSaves).where(eq(gameSaves.userId, sourceUserId)).limit(1);
  const game = row ? parseStoredSave(row.gameState) : null;
  if (!game) return;
  await writeSaveIfUnchanged(sourceUserId, row!.revision, {
    ...game,
    reputation: Math.max(0, Math.min(100, game.reputation + penalty)),
    notices: [{
      kind: "KESE",
      text: betrayed
        ? `${agitationSenderNotice(targetName, kind, true)} İmzalı barışı bozduğumuz için anlaşma da düştü.`
        : agitationSenderNotice(targetName, kind, true),
      at: now,
    }, ...game.notices].slice(0, 20),
  });
}

export async function POST(request: Request) {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET tanımlı değil." }, { status: 503, headers });
  if (request.headers.get("x-cron-secret") !== secret) {
    return Response.json({ error: "Yetkisiz." }, { status: 401, headers });
  }

  const now = Date.now();

  // TEMİZLİK. `sessions` ve `rate_limits` yalnızca büyüyordu: her giriş bir
  // oturum satırı ekliyor, hiçbir şey silmiyordu; `pruneRateLimits` ise yazılmış
  // ama hiçbir yerden çağrılmamıştı. İkisi de tek indeksli, tek koşullu birer
  // DELETE. Turun geri kalanını düşürmesinler diye sarılı: temizlik başarısız
  // olsa bile gece vardiyası çalışır.
  let swept = "temiz";
  try {
    await Promise.all([pruneExpiredSessions(now), pruneRateLimits()]);
  } catch (error) {
    swept = `temizlik düştü: ${error instanceof Error ? error.message : "bilinmiyor"}`;
  }

  // Yalnızca Kralın onayladığı, aktif channel'daki emirler işlenir. Emri olmayan
  // hesap bu sorguya hiç girmez; o oyuncu için tek satır kod bile çalışmaz.
  const rows = await getDb().select({ order: standingOrders }).from(standingOrders)
    .innerJoin(channels, eq(channels.id, standingOrders.channelId))
    .where(and(eq(standingOrders.status, "active"), eq(channels.status, "active")));

  // Haraç turu SARILI: tek bir hata (bozuk şart, düşen sorgu) bütün cron turunu
  // düşürüyordu ve o saat hiç kimsenin gece vardiyası çalışmıyordu. Hata rapora
  // yazılır, tur devam eder.
  let tributes: TributeRound = { deals: 0, paid: 0, missed: 0, error: null };
  try { tributes = await settleTributes(now); }
  catch (error) { tributes = { deals: 0, paid: 0, missed: 0, error: `Haraç turu düştü: ${error instanceof Error ? error.message : "bilinmiyor"}` }; }
  // Yolda olan keseler: etki hedefin kaydına `completesAt` anına damgalanarak yazılır.
  // Aynı sarma gerekçesi: bu turun düşmesi haraç ya da gece vardiyasını etkilemesin.
  let purses = { due: 0, landed: 0, exposed: 0 };
  try { purses = await settleAgitations(now); }
  catch { purses = { due: 0, landed: 0, exposed: 0 }; }
  // Yolda olan göçmenler: aynı sarma gerekçesi, bu turun düşmesi diğer
  // turları etkilemesin (bkz. settleMigrations).
  let migrationRound = { due: 0, landed: 0, lost: 0 };
  try { migrationRound = await settleMigrations(now); }
  catch { migrationRound = { due: 0, landed: 0, lost: 0 }; }
  // Kral çevrimdışıyken masada bekleyen cevap; imza atılmaz, yalnızca konuşulur.
  let desks: DeskReport[] = [];
  try { desks = await answerNegotiations(now); }
  catch (error) { desks = [{ negotiationId: "-", userId: "-", spoke: false, detail: `Müzakere turu düştü: ${error instanceof Error ? error.message : "bilinmiyor"}`, tokensUsed: false }]; }

  const reports: WakeReport[] = [];
  for (const row of rows) {
    try { reports.push(await runOne(row.order, now)); }
    catch (error) { reports.push({ userId: row.order.userId, acted: false, detail: `Hata: ${error instanceof Error ? error.message : "bilinmiyor"}`, tokensUsed: false }); }
  }
  return Response.json({
    ranAt: new Date(now).toISOString(),
    considered: rows.length,
    swept,
    tributes,
    agitations: purses,
    migrations: migrationRound,
    negotiations: { spoke: desks.filter(desk => desk.spoke).length, reports: desks },
    acted: reports.filter(report => report.acted).length,
    llmCalls: reports.filter(report => report.tokensUsed).length + desks.filter(desk => desk.tokensUsed).length,
    reports,
  }, { headers });
}
