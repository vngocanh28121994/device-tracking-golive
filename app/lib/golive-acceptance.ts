// Pure rules of the acceptance flow, shared by the API and the board so both read a ticket the same way.

export type RequiredDevice = { deviceId: string; deviceName?: string; waived: boolean; archived: boolean };

// Done on devices: the ticket has a non-empty list of required devices (archived ones do not count)
// and each one is either ticked or waived with a reason. Handing a device over never shrinks the list.
export function doneOnRequiredDevices(required: RequiredDevice[], tickedIds: Iterable<string>) {
  const ticked = new Set(tickedIds);
  const active = required.filter(device => !device.archived);
  return active.length > 0 && active.every(device => ticked.has(device.deviceId) || device.waived);
}

export type RetestTicket = { id: number; doneAt?: string | null; failedAt?: string | null };
// Which tickets the "new build" dialog offers for a retest, and which of them it ticks by default.
// A ticket with no result yet belongs on the list as soon as it has one device ticked: left out, it would
// carry ticks from the old build into the new one. Those are ticked by default, in a manual release too;
// the ones that failed on this build (now or earlier) only in a release imported from Jira, where a
// ticket is one piece of work.
export function retestChoices(input: { tickets: RetestTicket[]; tickedTicketIds: Iterable<number>; appFailedIds: number[]; manual: boolean }) {
  const ticked = new Set(input.tickedTicketIds);
  return input.tickets.filter(item => item.doneAt || item.failedAt || ticked.has(item.id)).map(item => ({
    id: item.id,
    preselected: (!input.manual && (!!item.failedAt || input.appFailedIds.includes(item.id))) || (!item.doneAt && !item.failedAt && ticked.has(item.id)),
  }));
}

export const EVENT_STATUSES = ["open", "tested", "done-devices", "not-needed", "cannot-test", "failed", "risk-accepted", "retest"] as const;
export type EventStatus = typeof EVENT_STATUSES[number];

type AppState = { doneAt: string | null; failedAt: string | null; skippedAt: string | null; skipKind: string };
// The event status of a ticket's app result.
export function appEventStatus(ticket: AppState): EventStatus {
  if (ticket.failedAt) return "failed";
  if (ticket.skippedAt) {
    return ticket.skipKind === "tested" ? "tested" : ticket.skipKind === "cannot-test" ? "cannot-test" : ticket.skipKind === "risk-accepted" ? "risk-accepted" : "not-needed";
  }
  return ticket.doneAt ? "done-devices" : "open";
}
export function webEventStatus(webStatus: string | null | undefined): EventStatus {
  return webStatus === "tested" || webStatus === "not-needed" || webStatus === "cannot-test" || webStatus === "failed" || webStatus === "risk-accepted" ? webStatus : "open";
}

export type EventRow = {
  ticketId: number; releaseId: string; phase: "web" | "app"; fromStatus: string; toStatus: string; reason: string;
  buildId: number | null; actorUserId: string | null; actorName: string; createdAt: string;
};
// The single place that shapes a log row; callers only say what changed.
export function eventRow(change: { ticketId: number; releaseId: string; phase: "web" | "app"; from: string; to: string; reason?: string; buildId?: number | null; actor: { userId: string | null; name: string }; now: string }): EventRow {
  return {
    ticketId: change.ticketId, releaseId: change.releaseId, phase: change.phase, fromStatus: change.from, toStatus: change.to,
    reason: (change.reason || "").slice(0, 500), buildId: change.buildId ?? null, actorUserId: change.actor.userId, actorName: change.actor.name, createdAt: change.now,
  };
}
export const SYSTEM_ACTOR = { userId: null, name: "Hệ thống" };

export type AttentionKind = "cannot-test" | "not-notified" | "risk-accepted" | "old-build" | "waived";
export type AttentionItem = { ticketId: number; issueKey: string; assignee: string; reasons: { kind: AttentionKind; text: string }[] };

