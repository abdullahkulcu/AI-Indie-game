import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { wars } from "../db/schema";
import { FIELD_STATUSES, filterRegencyActions } from "../engine/war-regency";

export { filterRegencyActions };

/** Kral, birlikler dönene dek başkentte değildir; dönüş hâli de naipliktedir. */
export async function kingIsAwayOnCampaign(userId: string, channelId: string) {
  const [war] = await getDb().select({ id: wars.id }).from(wars).where(and(
    eq(wars.channelId, channelId), eq(wars.attackerId, userId), eq(wars.kingLeads, true),
    inArray(wars.status, FIELD_STATUSES),
  )).limit(1);
  return Boolean(war);
}
