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
assert.deepEqual(tally[0], { name: "Gia Bảo", userId: "u_bao", done: 1, failed: 0, open: 2, total: 3, onDevices: 0, confirmed: 1, notNeeded: 0, cannotTest: 0, riskAccepted: 0 });
assert.deepEqual(tally[1], { name: "Minh Anh", userId: "u_anh", done: 2, failed: 0, open: 1, total: 3, onDevices: 1, confirmed: 0, notNeeded: 1, cannotTest: 0, riskAccepted: 0 });
assert.deepEqual(tally[2], { name: "", userId: null, done: 0, failed: 0, open: 1, total: 1, onDevices: 0, confirmed: 0, notNeeded: 0, cannotTest: 0, riskAccepted: 0 });

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
assert.deepEqual(mixed, { name: "Lan", userId: "u_lan", done: 4, failed: 0, open: 1, total: 5, onDevices: 1, confirmed: 1, notNeeded: 1, cannotTest: 1, riskAccepted: 0 });

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
assert.deepEqual(withFailure, { name: "Lan", userId: "u_lan", done: 1, failed: 1, open: 1, total: 3, onDevices: 1, confirmed: 0, notNeeded: 0, cannotTest: 0, riskAccepted: 0 });

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
  assert.equal(phaseOf({ completedAt: null, appPushedAt: null, web: { total: 2, signed: 2, done: true } }), "build");
  assert.equal(phaseOf({ completedAt: null, appPushedAt: "2026-11-03T00:00:00.000Z", web: { total: 2, signed: 2, done: true } }), "app");
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

// Only the four known web outcomes count; a stray value (bad data) is still untested.
{
  const { webSettled, isWebStatus } = await import("../app/lib/golive.ts");
  assert.equal(webSettled("tested"), true);
  assert.equal(webSettled("failed"), false);
  assert.equal(webSettled("web_status"), false);
  assert.equal(webSettled(null), false);
  assert.equal(isWebStatus("web_status"), false);
  console.log("Golive web outcomes: unknown values read as untested.");
}

{
  const { inAppPhase, webProgress } = await import("../app/lib/golive.ts");
  const release = { source: "csv", createdAt: "2026-11-07T01:00:00Z" };
  const profiles = [
    { userId: "a", displayName: "An", role: "QE" },
    { userId: "b", displayName: "Bình", role: "QEM" },
    { userId: "c", displayName: "Chi", role: "QE" },
  ];
  const webAt = "2026-11-07T02:00:00Z";
  const tickets = [
    ...Array.from({ length: 5 }, () => ({ assignee: "An", assigneeUserId: "a", webStatus: "tested", webAt })),
    { assignee: "Bình", assigneeUserId: null, webStatus: "failed", webAt },
  ];
  tickets[4].webStatus = "failed";
  let progress = webProgress(release, profiles, ["QE", "QEM"], tickets, []);
  assert.deepEqual(progress.qe.map(person => person.userId), ["a", "b"]);
  assert.deepEqual(progress.signed, {});
  tickets[4].webStatus = "tested";
  progress = webProgress(release, profiles, ["QE", "QEM"], tickets, []);
  assert.deepEqual(progress.signed, { a: webAt });
  assert.equal(inAppPhase(["a", "b"], Object.keys(progress.signed)), false);
  tickets[5].webStatus = "not-needed";
  progress = webProgress(release, profiles, ["QE", "QEM"], tickets, []);
  assert.equal(inAppPhase(["a", "b"], Object.keys(progress.signed)), true);
  const manual = webProgress({ ...release, source: "manual" }, profiles, ["QE", "QEM"], tickets, [{ userId: "b", signedAt: webAt }]);
  assert.deepEqual(manual.signed, { b: webAt });
}

