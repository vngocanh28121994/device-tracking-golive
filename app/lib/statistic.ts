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
  ? (ticket.skipKind === "tested" ? "Xác nhận đã test xong" : "Đánh dấu không cần test")
  : "Tích đủ " + ticket.testedDevices + " thiết bị";
