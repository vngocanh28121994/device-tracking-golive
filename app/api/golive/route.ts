import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { devices, goliveDeviceChecks, goliveReleases, goliveTicketDevices, goliveTickets, userProfiles } from "../../../db/schema";
import { normalizeName } from "../../lib/golive";

type Db = ReturnType<typeof getDb>;
const MAX_COMPLETED = 10;
type Profile = { userId: string; displayName: string };

// A tester name maps to an account only when exactly one display name matches.
function matchAccount(profiles: Profile[], name: string) {
  const matches = profiles.filter(person => normalizeName(person.displayName) === normalizeName(name));
  return matches.length === 1 ? matches[0].userId : null;
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
    db.select({ completedAt: goliveReleases.completedAt }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)),
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
      if (ticket.doneAt || !ticket.assigneeUserId) continue;
      const ticked = new Set(checks.filter(item => item.ticketId === ticket.id).map(item => item.deviceId));
      const required = held.get(ticket.assigneeUserId) || [];
      if (required.length > 0 && required.every(device => ticked.has(device.id))) { ticket.doneAt = now; doneIds.push(ticket.id); }
    }
    // D1 caps bound parameters per statement, so updates go in chunks of one batch.
    const writes = [];
    for (let i = 0; i < doneIds.length; i += 90) writes.push(db.update(goliveTickets).set({ doneAt: now }).where(inArray(goliveTickets.id, doneIds.slice(i, i + 90))));
    if (writes.length) await db.batch(writes as [typeof writes[number], ...typeof writes]);
  }
  return { tickets, held, checks };
}

// The ticket and whether its release is completed, in one round trip.
const ticketWithRelease = (db: Db, ticketId: number) =>
  db.select({ ticket: goliveTickets, completedAt: goliveReleases.completedAt }).from(goliveTickets).innerJoin(goliveReleases, eq(goliveReleases.id, goliveTickets.releaseId)).where(eq(goliveTickets.id, ticketId));

async function deleteRelease(db: Db, releaseId: string) {
  await db.batch([
    db.delete(goliveDeviceChecks).where(inRelease(goliveDeviceChecks.ticketId, releaseId)),
    db.delete(goliveTicketDevices).where(inRelease(goliveTicketDevices.ticketId, releaseId)),
    db.delete(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)),
    db.delete(goliveReleases).where(eq(goliveReleases.id, releaseId)),
  ]);
}

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
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
    const { tickets, held, checks } = found && preloaded ? preloaded : await loadRelease(db, releaseId);
    return Response.json({ releases, releaseId, tickets, devicesByUser: Object.fromEntries(held), checks }, noStore);
  } catch {
    return error("Không thể tải danh sách golive.", 500);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
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
      if (ticket.skippedAt && ticket.skipKind !== "tested") return error("Ticket đã được đánh dấu không cần test. Hãy thu hồi trước khi tích checklist.", 409);
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
      const ticketId = Number(body.ticketId), skipped = body.skipped !== false, kind = body.kind === "tested" ? "tested" : "not-needed";
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
      const by = me?.displayName || user.displayName || user.email;
      // Undoing clears Done too; the next load marks it Done again if every device is already ticked.
      await db.update(goliveTickets).set(skipped ? { skippedAt: now, skippedBy: by, skipKind: kind, doneAt: now } : { skippedAt: null, skippedBy: null, skipKind: "not-needed", doneAt: null }).where(eq(goliveTickets.id, ticketId));
      const { tickets } = await loadRelease(db, ticket.releaseId, now, ticketId);
      const updated = tickets[0];
      return Response.json({ doneAt: updated?.doneAt ?? null, skippedAt: updated?.skippedAt ?? null, skippedBy: updated?.skippedBy ?? null, skipKind: updated?.skipKind ?? "not-needed" });
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
