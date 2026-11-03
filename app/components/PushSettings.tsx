"use client";
import { useEffect, useState } from "react";
import { pushEvents, type PushEvent } from "../lib/push-events";

type Settings = Record<PushEvent, boolean>;

// Admin switches for each push type; hidden from accounts that cannot change them.
export function PushSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/push-settings", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as { settings: Settings; canManage: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "Không thể tải cài đặt thông báo.");
      setSettings(data.settings); setCanManage(data.canManage);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Không thể tải cài đặt thông báo."); });
    return () => controller.abort();
  }, []);

  async function toggle(event: PushEvent, enabled: boolean) {
    setSaving(event); setError("");
    try {
      const response = await fetch("/api/push-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, enabled }) });
      const data = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(data.error || "Không thể lưu cài đặt thông báo.");
      setSettings(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể lưu cài đặt thông báo."); }
    finally { setSaving(""); }
  }

  if (!canManage && !error) return null;
  return <section className="panel account-roles push-settings" aria-labelledby="push-settings-title">
    <h2 id="push-settings-title">Thông báo đẩy</h2>
    <p>Chọn những thông báo được gửi cho cả team. Tắt một loại thì không ai nhận loại đó nữa.</p>
    {error && <p className="role-error" role="alert">{error}</p>}
    {settings && <ul className="push-settings-list">{pushEvents.map(item => <li key={item.key}>
      <label>
        <input type="checkbox" checked={settings[item.key]} disabled={!!saving} onChange={event => void toggle(item.key, event.target.checked)} />
        <span><strong>{item.label}</strong><small>Gửi tới: {item.to}</small></span>
      </label>
    </li>)}</ul>}
  </section>;
}
