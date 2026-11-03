import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../chatgpt-auth";
import { getDb } from "../../db";
import { members } from "../../db/schema";

// Every data endpoint uses this guard before reading or writing application data.
export async function requireMember() {
  const user = await getChatGPTUser();
  const denied = (error: string, status: number) => ({ response: Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } }) });
  if (!user) return denied("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const [member] = await getDb().select({ email: members.email }).from(members).where(eq(members.email, user.email.trim().toLowerCase())).limit(1);
    if (!member) return denied("Email này chưa được cấp quyền. Hãy liên hệ quản trị hoặc Manager để được thêm vào team.", 403);
    return { user };
  } catch {
    return denied("Không thể kiểm tra quyền truy cập. Vui lòng thử lại.", 503);
  }
}
