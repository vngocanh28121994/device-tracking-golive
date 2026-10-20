import { isSiteOwner, readTeamsSettings, saveTeamsSettings, sendTeamsReport } from "../../lib/teams-notifications";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET() {
  if (!await isSiteOwner()) return json({ isOwner: false });
  try { return json(await readTeamsSettings()); }
  catch { return json({ error: "Không thể tải cấu hình Teams." }, 500); }
}
export async function POST(request: Request) {
  if (!await isSiteOwner()) return json({ error: "Chỉ chủ website được cấu hình Teams." }, 403);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Yêu cầu không hợp lệ." }, 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "test") {
      if (typeof body.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.requestId)) return json({ error: "Mã lần gửi không hợp lệ." }, 400);
      return json(await sendTeamsReport(body.requestId));
    }
    if (body.action !== "save") return json({ error: "Thao tác không hợp lệ." }, 400);
    return json(await saveTeamsSettings(body));
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Không thể cập nhật Teams." }, 400); }
}
