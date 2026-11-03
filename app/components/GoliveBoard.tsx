"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, History, CheckCircle2, ArrowUp, ArrowUpDown, Check, FileUp, Laptop, ListFilter, MoreHorizontal, Plus, Rocket, Search, Smartphone, Tablet, Trash2, X } from "lucide-react";
import { StyledSelect } from "./StyledSelect";
import { HolderIdentity } from "./HolderIdentity";
import { ImportedTicket, normalizeName, ticketsFromCsv } from "../lib/golive";
import { ManualGoliveDialog } from "./ManualGoliveDialog";

type Release = { id: string; name: string; source: string; fixVersion: string; createdBy: string; createdAt: string; completedAt: string | null; completedBy: string | null; ticketCount?: number };
const MAX_HISTORY = 10;
type Unfinished = { issueKey: string; summary: string; assignee: string };
type Ticket = { id: number; releaseId: string; issueKey: string; summary: string; assignee: string; assigneeUserId: string | null; doneAt: string | null };
type RecordedDevice = { ticketId: number; deviceId: string; deviceName: string };
const REFRESH_MS = 60_000;
type Person = { userId: string; displayName: string; avatar: string; role?: string };
type SortKey = "issueKey" | "summary" | "assignee";
type HeldDevice = { id: string; name: string; category: string };
type DeviceCheck = { ticketId: number; deviceId: string; deviceName: string; checkedByUserId: string; checkedAt: string };

const statusClass = (status: string) => "status-chip " + (status === "Done" ? "status-done" : "status-blocked");
const prettyTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));