// Unowned tickets block the web phase until the app is pushed; manual releases fix their QE list.
{
  const { webProgress, importReport } = await import("../app/lib/golive.ts");
  const profiles = [
    { userId: "a", displayName: "An", role: "QE" },
    { userId: "d", displayName: "Dũng", role: "DEV" },
  ];
  const at = "2026-11-07T02:00:00Z";
  const csv = { source: "csv", createdAt: "2026-11-07T01:00:00Z" };
  const tickets = [
    { id: 1, issueKey: "X-1", assignee: "An", assigneeUserId: "a", webStatus: "tested", webAt: at },
    { id: 2, issueKey: "X-2", assignee: "Dũng", assigneeUserId: null, webStatus: null, webAt: null },
    { id: 3, issueKey: "X-3", assignee: "", assigneeUserId: null, webStatus: null, webAt: null },
  ];
  let progress = webProgress(csv, profiles, ["QE", "QEM"], tickets, []);
  assert.deepEqual(progress.unowned.map(item => item.issueKey), ["X-2", "X-3"]);
  assert.equal(progress.done, false);
  progress = webProgress({ ...csv, appPushedAt: at }, profiles, ["QE", "QEM"], tickets, []);
  assert.equal(progress.done, true);
  tickets[1].webStatus = "not-needed"; tickets[2].webStatus = "cannot-test";
  progress = webProgress(csv, profiles, ["QE", "QEM"], tickets, []);
  assert.deepEqual([progress.unowned.length, progress.done], [0, true]);

  // Manual: the QE list is the accounts on the rows, even if one is no longer QE.
  const manual = webProgress({ source: "manual", createdAt: at }, profiles, ["QE", "QEM"], [{ assignee: "Dũng", assigneeUserId: "d", webStatus: null, webAt: null }], [{ userId: "d", signedAt: at }]);
  assert.deepEqual(manual.qe.map(person => person.userId), ["d"]);
  assert.equal(manual.done, true);

  const report = importReport([{ assignee: "An" }, { assignee: "An" }, { assignee: "Dũng" }, { assignee: "Lạ" }, { assignee: "" }], profiles, ["QE", "QEM"]);
  assert.equal(report.qeMatched, 2); assert.equal(report.noTester, 1);
  assert.deepEqual(report.unmatched, [{ name: "Lạ", count: 1 }]);
  assert.deepEqual(report.wrongRole, [{ name: "Dũng", count: 1, role: "DEV" }]);
  console.log("Golive web phase: unowned tickets, manual QE list and import report.");
}

