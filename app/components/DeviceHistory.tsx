"use client";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, History } from "lucide-react";

type Entry = { id: number; action: string; fromHolder: string | null; toHolder: string; actorName: string; createdAt: string };
const labels: Record<string, string> = { hold: "Nhận / lấy lại máy", lend: "Cho mượn", "update-holder": "Cập nhật người giữ", created: "Thêm thiết bị" };
const dayKey = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const dayLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
const clock = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function DeviceHistory({ deviceId, onBack }: { deviceId: string; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [cursors, setCursors] = useState<number[]>([]);
  const [range, setRange] = useState({ from: "", to: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const before = cursors.at(-1);
  const filtered = !!(range.from || range.to);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setEntries([]); setNextCursor(null);
    if (scroll.current) scroll.current.scrollTop = 0;
    void (async () => {
      try {
        const params = new URLSearchParams({ deviceId });
        if (before) params.set("before", String(before));
        if (range.from) params.set("from", range.from);
        if (range.to) params.set("to", range.to);
        const response = await fetch("/api/inventory/history?" + params, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { entries: Entry[]; nextCursor: number | null; error?: string };
        if (!response.ok) throw new Error(data.error || "Không thể tải lịch sử.");
        if (!controller.signal.aborted) { setEntries(data.entries); setNextCursor(data.nextCursor); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Không thể tải lịch sử."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [deviceId, before, range.from, range.to, retry]);
  const groups = useMemo(() => {
    const result: { key: string; label: string; entries: Entry[] }[] = [];
    for (const entry of entries) {
      const key = dayKey(entry.createdAt);
      let group = result.at(-1);
      if (!group || group.key !== key) { group = { key, label: dayLabel(entry.createdAt), entries: [] }; result.push(group); }
      group.entries.push(entry);
    }
    return result;
  }, [entries]);
  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const draft = { from: String(values.get("from") || ""), to: String(values.get("to") || "") };
    if (draft.from && draft.to && draft.from > draft.to) { setFilterError("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc."); return; }
    setFilterError(""); setCursors([]); setRange({ ...draft });
  }
  function clearFilter() { setRange({ from: "", to: "" }); setCursors([]); setFilterError(""); }

  return <div className="device-history">
    <h3><History size={18} /> Lịch sử giữ thiết bị</h3>
    <p className="history-description">Mới nhất trước · 20 lượt mỗi trang · Giờ Việt Nam</p>
    <div className="history-tools"><button className="text-button" aria-expanded={showFilters} aria-controls="history-date-filter" onClick={() => setShowFilters(!showFilters)}><CalendarDays size={16} /> Lọc thời gian{filtered && <span className="history-filter-dot" aria-label="Đang áp dụng"/>}</button>{filtered && <button className="text-button" onClick={clearFilter}>Xóa lọc</button>}</div>
    {showFilters && <form key={range.from + "_" + range.to} className="history-filter-form" id="history-date-filter" onSubmit={applyFilter}>
      <label>Từ ngày<input type="date" name="from" defaultValue={range.from} min="1900-01-01" max="9998-12-31"/></label>
      <label>Đến ngày<input type="date" name="to" defaultValue={range.to} min="1900-01-01" max="9998-12-31"/></label>
      <button className="outline-button" type="submit" disabled={loading}>Áp dụng</button>
      {filterError && <p role="alert">{filterError}</p>}
    </form>}
    {filtered && <p className="history-range-summary">{range.from ? "Từ " + dayLabel(range.from + "T00:00:00+07:00") : "Từ đầu lịch sử"}{range.to ? " đến " + dayLabel(range.to + "T00:00:00+07:00") : " đến nay"}</p>}
    <div className="history-scroll" ref={scroll} role="region" aria-label="Các lượt bàn giao" aria-busy={loading} tabIndex={0}>
      {groups.map(group => <section className="history-day" key={group.key}><h4>{group.label}</h4><ol className="history-timeline">{group.entries.map(entry => <li key={entry.id}>
        <div className="history-event-head"><strong>{labels[entry.action] || "Bàn giao thiết bị"}</strong><time dateTime={entry.createdAt} title={dayLabel(entry.createdAt)}>{clock(entry.createdAt)}</time></div>
        <div className="history-transfer">{entry.fromHolder !== null && <><span>{entry.fromHolder}</span><ArrowRight size={15} /></>}<b>{entry.toHolder}</b></div>
        <small>Thực hiện bởi <strong>{entry.actorName}</strong></small>
      </li>)}</ol></section>)}
      {!loading && !error && entries.length === 0 && <div className="history-empty"><History size={28} aria-hidden="true"/>{filtered ? "Không có lượt bàn giao trong khoảng ngày này." : "Chưa có lượt bàn giao được ghi nhận."}<p>{filtered ? "Thử khoảng ngày khác hoặc xóa bộ lọc." : "Các lần nhận máy và cho mượn từ khi bật lịch sử sẽ xuất hiện ở đây."}</p></div>}
      {loading && <p className="history-loading" role="status">Đang tải lịch sử...</p>}
      {error && <div className="history-error" role="alert">{error}<button className="text-button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></div>}
    </div>
    <div className="history-pagination" aria-label="Chuyển trang lịch sử">
      <span role="status">Trang {cursors.length + 1}{!loading && !error && " · " + entries.length + " lượt"}</span>
      <div><button className="outline-button" disabled={loading || !cursors.length} onClick={() => setCursors(value => value.slice(0, -1))}><ChevronLeft size={16}/> Mới hơn</button><button className="outline-button" disabled={loading || !!error || nextCursor === null} onClick={() => { if (nextCursor !== null) setCursors(value => [...value, nextCursor]); }}>Cũ hơn <ChevronRight size={16}/></button></div>
    </div>
    <div className="modal-actions"><button className="outline-button" onClick={onBack}><ArrowLeft size={16} /> Quay lại thao tác</button></div>
  </div>;
}
