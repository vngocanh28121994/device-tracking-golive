import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { dailyChecks, devices, teamsDeliveries, teamsSettings } from "../../db/schema";
import { getChatGPTUser } from "../chatgpt-auth";
import { buildTeamsReport, businessDate, isReportTime, validateWebhook } from "./teams-report";

const runtime = () => env as unknown as Record<string, string | undefined>;
export async function isSiteOwner() {
  const user = await getChatGPTUser();
  const owner = runtime().SITE_OWNER_EMAIL;
  return Boolean(owner && user?.email.toLowerCase() === owner.toLowerCase());
}

async function encryptionKey() {
  const value = runtime().TEAMS_CONFIG_KEY;
  if (!value) throw new Error("Cấu hình bảo mật Teams chưa sẵn sàng.");
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(value), char => char.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(cipher))}`;
}
async function decrypt(value: string) {
  const [iv, cipher] = value.split(".");
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await encryptionKey(), fromBase64(cipher));
  return new TextDecoder().decode(data);
}

export async function readTeamsSettings() {
  const db = getDb();
  const [settings] = await db.select().from(teamsSettings).where(eq(teamsSettings.id, "teams")).limit(1);
  const [lastDelivery] = await db.select({ status: teamsDeliveries.status, message: teamsDeliveries.message, createdAt: teamsDeliveries.createdAt, sentAt: teamsDeliveries.sentAt })
    .from(teamsDeliveries).orderBy(desc(teamsDeliveries.createdAt)).limit(1);
  return {
    isOwner: true, configured: Boolean(settings?.encryptedWebhook), enabled: settings?.enabled ?? false,
    targetLabel: settings?.targetLabel ?? "", scheduleReady: runtime().TEAMS_SCHEDULE_READY === "1", lastDelivery: lastDelivery ?? null,
  };
}

export async function saveTeamsSettings(body: Record<string, unknown>) {
  const db = getDb();
  const [previous] = await db.select().from(teamsSettings).where(eq(teamsSettings.id, "teams")).limit(1);
  let encryptedWebhook = previous?.encryptedWebhook ?? null;
  if (body.webhookUrl !== undefined && body.webhookUrl !== "") encryptedWebhook = await encrypt(validateWebhook(body.webhookUrl));
  if (body.removeWebhook === true) encryptedWebhook = null;
  const targetLabel = typeof body.targetLabel === "string" ? body.targetLabel.trim().slice(0, 100) : previous?.targetLabel ?? "";
  const enabled = body.enabled === true;
  if (enabled && !encryptedWebhook) throw new Error("Hãy lưu URL webhook trước khi bật báo cáo.");
  const values = { encryptedWebhook, targetLabel, enabled, updatedAt: new Date().toISOString() };
  await db.insert(teamsSettings).values({ id: "teams", ...values }).onConflictDoUpdate({ target: teamsSettings.id, set: values });
  return readTeamsSettings();
}

export async function sendTeamsReport(testRequestId?: string) {
  const test = Boolean(testRequestId);
  const date = businessDate();
  const db = getDb();
  const [settings] = await db.select().from(teamsSettings).where(eq(teamsSettings.id, "teams")).limit(1);
  if (!settings?.encryptedWebhook || (!test && !settings.enabled)) return { status: "skipped", message: "Báo cáo Teams đang tắt hoặc chưa có webhook." };
  if (!test && !isReportTime()) return { status: "skipped", message: "Chưa đến giờ gửi báo cáo 19:05." };
  const id = test ? `test:${testRequestId}` : `daily:${date}`;
  const inserted = await db.insert(teamsDeliveries).values({ id, reportDate: date, status: "sending", createdAt: new Date().toISOString() })
    .onConflictDoNothing().returning({ id: teamsDeliveries.id });
  if (!inserted.length) return { status: "skipped", message: "Lần gửi này đã được xử lý. Không gửi lặp lại." };
  let requestStarted = false;
  try {
    const items = await db.select({ id: devices.id, name: devices.name, holder: devices.holder }).from(devices).where(eq(devices.archived, false));
    const checks = await db.select({ deviceId: dailyChecks.deviceId }).from(dailyChecks).where(eq(dailyChecks.date, date));
    const report = buildTeamsReport(items, new Set(checks.map(check => check.deviceId)), date, test);
    const webhook = validateWebhook(await decrypt(settings.encryptedWebhook));
    const request = new Request(webhook, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report.payload),
      redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    requestStarted = true;
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Teams từ chối yêu cầu (HTTP ${response.status}). Kiểm tra webhook và quyền của Workflow.`);
    const responseText = (await response.text()).trim();
    if (/^(Microsoft Teams endpoint returned HTTP error|0$)/i.test(responseText)) throw new Error("Teams báo lỗi khi nhận thông báo. Hãy kiểm tra Workflow.");
    const message = `${test ? "Gửi thử" : "Báo cáo"}: ${report.done}/${report.total} đã chốt, ${report.pending} chưa chốt.`;
    await db.update(teamsDeliveries).set({ status: "sent", message, sentAt: new Date().toISOString() }).where(eq(teamsDeliveries.id, id));
    return { status: "sent", message };
  } catch (error) {
    const message = error instanceof Error && /^Teams /.test(error.message) ? error.message : requestStarted
      ? `${error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "Hết thời gian chờ phản hồi từ Teams." : "Không nhận được phản hồi từ Teams."} Chưa xác định được tin đã được nhận hay chưa. Kiểm tra Teams / lịch sử Workflow trước khi gửi lại.`
      : "Không thể chuẩn bị báo cáo. Hãy kiểm tra cấu hình Teams.";
    await db.update(teamsDeliveries).set({ status: requestStarted && !message.startsWith("Teams ") ? "unknown" : "failed", message }).where(eq(teamsDeliveries.id, id));
    throw new Error(message);
  }
}