// Acceptance rules: Done on the required device list, event statuses, risk-accepted in the report.
{
  const { doneOnRequiredDevices, appEventStatus, attentionList, eventRow } = await import("../app/lib/golive-acceptance.ts");
  const { webSettled } = await import("../app/lib/golive.ts");
  const { doneKindOf, markedHow, tallyByTester, tallyWebByTester, webKindOf, qeScorecard } = await import("../app/lib/statistic.ts");
  const dev = (deviceId, extra = {}) => ({ deviceId, waived: false, archived: false, ...extra });
  // The tester held A and B, ticked A and handed B over: not Done until B is ticked or waived.
  assert.equal(doneOnRequiredDevices([dev("A"), dev("B")], ["A"]), false);
  assert.equal(doneOnRequiredDevices([dev("A"), dev("B")], ["A", "B"]), true);
  assert.equal(doneOnRequiredDevices([dev("A"), dev("B", { waived: true })], ["A"]), true);
  assert.equal(doneOnRequiredDevices([dev("A"), dev("B", { archived: true })], ["A"]), true);
  assert.equal(doneOnRequiredDevices([], []), false);
  assert.equal(doneOnRequiredDevices([dev("B", { archived: true })], []), false);

  const state = { doneAt: null, failedAt: null, skippedAt: null, skipKind: "not-needed" };
  assert.equal(appEventStatus(state), "open");
  assert.equal(appEventStatus({ ...state, doneAt: "x" }), "done-devices");
  assert.equal(appEventStatus({ ...state, failedAt: "x" }), "failed");
  assert.equal(appEventStatus({ ...state, doneAt: "x", skippedAt: "x", skipKind: "risk-accepted" }), "risk-accepted");
  assert.equal(eventRow({ ticketId: 1, releaseId: "r", phase: "app", from: "open", to: "failed", actor: { userId: null, name: "Hệ thống" }, now: "t" }).actorUserId, null);

  // Risk accepted settles the web ticket and is neither tested nor skipped in the QE report.
  assert.equal(webSettled("risk-accepted"), true);
  assert.equal(webKindOf("risk-accepted"), "riskAccepted");
  const risky = { assignee: "An", assigneeUserId: "a", doneAt: "x", skippedAt: "x", skipKind: "risk-accepted" };
  assert.equal(doneKindOf(risky), "riskAccepted");
  assert.equal(markedHow({ ...risky, skippedBy: "M", testedDevices: 0, lastCheckedAt: null }), "Chấp nhận rủi ro");
  assert.equal(tallyByTester([risky])[0].riskAccepted, 1);
  assert.equal(tallyWebByTester([{ assignee: "An", assigneeUserId: "a", webStatus: "risk-accepted" }])[0].done, 1);
  const base = { skippedAt: null, skippedBy: null, skipKind: "not-needed", failedAt: null, testedDevices: 0, lastCheckedAt: null, webStatus: null, webAt: null, doneAt: null };
  const report = qeScorecard({
    releases: [{ id: "r", name: "R", source: "csv", createdAt: "2026-11-01T01:00:00Z", appPushedAt: "2026-11-01T03:00:00Z" }],
    tickets: [{ ...base, id: 1, releaseId: "r", assignee: "An", assigneeUserId: "a", webStatus: "risk-accepted", doneAt: "2026-11-01T05:00:00Z", skippedAt: "2026-11-01T05:00:00Z", skipKind: "risk-accepted" }],
    failures: [{ ticketId: 1, phase: "app" }], profiles: [{ userId: "a", displayName: "An", role: "QE" }], qeRoles: ["QE"],
    matchAccount: (profiles, name) => profiles.find(person => person.displayName === name)?.userId ?? null, normalizeName: name => name.toLowerCase(),
  });
  const row = report.rows[0];
  assert.deepEqual([row.app.tested, row.app.skipped, row.app.failed, row.app.samples, row.open, row.web.tested, row.web.skipped], [0, 0, 1, 0, 0, 0, 0]);

  // The note is mandatory only for cannot-test, not-notified and risk-accepted; old build and waivers just show.
  const ticket = { id: 1, issueKey: "X-1", assignee: "An", skippedAt: null, skipKind: "not-needed", skipReason: "", skipNotified: false, failedReason: "", webStatus: null, webReason: "", webNotified: false, appBuildId: 1, doneAt: "x" };
  let result = attentionList({ tickets: [ticket], risks: [], waived: [{ ticketId: 1, deviceName: "iPhone", waivedReason: "đã chuyển" }], currentBuildId: 2 });
  assert.deepEqual([result.items.length, result.noteRequired], [1, false]);
  assert.deepEqual(result.items[0].reasons.map(reason => reason.kind), ["old-build", "waived"]);
  result = attentionList({ tickets: [{ ...ticket, skippedAt: "x", skipKind: "cannot-test", skipReason: "không có máy" }], risks: [], waived: [], currentBuildId: 1 });
  assert.equal(result.noteRequired, true);
  result = attentionList({ tickets: [ticket], risks: [{ ticketId: 1, phase: "app", reason: "ok", acceptedBy: "M" }], waived: [], currentBuildId: 1 });
  assert.equal(result.noteRequired, true);
  console.log("Golive acceptance: required devices, event statuses, risk-accepted and sign-off attention.");
}

