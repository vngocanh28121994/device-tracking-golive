// How a ticket's "test done" moment is read back for the Statistic report.
export type DoneMark = {
  doneAt: string | null;
  failedAt?: string | null;
  failedBy?: string | null;
  skippedAt: string | null;
  skippedBy: string | null;
  skipKind: string;
  assignee: string;
  testedDevices: number;
  lastCheckedAt: string | null;
};

// A tester confirming "Đã test xong" or "Không cần test" marks the moment themselves; otherwise the
// ticket turned Done on their last device tick. doneAt is the fallback: it is stamped when the server
// derives Done, which can be a later page load than the tick that earned it.
export const markedAt = (ticket: DoneMark) => ticket.failedAt || ticket.skippedAt || ticket.lastCheckedAt || ticket.doneAt;
export const markedBy = (ticket: DoneMark) => ticket.failedAt ? (ticket.failedBy || ticket.assignee) : (ticket.skippedBy || ticket.assignee);
export const markedHow = (ticket: DoneMark) => ticket.failedAt ? "Đánh dấu test failed"
  : ticket.skippedAt
    ? ({ tested: "Xác nhận đã test xong", "cannot-test": "Đánh dấu không test được" }[ticket.skipKind] ?? "Đánh dấu không cần test")
    : "Tích đủ " + ticket.testedDevices + " thiết bị";

// How a finished ticket got there, so the report can colour them apart.
export type DoneKind = "onDevices" | "confirmed" | "notNeeded" | "cannotTest";

// One row of the per-tester summary shown on each golive in the Statistic report.
// done is the sum of the DoneKind counts, and done + open is total.
export type TesterTally = { name: string; userId: string | null; done: number; failed: number; open: number; total: number } & Record<DoneKind, number>;

type Assigned = { assignee: string; assigneeUserId: string | null; doneAt: string | null; skippedAt: string | null; skipKind: string; failedAt?: string | null };

// Four ways a ticket reaches Done, from the most to the least actual testing: every device the
// tester held was ticked, the tester confirmed testing on devices they no longer hold, the ticket
// could not be tested at all, or it was declared as needing no test.
export function doneKindOf(ticket: Assigned): DoneKind {
  if (!ticket.skippedAt) return "onDevices";
  if (ticket.skipKind === "tested") return "confirmed";
  return ticket.skipKind === "cannot-test" ? "cannotTest" : "notNeeded";
}

// Tickets of one release grouped by the tester they are assigned to. "done" follows the board's
// own rule (doneAt is set), so a ticket confirmed as not needing a test counts as done; the
// DoneKind counts say how much of that total was really run on a device.
export function tallyByTester(tickets: Assigned[]): TesterTally[] {
  const groups = new Map<string, TesterTally>();
  for (const ticket of tickets) {
    const name = ticket.assignee.trim();
    const entry = groups.get(name) || { name, userId: ticket.assigneeUserId, done: 0, failed: 0, open: 0, total: 0, onDevices: 0, confirmed: 0, notNeeded: 0, cannotTest: 0 };
    entry.total++;
    // A failing ticket is never Done, so the three outstanding kinds stay mutually exclusive.
    if (ticket.doneAt) { entry.done++; entry[doneKindOf(ticket)]++; }
    else if (ticket.failedAt) entry.failed++;
    else entry.open++;
    // Testers matched to an account only on a later load still name the account for the whole group.
    entry.userId = entry.userId ?? ticket.assigneeUserId;
    groups.set(name, entry);
  }
  // Whoever has the most outstanding work comes first, failures included; no tester sits at the end.
  return [...groups.values()].sort((a, b) =>
    (a.name ? 0 : 1) - (b.name ? 0 : 1) || (b.open + b.failed) - (a.open + a.failed) || a.name.localeCompare(b.name, "vi"));
}


// One reminder per tester, however many of their tickets the Manager ticked: a person with four
// untested tickets gets one notification naming all four, not four notifications.
export type UntestedNotice = { userId: string; issueKeys: string[]; body: string };

