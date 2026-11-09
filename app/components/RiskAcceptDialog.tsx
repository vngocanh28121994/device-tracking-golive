"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldAlert, X } from "lucide-react";

// A Manager accepts a failed ticket as it is. The reason is mandatory and stays on record.
export function RiskAcceptDialog({ issueKey, failedReason, busy, onCancel, onSubmit }: {
  issueKey: string; failedReason: string; busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    field.current?.focus();
    return () => element?.close();
  }, []);
  const trimmed = reason.trim();
  return <dialog ref={dialog} className="modal confirm-dialog cannot-test-dialog" aria-labelledby="risk-accept-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (trimmed) onSubmit(trimmed); }}>
      <div className="modal-head">
        <div className="confirm-head"><span className="confirm-icon confirm-icon-failed" aria-hidden="true"><ShieldAlert size={20} /></span><h2 id="risk-accept-title">Chấp nhận rủi ro?</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </div>
      <p className="confirm-message">Ticket <strong>{issueKey}</strong> đang test failed{failedReason ? <>: <em>{failedReason}</em></> : null}. Chấp nhận rủi ro sẽ coi ticket là xong để chốt đợt, và quyết định này được ghi lại.</p>
      <label>Lý do chấp nhận rủi ro<textarea ref={field} rows={3} maxLength={500} value={reason} required onChange={event => setReason(event.target.value)} placeholder="Ví dụ: Lỗi nhỏ, sẽ sửa ở bản vá tuần sau" /></label>
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button danger-button" disabled={busy || !trimmed}>Chấp nhận rủi ro</button>
      </div>
    </form>
  </dialog>;
}
