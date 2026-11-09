import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requireMember } from "../../lib/member-access";
import { getDb } from "../../../db";
import { devices, goliveBuilds, goliveDeviceChecks, goliveReleases, goliveRiskAcceptances, goliveTicketDevices, goliveTicketEvents, goliveTicketFailures, goliveTickets, goliveWebSignoffs, userProfiles } from "../../../db/schema";
import { isWebStatus, matchAccount, UnownedTicket, webProgress } from "../../lib/golive";
import { waitUntil } from "cloudflare:workers";
import { accountRoles, appPushRoles, canPushApp, isManager, isQe, managerRoles, qeRoles } from "../../lib/roles";
import { notifyRoles, notifyUsers, pushEnabled } from "../../lib/push";
import { appEventStatus, attentionList, doneOnRequiredDevices, EventRow, eventRow, SYSTEM_ACTOR, webEventStatus } from "../../lib/golive-acceptance";

type Db = ReturnType<typeof getDb>;
// Drizzle binds 13 values per ticket, including defaults. Keep each statement below D1's 100-parameter limit.
const TICKET_INSERT_BATCH_SIZE = 5;
// A failure log row binds 5 values; the same D1 parameter limit caps a bulk mark's inserts.
const FAILURE_INSERT_BATCH_SIZE = 15;
// A required-device row binds 6 values, an event row 10.
const REQUIRED_INSERT_BATCH_SIZE = 15;
const EVENT_INSERT_BATCH_SIZE = 9;
// Ids per IN (...) statement.
const ID_CHUNK = 90;
type Actor = { userId: string | null; name: string };

// The one place that turns event rows into insert statements, chunked under D1's parameter limit.
function eventStatements(db: Db, rows: EventRow[]) {
  const statements = [];
  for (let i = 0; i < rows.length; i += EVENT_INSERT_BATCH_SIZE) statements.push(db.insert(goliveTicketEvents).values(rows.slice(i, i + EVENT_INSERT_BATCH_SIZE)));
  return statements;
}
const chunks = <T,>(list: T[], size = ID_CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
const currentBuildOf = async (db: Db, releaseId: string) => (await db.select().from(goliveBuilds).where(eq(goliveBuilds.releaseId, releaseId)).orderBy(desc(goliveBuilds.id)).limit(1))[0] ?? null;
// The batch needs at least one statement; callers pass whatever they have.
async function runBatch(db: Db, writes: unknown[]) {
  if (writes.length) await db.batch(writes as [never, ...never[]]);
}
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
async function loadRelease(db: Db, releaseId: string, now = new Date().toISOString(), ticketId?: number, actor: Actor = SYSTEM_ACTOR) {
  const empty = { tickets: [], held: new Map<string, { id: string; name: string; category: string }[]>(), checks: [], required: [] as RequiredRow[], build: null as typeof goliveBuilds.$inferSelect | null };
  if (!releaseId) return empty;
  const [rows, [release], profiles, deviceRows, checks, requiredRows, build] = await Promise.all([
    db.select().from(goliveTickets).where(ticketId === undefined ? eq(goliveTickets.releaseId, releaseId) : eq(goliveTickets.id, ticketId)).orderBy(goliveTickets.id),
    db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name, appPushedAt: goliveReleases.appPushedAt }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
    db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
    activeDevices(db),
    db.select().from(goliveDeviceChecks).where(ticketId === undefined ? inRelease(goliveDeviceChecks.ticketId, releaseId) : eq(goliveDeviceChecks.ticketId, ticketId)),
    db.select({ ticketId: goliveTicketDevices.ticketId, deviceId: goliveTicketDevices.deviceId, deviceName: goliveTicketDevices.deviceName, waivedAt: goliveTicketDevices.waivedAt, waivedBy: goliveTicketDevices.waivedBy, waivedReason: goliveTicketDevices.waivedReason, archived: devices.archived })
      .from(goliveTicketDevices).leftJoin(devices, eq(devices.id, goliveTicketDevices.deviceId))
      .where(ticketId === undefined ? inRelease(goliveTicketDevices.ticketId, releaseId) : eq(goliveTicketDevices.ticketId, ticketId)),
    currentBuildOf(db, releaseId),
  ]);
  const required: RequiredRow[] = requiredRows.map(row => ({ ...row, archived: row.archived ?? true }));
  // Testers who create an account after the import are matched on every load.
  const tickets = rows.map(item => ({ ...item, assigneeUserId: item.assigneeUserId ?? (item.assignee ? matchAccount(profiles, item.assignee) : null) }));
  const testerIds = Array.from(new Set(tickets.flatMap(item => item.assigneeUserId ? [item.assigneeUserId] : [])));
  const held = devicesHeldBy(deviceRows, profiles, testerIds);
  if (release && !release.completedAt && release.appPushedAt) {
    // A ticket that is not Done and has no required list yet gets the devices its tester holds right now.
    // This also covers releases running at deploy time and testers whose account matched late.
    const snapshot: { ticketId: number; deviceId: string; deviceName: string }[] = [];
    for (const ticket of tickets) {
      if (ticket.doneAt || !ticket.assigneeUserId || required.some(row => row.ticketId === ticket.id)) continue;
      for (const device of held.get(ticket.assigneeUserId) || []) {
        snapshot.push({ ticketId: ticket.id, deviceId: device.id, deviceName: device.name });
        required.push({ ticketId: ticket.id, deviceId: device.id, deviceName: device.name, waivedAt: null, waivedBy: null, waivedReason: "", archived: false });
      }
    }
    // Done follows the required list, not what the tester holds now: handing a device over never finishes a ticket.
    // Done is sticky until a tick is removed.
    const doneIds: number[] = [];
    for (const ticket of tickets) {
      if (ticket.doneAt || ticket.failedAt || !ticket.assigneeUserId) continue;
      const ticked = checks.filter(item => item.ticketId === ticket.id).map(item => item.deviceId);
      if (doneOnRequiredDevices(required.filter(row => row.ticketId === ticket.id).map(row => ({ deviceId: row.deviceId, waived: !!row.waivedAt, archived: row.archived })), ticked)) {
        ticket.doneAt = now; ticket.appBuildId = build?.id ?? null; doneIds.push(ticket.id);
      }
    }
    // D1 caps bound parameters per statement, so writes go in chunks.
    const writes: unknown[] = [];
    for (const part of chunks(snapshot, REQUIRED_INSERT_BATCH_SIZE)) writes.push(db.insert(goliveTicketDevices).values(part).onConflictDoNothing());
    for (const part of chunks(doneIds)) writes.push(db.update(goliveTickets).set({ doneAt: now, appBuildId: build?.id ?? null }).where(inArray(goliveTickets.id, part)));
    writes.push(...eventStatements(db, doneIds.map(id => eventRow({ ticketId: id, releaseId, phase: "app", from: "open", to: "done-devices", buildId: build?.id, actor, now }))));
    await runBatch(db, writes);
    if (doneIds.length) waitUntil(announceDone(db, releaseId, release.name, tickets.filter(item => doneIds.includes(item.id))));
  }
  return { tickets, held, checks, required, build };
}
type RequiredRow = { ticketId: number; deviceId: string; deviceName: string; waivedAt: string | null; waivedBy: string | null; waivedReason: string; archived: boolean };

