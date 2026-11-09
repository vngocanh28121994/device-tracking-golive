"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Bell, CheckCircle2, ChevronDown, Clock, Globe, ListChecks, Rocket, Smartphone, X } from "lucide-react";
import { HolderIdentity } from "./HolderIdentity";
import { LoadingState } from "./LoadingState";
import { isManager as isManagerRole } from "../lib/roles";
import { doneKindOf, markedAt, markedBy, markedHow, phaseOf, tallyByTester, tallyWebByTester, webKindOf, WebQe, WebSummary } from "../lib/statistic";

type Release = { id: string; name: string; source: string; fixVersion: string; createdBy: string; createdAt: string; completedAt: string | null; completedBy: string | null; appPushedAt: string | null; total: number; done: number; failed: number; web: WebSummary };
type Ticket = { id: number; issueKey: string; summary: string; assignee: string; assigneeUserId: string | null; doneAt: string | null; skippedAt: string | null; skippedBy: string | null; skipKind: string; testedDevices: number; lastCheckedAt: string | null; failedAt: string | null; failedBy: string | null; failedReason: string; webStatus: string | null; webAt: string | null; webBy: string | null; webReason: string };
type Person = { userId: string; displayName: string; avatar: string; role?: string };
// The hovered slice of a tester's bar, with the very tickets it stands for.
type Tip = { x: number; y: number; label: string; tickets: Ticket[] };

