export const SITE_URL = "https://digital-devices.sillyplume12.chatgpt.site/";
export const businessDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
}).format(now);

export function isReportTime(now = new Date()) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  return time >= "19:05";
}

export function validateWebhook(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("URL webhook không hợp lệ.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("URL webhook không hợp lệ."); }
  const host = url.hostname.toLowerCase();
  const allowed = host.endsWith(".logic.azure.com") || host.endsWith(".environment.api.powerplatform.com") ||
    host.endsWith(".webhook.office.com") || host === "outlook.office.com";
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !allowed || url.pathname === "/") {
    throw new Error("Hãy dùng URL HTTPS webhook của Microsoft Teams / Power Automate.");
  }
  return url.toString();
}

type ReportDevice = { id: string; name: string; holder: string };
const escapeText = (value: string) => value.replace(/[\\`*_\[\]()<>#]/g, "\\$&").replace(/[\r\n]+/g, " ");

export function buildTeamsReport(items: ReportDevice[], checkedIds: Set<string>, date: string, test = false) {
  const pending = items.filter(item => !checkedIds.has(item.id));
  const done = items.length - pending.length;
  const lines: string[] = [];
  let bytes = 0;
  for (const item of pending) {
    const line = `• ${escapeText(item.name)} — Người giữ: ${escapeText(item.holder)}`;
    bytes += new TextEncoder().encode(line).length;
    if (bytes > 16000) break;
    lines.push(line);
  }
  if (lines.length < pending.length) lines.push(`Còn ${pending.length - lines.length} máy khác. Mở website để xem đầy đủ.`);
  const text = pending.length ? lines.join("\n\n") : "🎉 Tất cả thiết bị đã được chốt trong ngày.";
  return {
    total: items.length, done, pending: pending.length,
    payload: {
      type: "message",
      attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.2",
        body: [
          { type: "TextBlock", size: "Large", weight: "Bolder", wrap: true, text: `${test ? "[GỬI THỬ] " : ""}Báo cáo chốt thiết bị · ${date}` },
          { type: "TextBlock", wrap: true, text: `Đã chốt: ${done}/${items.length} · Chưa chốt: ${pending.length}` },
          { type: "TextBlock", weight: "Bolder", text: pending.length ? "Thiết bị chưa chốt" : "Đã chốt đầy đủ" },
          { type: "TextBlock", wrap: true, text },
        ],
        actions: [{ type: "Action.OpenUrl", title: "Mở Digital Devices", url: SITE_URL }],
      } }],
    },
  };
}
