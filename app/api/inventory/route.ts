import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { dailyChecks, devices, userProfiles } from "../../../db/schema";

const samples = [
  { id: "sample-laptop", name: "Laptop Dell Latitude", code: "LT-001", category: "Laptop", quantity: 8, holder: "Kho thiết bị", condition: "Tốt", note: "Dữ liệu mẫu" },
  { id: "sample-ipad", name: "iPad Gen 10", code: "TB-002", category: "Máy tính bảng", quantity: 5, holder: "Nhóm Marketing", condition: "Tốt", note: "Dữ liệu mẫu" },
  { id: "sample-camera", name: "Máy ảnh Sony A6400", code: "CA-003", category: "Máy ảnh", quantity: 2, holder: "Minh Anh", condition: "Cần kiểm tra", note: "Dữ liệu mẫu" },
  { id: "sample-headphone", name: "Tai nghe Sony WH-1000XM5", code: "HP-004", category: "Âm thanh", quantity: 6, holder: "Kho thiết bị", condition: "Tốt", note: "Dữ liệu mẫu" },
  { id: "sample-projector", name: "Máy chiếu Epson EB-X06", code: "PJ-005", category: "Trình chiếu", quantity: 3, holder: "Phòng họp A", condition: "Tốt", note: "Dữ liệu mẫu" },
  { id: "sample-microphone", name: "Micro không dây Rode", code: "MC-006", category: "Âm thanh", quantity: 4, holder: "Nhóm Sự kiện", condition: "Cần kiểm tra", note: "Dữ liệu mẫu" },
];

const validConditions = ["Tốt", "Cần kiểm tra", "Hỏng"];
const clean = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET(request: Request) {
  if (!await getChatGPTUser()) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const db = getDb();
    let all = await db.select().from(devices);
    if (all.length === 0) {
      const now = new Date().toISOString();
      await db.insert(devices).values(samples.map((sample) => ({ ...sample, updatedAt: now }))).onConflictDoNothing();
      all = await db.select().from(devices);
    }
    const date = new URL(request.url).searchParams.get("date") ?? "";
    const checks = validDate(date) ? await db.select().from(dailyChecks).where(eq(dailyChecks.date, date)) : [];
    return Response.json({ devices: all.filter((item) => !item.archived), checks });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Không thể tải dữ liệu", 500);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    const now = new Date().toISOString();

    if (body.action === "save-device") {
      const name = clean(body.name, 100);
      const code = clean(body.code, 40);
      const category = clean(body.category, 60) || "Khác";
      const holder = clean(body.holder, 100) || "Kho thiết bị";
      const condition = clean(body.condition, 30) || "Tốt";
      const note = clean(body.note, 500);
      const quantity = Number(body.quantity);
      if (!name) return error("Vui lòng nhập tên thiết bị.");
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) return error("Số lượng phải từ 0 đến 100.000.");
      if (!validConditions.includes(condition)) return error("Tình trạng không hợp lệ.");
      const id = clean(body.id, 100) || crypto.randomUUID();
      const existing = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, id)).limit(1);
      const values = { name, code, category, holder, condition, note, quantity, updatedAt: now };
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

    if (body.action === "save-check") {
      const date = clean(body.date, 10);
      const deviceId = clean(body.deviceId, 100);
      const quantity = Number(body.quantity);
      const holder = clean(body.holder, 100);
      const condition = clean(body.condition, 30);
      const note = clean(body.note, 500);
      if (!validDate(date)) return error("Ngày kiểm kê không hợp lệ.");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (date !== today) return error("Chỉ có thể chốt kiểm kê cho ngày hôm nay.");
      if (!deviceId || !holder) return error("Cần nhập người giữ thiết bị.");
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) return error("Số lượng không hợp lệ.");
      if (!validConditions.includes(condition)) return error("Tình trạng không hợp lệ.");
      const rows = await db.select().from(devices).where(and(eq(devices.id, deviceId), eq(devices.archived, false))).limit(1);
      if (!rows.length) return error("Thiết bị không còn trong danh sách.", 404);
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
      if (!profile) return error("Hãy đặt tên hiển thị cho tài khoản trước khi chốt kiểm kê.");
      const checkedBy = profile.displayName;
      const checkedByUserId = user.userId;
      const checkedByEmail = user.email;
      await db.insert(dailyChecks).values({ date, deviceId, quantity, holder, condition, note, checkedBy, checkedByUserId, checkedByEmail, checkedAt: now })
        .onConflictDoUpdate({ target: [dailyChecks.date, dailyChecks.deviceId], set: { quantity, holder, condition, note, checkedBy, checkedByUserId, checkedByEmail, checkedAt: now } });
      await db.update(devices).set({ quantity, holder, condition, updatedAt: now }).where(eq(devices.id, deviceId));
      return Response.json({ ok: true });
    }
    return error("Thao tác không hợp lệ.");
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Không thể lưu dữ liệu", 500);
  }
}
