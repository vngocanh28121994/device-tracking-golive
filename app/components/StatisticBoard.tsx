"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, ChevronDown, ListChecks, Rocket, X } from "lucide-react";
import { HolderIdentity } from "./HolderIdentity";
import { LoadingState } from "./LoadingState";
import { markedAt, markedBy, markedHow } from "../lib/statistic";

type Release = { id: string; name: string; source: string; fixVersion: string; createdBy: string; createdAt: string; completedAt: string | null; completedBy: string | null; total: number; done: number };
type Ticket = { id: number; issueKey: string; summary: string; assignee: string; assigneeUserId: string | null; doneAt: string | null; skippedAt: string | null; skippedBy: string | null; skipKind: string; testedDevices: number; lastCheckedAt: string | null };
type Person = { userId: string; displayName: string; avatar: string; role?: string };

// The Manager's picks are a working note, not shared data, so they stay in this browser.
const SELECTION_KEY = "statistic-selection";
const prettyDate = (iso: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const prettyStamp = (iso: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const statusClass = (done: boolean) => "status-chip " + (done ? "status-done" : "status-blocked");

export function StatisticBoard({ people }: { people: Person[] }) {
  const [releases, setReleases] = useState<Release[] | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<string[]>([]);
  const [ticketsByRelease, setTicketsByRelease] = useState<Record<string, Ticket[]>>({});
  const [loadingRelease, setLoadingRelease] = useState<string[]>([]), [releaseError, setReleaseError] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, number[]>>({});

  useEffect(() => { try { const raw = localStorage.getItem(SELECTION_KEY); if (raw) setSelected(JSON.parse(raw) as Record<string, number[]>); } catch { /* a corrupt note just starts empty */ } }, []);
  const writeSelected = useCallback((next: Record<string, number[]>) => {
    setSelected(next);
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify(next)); } catch { /* private mode: the picks live for this session only */ }
  }, []);

  const loadTickets = useCallback(async (id: string) => {
    setLoadingRelease(current => [...current, id]);
    setReleaseError(current => ({ ...current, [id]: "" }));
    try {
      const r = await fetch("/api/statistic?release=" + encodeURIComponent(id), { cache: "no-store" });
      const data = await r.json() as { tickets?: Ticket[]; error?: string };
      if (!r.ok) throw new Error(data.error || "Không thể tải ticket của đợt golive.");
      setTicketsByRelease(current => ({ ...current, [id]: data.tickets || [] }));
    } catch (e) {
      setReleaseError(current => ({ ...current, [id]: e instanceof Error ? e.message : "Không thể tải ticket của đợt golive." }));
    } finally { setLoadingRelease(current => current.filter(item => item !== id)); }
  }, []);

  // The newest golive opens by itself: that is the one a Manager is reporting on.
  useEffect(() => { void (async () => {
    try {
      const r = await fetch("/api/statistic", { cache: "no-store" });
      const data = await r.json() as { releases?: Release[]; error?: string };
      if (!r.ok) throw new Error(data.error || "Không thể tải số liệu golive.");
      const list = data.releases || [];
      setReleases(list);
      const first = list.find(item => !item.completedAt) || list[0];
      if (first) { setOpen([first.id]); void loadTickets(first.id); }
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể tải số liệu golive."); }
  })(); }, [loadTickets]);

  function toggleRelease(id: string) {
    setOpen(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    if (!ticketsByRelease[id] && !loadingRelease.includes(id)) void loadTickets(id);
  }

  const totals = useMemo(() => {
    const list = releases || [];
    const done = list.reduce((sum, item) => sum + item.done, 0), total = list.reduce((sum, item) => sum + item.total, 0);
    return { releases: list.length, running: list.filter(item => !item.completedAt).length, done, open: total - done, total };
  }, [releases]);

  if (error) return <>
    <div className="page-heading"><div><h1>Statistic.</h1><p>Số liệu test của từng đợt golive.</p></div></div>
    <section className="panel golive-empty"><Ban size={34} /><h2>Không mở được màn hình này</h2><p>{error}</p></section>
  </>;
  if (!releases) return <>
    <div className="page-heading"><div><h1>Statistic.</h1><p>Số liệu test của từng đợt golive.</p></div></div>
    <LoadingState label="Đang tải số liệu golive..." />
  </>;

  return <>
    <div className="page-heading"><div><h1>Statistic.</h1><p>Mỗi đợt golive và trạng thái từng ticket trong đó. Ticket đã done ghi lại thời điểm QE đánh dấu; ticket chưa done có thể chọn để theo dõi riêng.</p></div></div>
    {releases.length === 0 ? <section className="panel golive-empty"><Rocket size={34} /><h2>Chưa có đợt golive nào</h2><p>Tạo hoặc import một đợt golive ở màn Tracking Golive, số liệu sẽ hiện ở đây.</p></section> : <>
      <div className="golive-stats stat-summary">
        <div className="golive-stat"><span className="status-chip">Đợt golive</span><strong>{totals.releases}</strong><small>{totals.running} đang thực hiện</small></div>
        <div className="golive-stat"><span className="status-chip status-done">Done</span><strong>{totals.done}</strong><small>trên {totals.total} ticket</small></div>
        <div className="golive-stat"><span className="status-chip status-blocked">Chưa done</span><strong>{totals.open}</strong><small>cần theo dõi</small></div>
      </div>
      <ul className="stat-releases">{releases.map(release => {
        const expanded = open.includes(release.id);
        const tickets = ticketsByRelease[release.id];
        const manual = release.source === "manual";
        const rowLabel = manual ? "người test" : "ticket";
        const openTickets = (tickets || []).filter(ticket => !ticket.doneAt);
        const picks = selected[release.id] || [];
        const picked = picks.filter(id => openTickets.some(ticket => ticket.id === id));
        const percent = release.total ? Math.round(release.done / release.total * 100) : 0;
        const toggleOne = (ticketId: number, checked: boolean) =>
          writeSelected({ ...selected, [release.id]: checked ? [...picked, ticketId] : picked.filter(id => id !== ticketId) });
        return <li key={release.id} className={"stat-release" + (expanded ? " is-open" : "")}>
          <button type="button" className="stat-release-head" aria-expanded={expanded} onClick={() => toggleRelease(release.id)}>
            <span className={"stat-release-icon" + (release.completedAt ? " done" : "")}>{release.completedAt ? <CheckCircle2 size={20} /> : <Rocket size={20} />}</span>
            <span className="stat-release-main">
              <strong>{release.name}</strong>
              <small>{release.completedAt ? "Hoàn thành " + prettyStamp(release.completedAt) + (release.completedBy ? " · " + release.completedBy : "") : "Đang thực hiện · tạo " + prettyDate(release.createdAt) + " · " + release.createdBy}</small>
            </span>
            {release.fixVersion && <span className="golive-version">fixVersion: <strong>{release.fixVersion}</strong></span>}
            <span className="stat-release-progress">
              <span className="stat-bar"><span className={"stat-bar-fill" + (percent === 100 ? " full" : "")} style={{ width: percent + "%" }} /></span>
              <small>{release.done}/{release.total} done</small>
            </span>
            <ChevronDown className="stat-chevron" size={18} aria-hidden="true" />
          </button>
          {expanded && <div className="stat-release-body">
            {releaseError[release.id] ? <p className="empty">{releaseError[release.id]}</p>
              : !tickets ? <LoadingState label={"Đang tải " + rowLabel + "..."} />
              : tickets.length === 0 ? <p className="empty">Đợt golive này chưa có {rowLabel} nào.</p>
              : <>
                <div className="stat-selection">
                  <span><ListChecks size={16} aria-hidden="true" /> Đã chọn <strong>{picked.length}</strong>/{openTickets.length} {rowLabel} chưa done</span>
                  {picked.length > 0 && <button type="button" className="outline-button stat-clear" onClick={() => writeSelected({ ...selected, [release.id]: [] })}><X size={15} /> Bỏ chọn</button>}
                </div>
                <div className="table-scroll"><table className="stat-table"><thead><tr>
                  <th className="stat-pick"><input
                    type="checkbox"
                    aria-label={"Chọn tất cả " + rowLabel + " chưa done của " + release.name}
                    disabled={openTickets.length === 0}
                    checked={openTickets.length > 0 && picked.length === openTickets.length}
                    ref={element => { if (element) element.indeterminate = picked.length > 0 && picked.length < openTickets.length; }}
                    onChange={event => writeSelected({ ...selected, [release.id]: event.target.checked ? openTickets.map(ticket => ticket.id) : [] })}
                  /></th>
                  {!manual && <><th>MÃ</th><th>TÊN TICKET</th></>}
                  <th>NGƯỜI TEST</th><th>TRẠNG THÁI</th><th>QE ĐÁNH DẤU DONE</th>
                </tr></thead><tbody>{tickets.map(ticket => {
                  const done = !!ticket.doneAt, checked = picked.includes(ticket.id);
                  const person = people.find(item => item.userId === ticket.assigneeUserId);
                  const at = markedAt(ticket);
                  return <tr key={ticket.id} className={done ? "stat-row-done" : checked ? "stat-row-picked" : ""}>
                    <td className="stat-pick">{done
                      ? <CheckCircle2 className="stat-row-check" size={17} aria-label="Đã done" />
                      : <input type="checkbox" checked={checked} aria-label={"Chọn " + (manual ? ticket.assignee : ticket.issueKey)} onChange={event => toggleOne(ticket.id, event.target.checked)} />}</td>
                    {!manual && <><td className="golive-key">{ticket.issueKey}</td>
                    <td className="golive-summary">{ticket.summary || <span className="muted">(không có tên)</span>}</td></>}
                    <td className="golive-assignee">{ticket.assignee
                      ? <HolderIdentity name={ticket.assignee} avatar={person?.avatar || ""} role={person?.role} />
                      : <span className="muted">Chưa có người test</span>}</td>
                    <td className="golive-ticket-status"><span className={statusClass(done)}>{done ? "Done" : "In Progress"}</span></td>
                    <td className="stat-done-at">{done
                      ? <span className="stat-done-stamp"><strong>{at ? prettyStamp(at) : "Không rõ thời điểm"}</strong><small>{markedHow(ticket)}{markedBy(ticket) ? " · " + markedBy(ticket) : ""}</small></span>
                      : <span className="muted">{ticket.testedDevices > 0 ? "Đã tích " + ticket.testedDevices + " thiết bị, chưa đủ" : "Chưa đánh dấu"}</span>}</td>
                  </tr>;
                })}</tbody></table></div>
              </>}
          </div>}
        </li>;
      })}</ul>
    </>}
  </>;
}
