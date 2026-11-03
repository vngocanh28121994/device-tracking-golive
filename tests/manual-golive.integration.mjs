import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const database = resolve(process.argv[2] || "");
if (!database.includes("/.wrangler/state/") || !database.endsWith(".sqlite")) throw new Error("Pass the local .wrangler/state D1 SQLite file; never a production database.");
const sql = query => execFileSync("sqlite3", [database], { input: query, encoding: "utf8" });
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const prefix = "manual-golive-test-" + crypto.randomUUID();
const testerId = prefix + "-qe", developerId = prefix + "-dev", deviceId = prefix + "-device";
const releaseIds = [];
async function request(path, body) {
  const response = await fetch("http://localhost:5173" + path, { headers: { Cookie: "__sites_local_auth=1", "Content-Type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const actor = (await request("/api/profile")).data.profile;
assert.ok(actor?.userId);
const originalRole = sql(`SELECT role FROM user_profiles WHERE user_id=${literal(actor.userId)};`).trim();
try {
  sql(`UPDATE user_profiles SET role='Manager' WHERE user_id=${literal(actor.userId)};
    INSERT INTO user_profiles(user_id,email,display_name,updated_at,role) VALUES
    (${literal(testerId)},'test-qe@example.invalid','Test QE','test',''),
    (${literal(developerId)},'test-dev@example.invalid','Test DEV','test','DEV');
    INSERT INTO devices(id,name,holder,holder_user_id,updated_at) VALUES
    (${literal(deviceId)},'Test phone',${literal(actor.displayName)},${literal(actor.userId)},'test');`);
  if (sql("SELECT count(*) FROM user_profiles WHERE role='QE';").trim() === "0") {
    assert.equal((await request("/api/golive", { action: "create-manual", name: prefix, fixVersion: "release-empty" })).status, 400);
  }
  assert.equal((await request("/api/profile", { action: "assign-role", userId: testerId, role: "QE" })).status, 200);
  assert.equal((await request("/api/profile", { action: "assign-role", userId: testerId, role: "Admin" })).status, 400);
  assert.equal((await request("/api/profile", { action: "assign-role", userId: actor.userId, role: "QE" })).status, 200);
  assert.equal((await request("/api/profile", { action: "assign-role", userId: developerId, role: "Manager" })).status, 403);
  assert.equal((await request("/api/profile", { displayName: actor.displayName, role: "Manager" })).status, 200);
  assert.equal(sql(`SELECT role FROM user_profiles WHERE user_id=${literal(actor.userId)};`).trim(), "QE");
  assert.equal((await request("/api/golive", { action: "create-manual", name: "Missing version" })).status, 400);
  const created = await request("/api/golive", { action: "create-manual", name: prefix, fixVersion: "release-2.4", testers: [developerId] });
  assert.equal(created.status, 200);
  releaseIds.push(created.data.releaseId);
  const loaded = (await request("/api/golive?release=" + created.data.releaseId)).data;
  const release = loaded.releases.find(item => item.id === created.data.releaseId);
  assert.equal(release.source, "manual"); assert.equal(release.fixVersion, "release-2.4");
  const actualIds = loaded.tickets.map(item => item.assigneeUserId).sort();
  const expectedIds = sql("SELECT user_id FROM user_profiles WHERE role='QE' ORDER BY user_id;").trim().split("\n");
  assert.deepEqual(actualIds, expectedIds);
  assert.ok(!actualIds.includes(developerId));
  const own = loaded.tickets.find(item => item.assigneeUserId === actor.userId);
  const other = loaded.tickets.find(item => item.assigneeUserId === testerId);
  assert.equal((await request("/api/golive", { action: "toggle-check", ticketId: other.id, deviceId, checked: true })).status, 403);
  assert.equal((await request("/api/golive", { action: "toggle-check", ticketId: own.id, deviceId, checked: true })).status, 200);
  assert.ok((await request("/api/golive?release=" + created.data.releaseId)).data.tickets.find(item => item.id === own.id).doneAt);
  assert.equal((await request("/api/golive", { action: "complete-release", releaseId: created.data.releaseId })).status, 409);
  sql(`UPDATE user_profiles SET role='DEV' WHERE user_id=${literal(testerId)};`);
  assert.deepEqual((await request("/api/golive?release=" + created.data.releaseId)).data.tickets.map(item => item.assigneeUserId).sort(), expectedIds);
  if (expectedIds.length === 2) {
    const second = await request("/api/golive", { action: "create-manual", name: prefix + " complete", fixVersion: "release-complete" });
    assert.equal(second.status, 200); releaseIds.push(second.data.releaseId);
    const row = (await request("/api/golive?release=" + second.data.releaseId)).data.tickets[0];
    await request("/api/golive", { action: "toggle-check", ticketId: row.id, deviceId, checked: true });
    assert.equal((await request("/api/golive", { action: "complete-release", releaseId: second.data.releaseId })).status, 200);
    const saved = (await request("/api/golive?release=" + second.data.releaseId)).data.releases.find(item => item.id === second.data.releaseId);
    assert.ok(saved.completedAt); assert.equal(saved.fixVersion, "release-complete");
    assert.equal((await request("/api/golive", { action: "toggle-check", ticketId: row.id, deviceId, checked: false })).status, 409);
  }
  console.log("Passed: role permissions, self role change, role escalation, QE-only creation, validation, checklist permissions, Done, fixed participants and completed history.");
} finally {
  for (const releaseId of releaseIds) await request("/api/golive", { action: "delete-release", releaseId });
  sql(`DELETE FROM devices WHERE id=${literal(deviceId)};
    DELETE FROM user_profiles WHERE user_id IN (${literal(testerId)},${literal(developerId)});
    UPDATE user_profiles SET role=${literal(originalRole)} WHERE user_id=${literal(actor.userId)};`);
}
