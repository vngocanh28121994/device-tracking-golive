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
    ? ({ tested: "Xác nhận đã test xong", "cannot-test": "Đánh dấu không test được", "risk-accepted": "Chấp nhận rủi ro" }[ticket.skipKind] ?? "Đánh dấu không cần test")
    : "Tích đủ " + ticket.testedDevices + " thiết bị";

// How a finished ticket got there, so the report can colour them apart.
export type DoneKind = "onDevices" | "confirmed" | "notNeeded" | "cannotTest" | "riskAccepted";

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
  if (ticket.skipKind === "risk-accepted") return "riskAccepted";
  return ticket.skipKind === "cannot-test" ? "cannotTest" : "notNeeded";
}

// Tickets of one release grouped by the tester they are assigned to. "done" follows the board's
// own rule (doneAt is set), so a ticket confirmed as not needing a test counts as done; the
// DoneKind counts say how much of that total was really run on a device.
export function tallyByTester(tickets: Assigned[]): TesterTally[] {
  const groups = new Map<string, TesterTally>();
  for (const ticket of tickets) {
    const name = ticket.assignee.trim();
    const entry = groups.get(name) || { name, userId: ticket.assigneeUserId, done: 0, failed: 0, open: 0, total: 0, onDevices: 0, confirmed: 0, notNeeded: 0, cannotTest: 0, riskAccepted: 0 };
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
// "build": web is done and the release waits for the App Manager to push the app build.
export type GolivePhase = "web" | "build" | "app" | "completed";
export const phaseOf = (release: { completedAt: string | null; appPushedAt?: string | null; web: WebSummary }): GolivePhase =>
  release.completedAt ? "completed" : !release.web.done ? "web" : release.appPushedAt === null ? "build" : "app";

// Phase web per tester: the same four outcomes the app phase has, picked directly on each ticket.
export type WebKind = "tested" | "notNeeded" | "cannotTest" | "failed" | "riskAccepted" | "open";
export const webKindOf = (status: string | null | undefined): WebKind =>
  status === "tested" ? "tested" : status === "not-needed" ? "notNeeded" : status === "cannot-test" ? "cannotTest" : status === "failed" ? "failed" : status === "risk-accepted" ? "riskAccepted" : "open";
// done counts the three settled outcomes; failed and open are still outstanding for the web.
export type WebTally = { name: string; userId: string | null; done: number; total: number } & Record<WebKind, number>;

export function tallyWebByTester(tickets: { assignee: string; assigneeUserId: string | null; webStatus: string | null }[]): WebTally[] {
  const groups = new Map<string, WebTally>();
  for (const ticket of tickets) {
    const name = ticket.assignee.trim();
    const entry = groups.get(name) || { name, userId: ticket.assigneeUserId, done: 0, total: 0, tested: 0, notNeeded: 0, cannotTest: 0, failed: 0, riskAccepted: 0, open: 0 };
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


// ===== Tab "QE": one row per QE across every golive of the filtered period =====

// Everything a phase says about one QE. tested and failed are not exclusive: a ticket failed once
// and passed later counts in both. avgMs is null when no ticket of the phase yielded a usable sample.
export type QePhaseStat = { tested: number; skipped: number; failed: number; avgMs: number | null; samples: number };
// matched is false for a tester name that no account claims; such a row sorts to the very bottom.
export type QeStat = {
  key: string; name: string; userId: string | null; role: string | null; matched: boolean;
  // releases is releaseNames.length, kept as a number so the column sorts without counting strings.
  releases: number; releaseNames: string[]; assigned: number; open: number;
  web: QePhaseStat; app: QePhaseStat;
};
export type QeReport = {
  releases: number;          // golive releases in the period, manual ones included
  qeAccounts: number;        // accounts holding a QE role today
  unassignedTickets: number; // CSV tickets with nobody to test them
  rows: QeStat[];
};

export type QeRelease = { id: string; name: string; source: string; createdAt: string; appPushedAt: string | null };
export type QeTicket = DoneMark & { id: number; releaseId: string; assigneeUserId: string | null; webStatus: string | null; webAt: string | null };
export type QeProfile = { userId: string; displayName: string; role: string };
export type QeScorecardInput = {
  releases: QeRelease[];
  tickets: QeTicket[];
  failures: { ticketId: number; phase: string }[];
  profiles: QeProfile[];
  qeRoles: string[];
  // Name matching belongs to golive.ts and is handed in, so this module stays a leaf like the rest
  // of app/lib and the report can be computed with nothing but plain data.
  matchAccount: (profiles: { userId: string; displayName: string }[], name: string) => string | null;
  normalizeName: (name: string) => string;
};

const emptyPhase = (): QePhaseStat => ({ tested: 0, skipped: 0, failed: 0, avgMs: null, samples: 0 });
// A duration only counts when both ends parse and time runs forward; anything else is a data glitch.
function duration(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}
// Migration 0022 stamped old releases with their own creation time, so that value says nothing
// about when the app build was really pushed and its tickets cannot time the app phase.
const appClockStart = (release: QeRelease) =>
  release.appPushedAt && release.appPushedAt !== release.createdAt ? release.appPushedAt : null;

// Volume, speed and failures per QE over the releases handed in. Pure: the caller decides the
// period, so the same numbers come out of a test and out of the API.
export function qeScorecard(input: QeScorecardInput): QeReport {
  const releases = new Map(input.releases.map(release => [release.id, release]));
  const accounts = input.profiles;
  const rows = new Map<string, QeStat>();
  // Sums are kept apart from the rows so avgMs can be rounded once, at the end.
  const totals = new Map<string, { web: number; app: number }>();
  const seenReleases = new Map<string, Set<string>>();

  const blank = (key: string, name: string, userId: string | null, matched: boolean): QeStat => ({
    key, name, userId, role: accounts.find(person => person.userId === userId)?.role || null, matched,
    releases: 0, releaseNames: [], assigned: 0, open: 0, web: emptyPhase(), app: emptyPhase(),
  });
  const rowFor = (key: string, name: string, userId: string | null, matched: boolean) => {
    let row = rows.get(key);
    if (!row) { row = blank(key, name, userId, matched); rows.set(key, row); totals.set(key, { web: 0, app: 0 }); seenReleases.set(key, new Set()); }
    return row;
  };
  // Every QE account is on the list even with nothing to show, so a quiet period is visible as zeros.
  for (const person of accounts) {
    if (input.qeRoles.includes(person.role)) rowFor(person.userId, person.displayName, person.userId, true);
  }

  let unassignedTickets = 0;
  for (const ticket of input.tickets) {
    const release = releases.get(ticket.releaseId);
    if (!release) continue;
    const name = ticket.assignee.trim();
    const manual = release.source === "manual";
    if (!name) { if (!manual) unassignedTickets++; continue; }
    const userId = ticket.assigneeUserId ?? input.matchAccount(accounts, name);
    const key = userId ?? input.normalizeName(name);
    const row = rowFor(key, userId ? (accounts.find(person => person.userId === userId)?.displayName || name) : name, userId, !!userId);
    // A tester matched to an account only later still names the account for the whole row.
    if (userId && !row.userId) { row.userId = userId; row.matched = true; row.role = accounts.find(person => person.userId === userId)?.role || null; }
    seenReleases.get(key)!.add(release.id);
    // A manual release has one placeholder row per QE instead of real tickets: it proves the QE took
    // part in the release and nothing more, so it never reaches a ticket count.
    if (manual) continue;

    row.assigned++;
    if (!ticket.doneAt) row.open++;
    const sums = totals.get(key)!;

    if (ticket.webStatus === "tested") {
      row.web.tested++;
      const span = duration(release.createdAt, ticket.webAt);
      if (span !== null) { row.web.samples++; sums.web += span; }
    } else if (ticket.webStatus === "not-needed" || ticket.webStatus === "cannot-test") row.web.skipped++;

    if (ticket.doneAt) {
      const kind = doneKindOf(ticket);
      if (kind === "onDevices" || kind === "confirmed") {
        row.app.tested++;
        const span = duration(appClockStart(release), markedAt(ticket));
        if (span !== null) { row.app.samples++; sums.app += span; }
      } else if (kind !== "riskAccepted") row.app.skipped++; // an accepted risk is neither tested nor skipped
    }
  }

  // Failures are counted from their own log, so a ticket re-tested to a pass keeps its failure.
  const byId = new Map(input.tickets.map(ticket => [ticket.id, ticket]));
  for (const failure of input.failures) {
    const ticket = byId.get(failure.ticketId);
    if (!ticket) continue;
    const release = releases.get(ticket.releaseId);
    if (!release || release.source === "manual") continue;
    const name = ticket.assignee.trim();
    if (!name) continue;
    const userId = ticket.assigneeUserId ?? input.matchAccount(accounts, name);
    const row = rows.get(userId ?? input.normalizeName(name));
    if (!row) continue;
    if (failure.phase === "web") row.web.failed++;
    else if (failure.phase === "app") row.app.failed++;
  }

  // Newest golive first, the order a Manager reads them in on the other tab.
  const byNewest = [...input.releases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const [key, row] of rows) {
    const sums = totals.get(key)!;
    const seen = seenReleases.get(key)!;
    row.releaseNames = byNewest.filter(release => seen.has(release.id)).map(release => release.name);
    row.releases = seen.size;
    row.web.avgMs = row.web.samples ? Math.round(sums.web / row.web.samples) : null;
    row.app.avgMs = row.app.samples ? Math.round(sums.app / row.app.samples) : null;
  }

  return {
    releases: input.releases.length,
    qeAccounts: accounts.filter(person => input.qeRoles.includes(person.role)).length,
    unassignedTickets,
    rows: [...rows.values()].sort(compareQe),
  };
}

// The default order, and the tie-breaker every column sort falls back to: whoever tested most first.
export const qeTested = (row: QeStat) => row.web.tested + row.app.tested;
export const compareQe = (a: QeStat, b: QeStat) =>
  (a.matched ? 0 : 1) - (b.matched ? 0 : 1) || qeTested(b) - qeTested(a) || a.name.localeCompare(b.name, "vi");
