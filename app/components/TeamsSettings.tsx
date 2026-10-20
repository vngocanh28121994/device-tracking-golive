"use client";
import { useEffect, useState } from "react";
import { Check, Send } from "lucide-react";

type Settings = {
  isOwner: boolean; configured: boolean; enabled: boolean; targetLabel: string; scheduleReady: boolean;
  lastDelivery: { status: string; message: string; createdAt: string; sentAt: string | null } | null;
};

export function TeamsSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const apply = (value: Settings) => { setSettings(value); setEnabled(value.enabled); setTargetLabel(value.targetLabel); };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/teams-settings", { cache: "no-store" });
        const data = await response.json() as Settings & { error?: string };
        if (!response.ok) throw new Error(data.error || "Không thể tải cấu hình Teams.");
        if (active) apply(data);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Không thể tải cấu hình Teams."); }
    })();
    return () => { active = false; };
  }, []);

  async function submit(action: "save" | "test", removeWebhook = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/teams-settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "test" ? { action, requestId: crypto.randomUUID() }
          : { action, webhookUrl, targetLabel, enabled: removeWebhook ? false : enabled, removeWebhook }),
      });
      const data = await response.json() as Settings & { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Không thể cập nhật Teams.");
      if (action === "save") { apply(data); setWebhookUrl(""); setMessage(removeWebhook ? "Đã xóa webhook và tắt báo cáo." : "Đã lưu cấu hình Teams."); }
      else {
        setMessage(data.message || "Đã gửi yêu cầu đến Teams.");
        const refreshed = await fetch("/api/teams-settings", { cache: "no-store" });
        if (refreshed.ok) apply(await refreshed.json() as Settings);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể cập nhật Teams."); }
    finally { setBusy(false); }
  }

  if (settings && !settings.isOwner) return null;
  if (!settings) return error ? <p className="teams-feedback error" role="alert">{error}</p> : null;
  const dirty = Boolean(webhookUrl) || enabled !== settings.enabled || targetLabel !== settings.targetLabel;
  return <section className="panel teams-settings" aria-label="Cấu hình thông báo Teams">
    <div className="teams-heading"><span>💬</span><div><span className="section-kicker">CHỈ CHỦ WEBSITE</span><h2>Báo cáo chốt máy qua Teams</h2></div></div>
    <p className="teams-copy">Hằng ngày lúc <strong>19:05 · giờ Việt Nam</strong>, gửi số máy đã chốt và các máy chưa chốt kèm người đang giữ. Nếu chốt đủ, báo cáo sẽ thông báo hoàn thành.</p>
    <div className={"teams-schedule-note " + (settings.scheduleReady ? "ready" : "")}>
      {settings.scheduleReady ? "✓ Đã tạo lịch gửi hằng ngày lúc 19:05. Lưu webhook và bật báo cáo để sử dụng." : "Lịch tự động chưa được kích hoạt. Bạn có thể lưu webhook và gửi thử trước."}
    </div>
    <label className="teams-label" htmlFor="teams-target">TÊN NHÓM / KÊNH</label>
    <input id="teams-target" value={targetLabel} onChange={event => setTargetLabel(event.target.value)} maxLength={100} placeholder="Ví dụ: Team QA · Quản lý thiết bị" autoComplete="off" />
    <label className="teams-label" htmlFor="teams-webhook">TEAMS WEBHOOK URL</label>
    <input id="teams-webhook" type="password" value={webhookUrl} onChange={event => setWebhookUrl(event.target.value)} autoComplete="new-password" spellCheck={false} placeholder={settings.configured ? "Đã lưu webhook. Để trống nếu giữ nguyên." : "Dán URL webhook từ Teams Workflows"} />
    <p className="teams-help">URL được lưu mã hóa và không hiển thị lại. Tạo Workflow “Post to a channel when a webhook request is received” trong Teams, chọn nơi nhận và quyền gọi “Anyone”, sau đó dán URL tại đây. <a href="https://support.microsoft.com/en-gb/workflows/send-messages-in-teams-using-incoming-webhooks" target="_blank" rel="noreferrer">Xem hướng dẫn Microsoft ↗</a></p>
    <label className="teams-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span>Bật báo cáo tự động sau 19h</span></label>
    <div className="teams-actions">
      <button className="primary-button" disabled={busy} onClick={() => void submit("save")}>{busy ? "Đang xử lý..." : "Lưu cấu hình"} <Check size={16} /></button>
      <button className="outline-button" disabled={busy || !settings.configured || dirty} onClick={() => void submit("test")}>Gửi thử <Send size={15} /></button>
      {settings.configured && <button className="text-button teams-remove" disabled={busy} onClick={() => void submit("save", true)}>Xóa webhook</button>}
    </div>
    {dirty && <p className="teams-help">Lưu cấu hình trước khi gửi thử.</p>}
    {message && <p className="teams-feedback" role="status">{message}</p>}
    {error && <p className="teams-feedback error" role="alert">{error}</p>}
    {settings.lastDelivery && <div className="teams-last"><strong>Lần gửi gần nhất</strong><span>{new Date(settings.lastDelivery.sentAt || settings.lastDelivery.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span><p>{settings.lastDelivery.message || "Đang xử lý yêu cầu gửi. Kiểm tra Teams trước khi gửi lại."}</p></div>}
  </section>;
}