// The Manager's picks are a working note, not shared data, so they stay in this browser.
const SELECTION_KEY = "statistic-selection";
// A report should never white-screen over one bad row, and Intl throws on an unparseable date.
const format = (iso: string, options: Intl.DateTimeFormatOptions) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Không rõ thời điểm" : new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ...options }).format(date);
};
const prettyDate = (iso: string) => format(iso, { day: "2-digit", month: "2-digit", year: "numeric" });
const prettyStamp = (iso: string) => format(iso, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const statusOf = (ticket: { doneAt: string | null; failedAt: string | null }) => ticket.failedAt ? "Test Failed" : ticket.doneAt ? "Done" : "In Progress";
const statusClass = (status: string) => "status-chip " + (status === "Done" ? "status-done" : status === "Test Failed" ? "status-failed" : "status-blocked");
// Stacked left to right, most actual testing first, so a bar's green head shows real device coverage
// and its grey tail shows what is still outstanding. The four slices always span the tester's total.
const BAR_PARTS = [
  { kind: "onDevices", short: "trên thiết bị", label: "ticket test đủ trên thiết bị đang cầm" },
  { kind: "confirmed", short: "đã test xong", label: "ticket người test xác nhận đã test xong" },
  { kind: "cannotTest", short: "không test được", label: "ticket được đánh dấu không test được" },
  { kind: "notNeeded", short: "không cần test", label: "ticket được đánh dấu không cần test" },
  { kind: "riskAccepted", short: "chấp nhận rủi ro", label: "ticket chấp nhận rủi ro" },
  { kind: "failed", short: "test failed", label: "ticket test failed" },
  { kind: "open", short: "chưa test", label: "ticket chưa test" },
] as const;
// Phase web outcomes, in the same order and colours as the app bar: settled first, outstanding last.
const WEB_PARTS = [
  { kind: "tested", cls: "onDevices", short: "đã test xong", label: "ticket đã test xong web" },
  { kind: "cannotTest", cls: "cannotTest", short: "không test được", label: "ticket không test được web" },
  { kind: "notNeeded", cls: "notNeeded", short: "không cần test", label: "ticket không cần test web" },
  { kind: "riskAccepted", cls: "riskAccepted", short: "chấp nhận rủi ro", label: "ticket chấp nhận rủi ro web" },
  { kind: "failed", cls: "failed", short: "test failed", label: "ticket test web failed" },
  { kind: "open", cls: "open", short: "chưa test", label: "ticket chưa test web" },
] as const;
const WEB_LABEL = { tested: "Đã test xong", notNeeded: "Không cần test", cannotTest: "Không test được", failed: "Test failed", riskAccepted: "Chấp nhận rủi ro", open: "Chưa test" } as const;
const webChip = (kind: keyof typeof WEB_LABEL) => "status-chip " + (kind === "failed" ? "status-failed" : kind === "open" ? "status-blocked" : "status-done");
// The same two phases as the Tracking Golive board: QE confirm the web build, then test the app on devices.
const PHASE_LABEL = { web: "Giai đoạn 1 · Test web", build: "Chờ build app", app: "Giai đoạn 2 · Test app", completed: "Hoàn thành" } as const;
const NO_WEB: WebSummary = { total: 0, signed: 0, done: false };

// Tab 1 of the Statistic screen: every golive, its two phases and its tickets. The heading and the
// tablist belong to StatisticBoard, so this renders only the tab's own body and keeps its state
// while the QE tab is on screen.
export function GoliveStatisticTab({ people, currentUserId, onToast, onError }: { people: Person[]; currentUserId: string; onToast: (message: string) => void; onError: (message: string) => void }) {
  const [releases, setReleases] = useState<Release[] | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<string[]>([]);
  const [ticketsByRelease, setTicketsByRelease] = useState<Record<string, Ticket[]>>({});
  const [loadingRelease, setLoadingRelease] = useState<string[]>([]), [releaseError, setReleaseError] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [collapsedTesters, setCollapsedTesters] = useState<string[]>([]);
  const [collapsedDetails, setCollapsedDetails] = useState<string[]>([]);
  const [collapsedWeb, setCollapsedWeb] = useState<string[]>([]);
  const [collapsedWebTesters, setCollapsedWebTesters] = useState<string[]>([]);
  const [collapsedApp, setCollapsedApp] = useState<string[]>([]);
  const [webByRelease, setWebByRelease] = useState<Record<string, WebQe[]>>({});
  const isManager = isManagerRole(people.find(person => person.userId === currentUserId)?.role);
  const [tip, setTip] = useState<Tip | null>(null);
  const [sending, setSending] = useState("");

  // Reminds each ticked ticket's tester; the server groups a tester's tickets into one notification.
  async function notifyUntested(releaseId: string, ticketIds: number[]) {
    setSending(releaseId);
    setTip(null);
    try {
      const r = await fetch("/api/statistic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify-untested", releaseId, ticketIds }) });
      const data = await r.json() as { notified?: number; tickets?: number; unmatched?: string[]; alreadyDone?: number; error?: string };
      if (!r.ok) throw new Error(data.error || "Không thể gửi thông báo.");
      const extra = [
        data.alreadyDone ? data.alreadyDone + " ticket đã Done nên bỏ qua" : "",
        data.unmatched?.length ? data.unmatched.length + " ticket chưa khớp tài khoản" : "",
      ].filter(Boolean).join(", ");
      onToast("Đã gửi thông báo tới " + data.notified + " người test cho " + data.tickets + " ticket" + (extra ? " (" + extra + ")" : "") + " 🔔");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể gửi thông báo."); }
    finally { setSending(""); }
  }

  // Same reminder as the Tracking Golive board: a push to every QE who has not confirmed the web test.
  async function remindWeb(releaseId: string) {
    setSending("web:" + releaseId);
    try {
      const r = await fetch("/api/golive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remind-web", releaseId }) });
      const data = await r.json() as { pending?: number; error?: string };
      if (!r.ok) throw new Error(data.error || "Không thể gửi nhắc nhở.");
      onToast("Đã gửi nhắc nhở tới " + data.pending + " QE chưa hoàn thành test web 🔔");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể gửi nhắc nhở."); }
    finally { setSending(""); }
  }

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
      const data = await r.json() as { tickets?: Ticket[]; web?: WebQe[]; error?: string };
      if (!r.ok) throw new Error(data.error || "Không thể tải ticket của đợt golive.");
      setTicketsByRelease(current => ({ ...current, [id]: data.tickets || [] }));
      setWebByRelease(current => ({ ...current, [id]: data.web || [] }));
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
      const list = (data.releases || []).map(item => ({ ...item, web: item.web || NO_WEB }));
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
    const failed = list.reduce((sum, item) => sum + item.failed, 0);
    const running = list.filter(item => !item.completedAt);
    return { releases: list.length, running: running.length, onWeb: running.filter(item => phaseOf(item) === "web").length, done, failed, open: total - done - failed, total };
  }, [releases]);

  if (error) return <section className="panel golive-empty"><Ban size={34} /><h2>Không mở được màn hình này</h2><p>{error}</p></section>;
  if (!releases) return <LoadingState label="Đang tải số liệu golive..." />;

  return <>
    {releases.length === 0 ? <section className="panel golive-empty"><Rocket size={34} /><h2>Chưa có đợt golive nào</h2><p>Tạo hoặc import một đợt golive ở màn Tracking Golive, số liệu sẽ hiện ở đây.</p></section> : <>
      <div className="golive-stats stat-summary">
        <div className="golive-stat"><span className="status-chip">Đợt golive</span><strong>{totals.releases}</strong><small>{totals.running} đang thực hiện{totals.running > 0 && " · " + totals.onWeb + " test web, " + (totals.running - totals.onWeb) + " test app"}</small></div>
        <div className="golive-stat"><span className="status-chip status-done">Done</span><strong>{totals.done}</strong><small>trên {totals.total} ticket</small></div>
        <div className="golive-stat"><span className="status-chip status-failed">Test failed</span><strong>{totals.failed}</strong><small>cần xử lý</small></div>
        <div className="golive-stat"><span className="status-chip status-blocked">Chưa test</span><strong>{totals.open}</strong><small>cần theo dõi</small></div>
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
        const webOpen = !collapsedWeb.includes(release.id);
        const webTestersOpen = !collapsedWebTesters.includes(release.id);
        const appOpen = !collapsedApp.includes(release.id);
        const phase = phaseOf(release);
        const roster = webByRelease[release.id] || [];
        const webPending = roster.filter(person => !person.signedAt);
        const webTally = tickets && !manual ? tallyWebByTester(tickets) : [];
        const webTicketsDone = webTally.reduce((sum, tester) => sum + tester.done, 0);
        const webPercent = release.web.total ? Math.round(release.web.signed / release.web.total * 100) : 0;
        const toggle = (id: string, setter: typeof setCollapsedTesters) =>
          setter(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
        // Anchored to whatever was hovered and kept clear of both window edges.
        const showTip = (event: React.MouseEvent<HTMLElement>, tester: { name: string }, label: string, matcher: (ticket: Ticket) => boolean) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const matched = (tickets || []).filter(item => item.assignee.trim() === tester.name && matcher(item));
          setTip({ x: Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180), y: rect.top, label, tickets: matched });
        };
        const partMatcher = (kind: typeof BAR_PARTS[number]["kind"]) => (item: Ticket) =>
          kind === "open" ? !item.doneAt && !item.failedAt
            : kind === "failed" ? !item.doneAt && !!item.failedAt
            : !!item.doneAt && doneKindOf(item) === kind;
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
            <span className={"stat-phase-chip stat-phase-" + phase}>{phase === "web" ? <Globe size={13} /> : phase === "build" ? <Rocket size={13} /> : phase === "app" ? <Smartphone size={13} /> : <CheckCircle2 size={13} />} {PHASE_LABEL[phase]}</span>
            <span className="stat-release-phases">
              <span className="stat-release-progress" title="Giai đoạn 1 · Test web">
                <small><Globe size={12} aria-hidden="true" /> Web · {release.web.total ? release.web.signed + "/" + release.web.total + " QE" : "chưa có QE"}</small>
                <span className="stat-bar"><span className={"stat-bar-fill" + (release.web.done ? " full" : "")} style={{ width: webPercent + "%" }} /></span>
              </span>
              <span className="stat-release-progress" title="Giai đoạn 2 · Test app">
                <small><Smartphone size={12} aria-hidden="true" /> App · {release.done}/{release.total} done</small>
                <span className="stat-bar"><span className={"stat-bar-fill" + (percent === 100 ? " full" : "")} style={{ width: percent + "%" }} /></span>
              </span>
            </span>
            <ChevronDown className="stat-chevron" size={18} aria-hidden="true" />
          </button>
          {expanded && <div className="stat-release-body">
            {releaseError[release.id] ? <p className="empty">{releaseError[release.id]}</p>
              : !tickets ? <LoadingState label={"Đang tải " + rowLabel + "..."} />
              : <>
                <div className={"stat-web stat-phase stat-section" + (webOpen ? " is-open" : "")}>
                  <button type="button" className="stat-section-toggle" aria-expanded={webOpen} aria-controls={"stat-web-" + release.id}
                    onClick={() => toggle(release.id, setCollapsedWeb)}>
                    <span className="stat-phase-title"><Globe size={14} aria-hidden="true" /> Giai đoạn 1 · Test web</span>
                    <small>{!manual && tickets.length > 0 && webTicketsDone + "/" + tickets.length + " ticket · "}{roster.length ? roster.length - webPending.length + "/" + roster.length + " QE đã hoàn thành" : "Chưa có QE"}</small>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {webOpen && <div id={"stat-web-" + release.id} className="stat-phase-body">
                    {roster.length === 0 ? <p className="stat-web-note">Chưa có tài khoản role QE nào để theo dõi test web.</p> : <>
                      {webPending.length === 0
                        ? <p className="stat-web-done" role="status"><CheckCircle2 size={16} aria-hidden="true" /> Tất cả QE tham gia đã hoàn thành test web{phase === "app" ? ", đang test app ở giai đoạn 2." : phase === "build" ? ", đang chờ App Manager push app." : "."}</p>
                        : <div className="stat-web-pending">
                          <span>Còn <strong>{webPending.length}</strong> QE chưa hoàn thành test web: {webPending.map(person => person.displayName).join(", ")}{phase === "web" ? ". Giai đoạn test app chưa bắt đầu." : "."}</span>
                          {!release.completedAt && isManager && <button type="button" className="outline-button stat-clear" disabled={sending === "web:" + release.id}
                            onClick={() => void remindWeb(release.id)}><Bell size={15} /> {sending === "web:" + release.id ? "Đang gửi..." : "Nhắc nhở"}</button>}
                        </div>}
                      {webTally.length > 0 && <div className={"stat-web-testers stat-section stat-sub" + (webTestersOpen ? " is-open" : "")}>
                        <button type="button" className="stat-section-toggle" aria-expanded={webTestersOpen} aria-controls={"stat-web-testers-" + release.id}
                          onClick={() => toggle(release.id, setCollapsedWebTesters)}>
                          <span>Thống kê theo người test</span>
                          <small>{webTally.length} người test</small>
                          <ChevronDown size={15} aria-hidden="true" />
                        </button>
                        {webTestersOpen && <div id={"stat-web-testers-" + release.id} className="table-scroll"><table className="stat-tester-table"><thead><tr>
                          <th>NGƯỜI TEST</th><th>TIẾN ĐỘ TEST WEB</th><th>CHƯA XONG WEB</th>
                        </tr></thead><tbody>{webTally.map(tester => {
                          const account = people.find(item => item.userId === tester.userId);
                          const percent = tester.total ? Math.round(tester.done / tester.total * 100) : 0;
                          const parts = WEB_PARTS.filter(part => tester[part.kind] > 0);
                          const mine = (item: Ticket) => item.assignee.trim() === tester.name;
                          return <tr key={tester.name || "__none__"}>
                            <td className="golive-assignee">{tester.name
                              ? <HolderIdentity name={tester.name} avatar={account?.avatar || ""} role={account?.role} />
                              : <span className="muted">Chưa có người test</span>}</td>
                            <td className="stat-tester-done">
                              <span className="stat-stack" role="img" aria-label={tester.done + "/" + tester.total + " ticket đã xong web" + parts.map(part => ", " + tester[part.kind] + " " + part.label).join("")}>
                                {parts.map(part => <span key={part.kind} className={"stat-stack-part stat-part-" + part.cls} style={{ width: tester[part.kind] / tester.total * 100 + "%" }}
                                  onMouseEnter={event => showTip(event, tester, tester[part.kind] + " " + part.label, item => mine(item) && webKindOf(item.webStatus) === part.kind)} onMouseLeave={() => setTip(null)} />)}
                              </span>
                              <span className="stat-stack-counts">
                                <span className="stat-stack-total"><strong>{tester.done}</strong>/{tester.total} · {percent}%</span>
                                {parts.map(part => <span key={part.kind} className={"stat-legend stat-legend-" + part.cls}>{tester[part.kind]} {part.short}</span>)}
                              </span>
                            </td>
                            <td className="stat-tester-open" data-label="chưa xong web"><strong className={tester.open + tester.failed > 0 ? "stat-count" : ""}
                              onMouseEnter={tester.open + tester.failed > 0 ? (event => showTip(event, tester, tester.open + tester.failed + " ticket chưa xong web", item => mine(item) && ["open", "failed"].includes(webKindOf(item.webStatus)))) : undefined}
                              onMouseLeave={() => setTip(null)}>{tester.open + tester.failed}</strong></td>
                          </tr>;
                        })}</tbody></table></div>}
                      </div>}
                      {/* A manual golive has no tickets, so each QE's own sign-off is all there is to show. */}
                      {manual && <div className="table-scroll"><table className="stat-web-table"><thead><tr>
                        <th>QE</th><th>TRẠNG THÁI</th><th>THỜI ĐIỂM XÁC NHẬN</th>
                      </tr></thead><tbody>{roster.map(person => {
                        const account = people.find(item => item.userId === person.userId);
                        return <tr key={person.userId}>
                          <td className="golive-assignee"><HolderIdentity name={person.displayName} avatar={account?.avatar || ""} role={account?.role} /></td>
                          <td className="golive-ticket-status">{person.signedAt
                            ? <span className="status-chip status-done">Đã xác nhận</span>
                            : <span className="status-chip status-blocked">Chưa xác nhận</span>}</td>
                          <td className="stat-done-at">{person.signedAt
                            ? <strong>{prettyStamp(person.signedAt)}</strong>
                            : <span className="muted"><Clock size={13} aria-hidden="true" /> Đang chờ</span>}</td>
                        </tr>;
                      })}</tbody></table></div>}
                    </>}
                  </div>}
                </div>
                <div className={"stat-app stat-phase stat-section" + (appOpen ? " is-open" : "")}>
                  <button type="button" className="stat-section-toggle" aria-expanded={appOpen} aria-controls={"stat-app-" + release.id}
                    onClick={() => toggle(release.id, setCollapsedApp)}>
                    <span className="stat-phase-title"><Smartphone size={14} aria-hidden="true" /> Giai đoạn 2 · Test app</span>
                    <small>{phase === "web" ? "Chờ test web hoàn tất" : release.done + "/" + release.total + " " + rowLabel + " done"}</small>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                {appOpen && <div id={"stat-app-" + release.id} className="stat-phase-body">
                {tickets.length === 0 ? <p className="empty">Đợt golive này chưa có {rowLabel} nào.</p>
                :                 <div className={"stat-testers stat-section stat-sub" + (testersOpen ? " is-open" : "")}>
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
                      <td className="stat-tester-open" data-label="chưa test"><strong className={tester.open > 0 ? "stat-count" : ""}
                        onMouseEnter={tester.open > 0 ? (event => showTip(event, tester, tester.open + " ticket chưa test", item => !item.doneAt)) : undefined}
                        onMouseLeave={() => setTip(null)}>{tester.open}</strong></td>
                    </tr>;
                  })}</tbody></table></div>}
                </div>}
                </div>}
                </div>
                {/* Ticket details hold both phases' outcomes, so they sit beside the phases, not inside one. */}
                {tickets.length > 0 && <div className={"stat-details stat-phase stat-section" + (detailsOpen ? " is-open" : "")}>
                <button type="button" className="stat-section-toggle" aria-expanded={detailsOpen} aria-controls={"stat-details-" + release.id}
                  onClick={() => toggle(release.id, setCollapsedDetails)}>
                  <span className="stat-phase-title"><ListChecks size={14} aria-hidden="true" /> Chi tiết ticket</span>
                  <small>{tickets.length} {rowLabel}</small>
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
                {detailsOpen && <div id={"stat-details-" + release.id} className="stat-phase-body">
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
                  <th>NGƯỜI TEST</th>{!manual && <th>PHASE WEB</th>}<th>PHASE APP</th><th>QE ĐÁNH DẤU DONE (APP)</th>
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
                    {!manual && <td className="stat-web-status">{(() => {
                      const kind = webKindOf(ticket.webStatus);
                      return <span className="stat-done-stamp"><span className={webChip(kind)}>{WEB_LABEL[kind]}</span>
                        {/* Who and when only mean something once the ticket has a web outcome. */}
                        {kind !== "open" && ticket.webAt && <small>{prettyStamp(ticket.webAt)}{ticket.webBy ? " · " + ticket.webBy : ""}</small>}
                        {(kind === "cannotTest" || kind === "failed" || kind === "riskAccepted") && ticket.webReason && <small className={kind === "failed" ? "stat-fail-reason" : ""}>{ticket.webReason}</small>}</span>;
                    })()}</td>}
                    <td className="golive-ticket-status"><span className={statusClass(statusOf(ticket))}>{statusOf(ticket)}</span></td>
                    <td className="stat-done-at">{done || ticket.failedAt
                      ? <span className="stat-done-stamp"><strong>{at ? prettyStamp(at) : "Không rõ thời điểm"}</strong><small>{markedHow(ticket)}{markedBy(ticket) ? " · " + markedBy(ticket) : ""}</small>{ticket.failedAt && ticket.failedReason && <small className="stat-fail-reason">{ticket.failedReason}</small>}</span>
                      : <span className="muted">{ticket.testedDevices > 0 ? "Đã tích " + ticket.testedDevices + " thiết bị, chưa đủ" : "Chưa đánh dấu"}</span>}</td>
                  </tr>;
                })}</tbody></table></div>
                {picked.length > 0 && <div className="stat-notify">
                  <span>Nhắc người test của <strong>{picked.length}</strong> {rowLabel} đã chọn</span>
                  <button type="button" className="primary-button" disabled={sending === release.id}
                    onClick={() => void notifyUntested(release.id, picked)}>
                    <Bell size={17} /> {sending === release.id ? "Đang gửi..." : "Gửi thông báo"}
                  </button>
                </div>}
                </div>}
                </div>}
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
