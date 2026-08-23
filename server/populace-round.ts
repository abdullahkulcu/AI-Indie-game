import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { channelMembers, channels, gameSaves } from "../db/schema";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { voiceSignalsOf } from "../engine/populace-voice";
import { syncPopulaceDemands } from "./populace-voice";
import { parseStoredSave } from "./save-validation";
import { populaceComparison } from "./world-projection";

/**
 * HALKIN SESİNİN KENDİ TURU.
 *
 * NEDEN VAR: halkın talepleri bugüne kadar YALNIZCA `app/api/general` içinden,
 * yani Kral General'e bir mesaj gönderdiğinde eşitleniyordu. İki sonucu vardı
 * ve ikincisi ağır:
 *
 *  1. Kral uzun süre konuşmazsa halk susuyordu.
 *  2. GENERAL'İ HİÇ BAĞLAMAYAN Kral halkın sesini HİÇ duymuyordu. Kuruluş akışı
 *     "General sessizken başla" seçeneğini açıkça sunuyor, yani bu istisnai bir
 *     durum değil desteklenen bir oyun biçimi — ve o biçimde oyunun kalbi olan
 *     halk tamamen görünmezdi.
 *
 * Plan belgesindeki karar da "kıyaslama saatlik cron turunda yenilenir"
 * diyordu; bu tur o kararın gereği.
 *
 * MODEL ÇAĞRILMAZ. `syncPopulaceDemands`e anlatıcı verilmez, yani talepler
 * motorun deterministik şablon cümlesiyle açılır ve bu tur SIFIR token harcar.
 * Halk-AI'nın sesi Kral'ın turunda devreye girmeye devam eder (orada anlatıcı
 * verilir ve cümle modelden gelir). Sebep maliyet disiplini: saatlik bir tur
 * her oyuncu için model çağırsa fatura oyuncu sayısıyla çarpılırdı.
 */

export type PopulaceRound = { considered: number; spoke: number; error: string | null };

/** Aktif channel'ların aktif üyeleri için halkın talep defterini eşitler. */
export async function refreshPopulaceVoice(now: number): Promise<PopulaceRound> {
  const db = getDb();
  const members = await db.select({
    userId: channelMembers.userId,
    channelId: channels.id,
    channelName: channels.name,
    channelSpeed: channels.speed,
    gameState: gameSaves.gameState,
  })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .innerJoin(gameSaves, eq(gameSaves.userId, channelMembers.userId))
    .where(and(eq(channelMembers.status, "active"), eq(channels.status, "active")));

  // Kıyas girdisi channel BAŞINA bir kez okunur: her oyuncu için ayrı sorgu
  // atmak aynı satırları oyuncu sayısı kadar tekrar okumak olurdu.
  const byChannel = new Map<string, typeof members>();
  for (const member of members) {
    const list = byChannel.get(member.channelId) ?? [];
    list.push(member);
    byChannel.set(member.channelId, list);
  }

  let spoke = 0;
  for (const [, group] of byChannel) {
    const rows = group
      .map(member => ({ userId: member.userId, gameState: member.gameState }));
    for (const member of group) {
      const stored = parseStoredSave(member.gameState);
      if (!stored) continue;
      const game = tick(stored as Game, now);
      const comparison = populaceComparison({
        channelName: member.channelName, userId: member.userId, rows, now,
      });
      const { open } = await syncPopulaceDemands(
        member.userId,
        voiceSignalsOf(game, { channelSpeed: member.channelSpeed, comparison }),
        now,
        // ANLATICI YOK: bu tur token harcamaz (dosya başındaki gerekçe).
        null,
      );
      if (open.length) spoke += 1;
    }
  }
  return { considered: members.length, spoke, error: null };
}
