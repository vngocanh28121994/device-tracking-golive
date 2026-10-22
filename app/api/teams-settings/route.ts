const removed = () => Response.json({ error: "Chức năng chốt cuối ngày và báo cáo Teams đã được gỡ." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
export const GET = removed;
export const POST = removed;