// The ticket and whether its release is completed, in one round trip.
const ticketWithRelease = (db: Db, ticketId: number) =>
  db.select({ ticket: goliveTickets, completedAt: goliveReleases.completedAt, releaseName: goliveReleases.name }).from(goliveTickets).innerJoin(goliveReleases, eq(goliveReleases.id, goliveTickets.releaseId)).where(eq(goliveTickets.id, ticketId));

type WebPhase = { qe: { userId: string; displayName: string; role: string }[]; signed: Record<string, string>; unowned: UnownedTicket[]; done: boolean; appPushedAt: string | null; appPushedBy: string | null };
const NO_WEB: WebPhase = { qe: [], signed: {}, unowned: [], done: false, appPushedAt: null, appPushedBy: null };
async function webPhase(db: Db, releaseId: string): Promise<WebPhase> {
  if (!releaseId) return NO_WEB;
  const [[release], profiles, tickets, signoffs] = await Promise.all([
    db.select({ source: goliveReleases.source, createdAt: goliveReleases.createdAt, appPushedAt: goliveReleases.appPushedAt, appPushedBy: goliveReleases.appPushedBy }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
    db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles).orderBy(userProfiles.displayName),
    db.select({ id: goliveTickets.id, issueKey: goliveTickets.issueKey, assignee: goliveTickets.assignee, assigneeUserId: goliveTickets.assigneeUserId, webStatus: goliveTickets.webStatus, webAt: goliveTickets.webAt }).from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
    db.select().from(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
  ]);
  return release ? { ...webProgress(release, profiles, qeRoles, tickets, signoffs), appPushedAt: release.appPushedAt, appPushedBy: release.appPushedBy } : NO_WEB;
}

// Web outcomes lock once every QE is done with web and no open ticket lacks a QE (see webPhaseDone);
// the app checklist opens only after the app build is pushed.
// Between the two the release waits for the build: neither column can be edited.
const webDoneOf = (web: WebPhase) => web.done;
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

const MANAGER_ONLY = "Chỉ Manager mới được hoàn thành hoặc xoá đợt golive.";
const isManagerUser = async (db: Db, userId: string) => {
  const [row] = await db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, userId));
  return isManager(row?.role);
};
const NO_QE_MATCH = "Không có ticket nào khớp tài khoản QE. Kiểm tra lại tên người test hoặc role trước khi import.";
const RISK_LOCKED = "Ticket đã được Manager chấp nhận rủi ro, chỉ Manager mới thay đổi được.";
// The fields of a ticket the board redraws after an app-phase action.
const appResult = (ticket?: { doneAt: string | null; failedAt: string | null; failedBy: string | null; failedReason: string; skippedAt: string | null; skippedBy: string | null; skipKind: string; skipReason: string; skipNotified: boolean; appBuildId: number | null }) =>
  ({ doneAt: ticket?.doneAt ?? null, failedAt: ticket?.failedAt ?? null, failedBy: ticket?.failedBy ?? null, failedReason: ticket?.failedReason ?? "", skippedAt: ticket?.skippedAt ?? null, skippedBy: ticket?.skippedBy ?? null, skipKind: ticket?.skipKind ?? "not-needed", skipReason: ticket?.skipReason ?? "", skipNotified: ticket?.skipNotified ?? false, appBuildId: ticket?.appBuildId ?? null });
const WEB_PHASE_ONLY = "Phase app chưa mở: cần tất cả QE hoàn thành test web và App Manager xác nhận đã push app.";
const APP_PHASE_ONLY = "Đợt golive đã sang giai đoạn 2 · Test app, không sửa phase web được nữa.";

