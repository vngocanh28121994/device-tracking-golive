import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { userProfiles } from "../../../db/schema";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Vui lòng đăng nhập để sử dụng trang." }, { status: 401 });
  try {
    const [saved] = await getDb().select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
    return Response.json({
      profile: {
        email: user.email,
        displayName: saved?.displayName ?? "",
        suggestedName: user.fullName ?? "",
        configured: Boolean(saved),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Không thể tải hồ sơ." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Vui lòng đăng nhập để sử dụng trang." }, { status: 401 });
  try {
    const body = await request.json() as { displayName?: unknown };
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (displayName.length < 2 || displayName.length > 60) {
      return Response.json({ error: "Tên hiển thị cần từ 2 đến 60 ký tự." }, { status: 400 });
    }
    const updatedAt = new Date().toISOString();
    await getDb().insert(userProfiles).values({ userId: user.userId, email: user.email, displayName, updatedAt })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { email: user.email, displayName, updatedAt } });
    return Response.json({ profile: { email: user.email, displayName, configured: true } });
  } catch {
    return Response.json({ error: "Không thể lưu tên hiển thị." }, { status: 500 });
  }
}
