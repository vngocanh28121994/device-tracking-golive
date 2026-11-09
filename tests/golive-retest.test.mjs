// Which tickets the "new build" dialog offers, and which it ticks by default.
import assert from "node:assert/strict";
import { retestChoices } from "../app/lib/golive-acceptance.ts";

const done = { id: 1, doneAt: "2026-11-09T10:00:00.000Z", failedAt: null };
const failed = { id: 2, doneAt: null, failedAt: "2026-11-09T10:01:00.000Z" };
const open = { id: 3, doneAt: null, failedAt: null };
const alsoOpen = { id: 4, doneAt: null, failedAt: null };
const tickets = [done, failed, open, alsoOpen];
const pick = input => retestChoices({ tickets, appFailedIds: [], manual: false, tickedTicketIds: [], ...input });

// A ticket with no result and no tick has nothing to carry over: it is not on the list.
assert.deepEqual(pick({}), [{ id: 1, preselected: false }, { id: 2, preselected: true }]);

// A ticket being tested is on the list and ticked by default: left out, its ticks would count for the new build.
assert.deepEqual(pick({ tickedTicketIds: [3] }), [
  { id: 1, preselected: false },
  { id: 2, preselected: true },
  { id: 3, preselected: true },
]);

// Ticks on a ticket that already has a result change nothing: Done is not preselected, failed stays preselected.
assert.deepEqual(pick({ tickedTicketIds: [1, 2] }), [{ id: 1, preselected: false }, { id: 2, preselected: true }]);

// A ticket that failed on an earlier build of this release is preselected too.
assert.deepEqual(pick({ appFailedIds: [1] }), [{ id: 1, preselected: true }, { id: 2, preselected: true }]);

// A manual release is one checklist per QE, so a failure there is not reason enough to preselect;
// a half-finished checklist still is.
assert.deepEqual(pick({ manual: true, appFailedIds: [1], tickedTicketIds: [3] }), [
  { id: 1, preselected: false },
  { id: 2, preselected: false },
  { id: 3, preselected: true },
]);

console.log("Passed: retest candidates include tickets being tested and preselect the right ones.");
