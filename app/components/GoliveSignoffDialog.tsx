"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Globe, ShieldAlert, Smartphone, X } from "lucide-react";
import { ATTENTION_KIND_LABELS, AttentionItem } from "../lib/golive-acceptance";
import { DeviceDetail, TicketDetail } from "../lib/golive-signoff";

export type SignoffSummary = {
  name: string; fixVersion: string; build: string; qeCount: number; manual: boolean;
  web: { tested: number; notNeeded: number; cannotTest: number; riskAccepted: number };
  app: { devicesTested: number; devicesUntested: number; confirmed: number; notNeeded: number; cannotTest: number; riskAccepted: number };
  appTickets: number;
  details: {
    webCannotTest: TicketDetail[]; webRiskAccepted: TicketDetail[]; appCannotTest: TicketDetail[]; appRiskAccepted: TicketDetail[];
    devicesTested: DeviceDetail[]; devicesUntested: DeviceDetail[];
  };
  attention: AttentionItem[]; noteRequired: boolean;
};

// A count row; "warn" marks outcomes a Manager should look at twice when they are not zero, and
// "detail" is what opens under the row when its number is clicked.
type CountRow = { id: string; label: string; value: number; warn?: boolean; unit?: string; detail?: React.ReactNode };

function TicketList({ items }: { items: TicketDetail[] }) {
  return <ul className="signoff-detail-list">{items.map(item => <li key={item.ticketId}>
    <div className="signoff-detail-title"><strong>{item.issueKey}</strong><span>{item.assignee || "Chưa có người test"}</span></div>
    {item.reason && <p>{item.reason}</p>}
    {item.note && <small className={item.note.startsWith("Chưa") ? "is-warn" : ""}>{item.note}</small>}
  </li>)}</ul>;
}

function DeviceList({ items, tested }: { items: DeviceDetail[]; tested: boolean }) {
  return <ul className="signoff-detail-list">{items.map(item => <li key={item.deviceId}>
    <div className="signoff-detail-title"><strong className="signoff-device-name">{item.name}</strong>
      <span>{tested ? item.tickets.length + " ticket" : "Cần cho " + item.tickets.length + " ticket"}</span></div>
    {item.tickets.length > 0 && <p>{item.tickets.map(ticket => ticket.issueKey).join(", ")}</p>}
    {tested && item.testers.length > 0 && <small>Người test: {item.testers.join(", ")}</small>}
    {!tested && item.waived.map(reason => <small key={reason}>Miễn máy: {reason}</small>)}
  </li>)}</ul>;
}

function PhaseCounts({ kind, title, total, rows, openId, onToggle }: { kind: "web" | "app"; title: string; total: number; rows: CountRow[]; openId: string; onToggle: (id: string) => void }) {
  const Icon = kind === "web" ? Globe : Smartphone;
  return <section className={"signoff-phase signoff-phase-" + kind}>
    <header className="signoff-phase-head"><span className="signoff-phase-icon" aria-hidden="true"><Icon size={16} /></span><h3>{title}</h3><small>{total} ticket</small></header>
    <dl className="signoff-counts">{rows.map(row => {
      const clickable = !!row.detail && row.value > 0, open = clickable && openId === row.id;
      return <div key={row.id} className={"signoff-count-row" + (row.value === 0 ? " is-zero" : row.warn ? " is-warn" : "") + (open ? " is-open" : "")}>
        <dt>{row.label}</dt>
        <dd>{clickable
          ? <button type="button" className="signoff-count-button" aria-expanded={open} aria-controls={"signoff-detail-" + row.id}
            aria-label={row.label + ": " + row.value + (row.unit ? " " + row.unit : "") + ", " + (open ? "ẩn" : "xem") + " chi tiết"} onClick={() => onToggle(row.id)}>
            {row.value}<ChevronDown size={14} aria-hidden="true" /></button>
          : row.value}</dd>
        {open && <div id={"signoff-detail-" + row.id} className="signoff-detail" role="region" aria-label={"Chi tiết " + row.label}>{row.detail}</div>}
      </div>;
    })}</dl>
  </section>;
}

// The last look before a Manager closes a release: totals per phase, what needs attention, and the note.
// Full size: the whole screen on a phone, a large panel on desktop; the header and the actions stay put
// while the content scrolls between them.
export function GoliveSignoffDialog({ summary, busy, onCancel, onSubmit }: { summary: SignoffSummary; busy: boolean; onCancel: () => void; onSubmit: (note: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  // One detail bubble open at a time; clicking its number again or pressing Escape closes it.
  const [openId, setOpenId] = useState("");
  const toggle = (id: string) => setOpenId(current => current === id ? "" : id);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const trimmed = note.trim(), blocked = summary.noteRequired && !trimmed;
  const attentionCount = summary.attention.length;
  return <dialog ref={dialog} className="modal signoff-dialog" aria-labelledby="signoff-title"
    onCancel={event => { event.preventDefault(); if (openId) setOpenId(""); else onCancel(); }}
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
          {!summary.manual && <PhaseCounts kind="web" title="Phase web" openId={openId} onToggle={toggle}
            total={summary.web.tested + summary.web.notNeeded + summary.web.cannotTest + summary.web.riskAccepted} rows={[
            { id: "web-tested", label: "Đã test", value: summary.web.tested },
            { id: "web-not-needed", label: "Không cần test", value: summary.web.notNeeded },
            { id: "web-cannot-test", label: "Không test được", value: summary.web.cannotTest, warn: true, unit: "ticket", detail: <TicketList items={summary.details.webCannotTest} /> },
            { id: "web-risk", label: "Chấp nhận rủi ro", value: summary.web.riskAccepted, warn: true, unit: "ticket", detail: <TicketList items={summary.details.webRiskAccepted} /> },
          ]} />}
          <PhaseCounts kind="app" title="Phase app" openId={openId} onToggle={toggle} total={summary.appTickets} rows={[
            { id: "app-devices-tested", label: "Thiết bị đã test", value: summary.app.devicesTested, unit: "thiết bị", detail: <DeviceList items={summary.details.devicesTested} tested /> },
            { id: "app-devices-untested", label: "Thiết bị chưa test", value: summary.app.devicesUntested, warn: true, unit: "thiết bị", detail: <DeviceList items={summary.details.devicesUntested} tested={false} /> },
            { id: "app-confirmed", label: "Xác nhận đã test", value: summary.app.confirmed },
            { id: "app-not-needed", label: "Không cần test", value: summary.app.notNeeded },
            { id: "app-cannot-test", label: "Không test được", value: summary.app.cannotTest, warn: true, unit: "ticket", detail: <TicketList items={summary.details.appCannotTest} /> },
            { id: "app-risk", label: "Chấp nhận rủi ro", value: summary.app.riskAccepted, warn: true, unit: "ticket", detail: <TicketList items={summary.details.appRiskAccepted} /> },
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
