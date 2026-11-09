"use client";
import { useEffect, useRef, useState } from "react";
import { Undo2, X } from "lucide-react";

type Mode = "mistake" | "retest";

// Withdrawing a Test failed means one of two different things, and they must not be mixed up:
// the mark was a slip (the ticks stay), or the ticket was fixed and has to be tested again (the ticks go).
export function RevokeFailedDialog({ issueKey, phase, busy, onCancel, onSubmit }: {
  issueKey: string; phase: "web" | "app"; busy: boolean; onCancel: () => void; onSubmit: (mode: Mode) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("mistake");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="modal confirm-dialog cannot-test-dialog" aria-labelledby="revoke-failed-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); onSubmit(mode); }}>
      <div className="modal-head">
        <div className="confirm-head"><span className="confirm-icon" aria-hidden="true"><Undo2 size={20} /></span><h2 id="revoke-failed-title">Thu hồi test failed</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </div>
      <p className="confirm-message">Ticket <strong>{issueKey}</strong>: chọn lý do thu hồi.</p>
      <fieldset className="revoke-options">
        <label><input type="radio" name="revoke-mode" checked={mode === "mistake"} onChange={() => setMode("mistake")} />
          <span><strong>Tôi đánh dấu nhầm</strong><small>{phase === "app" ? "Giữ các dấu tích, ticket tính lại Done theo các máy đã tích. Lần failed này không còn tính vào thống kê." : "Ticket về chưa test web. Lần failed này không còn tính vào thống kê."}</small></span></label>
        <label><input type="radio" name="revoke-mode" checked={mode === "retest"} onChange={() => setMode("retest")} />
          <span><strong>Cần test lại</strong><small>{phase === "app" ? "Xoá toàn bộ dấu tích, ticket về In Progress và QE phải tích lại. Lần failed vẫn được ghi nhận." : "Ticket về chưa test web để test lại. Lần failed vẫn được ghi nhận."}</small></span></label>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button" disabled={busy}>Thu hồi</button>
      </div>
    </form>
  </dialog>;
}
