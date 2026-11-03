import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { pushTokens } from "../../../db/schema";
import { requireMember } from "../../lib/member-access";
import { webConfig } from "../../lib/push";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const access = await requireMember();
  if ("response" in access) return access.response;
  return Response.json(webConfig() ?? { config: null }, noStore);
}

// Body { token, enabled }: saves or removes this browser's FCM token for the signed-in account.
export async function POST(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => ({})) as { token?: unknown; enabled?: unknown };
  const token = typeof body.token === "string" ? body.token.trim().slice(0, 4096) : "";
  if (!token) return Response.json({ error: "Thiếu token thông báo." }, { status: 400 });
  try {
    const db = getDb(), userId = access.user.userId, updatedAt = new Date().toISOString();
    if (body.enabled === false) await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
    else await db.insert(pushTokens).values({ token, userId, updatedAt }).onConflictDoUpdate({ target: pushTokens.token, set: { userId, updatedAt } });
    return Response.json({ ok: true }, noStore);
  } catch {
    return Response.json({ error: "Không thể lưu cài đặt thông báo." }, { status: 500 });
  }
}
