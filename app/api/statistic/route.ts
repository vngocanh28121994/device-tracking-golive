import { and, desc, eq, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { waitUntil } from "cloudflare:workers";
import { requireMember } from "../../lib/member-access";
import { getDb } from "../../../db";
import { goliveDeviceChecks, goliveReleases, goliveTicketFailures, goliveTickets, goliveWebSignoffs, userProfiles } from "../../../db/schema";
import { canViewStatistic, qeRoles } from "../../lib/roles";
import { matchAccount, normalizeName, webProgress } from "../../lib/golive";
import { notifyUsers, pushEnabled } from "../../lib/push";
import { qeScorecard, untestedNotices, webRoster, webSummary } from "../../lib/statistic";
import { historyDateBounds } from "../../lib/history-dates";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

// Same gate as the report itself: only someone who can see it can act on it.
async function requireReporter() {
  const access = await requireMember();
  if ("response" in access) return access;
  const db = getDb();
  const [me] = await db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, access.user.userId)).limit(1);
  if (!canViewStatistic(me?.role)) return { response: json({ error: "Màn hình Statistic chỉ dành cho tài khoản có role Manager." }, 403) };
  return { user: access.user, db };
}

// Tab "QE": one row per QE over every release created in the filtered period. A release in the
// period brings all of its tickets, the running one included. Everything is read in four round
// trips whose ticket and failure rows are narrowed by a subquery, never by a list of release ids:
// a long period would otherwise blow past D1's parameter limit.
async function qeReport(db: ReturnType<typeof getDb>, from: string, to: string) {
  const bounds = historyDateBounds(from, to);
  const period = bounds.from && bounds.until
    ? sql`${goliveReleases.createdAt} >= ${bounds.from} and ${goliveReleases.createdAt} < ${bounds.until}`
    : bounds.from ? sql`${goliveReleases.createdAt} >= ${bounds.from}`
    : bounds.until ? sql`${goliveReleases.createdAt} < ${bounds.until}`
    : sql`1 = 1`;
  const inPeriod = (column: SQLWrapper) =>
    sql`${column} in (select ${goliveReleases.id} from ${goliveReleases} where ${period})`;
  const [releases, tickets, ticks, failures, profiles] = await Promise.all([
    db.select({ id: goliveReleases.id, name: goliveReleases.name, source: goliveReleases.source, createdAt: goliveReleases.createdAt, appPushedAt: goliveReleases.appPushedAt })
      .from(goliveReleases).where(period),
    db.select({
      id: goliveTickets.id, releaseId: goliveTickets.releaseId, assignee: goliveTickets.assignee, assigneeUserId: goliveTickets.assigneeUserId,
      doneAt: goliveTickets.doneAt, skippedAt: goliveTickets.skippedAt, skippedBy: goliveTickets.skippedBy, skipKind: goliveTickets.skipKind,
      failedAt: goliveTickets.failedAt, webStatus: goliveTickets.webStatus, webAt: goliveTickets.webAt,
    }).from(goliveTickets).where(inPeriod(goliveTickets.releaseId)),
    db.select({
      ticketId: goliveDeviceChecks.ticketId,
      devices: sql<number>`count(*)`,
      lastCheckedAt: sql<string>`max(${goliveDeviceChecks.checkedAt})`,
    }).from(goliveDeviceChecks)
      .where(sql`${goliveDeviceChecks.ticketId} in (select ${goliveTickets.id} from ${goliveTickets} where ${inPeriod(goliveTickets.releaseId)})`)
      .groupBy(goliveDeviceChecks.ticketId),
    db.select({ ticketId: goliveTicketFailures.ticketId, phase: goliveTicketFailures.phase })
      .from(goliveTicketFailures).where(inPeriod(goliveTicketFailures.releaseId)),
    db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
  ]);
  const ticksById = new Map(ticks.map(tick => [tick.ticketId, tick]));
  return qeScorecard({
    releases, failures, profiles, qeRoles, matchAccount, normalizeName,
    tickets: tickets.map(ticket => {
      const tick = ticksById.get(ticket.id);
      return { ...ticket, testedDevices: tick?.devices ?? 0, lastCheckedAt: tick?.lastCheckedAt ?? null };
    }),
  });
}

