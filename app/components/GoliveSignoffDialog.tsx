"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { AttentionItem } from "../lib/golive-acceptance";

export type SignoffSummary = {
  name: string; fixVersion: string; build: string; qeCount: number; manual: boolean;
  web: { tested: number; notNeeded: number; cannotTest: number; riskAccepted: number };
  app: { onDevices: number; confirmed: number; notNeeded: number; cannotTest: number; riskAccepted: number };
  attention: AttentionItem[]; noteRequired: boolean;
};

// The last look before a Manager closes a release: totals, what needs attention, and the note.
export function GoliveSignoffDialog({ summary, busy, onCancel, onSubmit }: { summary: SignoffSummary; busy: boolean; onCancel: () => void; onSubmit: (note: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const trimmed = note.trim(), blocked = summary.noteRequired && !trimmed;
  return <dialog ref={dialog} className="modal confirm-dialog signoff-dialog" aria-labelledby="signoff-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); if (!blocked) onSubmit(trimmed); }}>
      <div className="modal-head">
        <div className="confirm-head"><span className="confirm-icon" aria-hidden="true"><CheckCircle2 size={20} /></span><h2 id="signoff-title">Tổng kết trước khi hoàn thành</h2></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </div>
      <dl className="signoff-info">
        <div><dt>Đợt golive</dt><dd>{summary.name}</dd></div>
        <div><dt>fixVersion</dt><dd>{summary.fixVersion || "—"}</dd></div>
        <div><dt>Build hiện tại</dt><dd>{summary.build || "—"}</dd></div>
        <div><dt>Số QE</dt><dd>{summary.qeCount}</dd></div>
      </dl>
      <div className="signoff-groups">
        {!summary.manual && <section><h3>Web</h3><ul>
          <li>Đã test: <strong>{summary.web.tested}</strong></li><li>Không cần test: <strong>{summary.web.notNeeded}</strong></li>
          <li>Không test được: <strong>{summary.web.cannotTest}</strong></li><li>Chấp nhận rủi ro: <strong>{summary.web.riskAccepted}</strong></li></ul></section>}
        <section><h3>App</h3><ul>
          <li>Test đủ thiết bị: <strong>{summary.app.onDevices}</strong></li><li>Xác nhận đã test: <strong>{summary.app.confirmed}</strong></li>
          <li>Không cần test: <strong>{summary.app.notNeeded}</strong></li><li>Không test được: <strong>{summary.app.cannotTest}</strong></li>
          <li>Chấp nhận rủi ro: <strong>{summary.app.riskAccepted}</strong></li></ul></section>
      </div>
      <section className="signoff-attention"><h3>Cần lưu ý ({summary.attention.length})</h3>
        {summary.attention.length === 0 ? <p className="muted">Không có ticket nào cần lưu ý.</p>
          : <ul>{summary.attention.map(item => <li key={item.ticketId}><strong>{item.issueKey}</strong> <span className="muted">{item.assignee || "Chưa có người test"}</span>
            <ul>{item.reasons.map((reason, index) => <li key={index}>{reason.text}</li>)}</ul></li>)}</ul>}
      </section>
      <label>Ghi chú nghiệm thu{summary.noteRequired ? " (bắt buộc)" : " (tuỳ chọn)"}<textarea rows={3} maxLength={1000} value={note} required={summary.noteRequired} onChange={event => setNote(event.target.value)}
        placeholder={summary.noteRequired ? "Nêu lý do chấp nhận golive khi còn các ticket cần lưu ý" : "Ghi chú thêm nếu cần"} /></label>
      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button" disabled={busy || blocked}>Hoàn thành đợt golive</button>
      </div>
    </form>
  </dialog>;
}
