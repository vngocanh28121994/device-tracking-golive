import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { requireMember } from "../../lib/member-access";
import { getDb } from "../../../db";
import { devices, members, userProfiles } from "../../../db/schema";
import { memberEmail } from "../../lib/member-email";
import { avatarUrl, decodeAvatar } from "../../lib/avatar";
import { canManageAccountRoles, validRole } from "../../lib/roles";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const user = access.user;
  try {
    const db = getDb();
    if (new URL(request.url).searchParams.get("list") === "1") {
      const rows = await db.select().from(userProfiles);
      const accounts = rows.map(row => ({ userId: row.userId, email: row.email, displayName: row.displayName, role: row.role, avatar: avatarUrl(row.avatarKey) }));
      accounts.sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
      const canManageRoles = canManageAccountRoles(rows.find(row => row.userId === user.userId)?.role, user.email);
      const pendingMembers = canManageRoles ? (await db.select({ email: members.email }).from(members))
        .filter(member => !rows.some(row => row.email.toLowerCase() === member.email)).map(member => member.email).sort() : [];
      return json({ accounts, canManageRoles, pendingMembers });
    }
    const [saved] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
    return json({ profile: { userId: user.userId, email: user.email, displayName: saved?.displayName ?? "", suggestedName: user.fullName ?? "", configured: Boolean(saved), role: saved?.role || "", avatar: avatarUrl(saved?.avatarKey || "") } });
  } catch { return json({ error: "Không thể tải hồ sơ." }, 500); }
}

export async function POST(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const user = access.user;
  let createdKey = "";
  try {
    const text = await request.text();
    if (text.length > 100000) return json({ error: "Ảnh quá lớn. Hãy chọn lại ảnh." }, 413);
    let body: { action?: unknown; userId?: unknown; role?: unknown; displayName?: unknown; avatar?: unknown; email?: unknown };
    try { body = JSON.parse(text); } catch { return json({ error: "Dữ liệu hồ sơ không hợp lệ." }, 400); }
    if (!body || typeof body !== "object") return json({ error: "Dữ liệu hồ sơ không hợp lệ." }, 400);
    if (body.action === "add-member") {
      const db = getDb();
      const [actor] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId));
      if (!canManageAccountRoles(actor?.role, user.email)) return json({ error: "Chỉ người quản trị hoặc Manager được thêm người dùng." }, 403);
      if (!request.headers.get("Content-Type")?.includes("application/json") || (request.headers.get("Origin") && request.headers.get("Origin") !== new URL(request.url).origin)) return json({ error: "Yêu cầu không hợp lệ." }, 403);
      const email = memberEmail(body.email);
      if (!email) return json({ error: "Hãy nhập email hợp lệ." }, 400);
      const inserted = await db.insert(members).values({ email, addedBy: user.userId, createdAt: new Date().toISOString() }).onConflictDoNothing().returning({ email: members.email });
      if (!inserted.length) return json({ error: "Email này đã được cấp quyền truy cập." }, 409);
      return json({ email }, 201);
    }
    if (body.action === "assign-role") {
      const db = getDb();
      const [actor] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId));
      if (!canManageAccountRoles(actor?.role, user.email)) return json({ error: "Chỉ người quản trị hoặc Manager được gán role cho tài khoản." }, 403);
      if (typeof body.userId !== "string" || !validRole(body.role)) return json({ error: "Tài khoản hoặc role không hợp lệ." }, 400);
      const [target] = await db.select().from(userProfiles).where(eq(userProfiles.userId, body.userId));
      if (!target) return json({ error: "Không tìm thấy tài khoản." }, 404);
      const updated = await db.update(userProfiles).set({ role: body.role, updatedAt: new Date().toISOString() })
        .where(eq(userProfiles.userId, body.userId)).returning({ userId: userProfiles.userId, role: userProfiles.role });
      return json({ account: updated[0] });
    }
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (displayName.length < 2 || displayName.length > 60) return json({ error: "Tên hiển thị cần từ 2 đến 60 ký tự." }, 400);
    let bytes: Uint8Array | null | undefined;
    if (body.avatar !== undefined) {
      try { bytes = decodeAvatar(body.avatar); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Ảnh không hợp lệ." }, 400); }
    }
    const db = getDb();
    const [saved] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
    let avatarKey = saved?.avatarKey || "";
    if (bytes) {
      if (!env.BUCKET) throw new Error("Avatar storage unavailable");
      createdKey = crypto.randomUUID() + ".jpg";
      await env.BUCKET.put("avatars/" + createdKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      avatarKey = createdKey;
    } else if (bytes === null) avatarKey = "";
    const updatedAt = new Date().toISOString();
    await db.batch([
      db.update(devices).set({ holder: displayName, holderUserId: user.userId }).where(sql`
        ${devices.holderUserId} = ${user.userId}
        OR (${devices.holderUserId} IS NULL
          AND ${devices.holder} = (SELECT display_name FROM user_profiles WHERE user_id = ${user.userId})
          AND (SELECT count(*) FROM user_profiles WHERE display_name = ${devices.holder}) = 1)
      `),
      db.insert(userProfiles).values({ userId: user.userId, email: user.email, displayName, avatarKey, updatedAt })
        .onConflictDoUpdate({ target: userProfiles.userId, set: { email: user.email, displayName, avatarKey, updatedAt } }),
    ]);
    if (saved?.avatarKey && saved.avatarKey !== avatarKey) await env.BUCKET?.delete("avatars/" + saved.avatarKey).catch(() => {});
    return json({ profile: { userId: user.userId, email: user.email, displayName, configured: true, role: saved?.role || "", avatar: avatarUrl(avatarKey) } });
  } catch {
    if (createdKey) await env.BUCKET?.delete("avatars/" + createdKey).catch(() => {});
    return json({ error: "Không thể lưu hồ sơ. Vui lòng thử lại." }, 500);
  }
}
