"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Waiving a device that was handed over before it was ticked needs a reason, e.g. someone else tested it.
export function WaiveDeviceDialog({ deviceName, busy, onCancel, onSubmit }: { deviceName: string; busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), field = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    field.current?.focus();
    return () => element?.close();
  }, []);
  const trimmed = reason.trim();
  return <dialog ref={dialog} className="modal confirm-dialog cannot-test-dialog" aria-labelledby="waive-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (trimmed) onSubmit(trimmed); }}>
      <div className="modal-head"><h2 id="waive-title">Miễn máy {deviceName}?</h2>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button></div>
      <p className="confirm-message">Máy này đã bàn giao đi mà chưa được tích. Ticket sẽ không còn chờ máy này nữa.</p>
      <label>Lý do miễn<textarea ref={field} rows={3} maxLength={500} value={reason} required onChange={event => setReason(event.target.value)} placeholder="Ví dụ: Đã chuyển cho An test" /></label>
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button" disabled={busy || !trimmed}>Miễn máy này</button>
      </div>
    </form>
  </dialog>;
}
