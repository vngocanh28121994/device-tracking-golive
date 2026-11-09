import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requireMember } from "../../lib/member-access";
import { getDb } from "../../../db";
import { devices, goliveDeviceChecks, goliveReleases, goliveTicketDevices, goliveTicketFailures, goliveTickets, goliveWebSignoffs, userProfiles } from "../../../db/schema";
import { inAppPhase, isWebStatus, matchAccount, webProgress } from "../../lib/golive";
import { waitUntil } from "cloudflare:workers";
import { accountRoles, appPushRoles, canPushApp, isManager, isQe, managerRoles, qeRoles } from "../../lib/roles";
import { notifyRoles, notifyUsers, pushEnabled } from "../../lib/push";

type Db = ReturnType<typeof getDb>;
const MAX_COMPLETED = 10;
// Drizzle binds 13 values per ticket, including defaults. Keep each statement below D1's 100-parameter limit.
const TICKET_INSERT_BATCH_SIZE = 5;
// A failure log row binds 5 values; the same D1 parameter limit caps a bulk mark's inserts.
const FAILURE_INSERT_BATCH_SIZE = 15;
type Profile = { userId: string; displayName: string };

// Managers and PMs follow progress; everyone hears when a phase or the release is finished.
const WATCHERS = [...managerRoles, "PM"], EVERYONE = [...accountRoles];

// A QE is announced once their last open ticket of the release is Done; the last open ticket announces the release.
// ponytail: two loads racing on the same ticket can announce twice; add a claimed flag if that gets noisy.
async function announceDone(db: Db, releaseId: string, releaseName: string, done: { assignee: string }[]) {
  const open = await db.select({ assignee: goliveTickets.assignee }).from(goliveTickets).where(and(eq(goliveTickets.releaseId, releaseId), isNull(goliveTickets.doneAt)));
  const finished = Array.from(new Set(done.map(item => item.assignee).filter(name => name && !open.some(row => row.assignee === name))));
  for (const name of finished) await notifyRoles(db, WATCHERS, { event: "qe-done", title: "QE đã test xong", body: name + " đã test xong đợt " + releaseName + "." });
  if (!open.length) await notifyRoles(db, EVERYONE, { event: "all-done", title: "Golive đã test xong", body: "Tất cả đã test xong đợt " + releaseName + ". Manager có thể bấm Hoàn thành." });
}

type DeviceRow = { id: string; name: string; category: string; holder: string; holderUserId: string | null };
const activeDevices = (db: Db) => db.select({ id: devices.id, name: devices.name, category: devices.category, holder: devices.holder, holderUserId: devices.holderUserId }).from(devices).where(eq(devices.archived, false));

// Same rule as the inventory: legacy rows without holder_user_id match a unique display name.
function devicesHeldBy(rows: DeviceRow[], profiles: Profile[], userIds: string[]) {
  const held = new Map<string, { id: string; name: string; category: string }[]>(userIds.map(id => [id, []]));
  for (const row of rows) {
    const owner = row.holderUserId ?? matchAccount(profiles, row.holder);
    if (owner) held.get(owner)?.push({ id: row.id, name: row.name, category: row.category });
  }
  return held;
}
const clean = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const noStore = { headers: { "Cache-Control": "private, no-store" } };

const inRelease = (column: typeof goliveDeviceChecks.ticketId | typeof goliveTicketDevices.ticketId, releaseId: string) =>
  sql`${column} in (select ${goliveTickets.id} from ${goliveTickets} where ${goliveTickets.releaseId} = ${releaseId})`;