export const untestedBody = (issueKeys: string[]) =>
  "Ticket " + issueKeys.join(", ") + " chưa được test sau golive. Vui lòng phản hồi trong thời gian sớm nhất.";

// Tickets whose tester matches no account are dropped: there is nobody to notify. Keys keep the
// order they were given, which is the report's own order, so a reminder reads like the table.
export function untestedNotices(tickets: { userId: string | null; issueKey: string }[]): UntestedNotice[] {
  const byUser = new Map<string, string[]>();
  for (const ticket of tickets) {
    if (!ticket.userId) continue;
    const keys = byUser.get(ticket.userId) || [];
    if (!keys.includes(ticket.issueKey)) keys.push(ticket.issueKey);
    byUser.set(ticket.userId, keys);
  }
  return [...byUser].map(([userId, issueKeys]) => ({ userId, issueKeys, body: untestedBody(issueKeys) }));
}

// Phase 1 of a golive is the web build: every account with role QE confirms it before the app build
// (phase 2, the device checklist) starts. Like the Tracking Golive board, only today's QE accounts
// count, so a sign-off from someone who is no longer QE is ignored.
export type WebQe = { userId: string; displayName: string; signedAt: string | null };
export type WebSummary = { total: number; signed: number; done: boolean };

// Who still owes a confirmation comes first, then the confirmed ones in the order they signed.
export function webRoster(qe: { userId: string; displayName: string }[], signoffs: { userId: string; signedAt: string }[]): WebQe[] {
  const signed = new Map(signoffs.map(row => [row.userId, row.signedAt]));
  return qe.map(person => ({ userId: person.userId, displayName: person.displayName, signedAt: signed.get(person.userId) ?? null }))
    .sort((a, b) => (a.signedAt ? 1 : 0) - (b.signedAt ? 1 : 0) || (a.signedAt || "").localeCompare(b.signedAt || "") || a.displayName.localeCompare(b.displayName, "vi"));
}

export function webSummary(qeIds: string[], signedIds: string[]): WebSummary {
  const signed = qeIds.filter(id => signedIds.includes(id)).length;
  return { total: qeIds.length, signed, done: qeIds.length > 0 && signed === qeIds.length };
}

// Which phase a golive is in: a finished golive is done, otherwise web until every QE confirmed it.
export type GolivePhase = "web" | "app" | "completed";
export const phaseOf = (release: { completedAt: string | null; web: WebSummary }): GolivePhase =>
  release.completedAt ? "completed" : release.web.done ? "app" : "web";

// Phase web per tester: the same four outcomes the app phase has, picked directly on each ticket.
export type WebKind = "tested" | "notNeeded" | "cannotTest" | "failed" | "open";
export const webKindOf = (status: string | null | undefined): WebKind =>
  status === "tested" ? "tested" : status === "not-needed" ? "notNeeded" : status === "cannot-test" ? "cannotTest" : status === "failed" ? "failed" : "open";
// done counts the three settled outcomes; failed and open are still outstanding for the web.
export type WebTally = { name: string; userId: string | null; done: number; total: number } & Record<WebKind, number>;

export function tallyWebByTester(tickets: { assignee: string; assigneeUserId: string | null; webStatus: string | null }[]): WebTally[] {
  const groups = new Map<string, WebTally>();
  for (const ticket of tickets) {
    const name = ticket.assignee.trim();
    const entry = groups.get(name) || { name, userId: ticket.assigneeUserId, done: 0, total: 0, tested: 0, notNeeded: 0, cannotTest: 0, failed: 0, open: 0 };
    const kind = webKindOf(ticket.webStatus);
    entry.total++;
    entry[kind]++;
    if (kind !== "failed" && kind !== "open") entry.done++;
    entry.userId = entry.userId ?? ticket.assigneeUserId;
    groups.set(name, entry);
  }
  return [...groups.values()].sort((a, b) =>
    (a.name ? 0 : 1) - (b.name ? 0 : 1) || (b.open + b.failed) - (a.open + a.failed) || a.name.localeCompare(b.name, "vi"));
}
