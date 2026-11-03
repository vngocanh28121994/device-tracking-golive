"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

const KEY = "push-token";

async function save(token: string, enabled: boolean) {
  const response = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, enabled }) });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "Không thể lưu cài đặt thông báo.");
}

// Turns on push for this browser: registers the service worker, gets an FCM token and saves it for the account.
// iPhone/iPad only allow web push from the Home Screen app (iOS 16.4+).
export function PushToggle({ onError, onToast }: { onError: (message: string) => void; onToast: (message: string) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { if ("Notification" in window && Notification.permission === "granted") setToken(localStorage.getItem(KEY)); } catch { /* storage blocked */ }
  }, []);

  async function enable() {
    if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) {
      onError("Trình duyệt này chưa hỗ trợ thông báo đẩy. Trên iPhone, hãy “Thêm vào MH chính” rồi mở trang từ biểu tượng đó.");
      return;
    }
    setBusy(true);
    try {
      const { config, vapidKey } = (await (await fetch("/api/push", { cache: "no-store" })).json()) as { config?: Record<string, string>; vapidKey?: string };
      if (!config) throw new Error("Thông báo đẩy chưa được cấu hình Firebase.");
      if (await Notification.requestPermission() !== "granted") throw new Error("Bạn chưa cho phép thông báo trong trình duyệt.");
      const [{ getApps, initializeApp }, { getMessaging, getToken }] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
      const app = getApps()[0] ?? initializeApp(config);
      await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      const next = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready });
      await save(next, true);
      try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
      setToken(next);
      onToast("Đã bật thông báo trên thiết bị này 🔔");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể bật thông báo."); } finally { setBusy(false); }
  }

  async function disable() {
    if (!token) return;
    setBusy(true);
    try {
      await save(token, false);
      try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
      setToken(null);
      onToast("Đã tắt thông báo trên thiết bị này");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể tắt thông báo."); } finally { setBusy(false); }
  }

  return <button className="outline-button" disabled={busy} onClick={() => void (token ? disable() : enable())}>
    {token ? <BellOff size={18} /> : <Bell size={18} />} {token ? "Tắt thông báo" : "Bật thông báo"}
  </button>;
}
