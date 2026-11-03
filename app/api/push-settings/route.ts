import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { pushSettings, userProfiles } from "../../../db/schema";
import { requireMember } from "../../lib/member-access";
import { isPushEvent, pushEvents } from "../../lib/push-events";
import { canManageAccountRoles } from "../../lib/roles";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function load(userId: string, email: string) {
  const db = getDb();
  const [rows, [me]] = await Promise.all([
    db.select({ event: pushSettings.event, enabled: pushSettings.enabled }).from(pushSettings),
    db.select({ role: userProfiles.role, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, userId)),
  ]);
  const settings = Object.fromEntries(pushEvents.map(item => [item.key, rows.find(row => row.event === item.key)?.enabled ?? true]));
  return { db, me, settings, canManage: canManageAccountRoles(me?.role, email) };
}

export async function GET() {
  const access = await requireMember();
  if ("response" in access) return access.response;
  try {
    const { settings, canManage } = await load(access.user.userId, access.user.email);
    return json({ settings, canManage });
  } catch {
    return json({ error: "Không thể tải cài đặt thông báo." }, 500);
  }
}

// Body { event, enabled }: only the admin or a Manager may switch a notification type.
export async function POST(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => ({})) as { event?: unknown; enabled?: unknown };
  if (!isPushEvent(body.event) || typeof body.enabled !== "boolean") return json({ error: "Cài đặt không hợp lệ." }, 400);
  try {
    const { db, me, canManage } = await load(access.user.userId, access.user.email);
    if (!canManage) return json({ error: "Chỉ người quản trị hoặc Manager được đổi cài đặt thông báo." }, 403);
    const row = { enabled: body.enabled, updatedBy: me?.displayName || access.user.email, updatedAt: new Date().toISOString() };
    await db.insert(pushSettings).values({ event: body.event, ...row }).onConflictDoUpdate({ target: pushSettings.event, set: row });
    return json((await load(access.user.userId, access.user.email)).settings);
  } catch {
    return json({ error: "Không thể lưu cài đặt thông báo." }, 500);
  }
}
