import { requireMember } from "../../lib/member-access";
const removed = async () => {
  const access = await requireMember();
  if ("response" in access) return access.response;
  return Response.json({ error: "Chức năng chốt cuối ngày và báo cáo Teams đã được gỡ." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
};
export const GET = removed;
export const POST = removed;
