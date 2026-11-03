"use client";
import { useEffect, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

// The first request after an idle spell waits for the server to wake up,
// so a long wait explains itself instead of looking like a frozen page.
const SLOW_MS = 4000, STUCK_MS = 20000;

export function LoadingState({ label }: { label: string }) {
  const [elapsed, setElapsed] = useState<"normal" | "slow" | "stuck">("normal");
  useEffect(() => {
    const slow = setTimeout(() => setElapsed("slow"), SLOW_MS);
    const stuck = setTimeout(() => setElapsed("stuck"), STUCK_MS);
    return () => { clearTimeout(slow); clearTimeout(stuck); };
  }, []);
  return <div className="loading" role="status" aria-live="polite">
    <div className="loading-bars" aria-hidden="true"><span /><span /><span /></div>
    <p className="loading-label"><Loader2 className="loading-spinner" size={18} aria-hidden="true" />{label}</p>
    {elapsed === "slow" && <p className="loading-hint">Máy chủ đang khởi động lại sau một lúc không ai dùng, thường mất 5–15 giây. Trang vẫn đang chạy, bạn chờ chút nhé.</p>}
    {elapsed === "stuck" && <p className="loading-hint">Lâu hơn bình thường. Kiểm tra kết nối mạng hoặc thử tải lại trang.
      <button type="button" className="outline-button loading-retry" onClick={() => window.location.reload()}><RotateCw size={15} aria-hidden="true" /> Tải lại trang</button></p>}
  </div>;
}
