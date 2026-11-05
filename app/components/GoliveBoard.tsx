"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, History, CheckCircle2, ArrowUp, ArrowUpDown, Ban, Bell, Check, CircleSlash, Pencil, Globe, FileUp, Laptop, ListFilter, Plus, Rocket, Lock, Search, Smartphone, Tablet, Trash2, Undo2, UserRound, X, XCircle } from "lucide-react";
import { StyledSelect } from "./StyledSelect";
import { HolderIdentity } from "./HolderIdentity";
import { LoadingState } from "./LoadingState";
import { useConfirm } from "./ConfirmDialog";
import { readUrlParam, writeUrlParams } from "../lib/url-state";
import { ImportedTicket, inAppPhase, isWebStatus, normalizeName, releaseNameFromCsv, ticketsFromCsv, webSettled, WebStatus } from "../lib/golive";
import { ManualGoliveDialog } from "./ManualGoliveDialog";
import { CannotTestDialog } from "./CannotTestDialog";
import { TestFailedDialog } from "./TestFailedDialog";
import { PushToggle } from "./PushToggle";

type Release = { id: string; name: string; source: string; fixVersion: string; createdBy: string; createdAt: string; completedAt: string | null; completedBy: string | null; ticketCount?: number };
const MAX_HISTORY = 10;
type Unfinished = { issueKey: string; summary: string; assignee: string };
type Ticket = { id: number; releaseId: string; issueKey: string; summary: string; assignee: string; assigneeUserId: string | null; doneAt: string | null; skippedAt?: string | null; skippedBy?: string | null; skipKind?: string; skipReason?: string; skipNotified?: boolean; failedAt?: string | null; failedBy?: string | null; failedReason?: string; webStatus?: string | null; webAt?: string | null; webBy?: string | null; webReason?: string; webNotified?: boolean };
const REFRESH_MS = 60_000;
type Person = { userId: string; displayName: string; avatar: string; role?: string };
type SortKey = "issueKey" | "summary" | "assignee";
type HeldDevice = { id: string; name: string; category: string };
type DeviceCheck = { ticketId: number; deviceId: string; deviceName: string; checkedByUserId: string; checkedAt: string };

const statusClass = (status: string) => "status-chip " + (status === "Done" ? "status-done" : status === "Test Failed" ? "status-failed" : "status-blocked");
const prettyTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));

type GoliveData = { releases?: Release[]; releaseId?: string; tickets?: Ticket[]; devicesByUser?: Record<string, HeldDevice[]>; checks?: DeviceCheck[]; web?: WebPhase; error?: string };
type WebPhase = { qe: { userId: string; displayName: string }[]; signed: Record<string, string> };
const NO_WEB: WebPhase = { qe: [], signed: {} };
// The last response outlives the component, so coming back to this page shows it at once while it refreshes.
let lastData: GoliveData | null = null;

