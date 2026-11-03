import { desc, eq, sql } from "drizzle-orm";
import { requireMember } from "../../lib/member-access";
import { getDb } from "../../../db";
import { goliveDeviceChecks, goliveReleases, goliveTickets, userProfiles } from "../../../db/schema";
import { canViewStatistic } from "../../lib/roles";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

// Read-only reporting: unlike /api/golive this never re-derives Done, so a Manager opening the
// report cannot move a ticket. It shows exactly what the testers have already recorded.
export async function GET(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const user = access.user;
  try {
    const db = getDb();
    const [me] = await db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
    if (!canViewStatistic(me?.role, user.email)) return json({ error: "Màn hình Statistic chỉ dành cho tài khoản có role Manager." }, 403);
    const releaseId = new URL(request.url).searchParams.get("release") || "";
    if (releaseId) {
      // One round trip each: the tickets, and how many devices each one has ticked so far.
      const [rows, ticks] = await Promise.all([
        db.select().from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)).orderBy(goliveTickets.id),
        db.select({
          ticketId: goliveDeviceChecks.ticketId,
          devices: sql<number>`count(*)`,
          // The tester's last tick is the moment they finished the ticket on their devices.
          lastCheckedAt: sql<string>`max(${goliveDeviceChecks.checkedAt})`,
        }).from(goliveDeviceChecks)
          .where(sql`${goliveDeviceChecks.ticketId} in (select ${goliveTickets.id} from ${goliveTickets} where ${goliveTickets.releaseId} = ${releaseId})`)
          .groupBy(goliveDeviceChecks.ticketId),
      ]);
      const tickets = rows.map(ticket => {
        const tick = ticks.find(item => item.ticketId === ticket.id);
        return {
          id: ticket.id, issueKey: ticket.issueKey, summary: ticket.summary,
          assignee: ticket.assignee, assigneeUserId: ticket.assigneeUserId,
          doneAt: ticket.doneAt, skippedAt: ticket.skippedAt, skippedBy: ticket.skippedBy, skipKind: ticket.skipKind,
          testedDevices: tick?.devices ?? 0, lastCheckedAt: tick?.lastCheckedAt ?? null,
        };
      });
      return json({ releaseId, tickets });
    }
    const [rows, counts] = await Promise.all([
      db.select().from(goliveReleases).orderBy(desc(goliveReleases.createdAt)),
      db.select({
        releaseId: goliveTickets.releaseId,
        total: sql<number>`count(*)`,
        done: sql<number>`sum(case when ${goliveTickets.doneAt} is null then 0 else 1 end)`,
      }).from(goliveTickets).groupBy(goliveTickets.releaseId),
    ]);
    const releases = rows.map(release => {
      const count = counts.find(item => item.releaseId === release.id);
      return { ...release, total: count?.total ?? 0, done: Number(count?.done ?? 0) };
    });
    return json({ releases });
  } catch {
    return json({ error: "Không thể tải số liệu golive." }, 500);
  }
}
