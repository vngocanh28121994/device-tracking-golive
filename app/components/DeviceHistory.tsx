"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, History } from "lucide-react";

type Entry = { id: number; action: string; fromHolder: string | null; toHolder: string; actorName: string; createdAt: string };
const labels: Record<string, string> = { hold: "Nhận / lấy lại máy", lend: "Cho mượn", "update-holder": "Cập nhật người giữ", created: "Thêm thiết bị" };
const formatTime = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function DeviceHistory({ deviceId, onBack }: { deviceId: string; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (before?: number, signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/inventory/history?deviceId=" + encodeURIComponent(deviceId) + (before ? "&before=" + before : ""), { cache: "no-store", signal });
      const data = await response.json() as { entries: Entry[]; nextCursor: number | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Không thể tải lịch sử.");
      if (signal?.aborted) return;
      setEntries(current => before ? [...new Map([...current, ...data.entries].map(entry => [entry.id, entry])).values()] : data.entries);
      setNextCursor(data.nextCursor);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Không thể tải lịch sử."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [deviceId]);
  useEffect(() => { const controller = new AbortController(); void load(undefined, controller.signal); return () => controller.abort(); }, [load]);

  return <div className="device-history">
    <h3><History size={18} /> Lịch sử giữ thiết bị</h3>
    <p className="history-description">Các lần bàn giao được ghi nhận từ khi bật lịch sử, mới nhất ở trên. Thời gian theo giờ Việt Nam.</p>
    <div className="history-scroll" aria-live="polite" aria-busy={loading}>
      {entries.length > 0 && <ol className="history-timeline">{entries.map(entry => <li key={entry.id}>
        <div className="history-event-head"><strong>{labels[entry.action] || "Bàn giao thiết bị"}</strong><time dateTime={entry.createdAt}>{formatTime(entry.createdAt)}</time></div>
        <div className="history-transfer">{entry.fromHolder !== null && <><span>{entry.fromHolder}</span><ArrowRight size={15} /></>}<b>{entry.toHolder}</b></div>
        <small>Thực hiện bởi <strong>{entry.actorName}</strong></small>
      </li>)}</ol>}
      {!loading && !error && entries.length === 0 && <div className="history-empty"><History size={28} aria-hidden="true"/>Chưa có lượt bàn giao được ghi nhận.<p>Các lần nhận máy và cho mượn từ bây giờ sẽ xuất hiện ở đây.</p></div>}
      {loading && <p className="history-loading" role="status">Đang tải lịch sử...</p>}
      {error && <div className="history-error" role="alert">{error}<button className="text-button" onClick={() => void load(entries.length ? nextCursor ?? undefined : undefined)}>Thử lại</button></div>}
      {!loading && !error && nextCursor !== null && <button className="outline-button history-more" onClick={() => void load(nextCursor)}>Xem thêm lịch sử</button>}
    </div>
    <div className="modal-actions"><button className="outline-button" onClick={onBack}><ArrowLeft size={16} /> Quay lại thao tác</button></div>
  </div>;
}
