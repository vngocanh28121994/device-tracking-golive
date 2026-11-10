"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import { StyledSelect } from "./StyledSelect";
import { AttentionItem, ATTENTION_ALL, ATTENTION_KIND_LABELS, ATTENTION_KINDS, ATTENTION_NO_ASSIGNEE, filterAttention } from "../lib/golive-acceptance";

const NO_ASSIGNEE_LABEL = "Chưa có người test";

type Props = { items: AttentionItem[]; releaseId: string };

// Khối "Cần lưu ý" của một đợt đã hoàn thành: thu gọn được, lọc theo QE và theo loại lý do.
// Bộ lọc chỉ sống trong component (không vào URL) và reset khi mở đợt khác.
export function GoliveAttentionPanel({ items, releaseId }: Props) {
  const [open, setOpen] = useState(true);
  const [assignee, setAssignee] = useState(ATTENTION_ALL);
  const [kind, setKind] = useState(ATTENTION_ALL);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Mở đợt khác thì về mặc định: section mở, không lọc, mọi ticket thu gọn.
  const [shownRelease, setShownRelease] = useState(releaseId);
  if (shownRelease !== releaseId) {
    setShownRelease(releaseId);
    setOpen(true);
    setAssignee(ATTENTION_ALL);
    setKind(ATTENTION_ALL);
    setExpanded(new Set());
  }

  // Danh sách QE kèm số ticket, sort theo tiếng Việt; ticket chưa có người test gom vào một option.
  const assigneeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let none = 0;
    for (const item of items) {
      const name = (item.assignee || "").trim();
      if (!name) none += 1;
      else counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const named = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "vi"))
      .map(([name, count]) => ({ value: name, label: name, description: count + " ticket" }));
    return [
      { value: ATTENTION_ALL, label: "Tất cả QE", description: items.length + " ticket" },
      ...named,
      ...(none ? [{ value: ATTENTION_NO_ASSIGNEE, label: NO_ASSIGNEE_LABEL, description: none + " ticket" }] : []),
    ];
  }, [items]);

  // Số trên mỗi chip là số ticket khớp kind đó trong tập đã lọc theo QE.
  const byAssignee = useMemo(() => filterAttention(items, { assignee, kind: ATTENTION_ALL }), [items, assignee]);
  const kindChips = useMemo(() => ATTENTION_KINDS
    .map(value => ({ value, count: byAssignee.filter(item => item.reasons.some(reason => reason.kind === value)).length }))
    .filter(chip => chip.count > 0 || chip.value === kind), [byAssignee, kind]);

  const visible = useMemo(() => filterAttention(byAssignee, { assignee: ATTENTION_ALL, kind }), [byAssignee, kind]);
  const filtering = assignee !== ATTENTION_ALL || kind !== ATTENTION_ALL;
  const openCount = visible.filter(item => expanded.has(item.ticketId)).length;

  const toggleTicket = (ticketId: number) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(ticketId)) next.delete(ticketId); else next.add(ticketId);
    return next;
  });
  const toggleAll = () => setExpanded(previous => {
    const next = new Set(previous);
    for (const item of visible) { if (openCount > 0) next.delete(item.ticketId); else next.add(item.ticketId); }
    return next;
  });
  const clearFilters = () => { setAssignee(ATTENTION_ALL); setKind(ATTENTION_ALL); };

  return <div className={"golive-attention" + (open ? " is-open" : "")}>
    <button type="button" className="stat-section-toggle golive-attention-toggle" aria-expanded={open} aria-controls="golive-attention-body" onClick={() => setOpen(!open)}>
      <AlertTriangle size={16} aria-hidden="true" /> Cần lưu ý ({items.length})
      {open && filtering && <small>Hiện {visible.length}/{items.length}</small>}
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div id="golive-attention-body">
      {items.length > 1 && <div className="golive-attention-filters">
        <div className="golive-attention-qe"><StyledSelect ariaLabel="Lọc theo QE" value={assignee} onChange={setAssignee} options={assigneeOptions} placeholder="Tất cả QE" /></div>
        <div className="golive-attention-kinds" role="radiogroup" aria-label="Lọc theo loại lý do">
          {kindChips.map(chip => <button key={chip.value} type="button" role="radio" aria-checked={kind === chip.value} className={kind === chip.value ? "active" : ""}
            onClick={() => setKind(kind === chip.value ? ATTENTION_ALL : chip.value)}>
            {ATTENTION_KIND_LABELS[chip.value]} <span className="golive-scope-count">{chip.count}</span></button>)}
        </div>
        {visible.length > 0 && <button type="button" className="text-button golive-attention-all" onClick={toggleAll}>{openCount > 0 ? "Thu gọn tất cả" : "Mở tất cả"}</button>}
      </div>}
      {visible.length === 0
        ? <><p className="empty">Không có ticket nào khớp bộ lọc.</p><button type="button" className="text-button" onClick={clearFilters}><X size={15} aria-hidden="true" /> Xoá bộ lọc</button></>
        : <ul className="golive-attention-list">{visible.map(item => {
          const isOpen = expanded.has(item.ticketId);
          return <li key={item.ticketId} className={isOpen ? "is-open" : ""}>
            <button type="button" className="golive-attention-row" aria-expanded={isOpen} aria-controls={"golive-attention-" + item.ticketId} onClick={() => toggleTicket(item.ticketId)}>
              <strong>{item.issueKey}</strong>
              <span className="muted">{(item.assignee || "").trim() || NO_ASSIGNEE_LABEL}</span>
              <span className="golive-attention-count">{item.reasons.length} lý do</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {isOpen && <ul id={"golive-attention-" + item.ticketId} className="golive-attention-reasons">
              {item.reasons.map((reason, index) => <li key={index}><span className="status-chip">{ATTENTION_KIND_LABELS[reason.kind]}</span> {reason.text}</li>)}
            </ul>}
          </li>;
        })}</ul>}
    </div>}
  </div>;
}