async function deleteRelease(db: Db, releaseId: string) {
  await db.batch([
    db.delete(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
    db.delete(goliveBuilds).where(eq(goliveBuilds.releaseId, releaseId)),
    db.delete(goliveRiskAcceptances).where(eq(goliveRiskAcceptances.releaseId, releaseId)),
    db.delete(goliveTicketEvents).where(eq(goliveTicketEvents.releaseId, releaseId)),
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
    const [{ tickets, held, checks, required }, web, builds, risks, appFailures] = await Promise.all([
      found && preloaded ? preloaded : loadRelease(db, releaseId), webPhase(db, releaseId),
      releaseId ? db.select().from(goliveBuilds).where(eq(goliveBuilds.releaseId, releaseId)).orderBy(goliveBuilds.id) : [],
      releaseId ? db.select().from(goliveRiskAcceptances).where(eq(goliveRiskAcceptances.releaseId, releaseId)) : [],
      // Tickets that ever failed in the app phase: the new-build dialog selects them for a retest.
      releaseId ? db.select({ ticketId: goliveTicketFailures.ticketId }).from(goliveTicketFailures).where(and(eq(goliveTicketFailures.releaseId, releaseId), eq(goliveTicketFailures.phase, "app"))) : [],
    ]);
    return Response.json({ releases, releaseId, tickets, devicesByUser: Object.fromEntries(held), checks, web, builds, risks, required, appFailedIds: appFailures.map(row => row.ticketId) }, noStore);
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
      const profiles = await db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles);
      const profile = profiles.find(person => person.userId === user.userId);
      // A release where no ticket maps to a QE account could never finish its web phase.
      if (!tickets.some(item => { const owner = item.assignee ? matchAccount(profiles, item.assignee) : null; return owner && qeRoles.includes(profiles.find(person => person.userId === owner)?.role ?? ""); })) return error(NO_QE_MATCH);
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
      const [[found], profiles, deviceRows, requiredRows, tickRows] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
        body.checked === false ? [] : activeDevices(db),
        db.select({ deviceId: goliveTicketDevices.deviceId, waivedAt: goliveTicketDevices.waivedAt, archived: devices.archived }).from(goliveTicketDevices).leftJoin(devices, eq(devices.id, goliveTicketDevices.deviceId)).where(eq(goliveTicketDevices.ticketId, ticketId)),
        db.select({ deviceId: goliveDeviceChecks.deviceId }).from(goliveDeviceChecks).where(eq(goliveDeviceChecks.ticketId, ticketId)),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt } = found;
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester !== user.userId) return error("Chỉ người test của ticket này mới được tích checklist.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa checklist.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      if (ticket.skippedAt && ticket.skipKind !== "tested") return error("Ticket đã được đánh dấu không cần test hoặc không test được. Hãy thu hồi trước khi tích checklist.", 409);
      const by = profiles.find(item => item.userId === user.userId)?.displayName || user.displayName || user.email;
      const build = await currentBuildOf(db, ticket.releaseId);
      if (body.checked === false) {
        // Unticking a device outside the required list leaves the ticket Done: its result, build and
        // log stay on the build it was really tested on.
        const stillDone = doneOnRequiredDevices(
          requiredRows.map(row => ({ deviceId: row.deviceId, waived: !!row.waivedAt, archived: row.archived ?? true })),
          tickRows.map(row => row.deviceId).filter(id => id !== deviceId),
        );
        const wasDone = !!ticket.doneAt && !ticket.skippedAt && !stillDone;
        await runBatch(db, [
          db.delete(goliveDeviceChecks).where(and(eq(goliveDeviceChecks.ticketId, ticketId), eq(goliveDeviceChecks.deviceId, deviceId))),
          // A ticket confirmed as tested stays Done; ticks then only record which devices were used.
          ...(ticket.skippedAt || stillDone ? [] : [db.update(goliveTickets).set({ doneAt: null, appBuildId: null }).where(eq(goliveTickets.id, ticketId))]),
          ...(wasDone ? eventStatements(db, [eventRow({ ticketId, releaseId: ticket.releaseId, phase: "app", from: "done-devices", to: "open", buildId: build?.id, actor: { userId: user.userId, name: by }, now })]) : []),
        ]);
      } else {
        // A device on the ticket's required list can be ticked even after it was handed over.
        const device = devicesHeldBy(deviceRows, profiles, [user.userId]).get(user.userId)?.find(item => item.id === deviceId);
        const required = requiredRows.some(item => item.deviceId === deviceId);
        if (!device && !required) return error("Bạn không còn cầm thiết bị này. Nếu đã test xong, hãy bấm “Đã test xong”.", 409);
        const name = device?.name ?? (await db.select({ name: devices.name }).from(devices).where(eq(devices.id, deviceId)))[0]?.name ?? (await db.select({ name: goliveTicketDevices.deviceName }).from(goliveTicketDevices).where(and(eq(goliveTicketDevices.ticketId, ticketId), eq(goliveTicketDevices.deviceId, deviceId))))[0]?.name ?? deviceId;
        await db.insert(goliveDeviceChecks).values({ ticketId, deviceId, deviceName: name, checkedByUserId: user.userId, checkedAt: now, buildId: build?.id ?? null }).onConflictDoNothing();
      }
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId, { userId: user.userId, name: by });
      return Response.json({ doneAt: tickets[0]?.doneAt ?? null, appBuildId: tickets[0]?.appBuildId ?? null });
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
      const riskLocked = !!ticket.skippedAt && ticket.skipKind === "risk-accepted";
      if (riskLocked && !isManager(me?.role)) return error(RISK_LOCKED, 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      // Nothing to undo: without this the call would wipe a Done the ticks earned, or a risk acceptance.
      if (!skipped && !ticket.skippedAt) return error("Ticket không có đánh dấu nào để thu hồi.", 409);
      const by = me?.displayName || user.displayName || user.email;
      const build = await currentBuildOf(db, ticket.releaseId);
      const from = appEventStatus(ticket), to = skipped ? kind : "open";
      // Undoing clears Done too; the next load marks it Done again if every required device is already ticked.
      await runBatch(db, [
        db.update(goliveTickets).set(skipped
          ? { skippedAt: now, skippedBy: by, skipKind: kind, skipReason: reason, skipNotified: notified, doneAt: now, failedAt: null, failedBy: null, failedReason: "", appBuildId: build?.id ?? null }
          : { skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false, doneAt: null, appBuildId: null }).where(eq(goliveTickets.id, ticketId)),
        ...(riskLocked ? [db.delete(goliveRiskAcceptances).where(and(eq(goliveRiskAcceptances.ticketId, ticketId), eq(goliveRiskAcceptances.phase, "app")))] : []),
        ...(from !== to ? eventStatements(db, [eventRow({ ticketId, releaseId: ticket.releaseId, phase: "app", from, to, reason, buildId: build?.id, actor: { userId: user.userId, name: by }, now })]) : []),
      ]);
      if (skipped) waitUntil(announceDone(db, ticket.releaseId, found.releaseName, [ticket]));
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId, { userId: user.userId, name: by });
      return Response.json(appResult(tickets[0]));
    }
    if (body.action === "fail-test") {
      const ticketId = Number(body.ticketId), failed = body.failed !== false, reason = clean(body.reason, 500);
      if (failed && !reason) return error("Hãy nhập lý do test failed.");
      const mode = body.mode === "mistake" || body.mode === "retest" ? body.mode : null;
      if (!failed && !mode) return error("Hãy chọn cách thu hồi test failed: đánh dấu nhầm hoặc cần test lại.");
      const [[found], profiles] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt } = found;
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester && tester !== user.userId && !isManager(me?.role)) return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      const riskLocked = !!ticket.skippedAt && ticket.skipKind === "risk-accepted";
      if (riskLocked && !isManager(me?.role)) return error(RISK_LOCKED, 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      // A ticket that is not failed has no failed mark to revoke; revoking would drop an accepted risk.
      if (!failed && !ticket.failedAt) return error("Ticket không ở trạng thái test failed.", 409);
      const by = me?.displayName || user.displayName || user.email;
      const build = await currentBuildOf(db, ticket.releaseId);
      const from = appEventStatus(ticket), to = failed ? "failed" : mode === "retest" ? "retest" : "open";
      // Failing a ticket takes Done away and clears any skip mark; undoing lets the next load decide
      // Done again from the device ticks, exactly as undoing a skip does.
      // "mistake" keeps the ticks and drops the failure log row of this mark;
      // "retest" clears every tick, so the tester starts over, and keeps the log: the failure was real.
      // Editing the reason of a ticket already failed keeps the first failedAt, so it still matches the
      // log row "mistake" has to delete.
      const failedAt = ticket.failedAt ?? now;
      const write = db.update(goliveTickets).set(failed
        ? { failedAt, failedBy: by, failedReason: reason, doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false, appBuildId: build?.id ?? null }
        : mode === "retest" ? { failedAt: null, failedBy: null, failedReason: "", doneAt: null, appBuildId: null }
        : { failedAt: null, failedBy: null, failedReason: "", appBuildId: null }).where(eq(goliveTickets.id, ticketId));
      await runBatch(db, [
        write,
        ...(riskLocked ? [db.delete(goliveRiskAcceptances).where(and(eq(goliveRiskAcceptances.ticketId, ticketId), eq(goliveRiskAcceptances.phase, "app")))] : []),
        ...(failed ? [failureLog([{ ticketId, phase: "app", releaseId: ticket.releaseId, failedBy: by, failedAt }])]
          // "retest" starts the ticket over: waived devices have to be decided again, otherwise a ticket
          // whose devices were all waived would go straight back to Done.
          : mode === "retest" ? [db.delete(goliveDeviceChecks).where(eq(goliveDeviceChecks.ticketId, ticketId)), db.update(goliveTicketDevices).set({ waivedAt: null, waivedBy: null, waivedReason: "" }).where(eq(goliveTicketDevices.ticketId, ticketId))]
          : ticket.failedAt ? [db.delete(goliveTicketFailures).where(and(eq(goliveTicketFailures.ticketId, ticketId), eq(goliveTicketFailures.phase, "app"), eq(goliveTicketFailures.failedAt, ticket.failedAt)))] : []),
        ...(from !== to ? eventStatements(db, [eventRow({ ticketId, releaseId: ticket.releaseId, phase: "app", from, to, reason, buildId: build?.id, actor: { userId: user.userId, name: by }, now })]) : []),
      ]);
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId, { userId: user.userId, name: by });
      return Response.json(appResult(tickets[0]));
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
      const [[release], profiles, rows, web, build] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name, source: goliveReleases.source }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
        db.select().from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
        webPhase(db, releaseId),
        currentBuildOf(db, releaseId),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (release.source === "manual") return error("Đợt golive tạo tay không có ticket để cập nhật hàng loạt.", 409);
      if (phase === "app" && !appPhaseOf(web)) return error(WEB_PHASE_ONLY, 409);
      if (phase === "web" && webDoneOf(web)) return error(APP_PHASE_ONLY, 409);
      const me = profiles.find(item => item.userId === user.userId);
      const picked = rows.filter(row => ids.includes(row.id));
      const riskOf = (row: typeof rows[number]) => phase === "web" ? row.webStatus === "risk-accepted" : !!row.skippedAt && row.skipKind === "risk-accepted";
      const allowed = picked.filter(row => {
        const tester = row.assigneeUserId ?? (row.assignee ? matchAccount(profiles, row.assignee) : null);
        // An accepted risk is a Manager's decision: only a Manager changes it.
        return (!tester || tester === user.userId || isManager(me?.role)) && (!riskOf(row) || isManager(me?.role));
      });
      if (!allowed.length) return error("Bạn không có quyền đánh dấu các ticket đã chọn. Chỉ người test của ticket hoặc Manager mới được đánh dấu.", 403);
      const by = me?.displayName || user.displayName || user.email;
      const values = phase === "web"
        ? { webStatus: status, webAt: now, webBy: by, webReason: reason, webNotified: notified }
        : status === "failed"
          ? { failedAt: now, failedBy: by, failedReason: reason, doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false, appBuildId: build?.id ?? null }
          : { skippedAt: now, skippedBy: by, skipKind: status, skipReason: reason, skipNotified: notified, doneAt: now, failedAt: null, failedBy: null, failedReason: "", appBuildId: build?.id ?? null };
      const allowedIds = allowed.map(row => row.id);
      // Marking failed again (a reason fixed, say) keeps the first time, so "mistake" still finds its log row.
      // values goes back to the client as plain fields; only the stored update carries the sql expression.
      const stored = status !== "failed" ? values : phase === "web"
        ? { ...values, webAt: sql`case when ${goliveTickets.webStatus} = 'failed' and ${goliveTickets.webAt} is not null then ${goliveTickets.webAt} else ${now} end` }
        : { ...values, failedAt: sql`coalesce(${goliveTickets.failedAt}, ${now})` };
      // D1 caps bound parameters per statement, so updates go in chunks of one batch.
      const writes: unknown[] = [];
      for (const part of chunks(allowedIds)) writes.push(db.update(goliveTickets).set(stored).where(inArray(goliveTickets.id, part)));
      const riskIds = allowed.filter(riskOf).map(row => row.id);
      for (const part of chunks(riskIds)) writes.push(db.delete(goliveRiskAcceptances).where(and(inArray(goliveRiskAcceptances.ticketId, part), eq(goliveRiskAcceptances.phase, phase))));
      if (status === "failed") {
        // The log row of a ticket already failed stays as it is (primary key ticket+phase), and its
        // failed time above was kept too, so the two still match.
        const logs = allowed.map(row => ({ ticketId: row.id, phase, releaseId, failedBy: by, failedAt: (phase === "web" ? row.webAt : row.failedAt) ?? now }));
        for (let i = 0; i < logs.length; i += FAILURE_INSERT_BATCH_SIZE) writes.push(failureLog(logs.slice(i, i + FAILURE_INSERT_BATCH_SIZE)));
      }
      writes.push(...eventStatements(db, allowed.map(row => eventRow({ ticketId: row.id, releaseId, phase, from: phase === "web" ? webEventStatus(row.webStatus) : appEventStatus(row), to: status, reason, buildId: phase === "app" ? build?.id : null, actor: { userId: user.userId, name: by }, now })).filter(row => row.fromStatus !== row.toStatus)));
      await runBatch(db, writes);
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
      const mode = body.mode === "mistake" || body.mode === "retest" ? body.mode : null;
      const [[found], profiles] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      const { ticket, completedAt, releaseName } = found;
      if (status === null && ticket.webStatus === "failed" && !mode) return error("Hãy chọn cách thu hồi test failed: đánh dấu nhầm hoặc cần test lại.");
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester && tester !== user.userId && !isManager(me?.role)) return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      const riskLocked = ticket.webStatus === "risk-accepted";
      if (riskLocked && !isManager(me?.role)) return error(RISK_LOCKED, 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      const before = await webPhase(db, ticket.releaseId);
      if (webDoneOf(before)) return error(APP_PHASE_ONLY, 409);
      const by = me?.displayName || user.displayName || user.email;
      // Editing the reason of a ticket already failed keeps the first webAt: the failure log row is keyed
      // on it, so "mistake" has to be able to find it again.
      const webAt = status === "failed" && ticket.webStatus === "failed" && ticket.webAt ? ticket.webAt : now;
      const values = status
        ? { webStatus: status, webAt, webBy: by, webReason: reason, webNotified: status === "cannot-test" && body.notified === true }
        : { webStatus: null, webAt: null, webBy: null, webReason: "", webNotified: false };
      const from = webEventStatus(ticket.webStatus), to = status ?? "open";
      await runBatch(db, [
        db.update(goliveTickets).set(values).where(eq(goliveTickets.id, ticketId)),
        ...(riskLocked ? [db.delete(goliveRiskAcceptances).where(and(eq(goliveRiskAcceptances.ticketId, ticketId), eq(goliveRiskAcceptances.phase, "web")))] : []),
        ...(status === "failed" ? [failureLog([{ ticketId, phase: "web", releaseId: ticket.releaseId, failedBy: by, failedAt: webAt }])]
          : status === null && ticket.webStatus === "failed" && mode === "mistake" && ticket.webAt ? [db.delete(goliveTicketFailures).where(and(eq(goliveTicketFailures.ticketId, ticketId), eq(goliveTicketFailures.phase, "web"), eq(goliveTicketFailures.failedAt, ticket.webAt)))] : []),
        ...(from !== to ? eventStatements(db, [eventRow({ ticketId, releaseId: ticket.releaseId, phase: "web", from, to, reason, actor: { userId: user.userId, name: by }, now })]) : []),
      ]);
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
      if (release.source !== "manual") {
        if (!isQe(me?.role)) return error("Chỉ tài khoản QE mới xác nhận hoàn thành test web.", 403);
        return Response.json({ web: await webPhase(db, releaseId) });
      }
      const before = await webPhase(db, releaseId);
      // A manual release fixed its QE list when it was created; only those people can confirm.
      if (!before.qe.some(person => person.userId === user.userId)) return error("Chỉ người tham gia đợt golive này mới xác nhận hoàn thành test web.", 403);
      if (!done && before.appPushedAt) return error("App đã được push, không thu hồi xác nhận test web được nữa.", 409);
      if (done) await db.insert(goliveWebSignoffs).values({ releaseId, userId: user.userId, signedAt: now }).onConflictDoNothing();
      else await db.delete(goliveWebSignoffs).where(and(eq(goliveWebSignoffs.releaseId, releaseId), eq(goliveWebSignoffs.userId, user.userId)));
      const web = await webPhase(db, releaseId);
      announceWebProgress(db, release.name, before, web);
      return Response.json({ web });
    }
    // The App Manager (or a Manager) marks the app build as pushed: the app checklist opens and the testers hear.
    // Every push records its build number. again: a rebuilt app replaces the pushed one and the pusher picks
    // which tickets must be tested again (retestTicketIds); the others keep their result and show "Build cũ".
    // undo: a push tapped by mistake; only while the release has a single build.
    if (body.action === "app-pushed") {
      const releaseId = clean(body.releaseId, 60), mode = body.undo === true ? "undo" : body.again === true ? "again" : "first";
      const buildNumber = clean(body.build, 40);
      const [[release], [me], web, builds] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ role: userProfiles.role, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
        webPhase(db, releaseId),
        db.select({ id: goliveBuilds.id }).from(goliveBuilds).where(eq(goliveBuilds.releaseId, releaseId)),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!canPushApp(me?.role)) return error("Chỉ App Manager hoặc Manager mới xác nhận đã push app.", 403);
      if (mode === "undo") {
        if (!web.appPushedAt) return Response.json({ web });
        if (builds.length > 1) return error("Đợt đã có từ 2 bản build, không thu hồi push được.", 409);
        await runBatch(db, [
          db.update(goliveReleases).set({ appPushedAt: null, appPushedBy: null }).where(eq(goliveReleases.id, releaseId)),
          db.delete(goliveBuilds).where(eq(goliveBuilds.releaseId, releaseId)),
          db.update(goliveTickets).set({ appBuildId: null }).where(eq(goliveTickets.releaseId, releaseId)),
          db.update(goliveDeviceChecks).set({ buildId: null }).where(inRelease(goliveDeviceChecks.ticketId, releaseId)),
        ]);
        return Response.json({ web: await webPhase(db, releaseId) });
      }
      if (!webDoneOf(web)) return error("Chưa thể push app: còn QE chưa hoàn thành test web.", 409);
      // A double tap or a second Manager must not re-announce: only an explicit "again" pushes over a push.
      if (web.appPushedAt && mode === "first") return Response.json({ web });
      if (!web.appPushedAt && mode === "again") return error("App chưa được push lần nào.", 409);
      if (!buildNumber) return error("Hãy nhập số build.");
      const by = me?.displayName || user.displayName || user.email;
      const actor = { userId: user.userId, name: by };
      const [rows, profiles] = await Promise.all([
        db.select().from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
      ]);
      const requested = Array.isArray(body.retestTicketIds) ? body.retestTicketIds.map(Number) : [];
      const retest = mode === "again" ? rows.filter(row => requested.includes(row.id)) : [];
      const retestIds = retest.map(row => row.id);
      const [build] = await db.insert(goliveBuilds).values({ releaseId, buildNumber, pushedAt: now, pushedBy: by }).returning();
      const writes: unknown[] = [db.update(goliveReleases).set({ appPushedAt: now, appPushedBy: by }).where(eq(goliveReleases.id, releaseId))];
      // A push undone cleared every build id. Tickets that are already Done belong to this first build again.
      if (mode === "first") writes.push(
        db.update(goliveTickets).set({ appBuildId: build.id }).where(and(eq(goliveTickets.releaseId, releaseId), isNotNull(goliveTickets.doneAt), isNull(goliveTickets.appBuildId))),
        db.update(goliveDeviceChecks).set({ buildId: build.id }).where(and(inRelease(goliveDeviceChecks.ticketId, releaseId), isNull(goliveDeviceChecks.buildId))),
      );
      for (const part of chunks(retestIds)) {
        writes.push(
          db.delete(goliveDeviceChecks).where(inArray(goliveDeviceChecks.ticketId, part)),
          db.delete(goliveTicketDevices).where(inArray(goliveTicketDevices.ticketId, part)),
          db.delete(goliveRiskAcceptances).where(and(inArray(goliveRiskAcceptances.ticketId, part), eq(goliveRiskAcceptances.phase, "app"))),
          db.update(goliveTickets).set({ doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false, failedAt: null, failedBy: null, failedReason: "", appBuildId: null }).where(inArray(goliveTickets.id, part)),
        );
      }
      writes.push(...eventStatements(db, retest.map(row => eventRow({ ticketId: row.id, releaseId, phase: "app", from: appEventStatus(row), to: "retest", reason: "Build " + buildNumber, buildId: build.id, actor, now }))));
      await runBatch(db, writes);
      // The first push, and every retested ticket, snapshots the devices its tester holds right now.
      await loadRelease(db, releaseId, now, undefined, actor);
      const counts = new Map<string, number>();
      for (const row of retest) {
        const owner = row.assigneeUserId ?? (row.assignee ? matchAccount(profiles, row.assignee) : null);
        if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
      }
      const link = "/?tab=golive";
      if (mode === "again") {
        for (const count of new Set([0, ...counts.values()])) {
          const ids = web.qe.map(person => person.userId).filter(id => (counts.get(id) ?? 0) === count);
          if (!ids.length) continue;
          waitUntil(notifyUsers(db, ids, count > 0
            ? { event: "app-pushed", title: "Có bản app mới", body: "Bản app " + buildNumber + " đợt " + release.name + " đã sẵn sàng. Bạn có " + count + " ticket cần test lại.", link }
            : { event: "app-pushed", title: "Có bản app mới", body: "Đã có bản app " + buildNumber + " đợt " + release.name + ". Cài lại bản mới trước khi test tiếp.", link }));
        }
      } else {
        waitUntil(notifyUsers(db, web.qe.map(person => person.userId), { event: "app-pushed", title: "App đã sẵn sàng để test", body: by + " đã push app " + buildNumber + " đợt " + release.name + ". Bắt đầu test app trên thiết bị của bạn.", link }));
      }
      return Response.json({ web: await webPhase(db, releaseId) });
    }
    // Fixes a build number typed wrongly; only the current build can be edited.
    if (body.action === "edit-build") {
      const releaseId = clean(body.releaseId, 60), buildNumber = clean(body.build, 40);
      const [[release], [me]] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ role: userProfiles.role, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!canPushApp(me?.role)) return error("Chỉ App Manager hoặc Manager mới sửa được số build.", 403);
      if (!buildNumber) return error("Hãy nhập số build.");
      const build = await currentBuildOf(db, releaseId);
      if (!build) return error("App chưa được push lần nào.", 409);
      // The log is per ticket; a build edit belongs to no ticket, so it is stored with ticket id 0.
      await runBatch(db, [
        db.update(goliveBuilds).set({ buildNumber }).where(eq(goliveBuilds.id, build.id)),
        ...eventStatements(db, [eventRow({ ticketId: 0, releaseId, phase: "app", from: build.buildNumber, to: buildNumber, reason: "edit-build", buildId: build.id, actor: { userId: user.userId, name: me?.displayName || user.displayName || user.email }, now })]),
      ]);
      return Response.json({ build: { ...build, buildNumber } });
    }
    // A device handed over before it was ticked stops blocking the ticket once someone explains why.
    if (body.action === "waive-device") {
      const ticketId = Number(body.ticketId), deviceId = clean(body.deviceId, 120), waived = body.waived !== false, reason = clean(body.reason, 500);
      if (waived && !reason) return error("Hãy nhập lý do miễn máy.");
      const [[found], profiles, [row], [tick], [device]] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName, role: userProfiles.role }).from(userProfiles),
        db.select().from(goliveTicketDevices).where(and(eq(goliveTicketDevices.ticketId, ticketId), eq(goliveTicketDevices.deviceId, deviceId))),
        db.select({ deviceId: goliveDeviceChecks.deviceId }).from(goliveDeviceChecks).where(and(eq(goliveDeviceChecks.ticketId, ticketId), eq(goliveDeviceChecks.deviceId, deviceId))),
        db.select({ holder: devices.holder, holderUserId: devices.holderUserId }).from(devices).where(eq(devices.id, deviceId)),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      if (!row) return error("Thiết bị này không nằm trong danh sách máy bắt buộc của ticket.", 404);
      const { ticket, completedAt } = found;
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester && tester !== user.userId && !isManager(me?.role)) return error("Chỉ người test của ticket hoặc Manager mới được miễn máy.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      if (waived && tick) return error("Máy này đã được tích, không cần miễn.", 409);
      // Miễn máy is for a device handed over: while its tester still holds it, they test on it.
      if (waived && tester && device && (device.holderUserId ?? matchAccount(profiles, device.holder)) === tester) return error("Người test vẫn đang giữ máy này. Hãy tích máy sau khi test, hoặc bàn giao máy trước khi miễn.", 409);
      const by = me?.displayName || user.displayName || user.email;
      const build = await currentBuildOf(db, ticket.releaseId);
      const wasDone = !!ticket.doneAt && !ticket.skippedAt && !waived;
      await runBatch(db, [
        db.update(goliveTicketDevices).set(waived ? { waivedAt: now, waivedBy: by, waivedReason: reason } : { waivedAt: null, waivedBy: null, waivedReason: "" }).where(and(eq(goliveTicketDevices.ticketId, ticketId), eq(goliveTicketDevices.deviceId, deviceId))),
        ...(wasDone ? [db.update(goliveTickets).set({ doneAt: null, appBuildId: null }).where(eq(goliveTickets.id, ticketId)), ...eventStatements(db, [eventRow({ ticketId, releaseId: ticket.releaseId, phase: "app", from: "done-devices", to: "open", reason: "Thu hồi miễn máy " + row.deviceName, buildId: build?.id, actor: { userId: user.userId, name: by }, now })])] : []),
      ]);
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId, { userId: user.userId, name: by });
      return Response.json({ doneAt: tickets[0]?.doneAt ?? null, appBuildId: tickets[0]?.appBuildId ?? null, waivedAt: waived ? now : null, waivedBy: waived ? by : null, waivedReason: waived ? reason : "" });
    }
    // A Manager accepts a failed ticket as it is. The original failure reason stays on the ticket.
    if (body.action === "accept-risk") {
      const ticketId = Number(body.ticketId), phase: "web" | "app" | null = body.phase === "web" ? "web" : body.phase === "app" ? "app" : null;
      const accepted = body.accepted !== false, reason = clean(body.reason, 500);
      if (!phase) return error("Phase không hợp lệ.");
      if (accepted && !reason) return error("Hãy nhập lý do chấp nhận rủi ro.");
      const [[found], [me]] = await Promise.all([
        ticketWithRelease(db, ticketId),
        db.select({ role: userProfiles.role, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
      ]);
      if (!found) return error("Không tìm thấy ticket.", 404);
      if (!isManager(me?.role)) return error("Chỉ Manager mới được chấp nhận rủi ro.", 403);
      const { ticket, completedAt, releaseName } = found;
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      const before = await webPhase(db, ticket.releaseId);
      if (phase === "app" ? !appPhaseOf(before) : webDoneOf(before)) return error("Đợt golive không còn ở phase " + phase + ".", 409);
      const by = me?.displayName || user.displayName || user.email;
      const actor = { userId: user.userId, name: by };
      const build = await currentBuildOf(db, ticket.releaseId);
      const riskKey = and(eq(goliveRiskAcceptances.ticketId, ticketId), eq(goliveRiskAcceptances.phase, phase));
      const log = (from: string, to: string) => eventStatements(db, [eventRow({ ticketId, releaseId: ticket.releaseId, phase, from, to, reason, buildId: phase === "app" ? build?.id : null, actor, now })]);
      if (accepted) {
        if (phase === "app" ? !ticket.failedAt : ticket.webStatus !== "failed") return error("Chỉ chấp nhận rủi ro cho ticket đang test failed.", 409);
        await runBatch(db, [
          db.insert(goliveRiskAcceptances).values({ ticketId, phase, releaseId: ticket.releaseId, reason, acceptedBy: by, acceptedAt: now }).onConflictDoUpdate({ target: [goliveRiskAcceptances.ticketId, goliveRiskAcceptances.phase], set: { reason, acceptedBy: by, acceptedAt: now } }),
          phase === "app"
            ? db.update(goliveTickets).set({ skippedAt: now, skippedBy: by, skipKind: "risk-accepted", doneAt: now, failedAt: null, failedBy: null, appBuildId: build?.id ?? null }).where(eq(goliveTickets.id, ticketId))
            : db.update(goliveTickets).set({ webStatus: "risk-accepted" }).where(eq(goliveTickets.id, ticketId)),
          ...log("failed", "risk-accepted"),
        ]);
      } else {
        if (phase === "app" ? !(ticket.skippedAt && ticket.skipKind === "risk-accepted") : ticket.webStatus !== "risk-accepted") return error("Ticket không ở trạng thái chấp nhận rủi ro.", 409);
        await runBatch(db, [
          db.delete(goliveRiskAcceptances).where(riskKey),
          phase === "app"
            ? db.update(goliveTickets).set({ skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false, doneAt: null, failedAt: now, failedBy: by, appBuildId: null }).where(eq(goliveTickets.id, ticketId))
            : db.update(goliveTickets).set({ webStatus: "failed" }).where(eq(goliveTickets.id, ticketId)),
          ...log("risk-accepted", "failed"),
        ]);
      }
      const web = await webPhase(db, ticket.releaseId);
      if (phase === "web") announceWebProgress(db, releaseName, before, web);
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId, actor);
      const risks = await db.select().from(goliveRiskAcceptances).where(eq(goliveRiskAcceptances.ticketId, ticketId));
      return Response.json({ ...appResult(tickets[0]), webStatus: tickets[0]?.webStatus ?? null, web, risks });
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
      const releaseId = clean(body.releaseId, 60), note = clean(body.note, 1000);
      if (!await isManagerUser(db, user.userId)) return error(MANAGER_ONLY, 403);
      const [release] = await db.select().from(goliveReleases).where(eq(goliveReleases.id, releaseId));
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return Response.json({ release });
      // The board hides the button outside the app phase; the server checks it too.
      if (!appPhaseOf(await webPhase(db, releaseId))) return error(WEB_PHASE_ONLY, 409);
      const [{ tickets, required, build }, risks] = await Promise.all([
        loadRelease(db, releaseId, now),
        db.select().from(goliveRiskAcceptances).where(eq(goliveRiskAcceptances.releaseId, releaseId)),
      ]);
      const unfinished = tickets.filter(item => !item.doneAt).map(item => ({ issueKey: item.issueKey, summary: item.summary, assignee: item.assignee }));
      if (unfinished.length) return Response.json({ error: "Còn " + unfinished.length + (release.source === "manual" ? " người test" : " ticket") + " chưa Done.", unfinished }, { status: 409 });
      // The server decides again whether a note is mandatory; the dialog only mirrors this rule.
      const attention = attentionList({ tickets, risks, waived: required.filter(row => row.waivedAt).map(row => ({ ticketId: row.ticketId, deviceName: row.deviceName, waivedReason: row.waivedReason })), currentBuildId: build?.id ?? null });
      if (attention.noteRequired && !note) return error("Hãy nhập ghi chú nghiệm thu: có ticket không test được, chưa báo scrum team hoặc đã chấp nhận rủi ro.");
      const [profile] = await db.select({ displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId));
      const [updated] = await db.update(goliveReleases).set({ completedAt: now, completedBy: profile?.displayName || user.displayName || user.email, signoffNote: note }).where(eq(goliveReleases.id, releaseId)).returning();
      waitUntil(notifyRoles(db, EVERYONE, { event: "release-completed", title: "Golive hoàn thành 🎉", body: "Đợt " + release.name + " đã hoàn thành." }));
      return Response.json({ release: updated });
    }
    if (body.action === "delete-release") {
      if (!await isManagerUser(db, user.userId)) return error(MANAGER_ONLY, 403);
      await deleteRelease(db, clean(body.releaseId, 60));
      return Response.json({ ok: true });
    }
    return error("Thao tác không được hỗ trợ.");
  } catch {
    return error("Không thể lưu thay đổi.", 500);
  }
}