export function GoliveBoard({ people, currentUserId, onError, onToast, onManageRoles }: { people: Person[]; currentUserId: string; onError: (message: string) => void; onToast: (message: string) => void; onManageRoles: () => void }) {
  const [releases, setReleases] = useState<Release[]>(lastData?.releases || []), [releaseId, setReleaseId] = useState(lastData?.releaseId || ""), [tickets, setTickets] = useState<Ticket[]>(lastData?.tickets || []);
  const [devicesByUser, setDevicesByUser] = useState<Record<string, HeldDevice[]>>(lastData?.devicesByUser || {}), [checks, setChecks] = useState<DeviceCheck[]>(lastData?.checks || []), [mineOnly, setMineOnly] = useState(false);
  const [web, setWeb] = useState<WebPhase>(lastData?.web || NO_WEB);
  const [loading, setLoading] = useState(!lastData), [busy, setBusy] = useState(false), [view, setView] = useState<"active" | "history">(() => readUrlParam("view") === "history" ? "history" : "active");
  const [unfinished, setUnfinished] = useState<Unfinished[] | null>(null);
  const [pending, setPending] = useState<{ fileName: string; tickets: ImportedTicket[] } | null>(null), [releaseName, setReleaseName] = useState("");
  const [query, setQuery] = useState(""), [statusFilter, setStatusFilter] = useState("__all__");
  const [keyFilter, setKeyFilter] = useState(""), [summaryFilter, setSummaryFilter] = useState(""), [testerFilter, setTesterFilter] = useState("__all__");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>({ key: "assignee", dir: 1 });
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [creating, setCreating] = useState(false);
  // phase "web" routes the dialog's answer to the ticket's web outcome instead of the app one.
  const [cannotTest, setCannotTest] = useState<{ ticket: Ticket; editing: boolean; phase?: "web" } | null>(null);
  const [failing, setFailing] = useState<{ ticket: Ticket; editing: boolean; phase?: "web" } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Tickets ticked for a bulk status update, and the reason dialog a bulk "cannot test"/"failed" opens.
  const [picked, setPicked] = useState<number[]>([]);
  const [bulkReason, setBulkReason] = useState<"cannot-test" | "failed" | null>(null);

  const load = useCallback(async (id = "") => {
    try {
      const r = await fetch("/api/golive" + (id ? "?release=" + encodeURIComponent(id) : ""), { cache: "no-store" });
      const data = await r.json() as GoliveData;
      if (!r.ok) throw new Error(data.error || "Không thể tải danh sách golive.");
      lastData = data;
      setReleases(data.releases || []); setReleaseId(data.releaseId || ""); setTickets(data.tickets || []); setDevicesByUser(data.devicesByUser || {}); setChecks(data.checks || []); setWeb(data.web || NO_WEB);
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể tải danh sách golive."); } finally { setLoading(false); }
  }, [onError]);
  // Reopen the release named in the URL, else the one last on screen; naming it lets the server load it in parallel.
  useEffect(() => { void load(readUrlParam("release") || (readUrlParam("view") === "history" ? "" : lastData?.releaseId || "")); }, [load]);
  // Mirror the open view and release into the URL; Back/Forward within this page restore them.
  // The history list has no release open, even though the server reports the default running one.
  const openedId = view === "history" && !releases.find(item => item.id === releaseId)?.completedAt ? "" : releaseId;
  useEffect(() => { if (!loading) writeUrlParams({ view: view === "history" ? "history" : "", release: openedId }); }, [view, openedId, loading]);
  useEffect(() => {
    const fromUrl = () => {
      if (readUrlParam("tab") !== "golive") return;
      setView(readUrlParam("view") === "history" ? "history" : "active");
      const id = readUrlParam("release");
      if (id) void load(id); else setReleaseId("");
    };
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, [load]);
  // Pick up handovers and ticks made elsewhere: once a minute, and when the tab comes back into view.
  const refreshState = useRef({ releaseId, busy });
  useEffect(() => { refreshState.current = { releaseId, busy }; }, [releaseId, busy]);
  useEffect(() => {
    const refresh = () => { const { releaseId: id, busy: working } = refreshState.current; if (id && !working && document.visibilityState === "visible") void load(id); };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  function resetFilters() { setQuery(""); setStatusFilter("__all__"); setKeyFilter(""); setSummaryFilter(""); setTesterFilter("__all__"); setPicked([]); }

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/golive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json() as { error?: string; releaseId?: string; count?: number; doneAt?: string | null; skippedAt?: string | null; skippedBy?: string | null; skipKind?: string; skipReason?: string; skipNotified?: boolean; failedAt?: string | null; failedBy?: string | null; failedReason?: string; webStatus?: string | null; webAt?: string | null; webBy?: string | null; webReason?: string; webNotified?: boolean; release?: Release; unfinished?: Unfinished[]; web?: WebPhase; pending?: number };
    if (!r.ok) throw Object.assign(new Error(data.error || "Không thể lưu thay đổi."), { unfinished: data.unfinished });
    return data;
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = ticketsFromCsv(text);
      if (parsed.length === 0) throw new Error("Không tìm thấy ticket nào có Issue Key trong file.");
      setPending({ fileName: file.name, tickets: parsed }); setReleaseName(releaseNameFromCsv(text) || file.name.replace(/\.csv$/i, ""));
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
    }
    catch (e) { setChecks(previous); onError(e instanceof Error ? e.message : "Không thể cập nhật checklist."); }
  }

  // "tested": the tester finished on borrowed devices; "not-needed": the ticket needs no test.
  const applySkip = (ticket: Ticket, result: Awaited<ReturnType<typeof post>>) =>
    setTickets(current => current.map(item => item.id === ticket.id ? { ...item, doneAt: result.doneAt ?? null, failedAt: result.failedAt ?? null, failedBy: result.failedBy ?? null, failedReason: result.failedReason ?? "", skippedAt: result.skippedAt ?? null, skippedBy: result.skippedBy ?? null, skipKind: result.skipKind, skipReason: result.skipReason ?? "", skipNotified: !!result.skipNotified } : item));

  const applyFail = (ticket: Ticket, result: Awaited<ReturnType<typeof post>>) =>
    setTickets(current => current.map(item => item.id === ticket.id ? { ...item, doneAt: result.doneAt ?? null, failedAt: result.failedAt ?? null, failedBy: result.failedBy ?? null, failedReason: result.failedReason ?? "", skippedAt: result.skippedAt ?? null, skippedBy: result.skippedBy ?? null, skipKind: result.skipKind, skipReason: result.skipReason, skipNotified: result.skipNotified } : item));

  // "Test failed" records why, and leaves the ticket outstanding.
  async function markFailed(reason: string) {
    if (!failing) return;
    const { ticket, editing } = failing;
    if (failing.phase === "web") { if (await setWebStatus(ticket, "failed", reason)) setFailing(null); return; }
    setBusy(true);
    try {
      applyFail(ticket, await post({ action: "fail-test", ticketId: ticket.id, failed: true, reason }));
      setFailing(null);
      onToast(editing ? "Đã cập nhật lý do test failed cho " + ticket.issueKey : "Đã đánh dấu " + ticket.issueKey + " test failed");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể cập nhật ticket."); } finally { setBusy(false); }
  }

  async function clearFailed(ticket: Ticket) {
    if (!await confirm({ title: "Thu hồi test failed?", message: <>Ticket <strong>{ticket.issueKey}</strong> sẽ quay lại tính Done theo các máy đã tích.</>, confirmLabel: "Thu hồi" })) return;
    setBusy(true);
    try {
      applyFail(ticket, await post({ action: "fail-test", ticketId: ticket.id, failed: false }));
      onToast("Đã thu hồi test failed cho " + ticket.issueKey);
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể cập nhật ticket."); } finally { setBusy(false); }
  }

  // "Không test được" asks for a reason in its own dialog instead of a plain confirm.
  async function markCannotTest(reason: string, notified: boolean) {
    if (!cannotTest) return;
    const { ticket, editing } = cannotTest;
    if (cannotTest.phase === "web") { if (await setWebStatus(ticket, "cannot-test", reason, notified)) setCannotTest(null); return; }
    setBusy(true);
    try {
      applySkip(ticket, await post({ action: "skip-test", ticketId: ticket.id, skipped: true, kind: "cannot-test", reason, notified }));
      setCannotTest(null);
      onToast(editing ? "Đã cập nhật lý do cho " + ticket.issueKey : "Đã đánh dấu " + ticket.issueKey + " không test được");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể cập nhật ticket."); } finally { setBusy(false); }
  }

  async function setSkipped(ticket: Ticket, skipped: boolean, kind: "tested" | "not-needed" = "not-needed") {
    const ok = await confirm(!skipped
      ? { title: "Thu hồi đánh dấu?", message: <>Ticket <strong>{ticket.issueKey}</strong> sẽ quay lại checklist thiết bị và tính Done theo các máy đã tích.</>, confirmLabel: "Thu hồi" }
      : kind === "tested"
        ? { title: "Xác nhận đã test xong?", message: <>Ticket <strong>{ticket.issueKey}</strong> chuyển sang Done ngay, kể cả khi bạn test trên máy mượn và chưa tích đủ các máy đang cầm.</>, confirmLabel: "Đã test xong" }
        : { title: "Đánh dấu không cần test?", message: <>Ticket <strong>{ticket.issueKey}</strong> chuyển sang Done ngay và checklist thiết bị được ẩn đi. Có thể thu hồi sau.</>, confirmLabel: "Không cần test" });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await post({ action: "skip-test", ticketId: ticket.id, skipped, kind });
      applySkip(ticket, result);
      onToast(!skipped ? "Đã thu hồi đánh dấu cho " + ticket.issueKey : kind === "tested" ? "Đã xác nhận test xong " + ticket.issueKey : "Đã đánh dấu " + ticket.issueKey + " không cần test");
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể cập nhật ticket."); } finally { setBusy(false); }
  }

  // Phase web: the tester picks one of the four outcomes directly; null takes it back.
  const WEB_TOAST: Record<WebStatus, string> = { tested: "đã test xong web", "not-needed": "không cần test web", "cannot-test": "không test được web", failed: "test web failed" };
  // One of the four outcomes for every ticked ticket, in the phase the release is in.
  const BULK_LABEL: Record<WebStatus, string> = { tested: "Đã test xong", "not-needed": "Không cần test", "cannot-test": "Không test được", failed: "Test failed" };
  async function bulkUpdate(status: WebStatus, reason = "", notified = false) {
    const ids = picked.filter(id => tickets.some(item => item.id === id && canSkip(item)));
    if (!ids.length) return false;
    const phaseName = appPhase ? "phase app" : "phase web";
    if ((status === "tested" || status === "not-needed") && !await confirm({ title: "Cập nhật " + ids.length + " ticket?", message: <><strong>{ids.length}</strong> ticket đã chọn sẽ được đánh dấu <strong>{BULK_LABEL[status]}</strong> ở {phaseName}{appPhase ? " và chuyển sang Done" : ""}. Có thể thu hồi từng ticket sau.</>, confirmLabel: BULK_LABEL[status] })) return false;
    setBusy(true);
    try {
      const r = await fetch("/api/golive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bulk-status", releaseId, phase: appPhase ? "app" : "web", status, reason, notified, ticketIds: ids }) });
      const result = await r.json() as { error?: string; updated?: number[]; values?: Partial<Ticket>; skipped?: number };
      if (!r.ok) throw new Error(result.error || "Không thể cập nhật ticket.");
      const updated = result.updated || [];
      setTickets(current => current.map(item => updated.includes(item.id) ? { ...item, ...result.values } : item));
      setPicked([]);
      onToast("Đã đánh dấu " + updated.length + " ticket " + BULK_LABEL[status] + " ở " + phaseName + (result.skipped ? " (bỏ qua " + result.skipped + " ticket không có quyền)" : ""));
      return true;
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể cập nhật ticket."); return false; } finally { setBusy(false); }
  }

  async function setWebStatus(ticket: Ticket, status: WebStatus | null, reason = "", notified = false) {
    if (status === null && !await confirm({ title: "Thu hồi trạng thái phase web?", message: <>Ticket <strong>{ticket.issueKey}</strong> sẽ quay lại chưa test web.</>, confirmLabel: "Thu hồi" })) return false;
    if ((status === "tested" || status === "not-needed") && !await confirm(status === "tested"
      ? { title: "Xác nhận đã test xong web?", message: <>Ticket <strong>{ticket.issueKey}</strong> được ghi nhận đã test xong ở phase web.</>, confirmLabel: "Đã test xong" }
      : { title: "Đánh dấu không cần test web?", message: <>Ticket <strong>{ticket.issueKey}</strong> được ghi nhận không cần test ở phase web. Có thể thu hồi sau.</>, confirmLabel: "Không cần test" })) return false;
    setBusy(true);
    try {
      const result = await post({ action: "web-status", ticketId: ticket.id, status, reason, notified });
      setTickets(current => current.map(item => item.id === ticket.id ? { ...item, webStatus: result.webStatus ?? null, webAt: result.webAt ?? null, webBy: result.webBy ?? null, webReason: result.webReason ?? "", webNotified: !!result.webNotified } : item));
      onToast(status ? "Đã đánh dấu " + ticket.issueKey + " " + WEB_TOAST[status] : "Đã thu hồi trạng thái phase web của " + ticket.issueKey);
      return true;
    } catch (e) { onError(e instanceof Error ? e.message : "Không thể cập nhật ticket."); return false; } finally { setBusy(false); }
  }

  async function signWeb(doneWeb: boolean) {
    if (!doneWeb && !await confirm({ title: "Thu hồi xác nhận test web?", message: "Tiến trình test web sẽ trừ bạn ra cho đến khi bạn xác nhận lại.", confirmLabel: "Thu hồi" })) return;
    setBusy(true);
    try { const result = await post({ action: "web-signoff", releaseId, done: doneWeb }); setWeb(result.web || NO_WEB); onToast(doneWeb ? "Đã xác nhận hoàn thành test web" : "Đã thu hồi xác nhận test web"); }
    catch (e) {
      const list = (e as { unfinished?: Unfinished[] }).unfinished;
      if (list?.length) { setStatusFilter("__all__"); setMineOnly(true); }
      onError(e instanceof Error ? e.message : "Không thể cập nhật.");
    } finally { setBusy(false); }
  }

  // Sends a push to every QE who has not confirmed the web test yet.
  async function remindWeb() {
    setBusy(true);
    try { const result = await post({ action: "remind-web", releaseId }); onToast("Đã gửi nhắc nhở tới " + result.pending + " QE chưa xác nhận"); }
    catch (e) { onError(e instanceof Error ? e.message : "Không thể nhắc nhở."); } finally { setBusy(false); }
  }

  async function completeRelease() {
    const open = tickets.filter(item => !fullyTested(item));
    if (open.length) { setUnfinished(open); return; }
    const oldest = history.length >= MAX_HISTORY ? history[history.length - 1] : null;
    if (oldest && !await confirm({ title: "Lịch sử golive đã đầy", message: <>Lịch sử chỉ lưu {MAX_HISTORY} đợt gần nhất. Đợt cũ nhất <strong>{oldest.name}</strong> sẽ bị xoá vĩnh viễn.</>, confirmLabel: "Hoàn thành và xoá đợt cũ", tone: "danger" })) return;
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
    if (!release || !await confirm({ title: release.completedAt ? "Xoá bản lưu đợt golive?" : "Xoá đợt golive?", message: <>Đợt <strong>{release.name}</strong> cùng {tickets.length} {release.source === "manual" ? "checklist QE" : "ticket"} và toàn bộ dấu tích sẽ bị xoá vĩnh viễn. Không thể hoàn tác.</>, confirmLabel: "Xoá đợt golive", tone: "danger" })) return;
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
  // While running: the devices the tester holds now, plus ticked ones they have since handed over.
  // A device handed over before it was ticked drops off; "optional" marks one received after Done.
  const ticketDevices = (ticket: Ticket) => {
    const ticked = checks.filter(item => item.ticketId === ticket.id);
    if (current?.completedAt) return ticked.map(item => ({ id: item.deviceId, name: item.deviceName, handedOver: false, optional: false }));
    const held = ticket.assigneeUserId ? devicesByUser[ticket.assigneeUserId] || [] : [];
    const list = new Map<string, { id: string; name: string; handedOver: boolean; optional: boolean }>();
    for (const item of ticked) list.set(item.deviceId, { id: item.deviceId, name: item.deviceName, handedOver: !held.some(device => device.id === item.deviceId), optional: false });
    for (const device of held) if (!list.has(device.id)) list.set(device.id, { id: device.id, name: device.name, handedOver: false, optional: !!ticket.doneAt });
    return Array.from(list.values());
  };
  // The tester or a Manager may mark a CSV ticket as not needing a test while the release is running.
  // A ticket whose tester has no matching account can be marked by anyone signed in.
  const canSkip = (ticket: Ticket) => !manual && !current?.completedAt && (!ticket.assigneeUserId || ticket.assigneeUserId === currentUserId || people.find(person => person.userId === currentUserId)?.role === "Manager");
  // "Đã test xong" keeps the checklist below the badge so the devices actually tested stay visible.
  const skipBadge = (ticket: Ticket) => {
    const cannot = ticket.skipKind === "cannot-test";
    return <div className={"golive-skipped" + (ticket.skipKind === "tested" ? " golive-skipped-tested" : cannot ? " golive-skipped-cannot" : "")}>
      <span className="golive-skipped-label"><strong>{ticket.skipKind === "tested" ? <><CheckCircle2 size={16} aria-hidden="true" /> Đã test xong</> : cannot ? <><CircleSlash size={16} aria-hidden="true" /> Không test được</> : <><Ban size={16} aria-hidden="true" /> Không cần test</>}</strong>
        {cannot && ticket.skipReason && <span className="golive-skip-reason">{ticket.skipReason}</span>}
        {cannot && <span className={"golive-skip-notified" + (ticket.skipNotified ? " is-notified" : "")}>{ticket.skipNotified ? <><Check size={13} aria-hidden="true" /> Đã báo scrum team</> : <><AlertTriangle size={13} aria-hidden="true" /> Chưa báo scrum team</>}</span>}
        {ticket.skippedBy && <small>{ticket.skipKind === "tested" ? "Xác nhận" : "Đánh dấu"} bởi {ticket.skippedBy}</small>}</span>
      {canSkip(ticket) && <span className="golive-skipped-actions">
        {cannot && <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => setCannotTest({ ticket, editing: true })}><Pencil size={14} /> Sửa</button>}
        <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => void setSkipped(ticket, false)}><Undo2 size={14} /> Thu hồi</button></span>}
    </div>;
  };
  const failBadge = (ticket: Ticket) => <div className="golive-skipped golive-skipped-failed">
    <span className="golive-skipped-label"><strong><XCircle size={16} aria-hidden="true" /> Test failed</strong>
      {ticket.failedReason && <span className="golive-skip-reason">{ticket.failedReason}</span>}
      {ticket.failedBy && <small>Đánh dấu bởi {ticket.failedBy}</small>}
      {canSkip(ticket) && <small className="golive-fail-hint">Test lại xong thì chọn một trạng thái bên dưới.</small>}</span>
    {canSkip(ticket) && <span className="golive-skipped-actions">
      <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => setFailing({ ticket, editing: true })}><Pencil size={14} /> Sửa</button>
      <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => void clearFailed(ticket)}><Undo2 size={14} /> Thu hồi</button></span>}
  </div>;
  // Phase web column: one of the four outcomes, picked while the web phase runs and locked after it.
  // A manual golive has one row per QE, whose web outcome is that QE's own web sign-off.
  const webCell = (ticket: Ticket) => {
    if (manual) {
      const at = ticket.assigneeUserId ? web.signed[ticket.assigneeUserId] : undefined;
      return at ? <span className="golive-web-outcome"><CheckCircle2 size={15} aria-hidden="true" /> Đã xác nhận test web</span> : <span className="muted">Chưa xác nhận test web</span>;
    }
    // Anything but the four known outcomes (bad data) reads as not tested yet.
    const editable = !appPhase && canSkip(ticket), status = isWebStatus(ticket.webStatus) ? ticket.webStatus : null;
    if (!status) return editable
      ? <div className="golive-skip-actions">
        <button type="button" className="text-button golive-skip-button" disabled={busy} onClick={() => void setWebStatus(ticket, "tested")}><CheckCircle2 size={14} /> Đã test xong</button>
        <button type="button" className="text-button golive-skip-button" disabled={busy} onClick={() => void setWebStatus(ticket, "not-needed")}><Ban size={14} /> Không cần test</button>
        <button type="button" className="text-button golive-skip-button" disabled={busy} onClick={() => setCannotTest({ ticket, editing: false, phase: "web" })}><CircleSlash size={14} /> Không test được</button>
        <button type="button" className="text-button golive-skip-button golive-fail-button" disabled={busy} onClick={() => setFailing({ ticket, editing: false, phase: "web" })}><XCircle size={14} /> Test failed</button>
      </div>
      : <span className="muted">{appPhase ? "Không được đánh dấu ở phase web" : "Chưa test web"}</span>;
    const reasoned = status === "cannot-test" || status === "failed";
    return <div className={"golive-skipped" + (status === "tested" ? " golive-skipped-tested" : status === "cannot-test" ? " golive-skipped-cannot" : status === "failed" ? " golive-skipped-failed" : "")}>
      <span className="golive-skipped-label"><strong>{status === "tested" ? <><CheckCircle2 size={16} aria-hidden="true" /> Đã test xong</> : status === "cannot-test" ? <><CircleSlash size={16} aria-hidden="true" /> Không test được</> : status === "failed" ? <><XCircle size={16} aria-hidden="true" /> Test failed</> : <><Ban size={16} aria-hidden="true" /> Không cần test</>}</strong>
        {reasoned && ticket.webReason && <span className="golive-skip-reason">{ticket.webReason}</span>}
        {status === "cannot-test" && <span className={"golive-skip-notified" + (ticket.webNotified ? " is-notified" : "")}>{ticket.webNotified ? <><Check size={13} aria-hidden="true" /> Đã báo scrum team</> : <><AlertTriangle size={13} aria-hidden="true" /> Chưa báo scrum team</>}</span>}
        {ticket.webBy && <small>{status === "tested" ? "Xác nhận" : "Đánh dấu"} bởi {ticket.webBy}</small>}</span>
      {editable && <span className="golive-skipped-actions">
        {reasoned && <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => status === "failed" ? setFailing({ ticket, editing: true, phase: "web" }) : setCannotTest({ ticket, editing: true, phase: "web" })}><Pencil size={14} /> Sửa</button>}
        <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => void setWebStatus(ticket, null)}><Undo2 size={14} /> Thu hồi</button></span>}
    </div>;
  };
  const isChecked = (ticket: Ticket, deviceId: string) => checks.some(item => item.ticketId === ticket.id && item.deviceId === deviceId);
  // Done is decided by the server and stays Done until a tick is removed.
  const fullyTested = (ticket: Ticket) => !!ticket.doneAt;
  // Status is derived: Done once the tester has ticked every device on the ticket, and Test Failed
  // while the tester has recorded a failure — which the server never lets be Done at the same time.
  // Phase 2 (app) opens once every QE confirmed the web test; a completed release is read in its app phase.
  const appPhase = !!current?.completedAt || inAppPhase(web.qe.map(person => person.userId), Object.keys(web.signed));
  const appStatusOf = (ticket: Ticket) => ticket.failedAt ? "Test Failed" : fullyTested(ticket) ? "Done" : "In Progress";
  // The web outcome reads the same way: failed is Test Failed, the other three settle it as Done.
  const webStatusOf = (ticket: Ticket) => manual ? (ticket.assigneeUserId && ticket.assigneeUserId in web.signed ? "Done" : "In Progress")
    : ticket.webStatus === "failed" ? "Test Failed" : isWebStatus(ticket.webStatus) ? "Done" : "In Progress";
  // The status column and its filters follow the phase the release is in.
  const statusOf = (ticket: Ticket) => appPhase ? appStatusOf(ticket) : webStatusOf(ticket);
  const counts = (["In Progress", "Test Failed", "Done"] as const).map(status => [status, tickets.filter(item => statusOf(item) === status).length] as const);
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
  }, [tickets, query, keyFilter, summaryFilter, testerFilter, statusFilter, mineOnly, currentUserId, devicesByUser, checks, sort, projects, appPhase, web]);
  const filtered = keyFilter || summaryFilter || testerFilter !== "__all__" || query || statusFilter !== "__all__" || mineOnly;
  const columnFilterCount = Number(!!keyFilter) + Number(!!summaryFilter) + Number(testerFilter !== "__all__");
  const sortHeader = (key: SortKey, label: string) => {
    const active = sort?.key === key, Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" className={"golive-sort " + (active ? "active" : "")} onClick={() => setSort(!active ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null)}>{label}<Icon size={13} /></button></th>;
  };
  const done = tickets.filter(fullyTested).length;
  const mineCount = tickets.filter(item => item.assigneeUserId === currentUserId).length;
  // Bulk updates need tickets, so a manual golive and a completed one have no checkbox column.
  const bulkOn = !manual && !!current && !current.completedAt;
  const pickable = bulkOn ? visible.filter(canSkip) : [];
  const pickedVisible = pickable.filter(item => picked.includes(item.id));
  const pickedCount = picked.filter(id => tickets.some(item => item.id === id && canSkip(item))).length;
  const pickedList = tickets.filter(item => picked.includes(item.id) && canSkip(item)).map(item => item.issueKey);
  const pickedKeys = pickedList.slice(0, 5).join(", ") + (pickedList.length > 5 ? " và " + (pickedList.length - 5) + " ticket khác" : "");
  const me = people.find(person => person.userId === currentUserId);
  const webSigned = web.qe.filter(person => person.userId in web.signed), webPending = web.qe.filter(person => !(person.userId in web.signed));
  const webDone = web.qe.length > 0 && webPending.length === 0;
  const iSignedWeb = currentUserId in web.signed, iAmQe = web.qe.some(person => person.userId === currentUserId);
  const running = !!current && !current.completedAt;
  // A QE confirms the web test only after every one of their tickets has a settled web outcome.
  const myWebOpen = manual ? 0 : tickets.filter(item => item.assigneeUserId === currentUserId && !webSettled(item.webStatus)).length;
  // Phase 1 is the web build; once every QE confirms it, the device checklist below is the app phase.
  const webPanel = web.qe.length === 0
    ? <section className="golive-web panel"><div className="golive-web-head"><span className="golive-web-step"><Globe size={16} /> Giai đoạn 1 · Test web</span></div><p className="golive-web-note">Chưa có tài khoản QE nào để theo dõi test web.</p>{me?.role === "Manager" && <button type="button" className="outline-button" onClick={onManageRoles}>Gán role QE</button>}</section>
    : webDone
      ? <section className="golive-web golive-web-done" role="status"><CheckCircle2 size={22} aria-hidden="true" /><div className="golive-web-done-text"><strong>Quá trình test web đã hoàn tất, có thể build app.</strong><small>{web.qe.length}/{web.qe.length} QE đã xác nhận · Giai đoạn 2: test app theo checklist thiết bị bên dưới.</small></div>{running && iSignedWeb && <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => void signWeb(false)}><Undo2 size={14} /> Thu hồi</button>}</section>
      : <section className="golive-web panel">
        <div className="golive-web-head">
          <span className="golive-web-step"><Globe size={16} /> Giai đoạn 1 · Test web</span>
          <span className="golive-web-count"><strong>{webSigned.length}/{web.qe.length}</strong> QE đã test web xong</span>
          {running && iAmQe && (iSignedWeb
            ? <span className="golive-web-mine"><Check size={15} /> Bạn đã xác nhận <button type="button" className="outline-button golive-skip-button" disabled={busy} onClick={() => void signWeb(false)}><Undo2 size={14} /> Thu hồi</button></span>
            : <button type="button" className="primary-button golive-web-sign" disabled={busy || myWebOpen > 0} title={myWebOpen ? "Còn " + myWebOpen + " ticket của bạn chưa có trạng thái phase web" : ""} onClick={() => void signWeb(true)}><CheckCircle2 size={17} /> Đã hoàn thành test web</button>)}
        </div>
        {!manual && <p className="golive-web-note">Chọn trạng thái ở cột <strong>Phase web</strong> cho từng ticket, rồi bấm “Đã hoàn thành test web”. Cột Phase app mở khi tất cả QE đã xác nhận.{running && iAmQe && !iSignedWeb && myWebOpen > 0 && <> Bạn còn <strong>{myWebOpen}</strong> ticket chưa có trạng thái phase web (hoặc đang Test failed).</>}</p>}
        <div className="golive-web-bar" role="progressbar" aria-label="Tiến trình test web" aria-valuemin={0} aria-valuemax={web.qe.length} aria-valuenow={webSigned.length}><span style={{ width: (webSigned.length / web.qe.length * 100) + "%" }} /></div>
        <div className="golive-web-pending">
          <span className="golive-web-label">Chưa xác nhận ({webPending.length})</span>
          <ul>{webPending.map(person => <li key={person.userId}><HolderIdentity name={person.displayName} avatar={people.find(item => item.userId === person.userId)?.avatar} /></li>)}</ul>
          {running && me?.role === "Manager" && <button type="button" className="outline-button golive-web-remind" disabled={busy} onClick={() => void remindWeb()}><Bell size={15} /> Nhắc nhở</button>}
        </div>
      </section>;

  return <>
    <div className="page-heading"><div><h1>Tracking Golive.</h1><p>Tạo đợt golive cho team QE hoặc import ticket từ Jira. Người test xác nhận trên từng thiết bị đang cầm.</p></div>
      <div className="golive-heading-actions"><PushToggle onError={onError} onToast={onToast} /><button className="outline-button" onClick={() => fileInput.current?.click()}><FileUp size={18} /> Import CSV</button><button className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> Tạo đợt golive</button></div>
      <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={e => void pickFile(e.target.files?.[0])} /></div>
    {loading ? <LoadingState label="Đang tải đợt golive..." />
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
          <div className="golive-release-actions">
          {!current.completedAt && <button className="primary-button golive-complete" disabled={busy} onClick={() => void completeRelease()}><CheckCircle2 size={17} /> Hoàn thành đợt golive</button>}
          <button className="outline-button golive-delete" disabled={busy} onClick={() => void deleteRelease()} aria-label="Xoá đợt golive" title="Xoá đợt golive"><Trash2 size={16} /><span className="golive-delete-label">Xoá đợt golive</span></button>
          </div>
        </div>
        {webPanel}
        <div className="golive-stats">{counts.map(([status, count]) => <button key={status} className={"golive-stat " + (statusFilter === status ? "active" : "")} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(statusFilter === status ? "__all__" : status)}><span className={statusClass(status)}>{status}</span><strong>{count}</strong><small>{statusFilter === status ? "Đang lọc · bấm để bỏ" : (tickets.length ? Math.round(count / tickets.length * 100) : 0) + "% trên " + tickets.length + " " + rowLabel}</small></button>)}</div>
        {/* Scope first ("mine" is the filter testers use most), then search and the column filters. */}
        <div className="golive-filterbar">
          <div className="golive-scope" role="radiogroup" aria-label={manual ? "Phạm vi checklist" : "Phạm vi ticket"}>
            <button type="button" role="radio" aria-checked={!mineOnly} className={!mineOnly ? "active" : ""} onClick={() => setMineOnly(false)}>
              Tất cả <span className="golive-scope-count">{tickets.length}</span></button>
            <button type="button" role="radio" aria-checked={mineOnly} className={mineOnly ? "active" : ""} onClick={() => setMineOnly(true)}>
              <UserRound size={16} aria-hidden="true" /> Của tôi <span className="golive-scope-count">{mineCount}</span></button>
          </div>
          <div className="golive-search-row">
            <div className="search"><Search size={19} /><input aria-label={manual ? "Tìm người test" : "Tìm ticket"} value={query} onChange={e => setQuery(e.target.value)} placeholder={manual ? "Tìm người test..." : "Tìm mã, tên ticket, người test..."} />{query && <button type="button" className="search-clear" aria-label="Xoá từ khoá" onClick={() => setQuery("")}><X size={16} /></button>}</div>
            <button type="button" className={"outline-button golive-filter-toggle" + (filtersOpen ? " is-open" : "")} aria-expanded={filtersOpen} aria-controls="golive-column-filters" aria-label={"Bộ lọc" + (columnFilterCount ? ", đang bật " + columnFilterCount : "")} onClick={() => setFiltersOpen(!filtersOpen)}>
              <ListFilter size={18} aria-hidden="true" /><span className="golive-filter-label">Bộ lọc</span>{columnFilterCount > 0 && <span className="golive-filter-badge">{columnFilterCount}</span>}</button>
          </div>
        </div>
        <div id="golive-column-filters" className={"golive-filters" + (filtersOpen ? " is-open" : "")}>
          {!manual && <><label>Mã ticket<input list="golive-projects" value={keyFilter} onChange={e => setKeyFilter(e.target.value.trim().toUpperCase())} placeholder="VD: DIP hoặc DIP-2313" /><datalist id="golive-projects">{projects.map(project => <option key={project} value={project} />)}</datalist></label>
          <label>Tên ticket<input value={summaryFilter} onChange={e => setSummaryFilter(e.target.value)} placeholder="Chứa từ khoá..." /></label></>}
          <label>Người test<StyledSelect ariaLabel="Lọc theo người test" value={testerFilter} onChange={setTesterFilter} options={testerOptions} placeholder="Tất cả người test" /></label>
        </div>
        <div className="golive-result-line" aria-live="polite">
          <span>Hiển thị <strong>{visible.length}</strong>/{tickets.length} {rowLabel}{mineOnly ? " của tôi" : ""}</span>
          {filtered && <button type="button" className="text-button golive-clear" onClick={() => { resetFilters(); setMineOnly(false); }}><X size={15} /> Xoá lọc</button>}
        </div>
        {bulkOn && pickedCount > 0 && <div className="golive-bulk" role="region" aria-label="Cập nhật hàng loạt">
          <span className="golive-bulk-count">Đã chọn <strong>{pickedCount}</strong> ticket · cập nhật {appPhase ? <><Smartphone size={14} aria-hidden="true" /> Phase app</> : <><Globe size={14} aria-hidden="true" /> Phase web</>}:</span>
          <div className="golive-bulk-actions">
            <button type="button" className="outline-button" disabled={busy} onClick={() => void bulkUpdate("tested")}><CheckCircle2 size={15} /> Đã test xong</button>
            <button type="button" className="outline-button" disabled={busy} onClick={() => void bulkUpdate("not-needed")}><Ban size={15} /> Không cần test</button>
            <button type="button" className="outline-button" disabled={busy} onClick={() => setBulkReason("cannot-test")}><CircleSlash size={15} /> Không test được</button>
            <button type="button" className="outline-button golive-fail-button" disabled={busy} onClick={() => setBulkReason("failed")}><XCircle size={15} /> Test failed</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => setPicked([])}><X size={15} /> Bỏ chọn</button>
          </div>
        </div>}
        <section className="panel table-panel"><div className="table-scroll"><table className={"golive-table" + (manual ? " golive-manual-table" : "")}><thead><tr>{bulkOn && <th className="golive-pick"><input type="checkbox" aria-label="Chọn tất cả ticket đang hiển thị mà bạn được đánh dấu"
          disabled={pickable.length === 0} checked={pickable.length > 0 && pickedVisible.length === pickable.length}
          ref={element => { if (element) element.indeterminate = pickedVisible.length > 0 && pickedVisible.length < pickable.length; }}
          onChange={event => setPicked(event.target.checked ? Array.from(new Set([...picked, ...pickable.map(item => item.id)])) : picked.filter(id => !pickable.some(item => item.id === id)))} /></th>}{!manual && <>{sortHeader("issueKey", "MÃ")}{sortHeader("summary", "TÊN TICKET")}</>}{sortHeader("assignee", "NGƯỜI TEST")}<th>TRẠNG THÁI</th><th><span className="golive-phase-th"><Globe size={13} aria-hidden="true" /> PHASE WEB</span></th><th><span className="golive-phase-th"><Smartphone size={13} aria-hidden="true" /> PHASE APP</span></th></tr></thead><tbody>{visible.map(ticket => <tr key={ticket.id} className={picked.includes(ticket.id) ? "golive-row-picked" : ""}>
          {bulkOn && <td className="golive-pick">{canSkip(ticket) && <input type="checkbox" aria-label={"Chọn " + ticket.issueKey} checked={picked.includes(ticket.id)}
            onChange={event => setPicked(event.target.checked ? [...picked, ticket.id] : picked.filter(id => id !== ticket.id))} />}</td>}
          {!manual && <><td className="golive-key">{ticket.issueKey}</td>
          <td className="golive-summary">{ticket.summary || <span className="muted">(không có tên)</span>}</td></>}
          <td className="golive-assignee">{ticket.assignee ? <HolderIdentity name={ticket.assignee} avatar={people.find(person => person.userId === ticket.assigneeUserId)?.avatar || ""} role={people.find(person => person.userId === ticket.assigneeUserId)?.role} /> : <span className="muted">Chưa có người test</span>}</td>
          <td className="golive-ticket-status"><span className={statusClass(statusOf(ticket))}>{statusOf(ticket)}</span></td>
          <td className={"golive-web-cell" + (appPhase ? " golive-phase-locked" : "")}>{webCell(ticket)}</td>
          <td className={"golive-devices" + (appPhase ? "" : " golive-phase-locked")}>{!appPhase ? <span className="golive-phase-lock"><Lock size={15} aria-hidden="true" /><span className="golive-phase-lock-text">Chưa mở · mở khi tất cả QE xác nhận xong test web{checks.some(item => item.ticketId === ticket.id) && <small>Đã tích {checks.filter(item => item.ticketId === ticket.id).length} thiết bị trước đó</small>}</span></span>
            : <div className="golive-phase-body">{ticket.skippedAt && ticket.skipKind !== "tested" ? skipBadge(ticket) : <>{ticket.skippedAt && skipBadge(ticket)}{!ticket.assignee ? <span className="muted">Chưa có người test</span> : !ticket.assigneeUserId ? <span className="muted">“{ticket.assignee}” chưa khớp tài khoản nào</span> : (() => {
            const list = ticketDevices(ticket), mine = ticket.assigneeUserId === currentUserId && !current?.completedAt && !(ticket.skippedAt && ticket.skipKind !== "tested");
            if (list.length === 0) return <span className="muted">Người test chưa cầm thiết bị nào</span>;
            return <div className="golive-device-group">
              <div className="golive-device-count">{list.filter(device => isChecked(ticket, device.id)).length}/{list.length} thiết bị đã test</div>
              <ul className={"golive-checklist " + (fullyTested(ticket) ? "complete" : "")}>{list.map(device => {
                const checked = isChecked(ticket, device.id);
                const DeviceIcon = /ipad|tablet|máy tính bảng/i.test(device.name) ? Tablet : /laptop|macbook/i.test(device.name) ? Laptop : Smartphone;
                const detail = device.handedOver ? "Đã test · đã bàn giao" : device.optional && !checked ? "Máy mới · không bắt buộc" : checked ? "Đã test" : "Chưa test";
                return <li key={device.id}><label className={(checked ? "checked " : "") + (mine ? "" : "readonly")} title={mine ? "" : current?.completedAt ? "Đợt golive đã hoàn thành" : "Chỉ " + ticket.assignee + " mới tích được"}>
                  <input type="checkbox" aria-label={(manual ? ticket.assignee : ticket.issueKey) + " · " + device.name} checked={checked} disabled={!mine} onChange={e => void toggleCheck(ticket, device, e.target.checked)} />
                  <DeviceIcon className="golive-device-icon" size={19} aria-hidden="true" />
                  <span className="golive-device-copy"><span className="golive-device-name">{device.name}</span><small>{detail}</small></span>
                  <span className="golive-check-box" aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>
                </label></li>;
              })}</ul>
            </div>;
          })()}{ticket.failedAt && failBadge(ticket)}{canSkip(ticket) && !ticket.doneAt && <div className="golive-skip-actions">
            <button type="button" className="text-button golive-skip-button" disabled={busy} onClick={() => void setSkipped(ticket, true, "tested")}><CheckCircle2 size={14} /> Đã test xong</button>
            <button type="button" className="text-button golive-skip-button" disabled={busy} onClick={() => void setSkipped(ticket, true)}><Ban size={14} /> Không cần test</button>
            <button type="button" className="text-button golive-skip-button" disabled={busy} onClick={() => setCannotTest({ ticket, editing: false })}><CircleSlash size={14} /> Không test được</button>
            {!ticket.failedAt && <button type="button" className="text-button golive-skip-button golive-fail-button" disabled={busy} onClick={() => setFailing({ ticket, editing: false })}><XCircle size={14} /> Test failed</button>}
          </div>}</>}</div>}</td>
        </tr>)}</tbody></table>{visible.length === 0 && <p className="empty">Không có {rowLabel} phù hợp.</p>}</div></section>
      </>}
      </>}
    {confirmDialog}
    {bulkReason === "failed" && <TestFailedDialog issueKey={pickedKeys} busy={busy} onCancel={() => setBulkReason(null)} onSubmit={reason => void bulkUpdate("failed", reason).then(ok => { if (ok) setBulkReason(null); })} />}
    {bulkReason === "cannot-test" && <CannotTestDialog issueKey={pickedKeys} busy={busy} onCancel={() => setBulkReason(null)} onSubmit={(reason, notified) => void bulkUpdate("cannot-test", reason, notified).then(ok => { if (ok) setBulkReason(null); })} />}
    {failing && <TestFailedDialog key={failing.ticket.id} issueKey={failing.ticket.issueKey} editing={failing.editing} initialReason={failing.editing ? (failing.phase === "web" ? failing.ticket.webReason : failing.ticket.failedReason) || "" : ""} busy={busy} onCancel={() => setFailing(null)} onSubmit={reason => void markFailed(reason)} />}
    {cannotTest && <CannotTestDialog key={cannotTest.ticket.id} issueKey={cannotTest.ticket.issueKey} editing={cannotTest.editing} initialReason={cannotTest.editing ? (cannotTest.phase === "web" ? cannotTest.ticket.webReason : cannotTest.ticket.skipReason) || undefined : undefined} initialNotified={cannotTest.editing && !!(cannotTest.phase === "web" ? cannotTest.ticket.webNotified : cannotTest.ticket.skipNotified)} busy={busy} onCancel={() => setCannotTest(null)} onSubmit={(reason, notified) => void markCannotTest(reason, notified)} />}
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
