import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { factionCoalitions, gameSaves } from "../db/schema";
import { factionDemandOf, type FactionDemand } from "../engine/faction";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { activeMembershipOf } from "./active-membership";
import { populaceCredentialFor } from "./populace-ai-desk";
import { factionCoalitionNarrator } from "./faction-coalition-narrator";
import { parseStoredSave } from "./save-validation";

export type CoalitionDemand = {
  id: string;
  kind: "tax_relief" | "food_relief";
  text: string;
  policyKey: "taxRate" | "foodRation";
  policyValue: number;
  openedAt: number;
  refusalCount: number;
};

function sourceKey(demand: FactionDemand, refusals: number) {
  return `${demand.kind}:${demand.policy.value}:${Math.max(0, Math.floor(refusals))}`;
}

function toDemand(row: typeof factionCoalitions.$inferSelect): CoalitionDemand | null {
  if (row.status !== "open") return null;
  if ((row.kind !== "tax_relief" && row.kind !== "food_relief") || (row.policyKey !== "taxRate" && row.policyKey !== "foodRation")) return null;
  return { id: row.id, kind: row.kind, text: row.text, policyKey: row.policyKey, policyValue: row.policyValue, openedAt: row.openedAt, refusalCount: row.refusalCount };
}

/** Kral ekranı yalnız açık masayı okur; burada model çağrısı yoktur. */
export async function coalitionFor(userId: string): Promise<CoalitionDemand | null> {
  const [row] = await getDb().select().from(factionCoalitions).where(eq(factionCoalitions.userId, userId)).limit(1);
  return row ? toDemand(row) : null;
}

/**
 * Saatlik turda açık masayı tazeler. Talep yalnız Halk-AI kimliği varsa doğar;
 * aynı talep/reddetme seviyesi yeniden model çağrısı yapmaz.
 */
export async function refreshFactionCoalition(userId: string, game: Game, now: number, masterKey: string) {
  const current = tick(game, now);
  const demand = factionDemandOf(current);
  const db = getDb();
  const [existing] = await db.select().from(factionCoalitions).where(eq(factionCoalitions.userId, userId)).limit(1);
  if (!demand) {
    if (existing?.status === "open") await db.update(factionCoalitions).set({ status: "withdrawn", lastAnsweredAt: now }).where(and(eq(factionCoalitions.userId, userId), eq(factionCoalitions.status, "open")));
    return { generated: false, reason: "Muhalefetin masa kuracağı bir şart yok." };
  }
  const credential = await populaceCredentialFor(userId, masterKey);
  if (!credential) return { generated: false, reason: "Halk-AI kimliği bağlı değil." };
  const refusals = existing?.status === "open" ? existing.refusalCount : 0;
  const key = sourceKey(demand, refusals);
  if (existing?.status === "open" && existing.sourceKey === key) return { generated: false, reason: "Aynı koalisyon talebi açık." };
  const text = await factionCoalitionNarrator(credential)(demand, refusals);
  if (!text) return { generated: false, reason: "Halk-AI bu turda sözü tamamlayamadı." };
  const values = {
    id: `coalition:${userId}`, userId, kind: demand.kind, text, policyKey: demand.policy.key,
    policyValue: demand.policy.value, sourceKey: key, status: "open" as const,
    openedAt: existing?.status === "open" ? existing.openedAt : now, refusalCount: refusals, lastAnsweredAt: existing?.lastAnsweredAt ?? null,
  };
  await db.insert(factionCoalitions).values(values).onConflictDoUpdate({
    target: factionCoalitions.userId,
    set: { kind: values.kind, text: values.text, policyKey: values.policyKey, policyValue: values.policyValue, sourceKey: values.sourceKey, status: "open", openedAt: values.openedAt, refusalCount: values.refusalCount, lastAnsweredAt: values.lastAnsweredAt },
  });
  return { generated: true, reason: "Muhalefet koalisyon masasına çağırdı." };
}

/** Tüm etkin krallıkların masası cron'da değerlendirilir; sonuçlar token saymaz. */
export async function refreshDueFactionCoalitions(now: number, masterKey: string) {
  const rows = await getDb().select({ userId: gameSaves.userId, gameState: gameSaves.gameState }).from(gameSaves);
  const reports: Array<{ userId: string; generated: boolean }> = [];
  for (const row of rows) {
    if (!(await activeMembershipOf(row.userId))) continue;
    const game = parseStoredSave(row.gameState);
    if (!game) continue;
    const result = await refreshFactionCoalition(row.userId, game as Game, now, masterKey);
    reports.push({ userId: row.userId, generated: result.generated });
  }
  return reports;
}
