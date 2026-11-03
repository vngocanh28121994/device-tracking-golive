"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, ChevronDown, ListChecks, Rocket, X } from "lucide-react";
import { HolderIdentity } from "./HolderIdentity";
import { LoadingState } from "./LoadingState";
import { doneKindOf, markedAt, markedBy, markedHow, tallyByTester, TesterTally } from "../lib/statistic";

type Release = { id: string; name: string; source: string; fixVersion: string; createdBy: string; createdAt: string; completedAt: string | null; completedBy: string | null; total: number; done: number };
type Ticket = { id: number; issueKey: string; summary: string; assignee: string; assigneeUserId: string | null; doneAt: string | null; skippedAt: string | null; skippedBy: string | null; skipKind: string; testedDevices: number; lastCheckedAt: string | null };
type Person = { userId: string; displayName: string; avatar: string; role?: string };
// The hovered slice of a tester's bar, with the very tickets it stands for.
type Tip = { x: number; y: number; label: string; tickets: Ticket[] };

// The Manager's picks are a working note, not shared data, so they stay in this browser.
const SELECTION_KEY = "statistic-selection";
const prettyDate = (iso: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const prettyStamp = (iso: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const statusClass = (done: boolean) => "status-chip " + (done ? "status-done" : "status-blocked");
// Stacked left to right, most actual testing first, so a bar's green head shows real device coverage
// and its grey tail shows what is still outstanding. The four slices always span the tester's total.
const BAR_PARTS = [
  { kind: "onDevices", short: "trên thiết bị", label: "ticket test đủ trên thiết bị đang cầm" },
  { kind: "confirmed", short: "đã test xong", label: "ticket người test xác nhận đã test xong" },
  { kind: "cannotTest", short: "không test được", label: "ticket được đánh dấu không test được" },
  { kind: "notNeeded", short: "không cần test", label: "ticket được đánh dấu không cần test" },
  { kind: "open", short: "chưa test", label: "ticket chưa test" },
] as const;

export function StatisticBoard({ people }: { people: Person[] }) {
  const [releases, setReleases] = useState<Release[] | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<string[]>([]);
  const [ticketsByRelease, setTicketsByRelease] = useState<Record<string, Ticket[]>>({});
  const [loadingRelease, setLoadingRelease] = useState<string[]>([]), [releaseError, setReleaseError] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [collapsedTesters, setCollapsedTesters] = useState<string[]>([]);
  const [collapsedDetails, setCollapsedDetails] = useState<string[]>([]);
  const [tip, setTip] = useState<Tip | null>(null);

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
        const tally = tickets ? tallyByTester(tickets) : [];
        const testersOpen = !collapsedTesters.includes(release.id);
        const detailsOpen = !collapsedDetails.includes(release.id);
        const toggle = (id: string, setter: typeof setCollapsedTesters) =>
          setter(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
        // Anchored to whatever was hovered and kept clear of both window edges.
        const showTip = (event: React.MouseEvent<HTMLElement>, tester: TesterTally, label: string, matcher: (ticket: Ticket) => boolean) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const matched = (tickets || []).filter(item => item.assignee.trim() === tester.name && matcher(item));
          setTip({ x: Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180), y: rect.top, label, tickets: matched });
        };
        const partMatcher = (kind: typeof BAR_PARTS[number]["kind"]) => (item: Ticket) =>
          kind === "open" ? !item.doneAt : !!item.doneAt && doneKindOf(item) === kind;
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
                <div className={"stat-testers stat-section" + (testersOpen ? " is-open" : "")}>
                  <button type="button" className="stat-section-toggle" aria-expanded={testersOpen} aria-controls={"stat-testers-" + release.id}
                    onClick={() => toggle(release.id, setCollapsedTesters)}>
                    <span>Thống kê theo người test</span>
                    <small>{tally.length} người test</small>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {testersOpen && <div id={"stat-testers-" + release.id} className="table-scroll"><table className="stat-tester-table"><thead><tr>
                    <th>NGƯỜI TEST</th><th>TIẾN ĐỘ TEST</th><th>TICKET CHƯA TEST</th>
                  </tr></thead><tbody>{tally.map(tester => {
                    const account = people.find(item => item.userId === tester.userId);
                    const percent = tester.total ? Math.round(tester.done / tester.total * 100) : 0;
                    const parts = BAR_PARTS.filter(part => tester[part.kind] > 0);
                    return <tr key={tester.name || "__none__"}>
                      <td className="golive-assignee">{tester.name
                        ? <HolderIdentity name={tester.name} avatar={account?.avatar || ""} role={account?.role} />
                        : <span className="muted">Chưa có người test</span>}</td>
                      <td className="stat-tester-done">
                        <span className="stat-stack" role="img" aria-label={tester.done + "/" + tester.total + " ticket đã test" + parts.map(part => ", " + tester[part.kind] + " " + part.label).join("")}>
                          {parts.map(part => <span key={part.kind} className={"stat-stack-part stat-part-" + part.kind} style={{ width: tester[part.kind] / tester.total * 100 + "%" }}
                            onMouseEnter={event => showTip(event, tester, tester[part.kind] + " " + part.label, partMatcher(part.kind))} onMouseLeave={() => setTip(null)} />)}
                        </span>
                        <span className="stat-stack-counts">
                          <span className="stat-stack-total"><strong className={tester.done > 0 ? "stat-count" : ""}
                            onMouseEnter={tester.done > 0 ? (event => showTip(event, tester, tester.done + " ticket đã test", item => !!item.doneAt)) : undefined}
                            onMouseLeave={() => setTip(null)}>{tester.done}</strong>/{tester.total} · {percent}%</span>
                          {parts.map(part => <span key={part.kind} className={"stat-legend stat-legend-" + part.kind}>{tester[part.kind]} {part.short}</span>)}
                        </span>
                      </td>
                      <td className="stat-tester-open"><strong className={tester.open > 0 ? "stat-count" : ""}
                        onMouseEnter={tester.open > 0 ? (event => showTip(event, tester, tester.open + " ticket chưa test", item => !item.doneAt)) : undefined}
                        onMouseLeave={() => setTip(null)}>{tester.open}</strong></td>
                    </tr>;
                  })}</tbody></table></div>}
                </div>
                <div className={"stat-details stat-section" + (detailsOpen ? " is-open" : "")}>
                <button type="button" className="stat-section-toggle" aria-expanded={detailsOpen} aria-controls={"stat-details-" + release.id}
                  onClick={() => toggle(release.id, setCollapsedDetails)}>
                  <span>Chi tiết ticket</span>
                  <small>{tickets.length} {rowLabel}</small>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                {detailsOpen && <div id={"stat-details-" + release.id}>
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
                </div>}
                </div>
              </>}
          </div>}
        </li>;
      })}</ul>
    </>}
    {tip && <div className="stat-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.label}</strong>
      <ul>{tip.tickets.slice(0, 10).map(item => <li key={item.id}><b>{item.issueKey}</b><span>{item.summary || "(không có tên)"}</span></li>)}</ul>
      {tip.tickets.length > 10 && <p className="muted">… và {tip.tickets.length - 10} ticket khác</p>}
    </div>}
  </>;
}
