import { currentUser } from "../../../server/account-auth";
import { openFateFor, resolveFateEvent } from "../../../server/fate-desk";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  return Response.json({ event: await openFateFor(user.id) }, { headers });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const body = await request.json() as { id?: unknown; choice?: unknown };
  if (typeof body.id !== "string" || (body.choice !== "discuss" && body.choice !== "defer")) {
    return Response.json({ error: "Geçerli bir Kader kararı gerekli." }, { status: 400, headers });
  }
  const event = await resolveFateEvent(user.id, body.id, body.choice, Date.now());
  if (!event) return Response.json({ error: "Bu Kader anı artık açık değil." }, { status: 409, headers });
  return Response.json({ event }, { headers });
}
