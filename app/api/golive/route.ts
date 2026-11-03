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

// Same rule as the inventory: legacy rows without holder_user_id match a unique display name.
async function devicesHeldBy(db: Db, profiles: Profile[], userIds: string[]) {
  const held = new Map<string, { id: string; name: string; category: string }[]>(userIds.map(id => [id, []]));
  if (userIds.length === 0) return held;
  const rows = await db.select({ id: devices.id, name: devices.name, category: devices.category, holder: devices.holder, holderUserId: devices.holderUserId }).from(devices).where(eq(devices.archived, false));
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
// devices the tester holds now are added to the ticket's list (and stay there after a handover),
// and a ticket becomes Done once every listed device is ticked. Done is sticky until a tick is removed.
async function loadRelease(db: Db, releaseId: string, now = new Date().toISOString()) {
  const rows = releaseId ? await db.select().from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId)).orderBy(goliveTickets.id) : [];
  const [release] = releaseId ? await db.select({ completedAt: goliveReleases.completedAt }).from(goliveReleases).where(eq(goliveReleases.id, releaseId)) : [];
  const profiles = await db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles);
  // Testers who create an account after the import are matched on every load.
  const tickets = rows.map(item => ({ ...item, assigneeUserId: item.assigneeUserId ?? (item.assignee ? matchAccount(profiles, item.assignee) : null) }));
  const testerIds = Array.from(new Set(tickets.flatMap(item => item.assigneeUserId ? [item.assigneeUserId] : [])));
  const held = await devicesHeldBy(db, profiles, testerIds);
  const checks = rows.length ? await db.select().from(goliveDeviceChecks).where(inRelease(goliveDeviceChecks.ticketId, releaseId)) : [];
  const recorded = rows.length ? await db.select().from(goliveTicketDevices).where(inRelease(goliveTicketDevices.ticketId, releaseId)) : [];
  if (release && !release.completedAt) {
    const additions: typeof recorded = [];
    for (const ticket of tickets) {
      if (ticket.doneAt || !ticket.assigneeUserId) continue;
      for (const device of held.get(ticket.assigneeUserId) || []) {
        if (!recorded.some(item => item.ticketId === ticket.id && item.deviceId === device.id)) additions.push({ ticketId: ticket.id, deviceId: device.id, deviceName: device.name });
      }
    }
    // D1 caps bound parameters per statement, so insert in small chunks.
    for (let i = 0; i < additions.length; i += 30) await db.insert(goliveTicketDevices).values(additions.slice(i, i + 30)).onConflictDoNothing();
    recorded.push(...additions);
    for (const ticket of tickets) {
      if (ticket.doneAt) continue;
      const ticked = new Set(checks.filter(item => item.ticketId === ticket.id).map(item => item.deviceId));
      const required = new Set([...recorded.filter(item => item.ticketId === ticket.id).map(item => item.deviceId), ...ticked]);
      if (required.size > 0 && Array.from(required).every(id => ticked.has(id))) {
        ticket.doneAt = now;
        await db.update(goliveTickets).set({ doneAt: now }).where(eq(goliveTickets.id, ticket.id));
      }
    }
  }
  return { tickets, held, checks, recorded };
}

async function deleteRelease(db: Db, releaseId: string) {
  const ticketIds = (await db.select({ id: goliveTickets.id }).from(goliveTickets).where(eq(goliveTickets.releaseId, releaseId))).map(item => item.id);
  for (let i = 0; i < ticketIds.length; i += 90) {
    await db.delete(goliveDeviceChecks).where(inArray(goliveDeviceChecks.ticketId, ticketIds.slice(i, i + 90)));
    await db.delete(goliveTicketDevices).where(inArray(goliveTicketDevices.ticketId, ticketIds.slice(i, i + 90)));
  }
  await db.delete(goliveTickets).where(eq(goliveTickets.releaseId, releaseId));
  await db.delete(goliveReleases).where(eq(goliveReleases.id, releaseId));
}

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const db = getDb();
    const rows = await db.select().from(goliveReleases).orderBy(desc(goliveReleases.createdAt));
    const counts = await db.select({ releaseId: goliveTickets.releaseId, count: sql<number>`count(*)` }).from(goliveTickets).groupBy(goliveTickets.releaseId);
    const releases = rows.map(item => ({ ...item, ticketCount: counts.find(row => row.releaseId === item.id)?.count ?? 0 }));
    // Open the newest running release by default; history is opened explicitly.
    const releaseId = new URL(request.url).searchParams.get("release") || releases.find(item => !item.completedAt)?.id || "";
    const { tickets, held, checks, recorded } = await loadRelease(db, releaseId);
    return Response.json({ releases, releaseId, tickets, devicesByUser: Object.fromEntries(held), checks, recorded }, noStore);
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
      await db.insert(goliveReleases).values({ id, name, createdBy: profile?.displayName || user.displayName || user.email, createdAt: now });
      // D1 caps bound parameters per statement, so insert in small chunks.
      for (let i = 0; i < tickets.length; i += 10) {
        await db.insert(goliveTickets).values(tickets.slice(i, i + 10).map(item => ({ ...item, assigneeUserId: item.assignee ? matchAccount(profiles, item.assignee) : null, releaseId: id, updatedAt: now })));
      }
      return Response.json({ releaseId: id, count: tickets.length });
    }
    if (body.action === "toggle-check") {
      const ticketId = Number(body.ticketId), deviceId = clean(body.deviceId, 120);
      const [ticket] = await db.select().from(goliveTickets).where(eq(goliveTickets.id, ticketId));
      if (!ticket) return error("Không tìm thấy ticket.", 404);
      const profiles = await db.select({ userId: userProfiles.userId, displayName: userProfiles.displayName }).from(userProfiles);
      const tester = ticket.assigneeUserId ?? (ticket.assignee ? matchAccount(profiles, ticket.assignee) : null);
      if (tester !== user.userId) return error("Chỉ người test của ticket này mới được tích checklist.", 403);
      const [release] = await db.select({ completedAt: goliveReleases.completedAt }).from(goliveReleases).where(eq(goliveReleases.id, ticket.releaseId));
      if (release?.completedAt) return error("Đợt golive đã hoàn thành, không thể sửa checklist.", 409);
      if (body.checked === false) {
        await db.delete(goliveDeviceChecks).where(and(eq(goliveDeviceChecks.ticketId, ticketId), eq(goliveDeviceChecks.deviceId, deviceId)));
        await db.update(goliveTickets).set({ doneAt: null }).where(eq(goliveTickets.id, ticketId));
      } else {
        // A device handed over before it was ticked can still be ticked if it was tested in time.
        const device = (await devicesHeldBy(db, profiles, [user.userId])).get(user.userId)?.find(item => item.id === deviceId)
          ?? (await db.select({ id: goliveTicketDevices.deviceId, name: goliveTicketDevices.deviceName }).from(goliveTicketDevices).where(and(eq(goliveTicketDevices.ticketId, ticketId), eq(goliveTicketDevices.deviceId, deviceId))))[0];
        if (!device) return error("Thiết bị này không nằm trong danh sách test của ticket.", 409);
        await db.insert(goliveDeviceChecks).values({ ticketId, deviceId, deviceName: device.name, checkedByUserId: user.userId, checkedAt: now }).onConflictDoNothing();
      }
      const { tickets, recorded } = await loadRelease(db, ticket.releaseId, now);
      return Response.json({ doneAt: tickets.find(item => item.id === ticketId)?.doneAt ?? null, recorded: recorded.filter(item => item.ticketId === ticketId) });
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
