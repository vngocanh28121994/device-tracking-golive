"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Rocket, Search, X } from "lucide-react";

export type RetestCandidate = { id: number; issueKey: string; summary: string; assignee: string; status: string; preselected: boolean };

// "Đã push app": asks for the build number. For a new build it also asks which tickets must be tested again;
// the ones that failed before are ticked, the rest keep their result and read "Build cũ".
export function AppPushDialog({ mode, initialBuild = "", candidates = [], busy, onCancel, onSubmit }: {
  mode: "first" | "again" | "edit"; initialBuild?: string; candidates?: RetestCandidate[]; busy: boolean;
  onCancel: () => void; onSubmit: (build: string, retestTicketIds: number[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLInputElement>(null);
  const [build, setBuild] = useState(initialBuild), [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>(() => candidates.filter(item => item.preselected).map(item => item.id));
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    field.current?.focus();
    return () => element?.close();
  }, []);
  const term = query.trim().toLowerCase();
  const shown = useMemo(() => candidates.filter(item => !term || (item.issueKey + " " + item.summary + " " + item.assignee).toLowerCase().includes(term)), [candidates, term]);
  const trimmed = build.trim();
  const title = mode === "first" ? "Xác nhận đã push app" : mode === "again" ? "Đã push bản app mới" : "Sửa số build";
  return <dialog ref={dialog} className="modal confirm-dialog cannot-test-dialog app-push-dialog" aria-labelledby="app-push-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (trimmed) onSubmit(trimmed, picked); }}>
      <div className="modal-head">
        <div className="confirm-head"><span className="confirm-icon" aria-hidden="true"><Rocket size={20} /></span><h2 id="app-push-title">{title}</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </div>
      <p className="confirm-message">{mode === "first" ? "Checklist test app sẽ mở và QE có ticket trong đợt sẽ nhận thông báo bắt đầu test app."
        : mode === "again" ? "Chọn các ticket cần test lại trên bản mới. Ticket không chọn giữ kết quả cũ và được gắn nhãn “Build cũ”; ticket đang test dở mà không chọn sẽ giữ các dấu tích của bản cũ."
        : "Sửa lại số build hiện tại khi nhập sai."}</p>
      <label>Số build<input ref={field} value={build} maxLength={40} required onChange={event => setBuild(event.target.value)} placeholder="Ví dụ: 1.2.3 (456)" /></label>
      {mode === "again" && <div className="retest-picker">
        <div className="retest-tools">
          <div className="search"><Search size={16} aria-hidden="true" /><input aria-label="Tìm ticket" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã, tên ticket, người test..." /></div>
          <button type="button" className="text-button" onClick={() => setPicked(Array.from(new Set([...picked, ...shown.map(item => item.id)])))}>Chọn tất cả</button>
          <button type="button" className="text-button" onClick={() => setPicked(picked.filter(id => !shown.some(item => item.id === id)))}>Bỏ chọn</button>
        </div>
        <p className="retest-count"><strong>{picked.length}</strong>/{candidates.length} ticket test lại</p>
        {candidates.length === 0 ? <p className="muted">Chưa có ticket nào có kết quả.</p>
          : <ul className="retest-list">{shown.map(item => <li key={item.id}><label>
            <input type="checkbox" checked={picked.includes(item.id)} onChange={event => setPicked(event.target.checked ? [...picked, item.id] : picked.filter(id => id !== item.id))} />
            <span className="retest-main"><strong>{item.issueKey}</strong> {item.summary}<small>{item.assignee || "Chưa có người test"} · {item.status}</small></span>
          </label></li>)}</ul>}
      </div>}
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button" disabled={busy || !trimmed}>{mode === "edit" ? "Lưu" : mode === "again" ? "Đã push bản mới" : "Đã push app"}</button>
      </div>
    </form>
  </dialog>;
}
