import assert from "node:assert/strict";
import { markedAt, markedBy, markedHow } from "../app/lib/statistic.ts";

const base = { doneAt: null, skippedAt: null, skippedBy: null, skipKind: "not-needed", assignee: "Minh Anh", testedDevices: 0, lastCheckedAt: null };

// Done by ticking every device: the last tick is the moment the QE finished it.
const ticked = { ...base, doneAt: "2026-11-02T10:05:00.000Z", testedDevices: 3, lastCheckedAt: "2026-11-02T10:04:59.000Z" };
assert.equal(markedAt(ticked), "2026-11-02T10:04:59.000Z");
assert.equal(markedBy(ticked), "Minh Anh");
assert.equal(markedHow(ticked), "Tích đủ 3 thiết bị");

// "Đã test xong" wins over the ticks it may also carry: that confirmation is the mark.
const confirmed = { ...ticked, skippedAt: "2026-11-02T11:00:00.000Z", skippedBy: "Minh Anh", skipKind: "tested" };
assert.equal(markedAt(confirmed), "2026-11-02T11:00:00.000Z");
assert.equal(markedHow(confirmed), "Xác nhận đã test xong");

const notNeeded = { ...base, doneAt: "2026-11-02T09:00:00.000Z", skippedAt: "2026-11-02T09:00:00.000Z", skippedBy: "Quản lý", skipKind: "not-needed" };
assert.equal(markedBy(notNeeded), "Quản lý");
assert.equal(markedHow(notNeeded), "Đánh dấu không cần test");

// "Không test được" is its own outcome, not a flavour of "không cần test".
assert.equal(markedHow({ ...notNeeded, skipKind: "cannot-test" }), "Đánh dấu không test được");

// A ticket the server stamped Done without any tick still reports a time rather than nothing.
assert.equal(markedAt({ ...base, doneAt: "2026-11-02T08:00:00.000Z" }), "2026-11-02T08:00:00.000Z");
assert.equal(markedAt(base), null);

console.log("Statistic done-marks: ticks report the last tick, confirmations report the confirmation.");

import { doneKindOf, tallyByTester } from "../app/lib/statistic.ts";

const ticket = (assignee, assigneeUserId, doneAt, skippedAt = null, skipKind = "not-needed", failedAt = null) =>
  ({ assignee, assigneeUserId, doneAt, skippedAt, skipKind, failedAt });

const tally = tallyByTester([
  ticket("Minh Anh", "u_anh", "2026-11-02T07:00:00.000Z"),
  ticket("Minh Anh", "u_anh", null),
  ticket("Minh Anh", "u_anh", "2026-11-02T03:00:00.000Z", "2026-11-02T03:00:00.000Z", "not-needed"),
  ticket("Gia Bảo", "u_bao", null),
  ticket("Gia Bảo", "u_bao", null),
  // A ticket confirmed as tested is done, and is not a "không cần test".
  ticket("Gia Bảo", "u_bao", "2026-11-02T08:00:00.000Z", "2026-11-02T08:00:00.000Z", "tested"),
  ticket("", null, null),
]);

// Whoever has the most left to test leads; the no-tester bucket is always last.
assert.deepEqual(tally.map(row => row.name), ["Gia Bảo", "Minh Anh", ""]);
assert.deepEqual(tally[0], { name: "Gia Bảo", userId: "u_bao", done: 1, failed: 0, open: 2, total: 3, onDevices: 0, confirmed: 1, notNeeded: 0, cannotTest: 0 });
assert.deepEqual(tally[1], { name: "Minh Anh", userId: "u_anh", done: 2, failed: 0, open: 1, total: 3, onDevices: 1, confirmed: 0, notNeeded: 1, cannotTest: 0 });
assert.deepEqual(tally[2], { name: "", userId: null, done: 0, failed: 0, open: 1, total: 1, onDevices: 0, confirmed: 0, notNeeded: 0, cannotTest: 0 });

// The three done kinds add back up to done, and with open they span the tester's whole total,
// so the four slices of the stacked bar can neither overflow nor leave a gap.
for (const row of tally) {
  assert.equal(row.onDevices + row.confirmed + row.notNeeded + row.cannotTest, row.done);
  assert.equal(row.onDevices + row.confirmed + row.notNeeded + row.cannotTest + row.failed + row.open, row.total);
}

// A ticket Done purely from device ticks carries no skip mark; the other two kinds do.
assert.equal(doneKindOf(ticket("Minh Anh", "u_anh", "2026-11-02T07:00:00.000Z")), "onDevices");
assert.equal(doneKindOf(ticket("Minh Anh", "u_anh", "x", "x", "tested")), "confirmed");
assert.equal(doneKindOf(ticket("Minh Anh", "u_anh", "x", "x", "not-needed")), "notNeeded");
assert.equal(doneKindOf(ticket("Minh Anh", "u_anh", "x", "x", "cannot-test")), "cannotTest");

// A tester whose tickets land in all four done kinds keeps the bar's slices adding up.
const mixed = tallyByTester([
  ticket("Lan", "u_lan", "x"),
  ticket("Lan", "u_lan", "x", "x", "tested"),
  ticket("Lan", "u_lan", "x", "x", "cannot-test"),
  ticket("Lan", "u_lan", "x", "x", "not-needed"),
  ticket("Lan", "u_lan", null),
])[0];
assert.deepEqual(mixed, { name: "Lan", userId: "u_lan", done: 4, failed: 0, open: 1, total: 5, onDevices: 1, confirmed: 1, notNeeded: 1, cannotTest: 1 });