// ===== Tab "QE": qeScorecard over several golive releases =====
{
  const { qeScorecard } = await import("../app/lib/statistic.ts");
  const { matchAccount, normalizeName } = await import("../app/lib/golive.ts");
  const profiles = [
    { userId: "u_anh", displayName: "Minh Anh", role: "QE" },
    { userId: "u_bao", displayName: "Gia Bảo", role: "QEM" },
    { userId: "u_quiet", displayName: "Lặng Lẽ", role: "QE" },
    { userId: "u_dev", displayName: "Dev Khoa", role: "DEV" },
    { userId: "u_mgr", displayName: "Quản Lý", role: "Manager" },
  ];
  const csv = { id: "r1", name: "Golive 01/11", source: "csv", createdAt: "2026-11-01T01:00:00.000Z", appPushedAt: "2026-11-01T03:00:00.000Z" };
  // Migration 0022 stamped this release's push time with its own creation time: no app durations.
  const old = { id: "r2", name: "Golive 01/10", source: "csv", createdAt: "2026-10-01T01:00:00.000Z", appPushedAt: "2026-10-01T01:00:00.000Z" };
  const manual = { id: "r3", name: "Golive tay 02/11", source: "manual", createdAt: "2026-11-02T01:00:00.000Z", appPushedAt: null };
  const base = { skippedAt: null, skippedBy: null, skipKind: "not-needed", failedAt: null, testedDevices: 0, lastCheckedAt: null, webStatus: null, webAt: null, doneAt: null };
  const t = (id, releaseId, assignee, assigneeUserId, extra = {}) => ({ ...base, id, releaseId, assignee, assigneeUserId, ...extra });
  const run = (tickets, failures = [], releases = [csv, old, manual]) =>
    qeScorecard({ releases, tickets, failures, profiles, qeRoles: ["QE", "QEM"], matchAccount, normalizeName });

  // Tested and skipped are separate columns in both phases, and the two never overlap.
  {
    const report = run([
      t(1, "r1", "Minh Anh", "u_anh", { webStatus: "tested", webAt: "2026-11-01T02:00:00.000Z", doneAt: "2026-11-01T04:00:00.000Z", lastCheckedAt: "2026-11-01T04:00:00.000Z" }),
      t(2, "r1", "Minh Anh", "u_anh", { webStatus: "not-needed", doneAt: "2026-11-01T05:00:00.000Z", skippedAt: "2026-11-01T05:00:00.000Z", skipKind: "not-needed" }),
      t(3, "r1", "Minh Anh", "u_anh", { webStatus: "cannot-test", doneAt: "2026-11-01T06:00:00.000Z", skippedAt: "2026-11-01T06:00:00.000Z", skipKind: "cannot-test" }),
      // "Xác nhận đã test xong" is real testing, so it belongs with the device-ticked ones.
      t(4, "r1", "Minh Anh", "u_anh", { doneAt: "2026-11-01T07:00:00.000Z", skippedAt: "2026-11-01T07:00:00.000Z", skipKind: "tested" }),
      t(5, "r1", "Minh Anh", "u_anh", {}),
    ]);
    const row = report.rows.find(item => item.userId === "u_anh");
    assert.equal(row.assigned, 5);
    assert.equal(row.open, 1);
    assert.deepEqual([row.web.tested, row.web.skipped], [1, 2]);
    assert.deepEqual([row.app.tested, row.app.skipped], [2, 2]);
    // Web: 01:00 → 02:00. App: pushed 03:00 → marked 04:00 and 07:00, so 2.5 hours on average.
    assert.equal(row.web.avgMs, 3600000);
    assert.equal(row.app.samples, 2);
    assert.equal(row.app.avgMs, 2.5 * 3600000);
    assert.equal(report.releases, 3);
    assert.equal(report.qeAccounts, 3);
  }

  // A manual release has no real tickets: it only proves the QE took part in that release.
  {
    const report = run([
      t(10, "r3", "Minh Anh", "u_anh", { doneAt: "2026-11-02T02:00:00.000Z", lastCheckedAt: "2026-11-02T02:00:00.000Z" }),
      t(11, "r1", "Minh Anh", "u_anh", { webStatus: "tested", webAt: "2026-11-01T02:00:00.000Z" }),
    ], [{ ticketId: 10, phase: "app" }]);
    const row = report.rows.find(item => item.userId === "u_anh");
    assert.equal(row.releases, 2);
    // The column names the golives themselves, newest first, manual ones included.
    assert.deepEqual(row.releaseNames, ["Golive tay 02/11", "Golive 01/11"]);
    assert.equal(row.assigned, 1);
    assert.equal(row.open, 1);
    assert.equal(row.app.tested, 0);
    assert.equal(row.app.failed, 0);
  }

  // Grouping: the account wins over the written name, and an unmatched name keeps its own row last.
  {
    const report = run([
      t(20, "r1", "Minh  Anh", null, { webStatus: "tested", webAt: "2026-11-01T02:00:00.000Z" }),
      t(21, "r1", "minh anh", null, {}),
      t(22, "r1", "Người Lạ", null, {}),
      t(23, "r1", "nguời lạ ", null, {}),
      t(24, "r1", "", null, {}),
      t(25, "r3", "", null, {}),
    ]);
    const anh = report.rows.find(item => item.userId === "u_anh");
    assert.equal(anh.assigned, 2);
    assert.equal(anh.name, "Minh Anh");
    // Only a CSV ticket without a tester is reported as uncounted; a manual placeholder is not one.
    assert.equal(report.unassignedTickets, 1);
    const last = report.rows[report.rows.length - 1];
    assert.equal(last.matched, false);
    assert.equal(last.assigned, 1);
    assert.equal(report.rows.filter(item => !item.matched).length, 2);
  }

  // Every QE account is listed, even one with nothing in the period; a DEV with tickets is too.
  {
    const report = run([t(30, "r1", "Dev Khoa", "u_dev", {})]);
    const quiet = report.rows.find(item => item.userId === "u_quiet");
    assert.equal(quiet.assigned, 0);
    assert.equal(quiet.releases, 0);
    assert.deepEqual(quiet.releaseNames, []);
    assert.equal(quiet.web.avgMs, null);
    assert.equal(quiet.app.avgMs, null);
    const dev = report.rows.find(item => item.userId === "u_dev");
    assert.equal(dev.role, "DEV");
    assert.equal(dev.open, 1);
    assert.ok(!report.rows.some(item => item.userId === "u_mgr"));
  }

  // Failed then passed: the ticket counts in both columns, and the mark is credited to the ticket's
  // own tester even though a Manager pressed it.
  {
    const report = run([
      t(40, "r1", "Gia Bảo", "u_bao", { webStatus: "tested", webAt: "2026-11-01T02:00:00.000Z", doneAt: "2026-11-01T04:00:00.000Z", lastCheckedAt: "2026-11-01T04:00:00.000Z" }),
    ], [{ ticketId: 40, phase: "web" }, { ticketId: 40, phase: "app" }]);
    const row = report.rows.find(item => item.userId === "u_bao");
    assert.equal(row.web.failed, 1); assert.equal(row.web.tested, 1);
    assert.equal(row.app.failed, 1); assert.equal(row.app.tested, 1);
    assert.equal(row.open, 0);
  }

  // Unusable samples are dropped, not counted as zero: an old release's push time, a web mark that
  // predates the release, and an unparseable stamp. The counts themselves still include the tickets.
  {
    const report = run([
      t(50, "r2", "Minh Anh", "u_anh", { webStatus: "tested", webAt: "2026-10-01T02:00:00.000Z", doneAt: "2026-10-01T05:00:00.000Z", lastCheckedAt: "2026-10-01T05:00:00.000Z" }),
      t(51, "r1", "Minh Anh", "u_anh", { webStatus: "tested", webAt: "2026-10-31T23:00:00.000Z" }),
      t(52, "r1", "Minh Anh", "u_anh", { webStatus: "tested", webAt: "không rõ" }),
    ]);
    const row = report.rows.find(item => item.userId === "u_anh");
    assert.equal(row.web.tested, 3);
    assert.equal(row.web.samples, 1);
    assert.equal(row.web.avgMs, 3600000);
    assert.equal(row.app.tested, 1);
    assert.equal(row.app.samples, 0);
    assert.equal(row.app.avgMs, null);
  }

  // Default order: most tested first, then the name in Vietnamese, with unmatched names last.
  {
    const report = run([
      t(60, "r1", "Minh Anh", "u_anh", {}),
      t(61, "r1", "Gia Bảo", "u_bao", { webStatus: "tested", webAt: "2026-11-01T02:00:00.000Z" }),
      t(62, "r1", "Người Lạ", null, { webStatus: "tested", webAt: "2026-11-01T02:00:00.000Z" }),
    ]);
    assert.deepEqual(report.rows.map(item => item.name), ["Gia Bảo", "Lặng Lẽ", "Minh Anh", "Người Lạ"]);
  }
  console.log("Statistic QE scorecard: tested vs skipped, manual releases, grouping, failures and dropped samples.");
}