// Thứ tự hiển thị và nhãn ngắn của từng loại lý do cần lưu ý.
export const ATTENTION_KINDS: AttentionKind[] = ["cannot-test", "not-notified", "risk-accepted", "old-build", "waived"];
export const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
  "cannot-test": "Không test được",
  "not-notified": "Chưa báo scrum team",
  "risk-accepted": "Chấp nhận rủi ro",
  "old-build": "Kết quả build cũ",
  waived: "Miễn máy",
};
export const ATTENTION_ALL = "__all__";
export const ATTENTION_NO_ASSIGNEE = "__none__";

// Lọc danh sách cần lưu ý theo QE và loại lý do; hai điều kiện kết hợp AND.
// assignee "__none__" là ticket chưa có người test. Thứ tự items và reasons của mỗi item giữ nguyên.
export function filterAttention(items: AttentionItem[], filter: { assignee: string; kind: string }): AttentionItem[] {
  return items.filter(item => {
    const assignee = (item.assignee || "").trim();
    const byAssignee = filter.assignee === ATTENTION_ALL ? true : filter.assignee === ATTENTION_NO_ASSIGNEE ? assignee === "" : assignee === filter.assignee;
    const byKind = filter.kind === ATTENTION_ALL ? true : item.reasons.some(reason => reason.kind === filter.kind);
    return byAssignee && byKind;
  });
}
type AttentionTicket = { id: number; issueKey: string; assignee: string; skippedAt: string | null; skipKind: string; skipReason: string; skipNotified: boolean; failedReason: string; webStatus: string | null; webReason: string; webNotified: boolean; appBuildId: number | null; doneAt: string | null };
// Kinds that make the Ghi chú nghiệm thu mandatory; old-build and waived are shown but optional.
const NOTE_KINDS: AttentionKind[] = ["cannot-test", "not-notified", "risk-accepted"];

export function attentionList(input: {
  tickets: AttentionTicket[];
  risks: { ticketId: number; phase: string; reason: string; acceptedBy: string }[];
  waived: { ticketId: number; deviceName: string; waivedReason: string }[];
  currentBuildId: number | null;
}) {
  const items: AttentionItem[] = [];
  for (const ticket of input.tickets) {
    const reasons: AttentionItem["reasons"] = [];
    if (ticket.webStatus === "cannot-test") {
      reasons.push({ kind: "cannot-test", text: "Web không test được: " + ticket.webReason });
      if (!ticket.webNotified) reasons.push({ kind: "not-notified", text: "Web: chưa báo scrum team" });
    }
    if (ticket.skippedAt && ticket.skipKind === "cannot-test") {
      reasons.push({ kind: "cannot-test", text: "App không test được: " + ticket.skipReason });
      if (!ticket.skipNotified) reasons.push({ kind: "not-notified", text: "App: chưa báo scrum team" });
    }
    for (const risk of input.risks) {
      if (risk.ticketId === ticket.id) reasons.push({ kind: "risk-accepted", text: (risk.phase === "web" ? "Web" : "App") + " chấp nhận rủi ro bởi " + risk.acceptedBy + ": " + risk.reason });
    }
    if (ticket.doneAt && ticket.appBuildId !== null && input.currentBuildId !== null && ticket.appBuildId !== input.currentBuildId) {
      reasons.push({ kind: "old-build", text: "Kết quả app thuộc build cũ" });
    }
    for (const device of input.waived) {
      if (device.ticketId === ticket.id) reasons.push({ kind: "waived", text: "Miễn máy " + device.deviceName + ": " + device.waivedReason });
    }
    if (reasons.length) items.push({ ticketId: ticket.id, issueKey: ticket.issueKey, assignee: ticket.assignee, reasons });
  }
  return { items, noteRequired: items.some(item => item.reasons.some(reason => NOTE_KINDS.includes(reason.kind))) };
}
