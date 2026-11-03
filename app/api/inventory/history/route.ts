import { and, desc, eq, gte, lt } from "drizzle-orm";
import { requireMember } from "../../../lib/member-access";
import { getDb } from "../../../../db";
import { deviceMovements, devices } from "../../../../db/schema";

import { historyDateBounds } from "../../../lib/history-dates";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const params = new URL(request.url).searchParams;
  const deviceId = params.get("deviceId") || "";
  const rawCursor = params.get("before");
  const before = rawCursor === null ? null : Number(rawCursor);
  if (!deviceId || deviceId.length > 100 || (before !== null && (!Number.isSafeInteger(before) || before <= 0))) return json({ error: "Yêu cầu lịch sử không hợp lệ." }, 400);
  let range: ReturnType<typeof historyDateBounds>;
  try { range = historyDateBounds(params.get("from") || "", params.get("to") || ""); }
  catch (e) { return json({ error: e instanceof Error ? e.message : "Khoảng ngày không hợp lệ." }, 400); }
  try {
    const db = getDb();
    const [device] = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, deviceId), eq(devices.archived, false))).limit(1);
    if (!device) return json({ error: "Thiết bị không còn trong danh sách." }, 404);
    const entries = await db.select({
      id: deviceMovements.id, action: deviceMovements.action, fromHolder: deviceMovements.fromHolder,
      toHolder: deviceMovements.toHolder, actorName: deviceMovements.actorName, createdAt: deviceMovements.createdAt,
    }).from(deviceMovements).where(and(eq(deviceMovements.deviceId, deviceId), before === null ? undefined : lt(deviceMovements.id, before), range.from ? gte(deviceMovements.createdAt, range.from) : undefined, range.until ? lt(deviceMovements.createdAt, range.until) : undefined))
      .orderBy(desc(deviceMovements.id)).limit(21);
    const page = entries.slice(0, 20);
    return json({ entries: page, nextCursor: entries.length > 20 ? page[page.length - 1].id : null });
  } catch { return json({ error: "Không thể tải lịch sử giữ thiết bị." }, 500); }
}
