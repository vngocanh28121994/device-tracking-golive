import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { requireMember } from "../../lib/member-access";
import { getDb } from "../../../db";
import { devices, goliveDeviceChecks, goliveReleases, goliveTicketDevices, goliveTickets, goliveWebSignoffs, userProfiles } from "../../../db/schema";
import { inAppPhase, isWebStatus, matchAccount, webSettled } from "../../lib/golive";
import { waitUntil } from "cloudflare:workers";
import { notifyRoles, notifyUsers, pushEnabled } from "../../lib/push";

type Db = ReturnType<typeof getDb>;
const MAX_COMPLETED = 10;
type Profile = { userId: string; displayName: string };

// Managers and PMs follow progress; everyone hears when a phase or the release is finished.
const WATCHERS = ["Manager", "PM"], EVERYONE = ["Manager", "QE", "DEV", "PM"];

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

// Web phase: every account with role QE confirms the web build before the app build starts.
// Progress counts today's QE accounts, so a sign-off from someone no longer QE is not counted.
async function webPhase(db: Db, releaseId: string) {
  if (!releaseId) return { qe: [], signed: {} };
  const [qe, rows] = await Promise.all([
    db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.role, "QE")).orderBy(userProfiles.displayName),
    db.select().from(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
  ]);
  return { qe, signed: Object.fromEntries(rows.map(row => [row.userId, row.signedAt])) };
}

// Each phase locks the other's column: web outcomes while the web phase runs, the app checklist after.
const appPhaseOf = (web: Awaited<ReturnType<typeof webPhase>>) => inAppPhase(web.qe.map(person => person.userId), Object.keys(web.signed));
const WEB_PHASE_ONLY = "Đợt golive đang ở giai đoạn 1 · Test web. Phase app sẽ mở khi tất cả QE xác nhận hoàn thành test web.";
const APP_PHASE_ONLY = "Đợt golive đã sang giai đoạn 2 · Test app, không sửa phase web được nữa.";