// Read-only reporting: unlike /api/golive this never re-derives Done, so a Manager opening the
// report cannot move a ticket. It shows exactly what the testers have already recorded.
export async function GET(request: Request) {
  const access = await requireReporter();
  if ("response" in access) return access.response;
  const db = access.db;
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "qe") {
    try {
      return json(await qeReport(db, params.get("from") || "", params.get("to") || ""));
    } catch (e) {
      // historyDateBounds rejects a malformed or inverted range; that is the caller's mistake, not ours.
      const message = e instanceof Error ? e.message : "";
      if (message.startsWith("Ngày")) return json({ error: message }, 400);
      return json({ error: "Không thể tải số liệu QE." }, 500);
    }
  }
  try {
    const releaseId = params.get("release") || "";
    if (releaseId) {
      // One round trip each: the tickets, how many devices each one has ticked so far, and the web sign-offs.
      const [rows, ticks, profiles, signoffs, [release]] = await Promise.all([
        db.select().from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)).orderBy(goliveTickets.id),
        db.select({
          ticketId: goliveDeviceChecks.ticketId,
          devices: sql<number>`count(*)`,
          // The tester's last tick is the moment they finished the ticket on their devices.
          lastCheckedAt: sql<string>`max(${goliveDeviceChecks.checkedAt})`,
        }).from(goliveDeviceChecks)
          .where(sql`${goliveDeviceChecks.ticketId} in (select ${goliveTickets.id} from ${goliveTickets} where ${goliveTickets.releaseId} = ${releaseId})`)
          .groupBy(goliveDeviceChecks.ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
        db.select({ userId: goliveWebSignoffs.userId, signedAt: goliveWebSignoffs.signedAt }).from(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
        db.select({ source: goliveReleases.source, createdAt: goliveReleases.createdAt }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
      ]);
      const progress = webProgress(release ?? { source: "manual", createdAt: "" }, profiles, qeRoles, rows, signoffs);
      const web = webRoster(progress.qe, Object.entries(progress.signed).map(([userId, signedAt]) => ({ userId, signedAt })));
      const tickets = rows.map(ticket => {
        const tick = ticks.find(item => item.ticketId === ticket.id);
        return {
          id: ticket.id, issueKey: ticket.issueKey, summary: ticket.summary,
          assignee: ticket.assignee,
          assigneeUserId: ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null),
          doneAt: ticket.doneAt, skippedAt: ticket.skippedAt, skippedBy: ticket.skippedBy, skipKind: ticket.skipKind,
          failedAt: ticket.failedAt, failedBy: ticket.failedBy, failedReason: ticket.failedReason,
          webStatus: ticket.webStatus, webAt: ticket.webAt, webBy: ticket.webBy, webReason: ticket.webReason,
          testedDevices: tick?.devices ?? 0, lastCheckedAt: tick?.lastCheckedAt ?? null,
        };
      });
      return json({ releaseId, tickets, web });
    }
    const [rows, counts, profiles, signoffs, webTickets] = await Promise.all([
      db.select().from(goliveReleases).orderBy(desc(goliveReleases.createdAt)),
      db.select({
        releaseId: goliveTickets.releaseId,
        total: sql<number>`count(*)`,
        done: sql<number>`sum(case when ${goliveTickets.doneAt} is null then 0 else 1 end)`,
        failed: sql<number>`sum(case when ${goliveTickets.failedAt} is null then 0 else 1 end)`,
      }).from(goliveTickets).groupBy(goliveTickets.releaseId),
      db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
      db.select({ releaseId: goliveWebSignoffs.releaseId, userId: goliveWebSignoffs.userId, signedAt: goliveWebSignoffs.signedAt }).from(goliveWebSignoffs),
      db.select({ releaseId: goliveTickets.releaseId, assignee: goliveTickets.assignee, assigneeUserId: goliveTickets.assigneeUserId, webStatus: goliveTickets.webStatus, webAt: goliveTickets.webAt }).from(goliveTickets),
    ]);
    const releases = rows.map(release => {
      const count = counts.find(item => item.releaseId === release.id);
      const progress = webProgress(release, profiles, qeRoles, webTickets.filter(ticket => ticket.releaseId === release.id), signoffs.filter(row => row.releaseId === release.id));
      // Same rule as the board: unowned tickets keep the web phase open until the app is pushed.
      const web = { ...webSummary(progress.qe.map(person => person.userId), Object.keys(progress.signed)), done: progress.done };
      return { ...release, total: count?.total ?? 0, done: Number(count?.done ?? 0), failed: Number(count?.failed ?? 0), web };
    });
    return json({ releases });
  } catch {
    return json({ error: "Không thể tải số liệu golive." }, 500);
  }
}

// Reminds the tester of each ticket the Manager ticked in the report. Tickets of one tester are
// summarised into a single notification, and a ticket finished since it was ticked is left alone.
export async function POST(request: Request) {
  const access = await requireReporter();
  if ("response" in access) return access.response;
  const db = access.db;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Dữ liệu không hợp lệ." }, 400); }
  if (body.action !== "notify-untested") return json({ error: "Thao tác không được hỗ trợ." }, 400);
  const releaseId = typeof body.releaseId === "string" ? body.releaseId.trim().slice(0, 60) : "";
  const ids = Array.from(new Set((Array.isArray(body.ticketIds) ? body.ticketIds : []).map(Number).filter(Number.isInteger))).slice(0, 200);
  if (!releaseId || !ids.length) return json({ error: "Chưa chọn ticket nào để nhắc." }, 400);
  try {
    const [rows, profiles] = await Promise.all([
      db.select({ issueKey: goliveTickets.issueKey, assignee: goliveTickets.assignee, assigneeUserId: goliveTickets.assigneeUserId })
        .from(goliveTickets)
        .where(and(eq(goliveTickets.releaseId, releaseId), inArray(goliveTickets.id, ids), isNull(goliveTickets.doneAt)))
        .orderBy(goliveTickets.id),
      db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
    ]);
    const owned = rows.map(row => ({ issueKey: row.issueKey, userId: row.assigneeUserId ?? (row.assignee ? matchAccount(profiles, row.assignee) : null) }));
    const notices = untestedNotices(owned);
    const unmatched = owned.filter(row => !row.userId).map(row => row.issueKey);
    // A ticket that turned Done between the tick and the send is dropped rather than reminded about.
    const alreadyDone = ids.length - rows.length;
    if (!notices.length) return json({ error: "Không có ticket nào để nhắc: người test chưa khớp tài khoản hoặc ticket đã Done.", unmatched, alreadyDone }, 409);
    if (!await pushEnabled(db, "remind-untested")) return json({ error: "Nhắc nhở qua thông báo đang bị tắt trong cài đặt." }, 409);
    for (const notice of notices) {
      waitUntil(notifyUsers(db, [notice.userId], { event: "remind-untested", title: "Ticket chưa được test", body: notice.body, link: "/?tab=golive" }));
    }
    return json({ notified: notices.length, tickets: notices.reduce((total, notice) => total + notice.issueKeys.length, 0), unmatched, alreadyDone });
  } catch {
    return json({ error: "Không thể gửi thông báo." }, 500);
  }
}