export function GoliveBoard({ people, currentUserId, onError, onToast, onManageRoles }: { people: Person[]; currentUserId: string; onError: (message: string) => void; onToast: (message: string) => void; onManageRoles: () => void }) {
  const [releases, setReleases] = useState<Release[]>([]), [releaseId, setReleaseId] = useState(""), [tickets, setTickets] = useState<Ticket[]>([]);
  const [devicesByUser, setDevicesByUser] = useState<Record<string, HeldDevice[]>>({}), [checks, setChecks] = useState<DeviceCheck[]>([]), [recorded, setRecorded] = useState<RecordedDevice[]>([]), [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [view, setView] = useState<"active" | "history">("active");
  const [unfinished, setUnfinished] = useState<Unfinished[] | null>(null);
  const [pending, setPending] = useState<{ fileName: string; tickets: ImportedTicket[] } | null>(null), [releaseName, setReleaseName] = useState("");
  const [query, setQuery] = useState(""), [statusFilter, setStatusFilter] = useState("__all__");
  const [keyFilter, setKeyFilter] = useState(""), [summaryFilter, setSummaryFilter] = useState(""), [testerFilter, setTesterFilter] = useState("__all__");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>({ key: "assignee", dir: 1 });
  const fileInput = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false), [actionsOpen, setActionsOpen] = useState(false);

  const load = useCallback(async (id = "") => {
    try {
      const r = await fetch("/api/golive" + (id ? "?release=" + encodeURIComponent(id) : ""), { cache: "no-store" });
      const data = await r.json() as { releases?: Release[]; releaseId?: string; tickets?: Ticket[]; devicesByUser?: Record<string, HeldDevice[]>; checks?: DeviceCheck[]; recorded?: RecordedDevice[]; error?: string };
      if (!r.ok) throw new Error(data.error || "Không thể tải danh sách golive.");
      setReleases(data.releases || []); setReleaseId(data.releaseId || ""); setTickets(data.tickets || []); setDevicesByUser(data.devicesByUser || {}); setChecks(data.checks || []); setRecorded(data.recorded || []);
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể tải danh sách golive."); } finally { setLoading(false); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);
  // Pick up handovers and ticks made elsewhere: once a minute, and when the tab comes back into view.
  const refreshState = useRef({ releaseId, busy });
  useEffect(() => { refreshState.current = { releaseId, busy }; }, [releaseId, busy]);
  useEffect(() => {
    const refresh = () => { const { releaseId: id, busy: working } = refreshState.current; if (id && !working && document.visibilityState === "visible") void load(id); };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  function resetFilters() { setQuery(""); setStatusFilter("__all__"); setKeyFilter(""); setSummaryFilter(""); setTesterFilter("__all__"); }

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/golive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json() as { error?: string; releaseId?: string; count?: number; doneAt?: string | null; recorded?: RecordedDevice[]; release?: Release; unfinished?: Unfinished[] };
    if (!r.ok) throw Object.assign(new Error(data.error || "Không thể lưu thay đổi."), { unfinished: data.unfinished });
    return data;
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = ticketsFromCsv(await file.text());
      if (parsed.length === 0) throw new Error("Không tìm thấy ticket nào có Issue Key trong file.");
      setPending({ fileName: file.name, tickets: parsed }); setReleaseName(file.name.replace(/\.csv$/i, ""));
    } catch (e) { onError(e instanceof Error ? e.message : "Không đọc được file CSV."); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }

  async function confirmImport() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await post({ action: "import", name: releaseName, tickets: pending.tickets });
      setPending(null); resetFilters();
      onToast("Đã import " + result.count + " ticket cho đợt “" + releaseName.trim() + "” 🚀");
      await load(result.releaseId);
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể import."); } finally { setBusy(false); }
  }

  async function toggleCheck(ticket: Ticket, device: { id: string; name: string }, checked: boolean) {
    const previous = checks;
    setChecks(current => checked ? [...current, { ticketId: ticket.id, deviceId: device.id, deviceName: device.name, checkedByUserId: currentUserId, checkedAt: new Date().toISOString() }] : current.filter(item => !(item.ticketId === ticket.id && item.deviceId === device.id)));
    try {
      const result = await post({ action: "toggle-check", ticketId: ticket.id, deviceId: device.id, checked });
      setTickets(current => current.map(item => item.id === ticket.id ? { ...item, doneAt: result.doneAt ?? null } : item));
      if (result.recorded) setRecorded(current => [...current.filter(item => item.ticketId !== ticket.id), ...result.recorded!]);
    }
    catch (e) { setChecks(previous); onError(e instanceof Error ? e.message : "Không thể cập nhật checklist."); }
  }

  async function completeRelease() {
    const open = tickets.filter(item => !fullyTested(item));
    if (open.length) { setUnfinished(open); return; }
    const oldest = history.length >= MAX_HISTORY ? history[history.length - 1] : null;
    if (oldest && !window.confirm("Lịch sử chỉ lưu " + MAX_HISTORY + " đợt golive gần nhất. Đợt cũ nhất “" + oldest.name + "” sẽ bị xoá. Tiếp tục?")) return;
    setBusy(true);
    try {
      await post({ action: "complete-release", releaseId });
      onToast("Đã hoàn thành và lưu vào lịch sử golive 🎉");
      setView("history"); resetFilters();
      await load(releaseId);
    } catch (e) {
      // The server re-checks; someone may have unticked a device since this page loaded.
      const list = (e as { unfinished?: Unfinished[] }).unfinished;
      if (list?.length) { setUnfinished(list); await load(releaseId); }
      else onError(e instanceof Error ? e.message : "Không thể hoàn thành đợt golive.");
    } finally { setBusy(false); }
  }

  async function deleteRelease() {
    const release = releases.find(item => item.id === releaseId);
    if (!release || !window.confirm((release.completedAt ? "Xoá bản lưu của đợt golive" : "Xoá đợt golive") + " “" + release.name + "” cùng " + tickets.length + (release.source === "manual" ? " checklist QE?" : " ticket?"))) return;
    setBusy(true);
    try { await post({ action: "delete-release", releaseId }); onToast("Đã xoá đợt golive."); resetFilters(); await load(); }
    catch (e) { onError(e instanceof Error ? e.message : "Không thể xoá."); } finally { setBusy(false); }
  }

  // Devices the tester holds now, plus any already ticked device they have since handed over.
  const current = releases.find(item => item.id === releaseId);
  const manual = current?.source === "manual";
  const rowLabel = manual ? "người test" : "ticket";
  const active = releases.filter(item => !item.completedAt);
  const history = releases.filter(item => item.completedAt).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const showHistoryList = view === "history" && !current?.completedAt;
  const showDetail = view === "history" ? !!current?.completedAt : !!current && !current.completedAt;
  function openRelease(id: string) { setLoading(true); resetFilters(); void load(id); }
  function switchView(next: "active" | "history") {
    if (next === view) return;
    setView(next); resetFilters();
    if (next === "active") openRelease(active[0]?.id || "");
    else setReleaseId("");
  }

  // A completed release is a snapshot: only the devices ticked at completion, not today's holdings.
  // While running: every device recorded for the ticket, plus anything ticked or held now.
  // "optional" marks a device received after the ticket was already Done; it is not required.
  const ticketDevices = (ticket: Ticket) => {
    const ticked = checks.filter(item => item.ticketId === ticket.id);
    if (current?.completedAt) return ticked.map(item => ({ id: item.deviceId, name: item.deviceName, handedOver: false, optional: false }));
    const held = ticket.assigneeUserId ? devicesByUser[ticket.assigneeUserId] || [] : [];
    const list = new Map<string, { id: string; name: string; handedOver: boolean; optional: boolean }>();
    for (const item of [...recorded.filter(row => row.ticketId === ticket.id), ...ticked]) list.set(item.deviceId, { id: item.deviceId, name: item.deviceName, handedOver: !held.some(device => device.id === item.deviceId), optional: false });
    for (const device of held) if (!list.has(device.id)) list.set(device.id, { id: device.id, name: device.name, handedOver: false, optional: !!ticket.doneAt });
    return Array.from(list.values());
  };
  const isChecked = (ticket: Ticket, deviceId: string) => checks.some(item => item.ticketId === ticket.id && item.deviceId === deviceId);
  // Done is decided by the server and stays Done until a tick is removed.
  const fullyTested = (ticket: Ticket) => !!ticket.doneAt;
  // Status is derived: Done once the tester has ticked every device on the ticket.
  const statusOf = (ticket: Ticket) => fullyTested(ticket) ? "Done" : "In Progress";
  const counts = (["In Progress", "Done"] as const).map(status => [status, tickets.filter(item => statusOf(item) === status).length] as const);
  // Accent-insensitive, so "man hinh" finds "Màn hình".
  const fold = (value: string) => normalizeName(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
  const includes = (value: string, term: string) => fold(value).includes(fold(term));
  const projects = useMemo(() => Array.from(new Set(tickets.map(item => item.issueKey.split("-")[0]))).sort(), [tickets]);
  const testerOptions = useMemo(() => {
    const names = Array.from(new Set(tickets.map(item => item.assignee))).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "vi"));
    return [{ value: "__all__", label: "Tất cả người test", description: tickets.length + " " + rowLabel }, ...names.map(name => ({ value: name, label: name || "Chưa có người test", description: tickets.filter(item => item.assignee === name).length + (manual ? " checklist" : " ticket"), avatar: people.find(person => person.userId === tickets.find(item => item.assignee === name)?.assigneeUserId)?.avatar, role: people.find(person => person.userId === tickets.find(item => item.assignee === name)?.assigneeUserId)?.role }))];
  }, [tickets, people, rowLabel, manual]);
  const visible = useMemo(() => {
    const rows = tickets.filter(item => includes(item.issueKey + " " + item.summary + " " + item.assignee, query)
      && (!keyFilter || (projects.includes(keyFilter) ? item.issueKey.startsWith(keyFilter + "-") : includes(item.issueKey, keyFilter)))
      && includes(item.summary, summaryFilter)
      && (testerFilter === "__all__" || item.assignee === testerFilter)
      && (statusFilter === "__all__" || statusOf(item) === statusFilter) && (!mineOnly || item.assigneeUserId === currentUserId));
    if (!sort) return rows;
    // Issue keys compare numerically within a project, so ON-2006 sorts before ON-2251.
    return [...rows].sort((a, b) => sort.dir * (a[sort.key] || "\uffff").localeCompare(b[sort.key] || "\uffff", "vi", { numeric: true, sensitivity: "base" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, query, keyFilter, summaryFilter, testerFilter, statusFilter, mineOnly, currentUserId, devicesByUser, checks, sort, projects]);
  const filtered = keyFilter || summaryFilter || testerFilter !== "__all__" || query || statusFilter !== "__all__" || mineOnly;
  const columnFilterCount = Number(!!keyFilter) + Number(!!summaryFilter) + Number(testerFilter !== "__all__");
  const sortHeader = (key: SortKey, label: string) => {
    const active = sort?.key === key, Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" className={"golive-sort " + (active ? "active" : "")} onClick={() => setSort(!active ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null)}>{label}<Icon size={13} /></button></th>;
  };
  const done = tickets.filter(fullyTested).length;

  return <>
    <div className="page-heading"><div><h1>Tracking Golive.</h1><p>Tạo đợt golive cho team QE hoặc import ticket từ Jira. Người test xác nhận trên từng thiết bị đang cầm.</p></div>
      <div className="golive-heading-actions"><button className="outline-button" onClick={() => fileInput.current?.click()}><FileUp size={18} /> Import CSV</button><button className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> Tạo đợt golive</button></div>
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={e => void pickFile(e.target.files?.[0])} /></div>
    {loading ? <div className="loading" role="status"><div className="loading-bars"><span /><span /><span /></div>Đang tải đợt golive...</div>
      : <>
        <div className="filter-tabs golive-tabs" role="tablist">
          <button role="tab" aria-selected={view === "active"} className={view === "active" ? "active" : ""} onClick={() => switchView("active")}>Đang thực hiện ({active.length})</button>
          <button role="tab" aria-selected={view === "history"} className={view === "history" ? "active" : ""} onClick={() => switchView("history")}><History size={15} /> Lịch sử golive ({history.length}/{MAX_HISTORY})</button>
        </div>
        {view === "active" && active.length === 0 && <section className="panel golive-empty"><Rocket size={34} /><h2>Chưa có đợt golive nào đang thực hiện</h2><p>Tạo đợt golive bằng tên và fixVersion, hoặc import danh sách ticket từ Jira.</p><button className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> Tạo đợt golive</button></section>}
        {showHistoryList && (history.length === 0 ? <section className="panel golive-empty"><History size={34} /><h2>Chưa có đợt golive nào hoàn thành</h2><p>Các đợt đã hoàn thành được lưu ở đây, tối đa {MAX_HISTORY} đợt gần nhất.</p></section>
          : <><p className="golive-history-note">Lưu tối đa {MAX_HISTORY} đợt golive hoàn thành gần nhất. Khi hoàn thành đợt mới, đợt cũ nhất sẽ tự xoá.</p>
            <ul className="golive-history">{history.map(item => <li key={item.id}><button type="button" onClick={() => openRelease(item.id)}>
              <span className="golive-history-icon"><CheckCircle2 size={20} /></span>
              <span className="golive-history-main"><strong>{item.name}</strong><small>Hoàn thành {prettyTime(item.completedAt!)}{item.completedBy ? " · " + item.completedBy : ""}</small></span>
              <span className="golive-history-count">{item.ticketCount ?? 0} {item.source === "manual" ? "QE" : "ticket"}{item.fixVersion && <small className="golive-version">{item.fixVersion}</small>}</span><ArrowRight size={17} /></button></li>)}</ul></>)}
        {showDetail && current && <>
        <div className="golive-release-bar">
          {current.completedAt ? <><button type="button" className="outline-button golive-back" onClick={() => setReleaseId("")}><ArrowLeft size={16} /> Lịch sử</button><h2 className="golive-release-title">{current.name}</h2></>
            : <div className="golive-release-select"><StyledSelect ariaLabel="Chọn đợt golive" value={releaseId} onChange={openRelease} options={active.map(item => ({ value: item.id, label: item.name, description: prettyTime(item.createdAt) + " · " + item.createdBy }))} placeholder="Chọn đợt golive" /></div>}
          {current.fixVersion && <span className="golive-version">fixVersion: <strong>{current.fixVersion}</strong></span>}
          {current && <span className="golive-progress"><strong>{done}/{tickets.length}</strong> {rowLabel} đã test xong trên mọi thiết bị</span>}
          {current?.completedAt && <span className="golive-completed"><CheckCircle2 size={16} /> Đã hoàn thành {prettyTime(current.completedAt)}{current.completedBy ? " · " + current.completedBy : ""}</span>}
          <button className="outline-button golive-actions-toggle" aria-expanded={actionsOpen} aria-controls="golive-release-actions" onClick={() => setActionsOpen(!actionsOpen)}>Thao tác đợt <MoreHorizontal size={17} /></button>
          <div id="golive-release-actions" className={"golive-release-actions" + (actionsOpen ? " is-open" : "")}>
          {!current.completedAt && <button className="primary-button golive-complete" disabled={busy} onClick={() => void completeRelease()}><CheckCircle2 size={17} /> Hoàn thành đợt golive</button>}
          <button className="outline-button golive-delete" disabled={busy} onClick={() => void deleteRelease()}><Trash2 size={16} /> Xoá đợt golive</button>
          </div>
        </div>
        <div className="golive-stats">{counts.map(([status, count]) => <button key={status} className={"golive-stat " + (statusFilter === status ? "active" : "")} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(statusFilter === status ? "__all__" : status)}><span className={statusClass(status)}>{status}</span><strong>{count}</strong></button>)}</div>
        <div className="inventory-toolbar golive-toolbar"><div className="search"><Search size={19} /><input aria-label={manual ? "Tìm người test" : "Tìm ticket"} value={query} onChange={e => setQuery(e.target.value)} placeholder={manual ? "Tìm người test..." : "Tìm mã, tên ticket, người test..."} /></div><label className="golive-mine"><input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> {manual ? "Chỉ checklist của tôi" : "Chỉ ticket của tôi"}</label><span>{visible.length} {rowLabel}</span></div>
        <div className="golive-mobile-tools">
          <button className="outline-button" aria-expanded={filtersOpen} aria-controls="golive-column-filters" onClick={() => setFiltersOpen(!filtersOpen)}><ListFilter size={17} /> Bộ lọc{columnFilterCount > 0 ? " (" + columnFilterCount + ")" : ""}</button>
          <StyledSelect ariaLabel="Sắp xếp danh sách" value={sort ? sort.key + ":" + sort.dir : "none"} onChange={value => { const [key, dir] = value.split(":"); setSort(value === "none" ? null : { key: key as SortKey, dir: Number(dir) as 1 | -1 }); }} options={[
            { value: "assignee:1", label: "Người test A–Z" }, { value: "assignee:-1", label: "Người test Z–A" },
            ...(!manual ? [{ value: "issueKey:1", label: "Mã tăng dần" }, { value: "issueKey:-1", label: "Mã giảm dần" }, { value: "summary:1", label: "Tên ticket A–Z" }, { value: "summary:-1", label: "Tên ticket Z–A" }] : []),
            { value: "none", label: "Thứ tự ban đầu" },
          ]} placeholder="Sắp xếp" />
        </div>
        <div id="golive-column-filters" className={"golive-filters" + (filtersOpen ? " is-open" : "")}>
          {!manual && <><label>MÃ<input list="golive-projects" value={keyFilter} onChange={e => setKeyFilter(e.target.value.trim().toUpperCase())} placeholder="VD: DIP hoặc DIP-2313" /><datalist id="golive-projects">{projects.map(project => <option key={project} value={project} />)}</datalist></label>
          <label>TÊN TICKET<input value={summaryFilter} onChange={e => setSummaryFilter(e.target.value)} placeholder="Chứa từ khoá..." /></label></>}
          <label>NGƯỜI TEST<StyledSelect ariaLabel="Lọc theo người test" value={testerFilter} onChange={setTesterFilter} options={testerOptions} placeholder="Tất cả người test" /></label>
          {filtered && <button type="button" className="outline-button golive-clear" onClick={() => { resetFilters(); setMineOnly(false); }}><X size={15} /> Xoá lọc</button>}
        </div>
        <section className="panel table-panel"><div className="table-scroll"><table className={"golive-table" + (manual ? " golive-manual-table" : "")}><thead><tr>{!manual && <>{sortHeader("issueKey", "MÃ")}{sortHeader("summary", "TÊN TICKET")}</>}{sortHeader("assignee", "NGƯỜI TEST")}<th>TRẠNG THÁI</th><th>THIẾT BỊ ĐÃ TEST</th></tr></thead><tbody>{visible.map(ticket => <tr key={ticket.id}>
          {!manual && <><td className="golive-key">{ticket.issueKey}</td>
          <td className="golive-summary">{ticket.summary || <span className="muted">(không có tên)</span>}</td></>}
          <td className="golive-assignee">{ticket.assignee ? <HolderIdentity name={ticket.assignee} avatar={people.find(person => person.userId === ticket.assigneeUserId)?.avatar || ""} role={people.find(person => person.userId === ticket.assigneeUserId)?.role} /> : <span className="muted">Chưa có người test</span>}</td>
          <td className="golive-ticket-status"><span className={statusClass(statusOf(ticket))}>{statusOf(ticket)}</span></td>
          <td className="golive-devices">{!ticket.assignee ? <span className="muted">Chưa có người test</span> : !ticket.assigneeUserId ? <span className="muted">“{ticket.assignee}” chưa khớp tài khoản nào</span> : (() => {
            const list = ticketDevices(ticket), mine = ticket.assigneeUserId === currentUserId && !current?.completedAt;
            if (list.length === 0) return <span className="muted">Người test chưa cầm thiết bị nào</span>;
            return <div className="golive-device-group">
              <div className="golive-device-count">{list.filter(device => isChecked(ticket, device.id)).length}/{list.length} thiết bị đã test</div>
              <ul className={"golive-checklist " + (fullyTested(ticket) ? "complete" : "")}>{list.map(device => {
                const checked = isChecked(ticket, device.id);
                const DeviceIcon = /ipad|tablet|máy tính bảng/i.test(device.name) ? Tablet : /laptop|macbook/i.test(device.name) ? Laptop : Smartphone;
                const detail = device.handedOver ? (checked ? "Đã test · đã bàn giao" : "Đã bàn giao · chưa test") : device.optional && !checked ? "Máy mới · không bắt buộc" : checked ? "Đã test" : "Chưa test";
                return <li key={device.id}><label className={(checked ? "checked " : "") + (mine ? "" : "readonly")} title={mine ? "" : current?.completedAt ? "Đợt golive đã hoàn thành" : "Chỉ " + ticket.assignee + " mới tích được"}>
                  <input type="checkbox" aria-label={(manual ? ticket.assignee : ticket.issueKey) + " · " + device.name} checked={checked} disabled={!mine} onChange={e => void toggleCheck(ticket, device, e.target.checked)} />
                  <DeviceIcon className="golive-device-icon" size={19} aria-hidden="true" />
                  <span className="golive-device-copy"><span className="golive-device-name">{device.name}</span><small className={device.handedOver && !checked ? "golive-warn" : ""}>{detail}</small></span>
                  <span className="golive-check-box" aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>
                </label></li>;
              })}</ul>
            </div>;
          })()}</td>
        </tr>)}</tbody></table>{visible.length === 0 && <p className="empty">Không có {rowLabel} phù hợp.</p>}</div></section>
      </>}
      </>}
    {unfinished && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setUnfinished(null); }} onKeyDown={e => { if (e.key === "Escape") setUnfinished(null); }}><div className="modal golive-warning" role="alertdialog" aria-modal="true" aria-labelledby="golive-warning-title">
      <div className="modal-head"><div className="golive-warning-head"><AlertTriangle size={22} /><div><h2 id="golive-warning-title">Chưa thể hoàn thành đợt golive</h2><p>Còn {unfinished.length} {rowLabel} chưa Done. Người test cần tích đủ các thiết bị đang cầm.</p></div></div><button className="icon-button" onClick={() => setUnfinished(null)} aria-label="Đóng"><X size={21} /></button></div>
      <div className="golive-warning-list"><table><thead><tr>{!manual && <><th>MÃ</th><th>TÊN TICKET</th></>}<th>NGƯỜI TEST</th></tr></thead><tbody>{unfinished.map(item => <tr key={item.issueKey}>{!manual && <><td className="golive-key">{item.issueKey}</td><td>{item.summary}</td></>}<td>{item.assignee || <span className="muted">Chưa có người test</span>}</td></tr>)}</tbody></table></div>
      <div className="modal-actions"><button autoFocus className="primary-button" onClick={() => setUnfinished(null)}>Đã hiểu</button></div>
    </div></div>}
    {pending && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setPending(null); }}><div className="modal" role="dialog" aria-modal="true" aria-label="Đặt tên đợt golive">
      <div className="modal-head"><div><h2>Đặt tên đợt golive</h2><p className="golive-file">{pending.fileName} · {pending.tickets.length} ticket</p></div><button className="icon-button" disabled={busy} onClick={() => setPending(null)} aria-label="Đóng"><X size={21} /></button></div>
      <div className="form-grid"><label className="span-2">TÊN ĐỢT GOLIVE<input autoFocus value={releaseName} maxLength={120} onChange={e => setReleaseName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !busy) void confirmImport(); if (e.key === "Escape" && !busy) setPending(null); }} placeholder="Ví dụ: Golive 15/11 – Release 2.4" /></label></div>
      <ul className="golive-preview">{pending.tickets.slice(0, 5).map(ticket => <li key={ticket.issueKey}><strong>{ticket.issueKey}</strong> {ticket.summary}</li>)}{pending.tickets.length > 5 && <li className="muted">… và {pending.tickets.length - 5} ticket khác</li>}</ul>
      <div className="modal-actions"><button className="outline-button" disabled={busy} onClick={() => setPending(null)}>Huỷ</button><button className="primary-button" disabled={busy || releaseName.trim().length < 2} onClick={() => void confirmImport()}>{busy ? "Đang import..." : "Import"} <ArrowRight size={17} /></button></div>
    </div></div>}
    {creating && <ManualGoliveDialog onClose={() => setCreating(false)} onManageRoles={() => { setCreating(false); onManageRoles(); }} onCreated={id => { setCreating(false); setView("active"); resetFilters(); onToast("Đã tạo đợt golive."); void load(id); }} />}
  </>;
}
