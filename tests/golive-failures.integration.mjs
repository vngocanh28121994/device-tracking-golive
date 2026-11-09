// Failure history: marking a ticket Test Failed records it for the Statistic report, undoing or
// re-testing keeps the record, and deleting the release takes it away. Local D1 only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const database = resolve(process.argv[2] || "");
if (!database.includes("/.wrangler/state/") || !database.endsWith(".sqlite")) throw new Error("Pass the local .wrangler/state D1 SQLite file; never a production database.");
const sql = query => execFileSync("sqlite3", [database], { input: query, encoding: "utf8" });
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const prefix = "golive-failures-test-" + crypto.randomUUID();
const releaseIds = [];
async function request(path, body) {
  const response = await fetch("http://localhost:5173" + path, { headers: { Cookie: "__sites_local_auth=1", "Content-Type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const actor = (await request("/api/profile")).data.profile;
assert.ok(actor?.userId);
const originalRole = sql(`SELECT role FROM user_profiles WHERE user_id=${literal(actor.userId)};`).trim();
const logged = releaseId => sql(`SELECT phase||':'||ticket_id FROM golive_ticket_failures WHERE release_id=${literal(releaseId)} ORDER BY phase, ticket_id;`).trim().split("\n").filter(Boolean);

try {
  // QEM passes every QE and every Manager check: the actor owns the tickets, finishes the web phase
  // as a participating QE, and pushes the app build itself.
  sql(`UPDATE user_profiles SET role='QEM' WHERE user_id=${literal(actor.userId)};`);
  const imported = await request("/api/golive", {
    action: "import", name: prefix,
    tickets: [1, 2, 3, 4].map(index => ({ issueKey: prefix.slice(0, 20) + "-" + index, summary: "Ticket " + index, assignee: actor.displayName })),
  });
  assert.equal(imported.status, 200);
  const releaseId = imported.data.releaseId;
  releaseIds.push(releaseId);
  const tickets = (await request("/api/golive?release=" + releaseId)).data.tickets;
  assert.equal(tickets.length, 4);
  const [one, two, three, four] = tickets;

  // Phase web, single ticket: the mark is logged, and undoing it leaves the log behind.
  assert.equal((await request("/api/golive", { action: "web-status", ticketId: one.id, status: "failed", reason: "Lỗi hiển thị" })).status, 200);
  assert.deepEqual(logged(releaseId), ["web:" + one.id]);
  const firstAt = sql(`SELECT failed_at FROM golive_ticket_failures WHERE ticket_id=${one.id} AND phase='web';`).trim();
  // Withdrawing a failed mark needs a mode; "retest" keeps the log row.
  assert.equal((await request("/api/golive", { action: "web-status", ticketId: one.id, status: null })).status, 400);
  assert.equal((await request("/api/golive", { action: "web-status", ticketId: one.id, status: null, mode: "retest" })).status, 200);
  assert.deepEqual(logged(releaseId), ["web:" + one.id]);
  // Failing the same ticket again keeps the first mark rather than counting a second one.
  assert.equal((await request("/api/golive", { action: "web-status", ticketId: one.id, status: "failed", reason: "Lỗi lần hai" })).status, 200);
  assert.deepEqual(logged(releaseId), ["web:" + one.id]);
  assert.equal(sql(`SELECT failed_at FROM golive_ticket_failures WHERE ticket_id=${one.id} AND phase='web';`).trim(), firstAt);

  // Phase web, in bulk: one row per ticket of the selection, in the phase it was marked in.
  assert.equal((await request("/api/golive", { action: "bulk-status", releaseId, phase: "web", status: "failed", ticketIds: [two.id, three.id], reason: "Lỗi hàng loạt" })).status, 200);
  assert.deepEqual(logged(releaseId), ["web:" + one.id, "web:" + two.id, "web:" + three.id]);

  // A ticket failed on the web and then passed keeps its record: the report counts both.
  assert.equal((await request("/api/golive", { action: "web-status", ticketId: two.id, status: "tested" })).status, 200);
  assert.deepEqual(logged(releaseId), ["web:" + one.id, "web:" + two.id, "web:" + three.id]);

  // Phase app opens once every QE finished the web and the app build is pushed.
  for (const ticket of [one, three, four]) await request("/api/golive", { action: "web-status", ticketId: ticket.id, status: "tested" });
  assert.equal((await request("/api/golive", { action: "app-pushed", releaseId, build: "1.0.0" })).status, 200);
  assert.equal((await request("/api/golive", { action: "fail-test", ticketId: one.id, reason: "Crash khi mở app" })).status, 200);
  assert.equal((await request("/api/golive", { action: "fail-test", ticketId: one.id, failed: false })).status, 400);
  assert.equal((await request("/api/golive", { action: "fail-test", ticketId: one.id, failed: false, mode: "retest" })).status, 200);
  assert.equal((await request("/api/golive", { action: "bulk-status", releaseId, phase: "app", status: "failed", ticketIds: [two.id, four.id], reason: "Lỗi app hàng loạt" })).status, 200);
  assert.deepEqual(logged(releaseId), ["app:" + one.id, "app:" + two.id, "app:" + four.id, "web:" + one.id, "web:" + two.id, "web:" + three.id]);
  // The same ticket can be logged once per phase and no more.
  assert.equal(sql(`SELECT count(*) FROM golive_ticket_failures WHERE ticket_id=${one.id};`).trim(), "2");

  // The Statistic report reads the log, so a ticket failed and later passed shows in both columns.
  const report = (await request("/api/statistic?view=qe")).data;
  const row = report.rows.find(item => item.userId === actor.userId);
  assert.ok(row, "the actor should have a row in the QE report");
  assert.ok(row.web.failed >= 3 && row.app.failed >= 3);
  assert.ok(row.web.tested >= 3, "a ticket re-tested after a failure still counts as tested");

  // A bad date range is the caller's mistake, not a 500.
  assert.equal((await request("/api/statistic?view=qe&from=2026-03-04&to=2026-01-02")).status, 400);
  assert.equal((await request("/api/statistic?view=qe&from=hôm-qua")).status, 400);

  // Deleting the release takes its log with it.
  assert.equal((await request("/api/golive", { action: "delete-release", releaseId })).status, 200);
  releaseIds.pop();
  assert.deepEqual(logged(releaseId), []);
  console.log("Passed: failed marks logged once per phase, kept through undo and re-test, read by the QE report, and removed with the release.");
} finally {
  for (const releaseId of releaseIds) await request("/api/golive", { action: "delete-release", releaseId });
  sql(`UPDATE user_profiles SET role=${literal(originalRole)} WHERE user_id=${literal(actor.userId)};`);
}