// A tester whose account is only matched on a later ticket still names the whole group.
const late = tallyByTester([ticket("Minh Anh", null, null), ticket("Minh Anh", "u_anh", null)]);
assert.equal(late[0].userId, "u_anh");

assert.deepEqual(tallyByTester([]), []);

console.log("Statistic per-tester tally: counts, không-cần-test subtotal and ordering hold.");

import { untestedBody, untestedNotices } from "../app/lib/statistic.ts";

// The wording the Manager's reminder has to carry, verbatim.
assert.equal(untestedBody(["DIP-2103"]), "Ticket DIP-2103 chưa được test sau golive. Vui lòng phản hồi trong thời gian sớm nhất.");
assert.equal(untestedBody(["DIP-2103", "ON-884"]), "Ticket DIP-2103, ON-884 chưa được test sau golive. Vui lòng phản hồi trong thời gian sớm nhất.");

const notices = untestedNotices([
  { userId: "u_anh", issueKey: "DIP-2103" },
  { userId: "u_bao", issueKey: "ON-905" },
  { userId: "u_anh", issueKey: "DIP-2104" },
  { userId: "u_anh", issueKey: "DIP-2103" },   // the same ticket twice must not repeat in the body
  { userId: null, issueKey: "ON-884" },        // no account to notify
]);

// One notice per tester, not one per ticket.
assert.equal(notices.length, 2);
assert.deepEqual(notices.find(n => n.userId === "u_anh").issueKeys, ["DIP-2103", "DIP-2104"]);
assert.equal(notices.find(n => n.userId === "u_anh").body,
  "Ticket DIP-2103, DIP-2104 chưa được test sau golive. Vui lòng phản hồi trong thời gian sớm nhất.");
assert.deepEqual(notices.find(n => n.userId === "u_bao").issueKeys, ["ON-905"]);
assert.equal(notices.some(n => n.issueKeys.includes("ON-884")), false);
assert.deepEqual(untestedNotices([]), []);

console.log("Statistic reminders: one notice per tester, summarising every ticked ticket.");


// A failing ticket is outstanding, not Done: it must not land in any DoneKind bucket, and it ranks
// its tester alongside untested work rather than finished work.
const withFailure = tallyByTester([
  ticket("Lan", "u_lan", null, null, "not-needed", "2026-11-04T09:00:00.000Z"),
  ticket("Lan", "u_lan", "2026-11-04T08:00:00.000Z"),
  ticket("Lan", "u_lan", null),
])[0];
assert.deepEqual(withFailure, { name: "Lan", userId: "u_lan", done: 1, failed: 1, open: 1, total: 3, onDevices: 1, confirmed: 0, notNeeded: 0, cannotTest: 0 });

// The mark column reports a failure the same way it reports a done mark.
const failed = { ...base, failedAt: "2026-11-04T09:00:00.000Z", failedBy: "Minh Anh", testedDevices: 2, lastCheckedAt: "2026-11-04T08:00:00.000Z" };
assert.equal(markedAt(failed), "2026-11-04T09:00:00.000Z");
assert.equal(markedBy(failed), "Minh Anh");
assert.equal(markedHow(failed), "Đánh dấu test failed");

console.log("Statistic test-failed: outstanding rather than Done, and its own mark in the report.");

// Web phase: only today's QE accounts count, and the web is done once every one of them confirmed.
{
  const { webSummary, webRoster, phaseOf } = await import("../app/lib/statistic.ts");
  assert.deepEqual(webSummary(["a", "b"], ["a", "x"]), { total: 2, signed: 1, done: false });
  assert.deepEqual(webSummary(["a", "b"], ["b", "a"]), { total: 2, signed: 2, done: true });
  assert.deepEqual(webSummary([], []), { total: 0, signed: 0, done: false });
  const roster = webRoster(
    [{ userId: "a", displayName: "An" }, { userId: "b", displayName: "Bình" }, { userId: "c", displayName: "Chi" }],
    [{ userId: "c", signedAt: "2026-11-02T09:00:00.000Z" }, { userId: "a", signedAt: "2026-11-02T10:00:00.000Z" }, { userId: "gone", signedAt: "2026-11-02T08:00:00.000Z" }],
  );
  assert.deepEqual(roster.map(person => person.userId), ["b", "c", "a"]);
  assert.equal(roster[0].signedAt, null);
  assert.equal(phaseOf({ completedAt: null, web: { total: 2, signed: 1, done: false } }), "web");
  assert.equal(phaseOf({ completedAt: null, web: { total: 2, signed: 2, done: true } }), "app");
  assert.equal(phaseOf({ completedAt: "2026-11-03T00:00:00.000Z", web: { total: 2, signed: 1, done: false } }), "completed");
}

// Phase web per tester: three settled outcomes count as done, failed and untested stay outstanding.
{
  const { tallyWebByTester, webKindOf } = await import("../app/lib/statistic.ts");
  assert.equal(webKindOf(null), "open");
  assert.equal(webKindOf("not-needed"), "notNeeded");
  const tally = tallyWebByTester([
    { assignee: "An", assigneeUserId: "a", webStatus: "tested" },
    { assignee: "An", assigneeUserId: "a", webStatus: "failed" },
    { assignee: "Bình", assigneeUserId: "b", webStatus: "cannot-test" },
    { assignee: "Bình", assigneeUserId: "b", webStatus: "not-needed" },
    { assignee: "An ", assigneeUserId: "a", webStatus: null },
  ]);
  assert.deepEqual(tally.map(row => [row.name, row.done, row.failed, row.open, row.total]), [["An", 1, 1, 1, 3], ["Bình", 2, 0, 0, 2]]);
  console.log("Statistic web phase: per-tester web outcomes and QE sign-offs hold.");
}