async function deleteRelease(db: Db, releaseId: string) {
  await db.batch([
    db.delete(goliveWebSignoffs).where(eq(goliveWebSignoffs.releaseId, releaseId)),
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
    if (body.action === "create-manual") {
      const name = clean(body.name, 120), fixVersion = clean(body.fixVersion, 120);
      if (name.length < 2 || !fixVersion) return error("Nhập tên đợt golive (ít nhất 2 ký tự) và fixVersion.");
      const testers = await db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.role, "QE"));
      if (!testers.length) return error("Chưa có tài khoản QE. Hãy nhờ Manager gán role trong Tài khoản của tôi trước.");
      const [profile] = await db.select({ displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, user.userId));
      const id = crypto.randomUUID();
      const rows = testers.map((tester, index) => ({ releaseId: id, issueKey: "QE-" + (index + 1), summary: fixVersion, assignee: tester.displayName, assigneeUserId: tester.userId, updatedAt: now }));
      await db.batch([
        db.insert(goliveReleases).values({ id, name, fixVersion, source: "manual", createdBy: profile?.displayName || user.displayName || user.email, createdAt: now }),
        ...Array.from({ length: Math.ceil(rows.length / 10) }, (_, index) => db.insert(goliveTickets).values(rows.slice(index * 10, index * 10 + 10))),
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
        ...Array.from({ length: Math.ceil(tickets.length / 10) }, (_, index) => db.insert(goliveTickets).values(tickets.slice(index * 10, index * 10 + 10).map(item => ({ ...item, assigneeUserId: item.assignee ? matchAccount(profiles, item.assignee) : null, releaseId: id, updatedAt: now })))),
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
      if (tester && tester !== user.userId && me?.role !== "Manager") return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
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
      if (tester && tester !== user.userId && me?.role !== "Manager") return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (!appPhaseOf(await webPhase(db, ticket.releaseId))) return error(WEB_PHASE_ONLY, 409);
      const by = me?.displayName || user.displayName || user.email;
      // Failing a ticket takes Done away and clears any skip mark; undoing lets the next load decide
      // Done again from the device ticks, exactly as undoing a skip does.
      await db.update(goliveTickets).set(failed
        ? { failedAt: now, failedBy: by, failedReason: reason, doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", skipReason: "", skipNotified: false }
        : { failedAt: null, failedBy: null, failedReason: "" }).where(eq(goliveTickets.id, ticketId));
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId);
      const updated = tickets[0];
      return Response.json({ doneAt: updated?.doneAt ?? null, failedAt: updated?.failedAt ?? null, failedBy: updated?.failedBy ?? null, failedReason: updated?.failedReason ?? "", skippedAt: updated?.skippedAt ?? null, skippedBy: updated?.skippedBy ?? null, skipKind: updated?.skipKind ?? "not-needed", skipReason: updated?.skipReason ?? "", skipNotified: updated?.skipNotified ?? false });
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
      const { ticket, completedAt } = found;
      const me = profiles.find(item => item.userId === user.userId);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester && tester !== user.userId && me?.role !== "Manager") return error("Chỉ người test của ticket hoặc Manager mới được đánh dấu ticket.", 403);
      if (completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (appPhaseOf(await webPhase(db, ticket.releaseId))) return error(APP_PHASE_ONLY, 409);
      const by = me?.displayName || user.displayName || user.email;
      const values = status
        ? { webStatus: status, webAt: now, webBy: by, webReason: reason, webNotified: status === "cannot-test" && body.notified === true }
        : { webStatus: null, webAt: null, webBy: null, webReason: "", webNotified: false };
      await db.update(goliveTickets).set(values).where(eq(goliveTickets.id, ticketId));
      return Response.json(values);
    }
    if (body.action === "web-signoff") {
      const releaseId = clean(body.releaseId, 60), done = body.done !== false;
      const [[release], [me]] = await Promise.all([
        db.select({ completedAt: goliveReleases.completedAt, name: goliveReleases.name, source: goliveReleases.source }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
        db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
      ]);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      if (release.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa.", 409);
      if (me?.role !== "QE") return error("Chỉ tài khoản QE mới xác nhận hoàn thành test web.", 403);
      if (done) {
        // Every ticket of this QE needs a settled web outcome first, so the web column is never left blank.
        const [rows, profiles] = await Promise.all([
          db.select({ issueKey: goliveTickets.issueKey, assignee: goliveTickets.assignee, assigneeUserId: goliveTickets.assigneeUserId, webStatus: goliveTickets.webStatus, summary: goliveTickets.summary }).from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
          db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles),
        ]);
        // A manual golive has one row per QE, so the sign-off itself is that row's web outcome.
        const open = release.source === "manual" ? [] : rows.filter(row => (row.assigneeUserId ?? (row.assignee ? matchAccount(profiles, row.assignee) : null)) === user.userId && !webSettled(row.webStatus));
        if (open.length) return Response.json({ error: "Còn " + open.length + " ticket của bạn chưa có trạng thái phase web (hoặc đang Test failed): " + open.slice(0, 5).map(row => row.issueKey).join(", ") + (open.length > 5 ? "…" : "") + ".", unfinished: open.map(row => ({ issueKey: row.issueKey, summary: row.summary, assignee: row.assignee })) }, { status: 409 });
      }
      if (done) await db.insert(goliveWebSignoffs).values({ releaseId, userId: user.userId, signedAt: now }).onConflictDoNothing();
      else await db.delete(goliveWebSignoffs).where(and(eq(goliveWebSignoffs.releaseId, releaseId), eq(goliveWebSignoffs.userId, user.userId)));
      const web = await webPhase(db, releaseId);
      if (done) {
        const name = web.qe.find(person => person.userId === user.userId)?.displayName || user.displayName;
        waitUntil(notifyRoles(db, WATCHERS, { event: "web-qe-done", title: "QE đã xong test web", body: name + " đã xác nhận test web đợt " + release.name + "." }));
        if (web.qe.every(person => person.userId in web.signed)) waitUntil(notifyRoles(db, EVERYONE, { event: "web-all-done", title: "Test web hoàn tất", body: "Tất cả QE đã test xong web đợt " + release.name + ". Bắt đầu test app." }));
      }
      return Response.json({ web });
    }
    if (body.action === "remind-web") {
      const releaseId = clean(body.releaseId, 60);
      const [[me], web, [release]] = await Promise.all([
        db.select({ role: userProfiles.role }).from(userProfiles).where(eq(userProfiles.userId, user.userId)),
        webPhase(db, releaseId),
        db.select({ name: goliveReleases.name }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
      ]);
      if (me?.role !== "Manager") return error("Chỉ Manager mới được nhắc nhở.", 403);
      if (!release) return error("Không tìm thấy đợt golive.", 404);
      const pending = web.qe.filter(person => !(person.userId in web.signed)).map(person => person.userId);
      if (!await pushEnabled(db, "remind-web")) return error("Nhắc nhở qua thông báo đang bị tắt trong cài đặt.", 409);
      waitUntil(notifyUsers(db, pending, { event: "remind-web", title: "Nhắc test web", body: "Bạn chưa xác nhận test web đợt " + release.name + "." }));
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
