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

// A ticket the server stamped Done without any tick still reports a time rather than nothing.
assert.equal(markedAt({ ...base, doneAt: "2026-11-02T08:00:00.000Z" }), "2026-11-02T08:00:00.000Z");
assert.equal(markedAt(base), null);

console.log("Statistic done-marks: ticks report the last tick, confirmations report the confirmation.");