// Sorting and the duration labels of the QE table.
{
  const { sortRows, prettyDuration, rangeDates } = await import("../app/lib/qe-table.ts");
  assert.equal(prettyDuration(null), "—");
  assert.equal(prettyDuration(0), "0p");
  assert.equal(prettyDuration(45 * 60000), "45p");
  assert.equal(prettyDuration(59.6 * 60000), "1g 0p");
  assert.equal(prettyDuration((3 * 60 + 20) * 60000), "3g 20p");
  assert.equal(prettyDuration((2 * 24 + 4) * 3600000), "2n 4g");

  const row = (name, matched, avgMs, tested) => ({
    key: name, name, userId: matched ? name : null, role: "QE", matched,
    releases: 1, releaseNames: ["Golive 01/11"], assigned: tested, open: 0,
    web: { tested, skipped: 0, failed: 0, avgMs, samples: avgMs === null ? 0 : 1 },
    app: { tested: 0, skipped: 0, failed: 0, avgMs: null, samples: 0 },
  });
  const rows = [row("An", true, 2000, 1), row("Bình", true, null, 3), row("Cường", true, 1000, 2), row("Lạ", false, 500, 9)];
  // A missing average sits at the bottom either way round, and an unmatched name below everyone.
  assert.deepEqual(sortRows(rows, "web.avgMs", "asc").map(item => item.name), ["Cường", "An", "Bình", "Lạ"]);
  assert.deepEqual(sortRows(rows, "web.avgMs", "desc").map(item => item.name), ["An", "Cường", "Bình", "Lạ"]);
  assert.deepEqual(sortRows(rows, "web.tested", "desc").map(item => item.name), ["Bình", "Cường", "An", "Lạ"]);
  assert.deepEqual(sortRows(rows, "name", "asc").map(item => item.name), ["An", "Bình", "Cường", "Lạ"]);
  assert.deepEqual(sortRows(rows, "", "desc").map(item => item.name), rows.map(item => item.name));

  // Every fixed period ends with today in Vietnam and counts today as one of its days.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const span = range => (Date.parse(today) - Date.parse(rangeDates(range, { from: "", to: "" }).from)) / 86400000 + 1;
  assert.equal(rangeDates("30d", { from: "", to: "" }).to, today);
  assert.deepEqual([span("7d"), span("30d"), span("90d")], [7, 30, 90]);
  assert.deepEqual(rangeDates("custom", { from: "2026-01-02", to: "2026-03-04" }), { from: "2026-01-02", to: "2026-03-04" });
  console.log("Statistic QE table: durations, column sorting with blanks last, and period bounds.");
}
