import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ticketsFromCsv, releaseNameFromCsv } from "../app/lib/golive.ts";

const base = process.argv[2] || "http://localhost:5181";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error("Use a local preview, never production.");
const csv = process.argv[3] ? readFileSync(process.argv[3], "utf8") : "\uFEFFIssue key,Summary,Custom field (Quality Engineer),Fix versions\n" + Array.from({ length: 33 }, (_, i) => `TEST-${i + 1},Ticket ${i + 1},Tester,Test release`).join("\n");
const tickets = ticketsFromCsv(csv);
assert.ok(tickets.length > 10, "Use enough tickets to exercise multiple inserts.");
async function request(body, query = "") {
  const response = await fetch(base + "/api/golive" + query, { headers: { Cookie: "__sites_local_auth=1", "Content-Type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
let releaseId;
try {
  const result = await request({ action: "import", name: "Import regression " + crypto.randomUUID(), tickets });
  assert.equal(result.status, 200, result.data.error);
  releaseId = result.data.releaseId;
  assert.equal(result.data.count, tickets.length);
  const loaded = await request(null, "?release=" + releaseId);
  assert.equal(loaded.status, 200);
  const expected = new Map(tickets.map(item => [item.issueKey, item]));
  assert.equal(loaded.data.tickets.length, tickets.length);
  for (const item of loaded.data.tickets) {
    assert.equal(item.summary, expected.get(item.issueKey).summary);
    assert.equal(item.assignee, expected.get(item.issueKey).assignee);
  }
  console.log(`Passed: CSV ${tickets.length} tickets imported and read back with original keys, summaries and testers; Fix Version: ${releaseNameFromCsv(csv)}`);
} finally {
  if (releaseId) assert.equal((await request({ action: "delete-release", releaseId })).status, 200);
}
