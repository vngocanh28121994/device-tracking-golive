import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { userProfiles } from "../../../db/schema";
import { avatarUrl, decodeAvatar } from "../../lib/avatar";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Vui lòng đăng nhập để sử dụng trang." }, 401);
  try {
    const db = getDb();
    if (new URL(request.url).searchParams.get("list") === "1") {
      const rows = await db.select().from(userProfiles);
      const accounts = rows.map(row => ({ userId: row.userId, email: row.email, displayName: row.displayName, avatar: avatarUrl(row.avatarKey) }));
      accounts.sort((a, b) => a.displayName.localeCompare(b.displayName, "vi"));
      return json({ accounts });
    }
    const [saved] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
    return json({ profile: { userId: user.userId, email: user.email, displayName: saved?.displayName ?? "", suggestedName: user.fullName ?? "", configured: Boolean(saved), avatar: avatarUrl(saved?.avatarKey || "") } });
  } catch { return json({ error: "Không thể tải hồ sơ." }, 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Vui lòng đăng nhập để sử dụng trang." }, 401);
  let createdKey = "";
  try {
    const text = await request.text();
    if (text.length > 100000) return json({ error: "Ảnh quá lớn. Hãy chọn lại ảnh." }, 413);
    let body: { displayName?: unknown; avatar?: unknown };
    try { body = JSON.parse(text); } catch { return json({ error: "Dữ liệu hồ sơ không hợp lệ." }, 400); }
    if (!body || typeof body !== "object") return json({ error: "Dữ liệu hồ sơ không hợp lệ." }, 400);
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
    await db.insert(userProfiles).values({ userId: user.userId, email: user.email, displayName, avatarKey, updatedAt })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { email: user.email, displayName, avatarKey, updatedAt } });
    if (saved?.avatarKey && saved.avatarKey !== avatarKey) await env.BUCKET?.delete("avatars/" + saved.avatarKey).catch(() => {});
    return json({ profile: { userId: user.userId, email: user.email, displayName, configured: true, avatar: avatarUrl(avatarKey) } });
  } catch {
    if (createdKey) await env.BUCKET?.delete("avatars/" + createdKey).catch(() => {});
    return json({ error: "Không thể lưu hồ sơ. Vui lòng thử lại." }, 500);
  }
}
