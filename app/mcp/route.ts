import { isSiteOwner, readTeamsSettings, sendTeamsReport } from "../lib/teams-notifications";

export async function POST(request: Request) {
  let id: unknown = null;
  const result = (value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const body = await request.json() as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    id = body.id ?? null;
    if (body.method === "server/discover") return result({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
    if (body.method === "initialize") return result({ protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "Digital Devices Reports", version: "1.0.0" } });
    if (body.method?.startsWith("notifications/")) return new Response(null, { status: 204 });
    if (body.method === "ping") return result({});
    if (body.method === "tools/list") return result({ tools: [
      { name: "get_teams_reporting_status", description: "Chủ website xem cấu hình và kết quả gửi báo cáo Teams. Không trả URL webhook.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "send_daily_teams_report", description: "Chủ website gửi báo cáo chốt máy hôm nay đến Teams webhook đã lưu, chỉ từ 19:05 giờ Việt Nam khi cấu hình được bật. Mỗi ngày gửi tối đa một lần. Không gửi lại khi kết quả không rõ.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, idempotentHint: true } },
    ] });
    if (body.method === "tools/call") {
      if (!await isSiteOwner()) return result({ isError: true, content: [{ type: "text", text: "Chỉ chủ website được sử dụng công cụ báo cáo Teams." }] });
      const value = body.params?.name === "get_teams_reporting_status" ? await readTeamsSettings()
        : body.params?.name === "send_daily_teams_report" ? await sendTeamsReport() : null;
      if (!value) throw new Error("Công cụ không tồn tại.");
      return result({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    }
    return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (error) {
    return result({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Không thể xử lý yêu cầu." }] });
  }
}
