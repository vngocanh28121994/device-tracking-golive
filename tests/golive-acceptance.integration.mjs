// Acceptance flow: build numbers, retest on a new build, required devices with waivers, accepted risks,
// the sign-off note and the status log. Local D1 only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const database = resolve(process.argv[2] || "");
if (!database.includes("/.wrangler/state/") || !database.endsWith(".sqlite")) throw new Error("Pass the local .wrangler/state D1 SQLite file; never a production database.");
const sql = query => execFileSync("sqlite3", [database], { input: query, encoding: "utf8" });
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const prefix = "golive-acceptance-test-" + crypto.randomUUID();
const deviceIds = [prefix + "-a", prefix + "-b"];
// A device the tester receives after the build was pushed: it is ticked, but never required.
const lateDeviceId = prefix + "-c";
const releaseIds = [];
async function request(path, body) {
  const response = await fetch("http://localhost:5173" + path, { headers: { Cookie: "__sites_local_auth=1", "Content-Type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const post = body => request("/api/golive", body);
const actor = (await request("/api/profile")).data.profile;
assert.ok(actor?.userId);
const originalRole = sql(`SELECT role FROM user_profiles WHERE user_id=${literal(actor.userId)};`).trim();
const failures = (releaseId, phase) => sql(`SELECT ticket_id||':'||failed_at FROM golive_ticket_failures WHERE release_id=${literal(releaseId)} AND phase=${literal(phase)} ORDER BY ticket_id;`).trim().split("\n").filter(Boolean);
const waivers = releaseId => sql(`SELECT count(*) FROM golive_ticket_devices d JOIN golive_tickets t ON t.id=d.ticket_id WHERE t.release_id=${literal(releaseId)} AND d.waived_at IS NOT NULL;`).trim();
const holder = (deviceId, name, userId) => sql(`UPDATE devices SET holder=${literal(name)}, holder_user_id=${literal(userId)} WHERE id=${literal(deviceId)};`);
const events = releaseId => sql(`SELECT ticket_id||':'||from_status||'>'||to_status FROM golive_ticket_events WHERE release_id=${literal(releaseId)} ORDER BY id;`).trim().split("\n").filter(Boolean);
try {
  sql(`UPDATE user_profiles SET role='QEM' WHERE user_id=${literal(actor.userId)};
    INSERT INTO devices(id,name,holder,holder_user_id,updated_at) VALUES
    (${literal(deviceIds[0])},'Test phone A',${literal(actor.displayName)},${literal(actor.userId)},'test'),
    (${literal(deviceIds[1])},'Test phone B',${literal(actor.displayName)},${literal(actor.userId)},'test');`);
  const imported = await post({ action: "import", name: prefix, tickets: [1, 2, 3].map(index => ({ issueKey: prefix.slice(0, 24) + "-" + index, summary: "Ticket " + index, assignee: actor.displayName })) });
  assert.equal(imported.status, 200);
  const releaseId = imported.data.releaseId;
  releaseIds.push(releaseId);
  const load = async () => (await request("/api/golive?release=" + releaseId)).data;
  const [one, two, three] = (await load()).tickets;
  const ticket = async id => (await load()).tickets.find(item => item.id === id);
  assert.equal((await post({ action: "bulk-status", releaseId, phase: "web", status: "tested", ticketIds: [one.id, two.id, three.id] })).status, 200);

  // R7: the build number is mandatory.
  assert.equal((await post({ action: "app-pushed", releaseId })).status, 400);
  assert.equal((await post({ action: "app-pushed", releaseId, build: "1.0.0" })).status, 200);
  let data = await load();
  assert.equal(data.builds.length, 1); assert.equal(data.builds[0].buildNumber, "1.0.0");
  // R9: the devices held at push time are the ticket's required list.
  const required = id => data.required.filter(row => row.ticketId === id).map(row => row.deviceId);
  for (const id of deviceIds) assert.ok(required(one.id).includes(id));

  // Ticking every required device makes the ticket Done on the current build, and the log says so.
  for (const deviceId of required(one.id)) assert.equal((await post({ action: "toggle-check", ticketId: one.id, deviceId, checked: true })).status, 200);
  let row = await ticket(one.id);
  assert.ok(row.doneAt); assert.equal(row.appBuildId, data.builds[0].id);
  assert.ok(events(releaseId).includes(one.id + ":open>done-devices"));

  // R10: a QE cannot accept a risk; a Manager can, and the ticket then counts as Done.
  assert.equal((await post({ action: "fail-test", ticketId: three.id, failed: true, reason: "Crash" })).status, 200);
  sql(`UPDATE user_profiles SET role='QE' WHERE user_id=${literal(actor.userId)};`);
  assert.equal((await post({ action: "accept-risk", ticketId: three.id, phase: "app", accepted: true, reason: "ok" })).status, 403);
  sql(`UPDATE user_profiles SET role='QEM' WHERE user_id=${literal(actor.userId)};`);
  assert.equal((await post({ action: "accept-risk", ticketId: three.id, phase: "app", accepted: true, reason: "" })).status, 400);
  assert.equal((await post({ action: "accept-risk", ticketId: two.id, phase: "app", accepted: true, reason: "ok" })).status, 409);
  assert.equal((await post({ action: "accept-risk", ticketId: three.id, phase: "app", accepted: true, reason: "Lỗi nhỏ" })).status, 200);
  row = await ticket(three.id);
  assert.ok(row.doneAt); assert.equal(row.skipKind, "risk-accepted"); assert.equal(row.failedReason, "Crash"); assert.equal(row.failedAt, null);
  assert.deepEqual((await load()).risks.map(item => item.reason), ["Lỗi nhỏ"]);

  // R8: a new build retests the chosen tickets only; the others keep their result on the old build.
  assert.equal((await post({ action: "app-pushed", releaseId, again: true, build: "1.1.0", retestTicketIds: [one.id] })).status, 200);
  data = await load();
  assert.equal(data.builds.length, 2);
  row = await ticket(one.id);
  assert.equal(row.doneAt, null); assert.equal(row.appBuildId, null);
  assert.equal(data.checks.filter(item => item.ticketId === one.id).length, 0);
  assert.ok(events(releaseId).includes(one.id + ":done-devices>retest"));
  assert.equal((await ticket(three.id)).appBuildId, data.builds[0].id);
  assert.equal((await post({ action: "app-pushed", releaseId, undo: true })).status, 409);
  assert.equal((await post({ action: "edit-build", releaseId, build: "1.1.1" })).status, 200);
  for (const deviceId of data.required.filter(item => item.ticketId === one.id).map(item => item.deviceId)) await post({ action: "toggle-check", ticketId: one.id, deviceId, checked: true });
  row = await ticket(one.id);
  assert.ok(row.doneAt); assert.equal(row.appBuildId, data.builds[1].id);

  // R9: tick A, hand B over: not Done until B is waived with a reason.
  const [first, second] = deviceIds;
  const others = required(two.id).filter(id => !deviceIds.includes(id));
  for (const deviceId of [first, ...others]) await post({ action: "toggle-check", ticketId: two.id, deviceId, checked: true });
  sql(`UPDATE devices SET holder='Someone Else', holder_user_id='someone-else' WHERE id=${literal(second)};`);
  assert.equal((await ticket(two.id)).doneAt, null);
  assert.equal((await post({ action: "waive-device", ticketId: two.id, deviceId: second, waived: true, reason: "" })).status, 400);
  assert.equal((await post({ action: "waive-device", ticketId: two.id, deviceId: second, waived: true, reason: "Đã chuyển cho người khác" })).status, 200);
  assert.ok((await ticket(two.id)).doneAt);

  // R11: the sign-off note is mandatory while an accepted risk is on the release.
  assert.equal((await post({ action: "complete-release", releaseId })).status, 400);
  assert.equal((await post({ action: "complete-release", releaseId, note: "Chấp nhận golive" })).status, 200);
  const saved = (await load()).releases.find(item => item.id === releaseId);
  assert.ok(saved.completedAt); assert.equal(saved.signoffNote, "Chấp nhận golive");
  assert.ok(events(releaseId).length >= 6);

  assert.equal((await post({ action: "delete-release", releaseId })).status, 200);
  releaseIds.pop();
  assert.equal(sql(`SELECT count(*) FROM golive_builds WHERE release_id=${literal(releaseId)};`).trim(), "0");
  assert.equal(sql(`SELECT count(*) FROM golive_ticket_events WHERE release_id=${literal(releaseId)};`).trim(), "0");

  // L1 web: fixing the reason of a ticket already failed keeps the first failed time, so "mistake"
  // still finds the log row it has to delete. Single ticket and bulk update.
  const webImport = await post({ action: "import", name: prefix + " web", tickets: [1, 2, 3].map(index => ({ issueKey: prefix.slice(0, 20) + "-w" + index, summary: "Web " + index, assignee: actor.displayName })) });
  assert.equal(webImport.status, 200);
  const webId = webImport.data.releaseId;
  releaseIds.push(webId);
  const webTickets = (await request("/api/golive?release=" + webId)).data.tickets;
  const webRow = async id => (await request("/api/golive?release=" + webId)).data.tickets.find(item => item.id === id);
  const [w1, w2, w3] = webTickets;
  assert.equal((await post({ action: "web-status", ticketId: w1.id, status: "failed", reason: "Lỗi web" })).status, 200);
  const w1At = (await webRow(w1.id)).webAt;
  assert.equal((await post({ action: "web-status", ticketId: w1.id, status: "failed", reason: "Lỗi web, mô tả lại" })).status, 200);
  assert.equal((await webRow(w1.id)).webAt, w1At);
  assert.deepEqual(failures(webId, "web"), [w1.id + ":" + w1At]);
  assert.equal((await post({ action: "web-status", ticketId: w1.id, status: null, mode: "mistake" })).status, 200);
  assert.deepEqual(failures(webId, "web"), []);
  assert.equal((await post({ action: "bulk-status", releaseId: webId, phase: "web", status: "failed", ticketIds: [w2.id, w3.id], reason: "Lỗi hàng loạt" })).status, 200);
  const bulkAt = [(await webRow(w2.id)).webAt, (await webRow(w3.id)).webAt];
  assert.equal((await post({ action: "bulk-status", releaseId: webId, phase: "web", status: "failed", ticketIds: [w2.id, w3.id], reason: "Lỗi hàng loạt, mô tả lại" })).status, 200);
  assert.deepEqual([(await webRow(w2.id)).webAt, (await webRow(w3.id)).webAt], bulkAt);
  assert.deepEqual(failures(webId, "web"), [w2.id + ":" + bulkAt[0], w3.id + ":" + bulkAt[1]].sort());
  for (const id of [w2.id, w3.id]) assert.equal((await post({ action: "web-status", ticketId: id, status: null, mode: "mistake" })).status, 200);
  assert.deepEqual(failures(webId, "web"), []);
  assert.equal((await post({ action: "delete-release", releaseId: webId })).status, 200);
  releaseIds.pop();

  // The app-phase regressions run on their own release, on the two test devices only: the local
  // inventory may hold more devices for this account, and they would be required too.
  holder(deviceIds[1], actor.displayName, actor.userId);
  const appImport = await post({ action: "import", name: prefix + " app", tickets: [1, 2, 3].map(index => ({ issueKey: prefix.slice(0, 20) + "-a" + index, summary: "App " + index, assignee: actor.displayName })) });
  assert.equal(appImport.status, 200);
  const appId = appImport.data.releaseId;
  releaseIds.push(appId);
  const appLoad = async () => (await request("/api/golive?release=" + appId)).data;
  const appRow = async id => (await appLoad()).tickets.find(item => item.id === id);
  const [a1, a2, a3] = (await appLoad()).tickets;
  assert.equal((await post({ action: "bulk-status", releaseId: appId, phase: "web", status: "tested", ticketIds: [a1.id, a2.id, a3.id] })).status, 200);
  assert.equal((await post({ action: "app-pushed", releaseId: appId, build: "2.0.0" })).status, 200);
  sql(`DELETE FROM golive_ticket_devices WHERE ticket_id IN (${[a1.id, a2.id, a3.id].join(",")}) AND device_id NOT IN (${deviceIds.map(literal).join(",")});`);
  const appBuildId = (await appLoad()).builds.at(-1).id;

  // L1 app: same rule as the web phase, single ticket and bulk update.
  assert.equal((await post({ action: "fail-test", ticketId: a1.id, failed: true, reason: "Crash" })).status, 200);
  const a1At = (await appRow(a1.id)).failedAt;
  assert.equal((await post({ action: "fail-test", ticketId: a1.id, failed: true, reason: "Crash, mô tả lại" })).status, 200);
  assert.equal((await appRow(a1.id)).failedAt, a1At);
  assert.deepEqual(failures(appId, "app"), [a1.id + ":" + a1At]);
  assert.equal((await post({ action: "fail-test", ticketId: a1.id, failed: false, mode: "mistake" })).status, 200);
  assert.deepEqual(failures(appId, "app"), []);
  // N3: nothing to revoke on a ticket that is not failed.
  assert.equal((await post({ action: "fail-test", ticketId: a1.id, failed: false, mode: "mistake" })).status, 409);
  assert.equal((await post({ action: "bulk-status", releaseId: appId, phase: "app", status: "failed", ticketIds: [a2.id, a3.id], reason: "Crash hàng loạt" })).status, 200);
  const bulkFailedAt = [(await appRow(a2.id)).failedAt, (await appRow(a3.id)).failedAt];
  assert.equal((await post({ action: "bulk-status", releaseId: appId, phase: "app", status: "failed", ticketIds: [a2.id, a3.id], reason: "Crash hàng loạt, mô tả lại" })).status, 200);
  assert.deepEqual([(await appRow(a2.id)).failedAt, (await appRow(a3.id)).failedAt], bulkFailedAt);
  assert.deepEqual(failures(appId, "app"), [a2.id + ":" + bulkFailedAt[0], a3.id + ":" + bulkFailedAt[1]].sort());
  for (const id of [a2.id, a3.id]) assert.equal((await post({ action: "fail-test", ticketId: id, failed: false, mode: "mistake" })).status, 200);
  assert.deepEqual(failures(appId, "app"), []);

  // L3: every required device waived makes the ticket Done; "cần test lại" has to undo those waivers
  // as well, or the ticket goes straight back to Done without being tested.
  for (const deviceId of deviceIds) holder(deviceId, "Someone Else", "someone-else");
  for (const deviceId of deviceIds) assert.equal((await post({ action: "waive-device", ticketId: a1.id, deviceId, waived: true, reason: "Đã bàn giao" })).status, 200);
  assert.ok((await appRow(a1.id)).doneAt);
  assert.equal(waivers(appId), String(deviceIds.length));
  assert.equal((await post({ action: "fail-test", ticketId: a1.id, failed: true, reason: "Crash" })).status, 200);
  assert.equal((await post({ action: "fail-test", ticketId: a1.id, failed: false, mode: "retest" })).status, 200);
  assert.equal((await appRow(a1.id)).doneAt, null);
  assert.equal(waivers(appId), "0");
  for (const deviceId of deviceIds) holder(deviceId, actor.displayName, actor.userId);
  // N4: a device the tester still holds is tested, not waived.
  assert.equal((await post({ action: "waive-device", ticketId: a1.id, deviceId: deviceIds[0], waived: true, reason: "Đã bàn giao" })).status, 409);

  // L4: a device outside the required list changes nothing about the ticket's result, build or log.
  for (const deviceId of deviceIds) assert.equal((await post({ action: "toggle-check", ticketId: a2.id, deviceId, checked: true })).status, 200);
  let done2 = await appRow(a2.id);
  assert.ok(done2.doneAt); assert.equal(done2.appBuildId, appBuildId);
  sql(`INSERT INTO devices(id,name,holder,holder_user_id,updated_at) VALUES (${literal(lateDeviceId)},'Test phone C',${literal(actor.displayName)},${literal(actor.userId)},'test');`);
  assert.equal((await post({ action: "toggle-check", ticketId: a2.id, deviceId: lateDeviceId, checked: true })).status, 200);
  const before = events(appId).length, doneAtBefore = done2.doneAt;
  assert.equal((await post({ action: "toggle-check", ticketId: a2.id, deviceId: lateDeviceId, checked: false })).status, 200);
  done2 = await appRow(a2.id);
  assert.equal(done2.doneAt, doneAtBefore);
  assert.equal(done2.appBuildId, appBuildId);
  assert.equal(events(appId).length, before);
  // Unticking a required device does take Done away, with exactly one log row.
  assert.equal((await post({ action: "toggle-check", ticketId: a2.id, deviceId: deviceIds[0], checked: false })).status, 200);
  assert.equal((await appRow(a2.id)).doneAt, null);
  assert.deepEqual(events(appId).slice(before), [a2.id + ":done-devices>open"]);

  // N1: the release cannot be completed while it is not in the app phase.
  const webOnly = await post({ action: "import", name: prefix + " phase", tickets: [{ issueKey: prefix.slice(0, 20) + "-p1", summary: "Phase", assignee: actor.displayName }] });
  assert.equal(webOnly.status, 200);
  releaseIds.push(webOnly.data.releaseId);
  assert.equal((await post({ action: "complete-release", releaseId: webOnly.data.releaseId, note: "x" })).status, 409);

  console.log("Passed: builds, retest, required devices with waivers, accepted risks, sign-off note, the status log, the failed-mark rules and Done on required devices only.");
} finally {
  for (const releaseId of releaseIds) await post({ action: "delete-release", releaseId });
  sql(`DELETE FROM devices WHERE id IN (${[...deviceIds, lateDeviceId].map(literal).join(",")});
    UPDATE user_profiles SET role=${literal(originalRole)} WHERE user_id=${literal(actor.userId)};`);
}