// Loads a release and, while it is running, brings each open ticket up to date:
// a ticket becomes Done once the tester has ticked every device they hold right now.
// Devices handed to someone else no longer count. Done is sticky until a tick is removed.
// Pass ticketId to bring a single ticket up to date instead of the whole release.
// Reads run in parallel and writes go out as one batch: every D1 call is a network round trip.
async function loadRelease(db: Db, releaseId: string, now = new Date().toISOString(), ticketId?: number) {
  if (!releaseId) return { tickets: [], held: new Map<string, { id: string; name: string; category: string }[]>(), checks: [] };
  const [rows, [release], profiles, deviceRows, checks] = await Promise.all([
    db.select().from(goliveTickets).where(ticketId === undefined ? eq(goliveTickets.releaseId, releaseId) : eq(goliveTickets.id, ticketId)).orderBy(goliveTickets.id),
    db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
    db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
    activeDevices(db),
    db.select().from(goliveDeviceChecks).where(ticketId === undefined ? inRelease(goliveDeviceChecks.ticketId, releaseId) : eq(goliveDeviceChecks.ticketId, ticketId)),
  ]);
  // Testers who create an account after the import are matched on every load.
  const tickets = rows.map(item => ({ ...item, assigneeUserId: item.assigneeUserId ?? (item.assignee ? matchAccount(profiles, item.assignee) : null) }));
  const testerIds = Array.from(new Set(tickets.flatMap(item => item.assigneeUserId ? [item.assigneeUserId] : [])));
  const held = devicesHeldBy(deviceRows, profiles, testerIds);
  if (release && !release.completedAt) {
    const doneIds: number[] = [];
    for (const ticket of tickets) {
      if (ticket.doneAt || ticket.failedAt || !ticket.assigneeUserId) continue;
      const ticked = new Set(checks.filter(item => item.ticketId === ticket.id).map(item => item.deviceId));
      const required = held.get(ticket.assigneeUserId) || [];
      if (required.length > 0 && required.every(device => ticked.has(device.id))) { ticket.doneAt = now; doneIds.push(ticket.id); }
    }
    // D1 caps bound parameters per statement, so updates go in chunks of one batch.
    const writes = [];
    for (let i = 0; i < doneIds.length; i += 90) writes.push(db.update(goliveTickets).set({ doneAt: now }).where(inArray(goliveTickets.id, doneIds.slice(i, i + 90))));
    if (writes.length) await db.batch(writes as [typeof writes[number], ...typeof writes]);
    if (doneIds.length) waitUntil(announceDone(db, releaseId, release.name, tickets.filter(item => doneIds.includes(item.id))));
  }
  return { tickets, held, checks };
}

// The ticket and whether its release is completed, in one round trip.
const ticketWithRelease = (db: Db, ticketId: number) =>
  db.select({ ticket: goliveTickets, completedAt: goliveReleases.completedAt, releaseName: goliveReleases.name }).from(goliveTickets).innerJoin(goliveReleases, eq(goliveReleases.id, goliveTickets.releaseId)).where(eq(goliveTickets.id, ticketId));

