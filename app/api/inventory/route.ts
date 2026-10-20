import { and, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { dailyChecks, devices, userProfiles } from "../../../db/schema";

const initialDevices = [
  { id: "ios-iphone-se", name: "iPhone SE", category: "iOS" },
  { id: "ios-iphone-16-promax", name: "iPhone 16 promax", category: "iOS" },
  { id: "ios-iphone-12-promax", name: "iPhone 12 promax", category: "iOS" },
  { id: "ios-iphone-12-pro", name: "iPhone 12 pro", category: "iOS" },
  { id: "ios-ipad-air-11", name: "iPad Air 11 inch", category: "iOS" },
  { id: "ios-ipad-pro-2015", name: "iPad Pro (2015)", category: "iOS" },
  { id: "ios-ipad-pro-2018", name: "iPad Pro (2018)", category: "iOS" },
  { id: "ios-iphone-12-promax-new", name: "iPhone 12 promax (mới nhận)", category: "iOS" },
  { id: "android-samsung-s23-ultra", name: "Samsung S23 Ultra", category: "Android" },
  { id: "android-samsung-a56", name: "Samsung A56", category: "Android" },
  { id: "android-samsung-a51", name: "Samsung A51", category: "Android" },
  { id: "android-xiaomi-14t", name: "Xiaomi 14T", category: "Android" },
  { id: "android-oppo-find-x9", name: "Oppo Find X9", category: "Android" },
  { id: "android-redmi-note-14", name: "Redmi Note 14", category: "Android" },
  { id: "android-samsung-a52", name: "Samsung A52", category: "Android" },
];
const oldSampleIds = ["sample-laptop", "sample-ipad", "sample-camera", "sample-headphone", "sample-projector", "sample-microphone"];

const validConditions = ["Chưa kiểm tra", "Tốt", "Cần kiểm tra", "Hỏng"];
const clean = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
async function insertInitialDevices(db: ReturnType<typeof getDb>, now: string) {
  for (let i = 0; i < initialDevices.length; i += 5) {
    await db.insert(devices).values(initialDevices.slice(i, i + 5).map((item) => ({
      ...item, code: "", quantity: 1, holder: "Chưa xác định", condition: "Chưa kiểm tra", note: "", updatedAt: now,
    }))).onConflictDoNothing();
  }
}

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const db = getDb();
    let all = await db.select().from(devices);
    if (all.length === 0) {
      const now = new Date().toISOString();
      await insertInitialDevices(db, now);
      all = await db.select().from(devices);
    }
    const date = new URL(request.url).searchParams.get("date") ?? "";
    const active = all.filter((item) => !item.archived);
    const activeIds = new Set(active.map((item) => item.id));
    const checks = validDate(date) ? (await db.select().from(dailyChecks).where(eq(dailyChecks.date, date))).filter((item) => activeIds.has(item.deviceId)) : [];
    return Response.json({ devices: active, checks }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return error("Không thể tải dữ liệu", 500);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    const now = new Date().toISOString();

    if (body.action === "replace-samples") {
      await insertInitialDevices(db, now);
      await db.update(devices).set({ archived: true, updatedAt: now }).where(inArray(devices.id, oldSampleIds));
      return Response.json({ ok: true });
    }

    if (body.action === "save-device") {
      const name = clean(body.name, 100);
      const code = clean(body.code, 40);
      const category = clean(body.category, 60) || "Khác";
      const holder = clean(body.holder, 100) || "Chưa xác định";
      const condition = clean(body.condition, 30) || "Chưa kiểm tra";
      const note = clean(body.note, 500);
      if (!name) return error("Vui lòng nhập tên thiết bị.");
      if (!validConditions.includes(condition)) return error("Tình trạng không hợp lệ.");
      const id = clean(body.id, 100) || crypto.randomUUID();
      const existing = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, id)).limit(1);
      const values = { name, code, category, holder, condition, note, quantity: 1, updatedAt: now };
      if (existing.length) await db.update(devices).set(values).where(eq(devices.id, id));
      else await db.insert(devices).values({ id, ...values });
      return Response.json({ ok: true, id });
    }

    if (body.action === "archive-device") {
      const id = clean(body.id, 100);
      if (!id) return error("Thiếu mã thiết bị.");
      await db.update(devices).set({ archived: true, updatedAt: now }).where(eq(devices.id, id));
      return Response.json({ ok: true });
    }

    if (body.action === "confirm-hold" || body.action === "lend-device") {
      const deviceId = clean(body.deviceId, 100);
      if (!deviceId) return error("Thiếu mã thiết bị.");
      const [device] = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, deviceId), eq(devices.archived, false))).limit(1);
      if (!device) return error("Thiết bị không còn trong danh sách.", 404);
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
      if (!profile) return error("Hãy đặt tên hiển thị cho tài khoản trước khi thao tác.");
      const borrowerUserId = clean(body.borrowerUserId, 100);
      let holder = profile.displayName;
      if (body.action === "lend-device") {
        if (borrowerUserId) {
          const [borrowerProfile] = await db.select({ displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, borrowerUserId)).limit(1);
          if (!borrowerProfile) return error("Tài khoản người mượn không còn trong danh sách.");
          holder = borrowerProfile.displayName;
        } else {
          holder = clean(body.borrower, 100);
        }
      }
      if (!holder) return error("Vui lòng nhập tên người hoặc team mượn.");
      await db.update(devices).set({ holder, updatedAt: now }).where(eq(devices.id, deviceId));
      return Response.json({ ok: true, holder });
    }

    if (body.action === "save-check") {
      const date = clean(body.date, 10);
      const deviceId = clean(body.deviceId, 100);
      if (!validDate(date)) return error("Ngày kiểm kê không hợp lệ.");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (date !== today) return error("Chỉ có thể chốt kiểm kê cho ngày hôm nay.");
      if (!deviceId) return error("Thiếu mã thiết bị.");
      const rows = await db.select().from(devices).where(and(eq(devices.id, deviceId), eq(devices.archived, false))).limit(1);
      if (!rows.length) return error("Thiết bị không còn trong danh sách.", 404);
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
      if (!profile) return error("Hãy đặt tên hiển thị cho tài khoản trước khi chốt kiểm kê.");
      const checkedBy = profile.displayName;
      const checkedByUserId = user.userId;
      const checkedByEmail = user.email;
      const quantity = rows[0].quantity;
      const holder = rows[0].holder;
      const condition = rows[0].condition;
      const note = rows[0].note;
      await db.insert(dailyChecks).values({ date, deviceId, quantity, holder, condition, note, checkedBy, checkedByUserId, checkedByEmail, checkedAt: now })
        .onConflictDoUpdate({ target: [dailyChecks.date, dailyChecks.deviceId], set: { quantity, holder, condition, note, checkedBy, checkedByUserId, checkedByEmail, checkedAt: now } });
      return Response.json({ ok: true });
    }
    return error("Thao tác không hợp lệ.");
  } catch {
    return error("Không thể lưu dữ liệu", 500);
  }
}
