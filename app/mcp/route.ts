
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
      { name: "get_teams_reporting_status", description: "Chốt cuối ngày đã được gỡ. Chỉ trả trạng thái ngừng hoạt động, không có cấu hình webhook.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "send_daily_teams_report", description: "Công cụ cũ đã ngừng hoạt động. Chỉ trả trạng thái bỏ qua, không gửi tin Teams.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
    ] });
    if (body.method === "tools/call") {
      const value = ["get_teams_reporting_status", "send_daily_teams_report"].includes(body.params?.name || "")
        ? { status: "skipped", enabled: false, configured: false, featureRemoved: true, message: "Chốt cuối ngày và báo cáo Teams đã được gỡ. Không gửi thông báo." } : null;
      if (!value) throw new Error("Công cụ không tồn tại.");
      return result({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    }
    return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (error) {
    return result({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Không thể xử lý yêu cầu." }] });
  }
}
