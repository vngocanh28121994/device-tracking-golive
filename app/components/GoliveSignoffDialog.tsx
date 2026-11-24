"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Globe, ShieldAlert, Smartphone, X } from "lucide-react";
import { ATTENTION_KIND_LABELS, AttentionItem } from "../lib/golive-acceptance";

export type SignoffSummary = {
  name: string; fixVersion: string; build: string; qeCount: number; manual: boolean;
  web: { tested: number; notNeeded: number; cannotTest: number; riskAccepted: number };
  app: { onDevices: number; confirmed: number; notNeeded: number; cannotTest: number; riskAccepted: number };
  attention: AttentionItem[]; noteRequired: boolean;
};

// A count row; "warn" marks outcomes a Manager should look at twice when they are not zero.
type CountRow = { label: string; value: number; warn?: boolean };

function PhaseCounts({ kind, title, rows }: { kind: "web" | "app"; title: string; rows: CountRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const Icon = kind === "web" ? Globe : Smartphone;
  return <section className={"signoff-phase signoff-phase-" + kind}>
    <header className="signoff-phase-head"><span className="signoff-phase-icon" aria-hidden="true"><Icon size={16} /></span><h3>{title}</h3><small>{total} ticket</small></header>
    <dl className="signoff-counts">{rows.map(row => <div key={row.label} className={row.value === 0 ? "is-zero" : row.warn ? "is-warn" : ""}>
      <dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
  </section>;
}

// The last look before a Manager closes a release: totals per phase, what needs attention, and the note.
// Full size: the whole screen on a phone, a large panel on desktop; the header and the actions stay put
// while the content scrolls between them.
export function GoliveSignoffDialog({ summary, busy, onCancel, onSubmit }: { summary: SignoffSummary; busy: boolean; onCancel: () => void; onSubmit: (note: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const trimmed = note.trim(), blocked = summary.noteRequired && !trimmed;
  const attentionCount = summary.attention.length;
  return <dialog ref={dialog} className="modal signoff-dialog" aria-labelledby="signoff-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="signoff-form" onSubmit={event => { event.preventDefault(); if (!blocked) onSubmit(trimmed); }}>
      <header className="signoff-head">
        <span className="confirm-icon" aria-hidden="true"><CheckCircle2 size={20} /></span>
        <div className="signoff-head-text"><h2 id="signoff-title">Tổng kết trước khi hoàn thành</h2><p>{summary.name}</p></div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={21} /></button>
      </header>

      <div className="signoff-body">
        <dl className="signoff-info">
          <div><dt>Đợt golive</dt><dd>{summary.name}</dd></div>
          <div><dt>fixVersion</dt><dd>{summary.fixVersion || "—"}</dd></div>
          <div><dt>Build hiện tại</dt><dd>{summary.build || "—"}</dd></div>
          <div><dt>Số QE</dt><dd>{summary.qeCount}</dd></div>
        </dl>

        <div className={"signoff-phases" + (summary.manual ? " is-single" : "")}>
          {!summary.manual && <PhaseCounts kind="web" title="Phase web" rows={[
            { label: "Đã test", value: summary.web.tested },
            { label: "Không cần test", value: summary.web.notNeeded },
            { label: "Không test được", value: summary.web.cannotTest, warn: true },
            { label: "Chấp nhận rủi ro", value: summary.web.riskAccepted, warn: true },
          ]} />}
          <PhaseCounts kind="app" title="Phase app" rows={[
            { label: "Test đủ thiết bị", value: summary.app.onDevices },
            { label: "Xác nhận đã test", value: summary.app.confirmed },
            { label: "Không cần test", value: summary.app.notNeeded },
            { label: "Không test được", value: summary.app.cannotTest, warn: true },
            { label: "Chấp nhận rủi ro", value: summary.app.riskAccepted, warn: true },
          ]} />
        </div>

        <section className="signoff-attention" aria-labelledby="signoff-attention-title">
          <header className="signoff-section-head">
            <ShieldAlert size={17} aria-hidden="true" /><h3 id="signoff-attention-title">Cần lưu ý</h3>
            <span className={"signoff-count-badge" + (attentionCount ? " is-warn" : "")}>{attentionCount}</span>
          </header>
          {attentionCount === 0
            ? <p className="signoff-empty"><CheckCircle2 size={17} aria-hidden="true" /> Không có ticket nào cần lưu ý.</p>
            : <ul className="signoff-items">{summary.attention.map(item => <li key={item.ticketId} className="signoff-item">
              <div className="signoff-item-head"><strong>{item.issueKey}</strong><span>{item.assignee || "Chưa có người test"}</span></div>
              <ul className="signoff-reasons">{item.reasons.map((reason, index) => <li key={index}>
                <span className={"signoff-kind signoff-kind-" + reason.kind}>{ATTENTION_KIND_LABELS[reason.kind]}</span>
                <span className="signoff-reason-text">{reason.text}</span></li>)}</ul>
            </li>)}</ul>}
        </section>

        <label className="signoff-note">
          <span className="signoff-note-label">Ghi chú nghiệm thu <span className={"signoff-note-tag" + (summary.noteRequired ? " is-required" : "")}>{summary.noteRequired ? "Bắt buộc" : "Tuỳ chọn"}</span></span>
          <textarea rows={4} maxLength={1000} value={note} required={summary.noteRequired} onChange={event => setNote(event.target.value)}
            placeholder={summary.noteRequired ? "Nêu lý do chấp nhận golive khi còn các ticket cần lưu ý" : "Ghi chú thêm nếu cần"} />
          {blocked && <small className="signoff-note-hint">Nhập ghi chú để có thể hoàn thành đợt golive.</small>}
        </label>
      </div>

      <footer className="signoff-foot">
        <button type="button" className="outline-button" onClick={onCancel}>Huỷ</button>
        <button type="submit" className="primary-button" disabled={busy || blocked}><CheckCircle2 size={17} aria-hidden="true" /> {busy ? "Đang hoàn thành..." : "Hoàn thành đợt golive"}</button>
      </footer>
    </form>
  </dialog>;
}
