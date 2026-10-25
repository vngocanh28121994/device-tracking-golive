import { and, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { deviceMovements, devices, userProfiles } from "../../../db/schema";
import { avatarUrl } from "../../lib/avatar";
import { recordHolderChange } from "../../lib/device-movements";

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

const clean = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const error = (message: string, status = 400) => Response.json({ error: message }, { status });
async function insertInitialDevices(db: ReturnType<typeof getDb>, now: string) {
  for (let i = 0; i < initialDevices.length; i += 5) {
    await db.insert(devices).values(initialDevices.slice(i, i + 5).map((item) => ({
      ...item, code: "", quantity: 1, holder: "Chưa xác định", note: "", updatedAt: now,
    }))).onConflictDoNothing();
  }
}

export async function GET() {
  if (!await getChatGPTUser()) return error("Vui lòng đăng nhập để sử dụng trang.", 401);
  try {
    const db = getDb();
    let all = await db.select().from(devices);
    if (all.length === 0) {
      const now = new Date().toISOString();
      await insertInitialDevices(db, now);
      all = await db.select().from(devices);
    }
    const active = all.filter((item) => !item.archived);
    const profiles = await db.select({userId:userProfiles.userId,displayName:userProfiles.displayName,avatarKey:userProfiles.avatarKey}).from(userProfiles);
    // Legacy holders have no account ID. Match only a unique name; explicit manual loans use "".
    const resolved = active.map(item => {
      if (item.holderUserId !== null) return item;
      const matches = profiles.filter(person => person.displayName === item.holder);
      return {...item,holderUserId:matches.length === 1 ? matches[0].userId : null};
    });
    const people = profiles.map(person => ({userId:person.userId,displayName:person.displayName,avatar:avatarUrl(person.avatarKey)}));
    return Response.json({ devices: resolved, people }, { headers: { "Cache-Control": "private, no-store" } });
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
      const note = clean(body.note, 500);
      if (!name) return error("Vui lòng nhập tên thiết bị.");
      const id = clean(body.id, 100) || crypto.randomUUID();
      const existing = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, id)).limit(1);
      const values = { name, code, category, holder, holderUserId: "", note, quantity: 1, updatedAt: now };
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, user.userId)).limit(1);
      const actor = { userId: user.userId, name: profile?.displayName || user.displayName, email: user.email };
      if (existing.length) await db.batch([
        recordHolderChange(db, id, holder, "update-holder", actor, now),
        db.update(devices).set(values).where(and(eq(devices.id, id), eq(devices.archived, false))),
      ]);
      else await db.batch([
        db.insert(devices).values({ id, ...values }),
        db.insert(deviceMovements).values({ deviceId: id, action: "created", fromHolder: null, toHolder: holder, actorUserId: actor.userId, actorName: actor.name, actorEmail: actor.email, createdAt: now }),
      ]);
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
      let holderUserId = user.userId;
      if (body.action === "lend-device") {
        if (borrowerUserId) {
          const [borrowerProfile] = await db.select({ displayName: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, borrowerUserId)).limit(1);
          if (!borrowerProfile) return error("Tài khoản người mượn không còn trong danh sách.");
          holder = borrowerProfile.displayName;
          holderUserId = borrowerUserId;
        } else {
          holder = clean(body.borrower, 100);
          holderUserId = "";
        }
      }
      if (!holder) return error("Vui lòng nhập tên người hoặc team mượn.");
      await db.batch([
        recordHolderChange(db, deviceId, holder, body.action === "confirm-hold" ? "hold" : "lend", { userId: user.userId, name: profile.displayName, email: user.email }, now),
        db.update(devices).set({ holder, holderUserId, updatedAt: now }).where(and(eq(devices.id, deviceId), eq(devices.archived, false))),
      ]);
      return Response.json({ ok: true, holder, holderUserId });
    }

    return error("Thao tác không hợp lệ.");
  } catch {
    return error("Không thể lưu dữ liệu", 500);
  }
}