async function webPhase(db: Db, releaseId: string): Promise<{ qe: { userId: string; displayName: string; role: string }[]; signed: Record<string, string>; appPushedAt: string | null; appPushedBy: string | null }> {
  if (!releaseId) return { qe: [], signed: {}, appPushedAt: null, appPushedBy: null };
  const [[release], profiles, tickets, signoffs] = await Promise.all([
    db.select({ source: goliveReleases.source, createdAt: goliveReleases.createdAt, appPushedAt: goliveReleases.appPushedAt, appPushedBy: goliveReleases.appPushedBy }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
    db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles).orderBy(userProfiles.displayName),
    db.select({ assignee: goliveTickets.assignee, assigneeUserId: goliveTickets.assigneeUserId, webStatus: goliveTickets.webStatus, webAt: goliveTickets.webAt }).from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
    db.select().from(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
  ]);
  return release ? { ...webProgress(release, profiles, qeRoles, tickets, signoffs), appPushedAt: release.appPushedAt, appPushedBy: release.appPushedBy } : { qe: [], signed: {}, appPushedAt: null, appPushedBy: null };
}

// Web outcomes lock once every QE is done with web; the app checklist opens only after the app build is pushed.
// Between the two the release waits for the build: neither column can be edited.
const webDoneOf = (web: Awaited<ReturnType<typeof webPhase>>) => inAppPhase(web.qe.map(person => person.userId), Object.keys(web.signed));
const appPhaseOf = (web: Awaited<ReturnType<typeof webPhase>>) => webDoneOf(web) && !!web.appPushedAt;
function announceWebProgress(db: Db, releaseName: string, before: Awaited<ReturnType<typeof webPhase>>, after: Awaited<ReturnType<typeof webPhase>>) {
  for (const person of after.qe) {
    if (person.userId in before.signed || !(person.userId in after.signed)) continue;
    waitUntil(notifyRoles(db, WATCHERS, { event: "web-qe-done", title: "QE đã xong test web", body: person.displayName + " đã hoàn thành test web đợt " + releaseName + "." }));
  }
  if (!webDoneOf(before) && webDoneOf(after)) {
    waitUntil(notifyRoles(db, appPushRoles, { event: "web-all-done", title: "Test web hoàn tất", body: "Tất cả QE đã test xong web đợt " + releaseName + ". Có thể build và push app." }));
  }
}

const WEB_PHASE_ONLY = "Phase app chưa mở: cần tất cả QE hoàn thành test web và App Manager xác nhận đã push app.";
const APP_PHASE_ONLY = "Đợt golive đã sang giai đoạn 2 · Test app, không sửa phase web được nữa.";

async function deleteRelease(db: Db, releaseId: string) {
  await db.batch([
    db.delete(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
    db.delete(goliveTicketFailures).where(eq(goliveTicketFailures.releaseId, releaseId)),
    db.delete(goliveDeviceChecks).where(inRelease(goliveDeviceChecks.ticketId, releaseId)),
    db.delete(goliveTicketDevices).where(inRelease(goliveTicketDevices.ticketId, releaseId)),
    db.delete(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
    db.delete(goliveReleases).where(eq(goliveReleases.id, releaseId)),
  ]);
}

export async function GET(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  try {
    const db = getDb();
    const requested = new URL(request.url).searchParams.get("release") || "";
    // A requested release loads alongside the list; otherwise the list decides the default.
    const [rows, counts, preloaded] = await Promise.all([
      db.select().from(goliveReleases).orderBy(desc(goliveReleases.createdAt)),
      db.select({ releaseId: goliveTickets.releaseId, count: sql<number>`count(*)` }).from(goliveTickets).groupBy(goliveTickets.releaseId),
      requested ? loadRelease(db, requested) : null,
    ]);
    const releases = rows.map(item => ({ ...item, ticketCount: counts.find(row => row.releaseId === item.id)?.count ?? 0 }));
    // Open the newest running release by default; history is opened explicitly.
    // A release deleted by someone else falls back to the default one.
    const found = releases.some(item => item.id === requested);
    const releaseId = found ? requested : releases.find(item => !item.completedAt)?.id || "";
    const [{ tickets, held, checks }, web] = await Promise.all([found && preloaded ? preloaded : loadRelease(db, releaseId), webPhase(db, releaseId)]);
    return Response.json({ releases, releaseId, tickets, devicesByUser: Object.fromEntries(held), checks, web }, noStore);
  } catch {
    return error("Không thể tải danh sách golive.", 500);
  }
}

export async function POST(request: Request) {
  const access = await requireMember();
  if ("response" in access) return access.response;
  const user = access.user;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error("Dữ liệu không hợp lệ."); }
  try {
    const db = getDb();
    const now = new Date().toISOString();
    // The first "Test Failed" of a ticket in a phase is remembered for the Statistic report, which
    // has to count a ticket that failed and later passed. Unmarking or re-testing leaves the row
    // behind on purpose: nothing tells a mistaken mark apart from a failure that was really fixed.
    const failureLog = (rows: { ticketId: number; phase: "web" | "app"; releaseId: string; failedBy: string; failedAt: string }[]) =>
      db.insert(goliveTicketFailures).values(rows).onConflictDoNothing();
    if (body.action === "create-manual") {
      const name = clean(body.name, 120), fixVersion = clean(body.fixVersion, 120);
      if (name.length < 2 || !fixVersion) return error("Nhập tên đợt golive (ít nhất 2 ký tự) và fixVersion.");
      const testers = await db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.role, qeRoles));
      if (!testers.length) return error("Chưa có tài khoản QE. Hãy nhờ Manager gán role trong Tài khoản của tôi trước.");
      const [profile] = await db.select({ displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId));
      const id = crypto.randomUUID();
      const rows = testers.map((tester, index) => ({ releaseId: id, issueKey: "QE-" + (index + 1), summary: fixVersion, assignee: tester.displayName, assigneeUserId: tester.userId, updatedAt: now }));
      await db.batch([
        db.insert(goliveReleases).values({ id, name, fixVersion, source: "manual", createdBy: profile?.displayName || user.displayName || user.email, createdAt: now }),
        ...Array.from({ length: Math.ceil(rows.length / TICKET_INSERT_BATCH_SIZE) }, (_, index) => db.insert(goliveTickets).values(rows.slice(index * TICKET_INSERT_BATCH_SIZE, (index + 1) * TICKET_INSERT_BATCH_SIZE))),
      ]);
      await loadRelease(db, id, now);
      return Response.json({ releaseId: id, count: testers.length });
    }
    if (body.action === "import") {
      const name = clean(body.name, 120);
      if (name.length < 2) return error("Hãy đặt tên cho đợt golive (ít nhất 2 ký tự).");
      const rows = Array.isArray(body.tickets) ? body.tickets : [];
      const seen = new Set<string>();
      const tickets = rows.map(row => {
        const item = row as Record<string, unknown>;
        return { issueKey: clean(item.issueKey, 40), summary: clean(item.summary, 500), assignee: clean(item.assignee, 80) };
      }).filter(item => item.issueKey && !seen.has(item.issueKey) && seen.add(item.issueKey));
      if (tickets.length === 0) return error("Không tìm thấy ticket nào có Issue Key.");
      if (tickets.length > 1000) return error("Mỗi đợt golive tối đa 1000 ticket.");
      const profiles = await db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles);
      const profile = profiles.find(person => person.userId === user.userId);
      const id = crypto.randomUUID();
      // D1 caps bound parameters per statement, so tickets go in chunks of one batch.
      await db.batch([
        db.insert(goliveReleases).values({ id, name, createdBy: profile?.displayName || user.displayName || user.email, createdAt: now }),
        ...Array.from({ length: Math.ceil(tickets.length / TICKET_INSERT_BATCH_SIZE) }, (_, index) => db.insert(goliveTickets).values(tickets.slice(index * TICKET_INSERT_BATCH_SIZE, (index + 1) * TICKET_INSERT_BATCH_SIZE).map(item => ({ ...item, assigneeUserId: item.assignee ? matchAccount(profiles, item.assignee) : null, releaseId: id, updatedAt: now })))),
      ]);
      return Response.json({ releaseId: id, count: tickets.length });
    }
    if (body.action === "toggle-check") {
      const ticketId = Number(body.ticketId), deviceId = clean(body.deviceId, 120);
      const [[found], profiles, deviceRows] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
        body.checked === false ? [] : activeDevices(db),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt } = found;
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester !== user.userId) return error("Chỉ người test của ticket này mới được tích checklist.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa checklist.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      if (ticket.skippedAt && ticket.skipKind !== "tested") return error("Ticket đã được đánh dấu không cần test hoặc không test được. Hãy thu hồi trước khi tích checklist.", 409);
      if (body.checked === false) {
        await db.batch([
          db.delete(goliveDeviceChecks).where(and(eq(goliveDeviceChecks.ticketId, ticketId), eq(goliveDeviceChecks.deviceId, deviceId))),
          // A ticket confirmed as tested stays Done; ticks then only record which devices were used.
          ...(ticket.skippedAt ? [] : [db.update(goliveTickets).set({ doneAt: null }).where(eq(goliveTickets.id, ticketId))]),
        ]);
      } else {
        const device = devicesHeldBy(deviceRows, profiles, [user.userId]).get(user.userId)?.find(item => item.id === deviceId);
        if (!device) return error("Bạn không còn cầm thiết bị này. Nếu đã test xong, hãy bấm “Đã test xong”.", 409);
        await db.insert(goliveDeviceChecks).values({ ticketId, deviceId, deviceName: device.name, checkedByUserId: user.userId, checkedAt: now }).onConflictDoNothing();
      }
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId);
      return Response.json({ doneAt: tickets[0]?.doneAt ?? null });
    }
    if (body.action === "skip-test") {
      const ticketId = Number(body.ticketId), skipped = body.skipped !== false;
      const kind = body.kind === "tested" || body.kind === "cannot-test" ? body.kind : "not-needed";
      const reason = kind === "cannot-test" ? clean(body.reason, 500) : "", notified = kind === "cannot-test" && body.notified === true;
      if (skipped && kind === "cannot-test" && !reason) return error("Hãy nhập lý do không test được.");
      const [[found], profiles] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt } = found;
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      // A tester without an account (or an outside helper) cannot act, so anyone signed in may mark that ticket.
      if (tester && tester !== user.userId && !isManager(me?.role)) return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      const by = me?.displayName || user.displayName || user.email;
      // Undoing clears Done too; the next load marks it Done again if every device is already ticked.
      await db.update(goliveTickets).set(skipped
        ? { skippedAt: now, skippedBy: by, skipKind: kind, skipReason: reason, skipNotified: notified, doneAt: now, failedAt: null, failedBy: null, failedReason: "" }
        : { skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false, doneAt: null }).where(eq(goliveTickets.id, ticketId));
      if (skipped) waitUntil(announceDone(db, ticket.releaseId, found.releaseName, [ticket]));
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId);
      const updated = tickets[0];
      return Response.json({ doneAt: updated?.doneAt ?? null, failedAt: updated?.failedAt ?? null, failedBy: updated?.failedBy ?? null, failedReason: updated?.failedReason ?? "", skippedAt: updated?.skippedAt ?? null, skippedBy: updated?.skippedBy ?? null, skipKind: updated?.skipKind ?? "not-needed", skipReason: updated?.skipReason ?? "", skipNotified: updated?.skipNotified ?? false });
    }
    if (body.action === "fail-test") {
      const ticketId = Number(body.ticketId), failed = body.failed !== false, reason = clean(body.reason, 500);
      if (failed && !reason) return error("Hãy nhập lý do test failed.");
      const [[found], profiles] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt } = found;
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester && tester !== user.userId && !isManager(me?.role)) return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      const by = me?.displayName || user.displayName || user.email;
      // Failing a ticket takes Done away and clears any skip mark; undoing lets the next load decide
      // Done again from the device ticks, exactly as undoing a skip does.
      const write = db.update(goliveTickets).set(failed
        ? { failedAt: now, failedBy: by, failedReason: reason, doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false }
        : { failedAt: null, failedBy: null, failedReason: "" }).where(eq(goliveTickets.id, ticketId));
      // The failure is logged for the Statistic report; undoing the mark leaves the log alone.
      if (failed) await db.batch([write, failureLog([{ ticketId, phase: "app", releaseId: ticket.releaseId, failedBy: by, failedAt: now }])]);
      else await write;
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId);
      const updated = tickets[0];
      return Response.json({ doneAt: updated?.doneAt ?? null, failedAt: updated?.failedAt ?? null, failedBy: updated?.failedBy ?? null, failedReason: updated?.failedReason ?? "", skippedAt: updated?.skippedAt ?? null, skippedBy: updated?.skippedBy ?? null, skipKind: updated?.skipKind ?? "not-needed", skipReason: updated?.skipReason ?? "", skipNotified: updated?.skipNotified ?? false });
    }
    // Bulk update: one of the four outcomes for many tickets of one release, in the phase it is in.
    // Same rules as the single-ticket actions; tickets the user may not mark are left alone and counted.
    if (body.action === "bulk-status") {
      const releaseId = clean(body.releaseId, 60), phase: "web" | "app" = body.phase === "web" ? "web" : "app";
      const status = isWebStatus(body.status) ? body.status : null;
      if (!status) return error("Trạng thái không hợp lệ.");
      const ids = Array.from(new Set((Array.isArray(body.ticketIds) ? body.ticketIds : []).map(Number).filter(Number.isInteger))).slice(0, 1000);
      if (!ids.length) return error("Chưa chọn ticket nào.");
      const reason = status === "cannot-test" || status === "failed" ? clean(body.reason, 500) : "", notified = status === "cannot-test" && body.notified === true;
      if (status === "cannot-test" && !reason) return error("Hãy nhập lý do không test được.");
      if (status === "failed" && !reason) return error("Hãy nhập lý do test failed.");
      const [[release], profiles, rows, web] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name, source: goliveReleases.source }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
        db.select().from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
        webPhase(db, releaseId),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (release.source === "manual") return error("Đợt golive tạo tay không có ticket để cập nhật hàng loạt.", 409);
      if (phase === "app" && !appPhaseOf(web)) return error(WEB_PHASE_ONLY, 409);
      if (phase === "web" && webDoneOf(web)) return error(APP_PHASE_ONLY, 409);
      const me = profiles.find(item => item.userId === user.userId);
      const picked = rows.filter(row => ids.includes(row.id));
      const allowed = picked.filter(row => {
        const tester = row.assigneeUserId ?? (row.assignee ? matchAccount(profiles, row.assignee) : null);
        return !tester || tester === user.userId || isManager(me?.role);
      });
      if (!allowed.length) return error("Bạn không có quyền đánh dấu các ticket đã chọn. Chỉ người test của ticket hoặc Manager mới được đánh dấu.", 403);
      const by = me?.displayName || user.displayName || user.email;
      const values = phase === "web"
        ? { webStatus: status, webAt: now, webBy: by, webReason: reason, webNotified: notified }
        : status === "failed"
          ? { failedAt: now, failedBy: by, failedReason: reason, doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false }
          : { skippedAt: now, skippedBy: by, skipKind: status, skipReason: reason, skipNotified: notified, doneAt: now, failedAt: null, failedBy: null, failedReason: "" };
      const allowedIds = allowed.map(row => row.id);
      // D1 caps bound parameters per statement, so updates go in chunks of one batch.
      const writes = [];
      for (let i = 0; i < allowedIds.length; i += 90) writes.push(db.update(goliveTickets).set(values).where(inArray(goliveTickets.id, allowedIds.slice(i, i + 90))));
      if (status === "failed") {
        const logs = allowedIds.map(ticketId => ({ ticketId, phase, releaseId, failedBy: by, failedAt: now }));
        for (let i = 0; i < logs.length; i += FAILURE_INSERT_BATCH_SIZE) writes.push(failureLog(logs.slice(i, i + FAILURE_INSERT_BATCH_SIZE)));
      }
      await db.batch(writes as [typeof writes[number], ...typeof writes]);
      if (phase === "app" && status !== "failed") waitUntil(announceDone(db, releaseId, release.name, allowed));
      const updatedWeb = phase === "web" ? await webPhase(db, releaseId) : undefined;
      if (updatedWeb) announceWebProgress(db, release.name, web, updatedWeb);
      return Response.json({ updated: allowedIds, values, web: updatedWeb, skipped: picked.length - allowed.length, missing: ids.length - picked.length });
    }
    if (body.action === "web-status") {
      const ticketId = Number(body.ticketId), status = body.status === null ? null : isWebStatus(body.status) ? body.status : undefined;
      if (status === undefined) return error("Trạng thái phase web không hợp lệ.");
      const reason = status === "cannot-test" || status === "failed" ? clean(body.reason, 500) : "";
      if (status === "cannot-test" && !reason) return error("Hãy nhập lý do không test được.");
      if (status === "failed" && !reason) return error("Hãy nhập lý do test failed.");
      const [[found], profiles] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt, releaseName } = found;
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester && tester !== user.userId && !isManager(me?.role)) return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      const before = await webPhase(db, ticket.releaseId);
      if (webDoneOf(before)) return error(APP_PHASE_ONLY, 409);
      const by = me?.displayName || user.displayName || user.email;
      const values = status
        ? { webStatus: status, webAt: now, webBy: by, webReason: reason, webNotified: status === "cannot-test" && body.notified === true }
        : { webStatus: null, webAt: null, webBy: null, webReason: "", webNotified: false };
      const write = db.update(goliveTickets).set(values).where(eq(goliveTickets.id, ticketId));
      if (status === "failed") await db.batch([write, failureLog([{ ticketId, phase: "web", releaseId: ticket.releaseId, failedBy: by, failedAt: now }])]);
      else await write;
      const web = await webPhase(db, ticket.releaseId);
      announceWebProgress(db, releaseName, before, web);
      return Response.json({ ...values, web });
    }
    if (body.action === "web-signoff") {
      const releaseId = clean(body.releaseId, 60), done = body.done !== false;
      const [[release], [me]] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name, source: goliveReleases.source }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!isQe(me?.role)) return error("Chỉ tài khoản QE mới xác nhận hoàn thành test web.", 403);
      if (release.source !== "manual") return Response.json({ web: await webPhase(db, releaseId) });
      const before = await webPhase(db, releaseId);
      if (!done && before.appPushedAt) return error("App đã được push, không thu hồi xác nhận test web được nữa.", 409);
      if (done) await db.insert(goliveWebSignoffs).values({ releaseId, userId: user.userId, signedAt: now }).onConflictDoNothing();
      else await db.delete(goliveWebSignoffs).where(and(eq(goliveWebSignoffs.releaseId, releaseId), eq(goliveWebSignoffs.userId, user.userId)));
      const web = await webPhase(db, releaseId);
      announceWebProgress(db, release.name, before, web);
      return Response.json({ web });
    }
    // The App Manager (or a Manager) marks the app build as pushed: the app checklist opens and the testers hear.
    // again: a rebuilt app replaces the pushed one; ticks and Done stay, the testers are told to install it.
    // undo: a push tapped by mistake; the release goes back to waiting for the build, ticks are kept.
    if (body.action === "app-pushed") {
      const releaseId = clean(body.releaseId, 60), mode = body.undo === true ? "undo" : body.again === true ? "again" : "first";
      const [[release], [me], web] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ role: userProfiles.role, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
        webPhase(db, releaseId),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!canPushApp(me?.role)) return error("Chỉ App Manager hoặc Manager mới xác nhận đã push app.", 403);
      if (mode === "undo") {
        if (!web.appPushedAt) return Response.json({ web });
        await db.update(goliveReleases).set({ appPushedAt: null, appPushedBy: null }).where(eq(goliveReleases.id, releaseId));
        return Response.json({ web: { ...web, appPushedAt: null, appPushedBy: null } });
      }
      if (!webDoneOf(web)) return error("Chưa thể push app: còn QE chưa hoàn thành test web.", 409);
      // A double tap or a second Manager must not re-announce: only an explicit "again" pushes over a push.
      if (web.appPushedAt && mode === "first") return Response.json({ web });
      if (!web.appPushedAt && mode === "again") return error("App chưa được push lần nào.", 409);
      const by = me?.displayName || user.displayName || user.email;
      await db.update(goliveReleases).set({ appPushedAt: now, appPushedBy: by }).where(eq(goliveReleases.id, releaseId));
      waitUntil(notifyUsers(db, web.qe.map(person => person.userId), mode === "again"
        ? { event: "app-pushed", title: "Có bản app mới", body: by + " đã push bản app mới đợt " + release.name + ". Cài lại bản mới trước khi test tiếp.", link: "/?tab=golive" }
        : { event: "app-pushed", title: "App đã sẵn sàng để test", body: by + " đã push app đợt " + release.name + ". Bắt đầu test app trên thiết bị của bạn.", link: "/?tab=golive" }));
      return Response.json({ web: { ...web, appPushedAt: now, appPushedBy: by } });
    }
    if (body.action === "remind-web") {
      const releaseId = clean(body.releaseId, 60);
      const [[me], web, [release]] = await Promise.all([
        db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
        webPhase(db, releaseId),
        db.select({ name: goliveReleases.name }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
      ]);
      if (!isManager(me?.role)) return error("Chỉ Manager mới được nhắc nhở.", 403);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      const pending = web.qe.filter(person => !(person.userId in web.signed)).map(person => person.userId);
      if (!await pushEnabled(db, "remind-web")) return error("Nhắc nhở qua thông báo đang bị tắt trong cài đặt.", 409);
      waitUntil(notifyUsers(db, pending, { event: "remind-web", title: "Nhắc test web", body: "Bạn chưa hoàn thành test web đợt " + release.name + "." }));
      return Response.json({ pending: pending.length });
    }
    if (body.action === "complete-release") {
      const releaseId = clean(body.releaseId, 60);
      const [release] = await db.select().from(goliveReleases).where(eq(goliveReleases.id, releaseId));
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return Response.json({ release });
      const { tickets } = await loadRelease(db, releaseId, now);
      const unfinished = tickets.filter(item => !item.doneAt).map(item => ({ issueKey: item.issueKey, summary: item.summary, assignee: item.assignee }));
      if (unfinished.length) return Response.json({ error: "Còn " + unfinished.length + (release.source === "manual" ? " người test" : " ticket") + " chưa Done.", unfinished }, { status: 409 });
      const [profile] = await db.select({ displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId));
      const [updated] = await db.update(goliveReleases).set({ completedAt: now, completedBy: profile?.displayName || user.displayName || user.email }).where(eq(goliveReleases.id, releaseId)).returning();
      waitUntil(notifyRoles(db, EVERYONE, { event: "release-completed", title: "Golive hoàn thành 🎉", body: "Đợt " + release.name + " đã hoàn thành." }));
      // History keeps only the newest completed releases.
      const completed = await db.select({ id: goliveReleases.id }).from(goliveReleases).where(isNotNull(goliveReleases.completedAt)).orderBy(desc(goliveReleases.completedAt));
      for (const old of completed.slice(MAX_COMPLETED)) await deleteRelease(db, old.id);
      return Response.json({ release: updated, pruned: Math.max(0, completed.length - MAX_COMPLETED) });
    }
    if (body.action === "delete-release") {
      await deleteRelease(db, clean(body.releaseId, 60));
      return Response.json({ ok: true });
    }
    return error("Thao tác không được hỗ trợ.");
  } catch {
    return error("Không thể lưu thay đổi.", 500);
  }
}
