// How a ticket's "test done" moment is read back for the Statistic report.
export type DoneMark = {
  doneAt: string | null;
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
export const markedAt = (ticket: DoneMark) => ticket.skippedAt || ticket.lastCheckedAt || ticket.doneAt;
export const markedBy = (ticket: DoneMark) => ticket.skippedBy || ticket.assignee;
export const markedHow = (ticket: DoneMark) => ticket.skippedAt
  ? ({ tested: "Xác nhận đã test xong", "cannot-test": "Đánh dấu không test được" }[ticket.skipKind] ?? "Đánh dấu không cần test")
  : "Tích đủ " + ticket.testedDevices + " thiết bị";

// How a finished ticket got there, so the report can colour them apart.
export type DoneKind = "onDevices" | "confirmed" | "notNeeded" | "cannotTest";

// One row of the per-tester summary shown on each golive in the Statistic report.
// done is the sum of the DoneKind counts, and done + open is total.
export type TesterTally = { name: string; userId: string | null; done: number; open: number; total: number } & Record<DoneKind, number>;

type Assigned = { assignee: string; assigneeUserId: string | null; doneAt: string | null; skippedAt: string | null; skipKind: string };

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
    const entry = groups.get(name) || { name, userId: ticket.assigneeUserId, done: 0, open: 0, total: 0, onDevices: 0, confirmed: 0, notNeeded: 0, cannotTest: 0 };
    entry.total++;
    if (ticket.doneAt) { entry.done++; entry[doneKindOf(ticket)]++; } else entry.open++;
    // Testers matched to an account only on a later load still name the account for the whole group.
    entry.userId = entry.userId ?? ticket.assigneeUserId;
    groups.set(name, entry);
  }
  // Whoever has the most left to test comes first; tickets with no tester sit at the end.
  return [...groups.values()].sort((a, b) =>
    (a.name ? 0 : 1) - (b.name ? 0 : 1) || b.open - a.open || a.name.localeCompare(b.name, "vi"));
}
