import { currentUser } from "../../../server/account-auth";
import { loadPopulaceFeed } from "../../../server/populace-feed";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

/** Günce salt-okunurdur: yalnızca cron üretir, Kral silemez veya yenileyemez. */
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  return Response.json({ items: await loadPopulaceFeed(user.id) }, { headers });
}
