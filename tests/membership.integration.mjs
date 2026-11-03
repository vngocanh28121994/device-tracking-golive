import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Run against an isolated local preview with migrations applied, never production.
const database = resolve(process.argv[2] || "");
const base = process.argv[3] || "http://localhost:5180";
if (!database.includes("/.wrangler/state/") || !database.endsWith(".sqlite") || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error("Local preview and D1 SQLite file required.");
const sql = query => execFileSync("sqlite3", [database], { input: query, encoding: "utf8" });
async function request(path, body, signedIn = true, extraHeaders = {}) {
  const response = await fetch(base + path, { headers: { ...(signedIn ? { Cookie: "__sites_local_auth=1" } : {}), "Content-Type": "application/json", ...extraHeaders }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}
const email = "membership-" + crypto.randomUUID() + "@example.com";
const paths = ["/api/profile", "/api/profile?list=1", "/api/inventory", "/api/inventory/history?deviceId=test", "/api/golive", "/api/avatar/00000000-0000-4000-8000-000000000000.jpg", "/api/teams-settings"];
const before = sql("SELECT email FROM members WHERE email='seedy@sites.test';").trim();
const actor = sql("SELECT role FROM user_profiles WHERE user_id='local_seedy';").trim();
const hadProfile = sql("SELECT count(*) FROM user_profiles WHERE user_id='local_seedy';").trim() === "1";
try {
  sql("DELETE FROM members WHERE email='seedy@sites.test';");
  for (const path of paths) {
    assert.equal((await request(path, null, false)).status, 401, path + " anonymous");
    assert.equal((await request(path)).status, 403, path + " nonmember");
  }
  for (const path of ["/api/profile", "/api/inventory", "/api/golive", "/mcp", "/api/teams-settings"]) assert.equal((await request(path, {})).status, 403, path + " POST nonmember");
  sql("INSERT INTO members VALUES ('seedy@sites.test','test','test');");
  assert.equal((await request("/api/profile", { displayName: "Local tester" })).status, 200);
  sql("UPDATE user_profiles SET role='' WHERE user_id='local_seedy';");
  assert.equal((await request("/api/profile", { action: "add-member", email })).status, 403, "unassigned cannot invite");
  sql("UPDATE user_profiles SET role='QE' WHERE user_id='local_seedy';");
  assert.equal((await request("/api/profile", { action: "add-member", email })).status, 403, "QE cannot invite");
  sql("UPDATE user_profiles SET role='Manager' WHERE user_id='local_seedy';");
  assert.equal((await request("/api/profile", { action: "add-member", email: "invalid" })).status, 400);
  assert.equal((await request("/api/profile", { action: "add-member", email }, true, { Origin: "https://other.example" })).status, 403);
  const added = await request("/api/profile", { action: "add-member", email: "  " + email.toUpperCase() + "  " });
  assert.equal(added.status, 201); assert.equal(added.data.email, email);
  assert.equal((await request("/api/profile", { action: "add-member", email })).status, 409);
  assert.ok((await request("/api/profile?list=1")).data.pendingMembers.includes(email));
  assert.equal(sql(`SELECT added_by FROM members WHERE email='${email}';`).trim(), "local_seedy");
  // The same authenticated identity gains access immediately when its email is added.
  assert.equal((await request("/api/inventory")).status, 200);
  sql("DELETE FROM members WHERE email='seedy@sites.test';");
  assert.equal((await request("/api/profile", { displayName: "Cannot bypass" })).status, 403);
  assert.equal((await request("/api/inventory")).status, 403);
  console.log("Passed: anonymous/nonmember guards across every API and MCP, profile bypass blocked, Manager-only invitations, email validation/normalization, cross-origin rejection, duplicates, pending members and immediate membership checks.");
} finally {
  sql(`DELETE FROM members WHERE email IN ('${email}','seedy@sites.test');`);
  if (before) sql("INSERT INTO members VALUES ('seedy@sites.test','test','test');");
  if (hadProfile) sql(`UPDATE user_profiles SET role='${actor.replaceAll("'", "''")}' WHERE user_id='local_seedy';`);
  else sql("DELETE FROM user_profiles WHERE user_id='local_seedy';");
}
