// Run: node --experimental-strip-types tests/history-dates.test.mjs
import assert from 'node:assert/strict';
import { historyDateBounds } from '../app/lib/history-dates.ts';
assert.deepEqual(historyDateBounds('', ''), {from: undefined, until: undefined});
assert.deepEqual(historyDateBounds('2026-10-25', '2026-10-25'), {from: '2026-10-24T17:00:00.000Z', until: '2026-10-25T17:00:00.000Z'});
assert.equal(historyDateBounds('', '2024-02-29').until, '2024-02-29T17:00:00.000Z');
assert.equal(historyDateBounds('2026-01-01', '').from, '2025-12-31T17:00:00.000Z');
for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00', '25/10/2026', '2026-1-01', 'not-a-date']) {
  assert.throws(() => historyDateBounds(invalid, ''));
  assert.throws(() => historyDateBounds('', invalid));
}
assert.throws(() => historyDateBounds('2026-10-26','2026-10-25'));
console.log('History date bounds: passed');
