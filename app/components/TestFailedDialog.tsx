"use client";
import { useEffect, useRef, useState } from "react";
import { XCircle, X } from "lucide-react";

// Asks what failed. Unlike every skip kind this mark leaves the ticket outstanding, so the dialog
// says so plainly: the release stays blocked until the failure is withdrawn.
export function TestFailedDialog({ issueKey, initialReason = "", editing = false, busy, onCancel, onSubmit }: {
  issueKey: string; initialReason?: string; editing?: boolean; busy: boolean;
  onCancel: () => void; onSubmit: (reason: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState(initialReason);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    field.current?.select();
    return () => element?.close();
  }, []);
  const trimmed = reason.trim();
  return <dialog ref={dialog} className="modal confirm-dialog cannot-test-dialog" aria-labelledby="test-failed-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (trimmed) onSubmit(trimmed); }}>
      <div className="modal-head">
        <div className="confirm-head"><span className="confirm-icon confirm-icon-failed" aria-hidden="true"><XCircle size={20} /></span><h2 id="test-failed-title">{editing ? "Sửa lý do test failed" : "Đánh dấu test failed?"}</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </div>
      <p className="confirm-message">Ticket <strong>{issueKey}</strong> <strong>không</strong> chuyển sang Done: đợt golive chưa hoàn thành được khi còn ticket test failed. Có thể thu hồi sau.</p>
      <label>Lý do test failed<textarea ref={field} rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} required placeholder="Ví dụ: Nút thanh toán không phản hồi trên iOS 18" /></label>
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="danger-button" disabled={busy || !trimmed}>{editing ? "Lưu" : "Đánh dấu test failed"}</button>
      </div>
    </form>
  </dialog>;
}
