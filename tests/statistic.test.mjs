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

const ticket = (assignee, assigneeUserId, doneAt, skippedAt = null, skipKind = "not-needed") =>
  ({ assignee, assigneeUserId, doneAt, skippedAt, skipKind });

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
assert.deepEqual(tally[0], { name: "Gia Bảo", userId: "u_bao", done: 1, open: 2, total: 3, onDevices: 0, confirmed: 1, notNeeded: 0, cannotTest: 0 });
assert.deepEqual(tally[1], { name: "Minh Anh", userId: "u_anh", done: 2, open: 1, total: 3, onDevices: 1, confirmed: 0, notNeeded: 1, cannotTest: 0 });
assert.deepEqual(tally[2], { name: "", userId: null, done: 0, open: 1, total: 1, onDevices: 0, confirmed: 0, notNeeded: 0, cannotTest: 0 });

// The three done kinds add back up to done, and with open they span the tester's whole total,
// so the four slices of the stacked bar can neither overflow nor leave a gap.
for (const row of tally) {
  assert.equal(row.onDevices + row.confirmed + row.notNeeded + row.cannotTest, row.done);
  assert.equal(row.onDevices + row.confirmed + row.notNeeded + row.cannotTest + row.open, row.total);
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
assert.deepEqual(mixed, { name: "Lan", userId: "u_lan", done: 4, open: 1, total: 5, onDevices: 1, confirmed: 1, notNeeded: 1, cannotTest: 1 });

// A tester whose account is only matched on a later ticket still names the whole group.
const late = tallyByTester([ticket("Minh Anh", null, null), ticket("Minh Anh", "u_anh", null)]);
assert.equal(late[0].userId, "u_anh");

assert.deepEqual(tallyByTester([]), []);

console.log("Statistic per-tester tally: counts, không-cần-test subtotal and ordering hold.");
