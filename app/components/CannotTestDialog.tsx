"use client";
import { useEffect, useRef, useState } from "react";
import { CircleSlash, X } from "lucide-react";

export const DEFAULT_CANNOT_TEST_REASON = "Không có data trên môi trường prod";

// Asks why a ticket cannot be tested and whether its scrum team has been told.
// Opened for a new mark (defaults) or to edit an existing one (its saved values).
export function CannotTestDialog({ issueKey, initialReason = DEFAULT_CANNOT_TEST_REASON, initialNotified = false, editing = false, busy, onCancel, onSubmit }: {
  issueKey: string; initialReason?: string; initialNotified?: boolean; editing?: boolean; busy: boolean;
  onCancel: () => void; onSubmit: (reason: string, notified: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState(initialReason), [notified, setNotified] = useState(initialNotified);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    field.current?.select();
    return () => element?.close();
  }, []);
  const trimmed = reason.trim();
  return <dialog ref={dialog} className="modal confirm-dialog cannot-test-dialog" aria-labelledby="cannot-test-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (trimmed) onSubmit(trimmed, notified); }}>
      <div className="modal-head">
        <div className="confirm-head"><span className="confirm-icon" aria-hidden="true"><CircleSlash size={20} /></span><h2 id="cannot-test-title">{editing ? "Sửa lý do không test được" : "Không test được"}</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </div>
      <p className="confirm-message">Ticket <strong>{issueKey}</strong> chuyển sang Done và ghi lại lý do bên dưới. Có thể thu hồi sau.</p>
      <label>Lý do<textarea ref={field} rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} required /></label>
      <label className="cannot-test-notified"><input type="checkbox" checked={notified} onChange={event => setNotified(event.target.checked)} /> Đã báo scrum team tương ứng</label>
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button" disabled={busy || !trimmed}>{editing ? "Lưu" : "Xác nhận không test được"}</button>
      </div>
    </form>
  </dialog>;
}
