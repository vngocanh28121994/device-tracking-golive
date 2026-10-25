// Run: node --experimental-strip-types tests/handover-game.test.mjs
import assert from 'node:assert/strict';
import { catchesDevice, clampBasket } from '../app/lib/handover-game.ts';
assert.equal(clampBasket(-100),16);assert.equal(clampBasket(200),84);assert.equal(clampBasket(50),50);
assert.equal(catchesDevice(20,20),true);
assert.equal(catchesDevice(20,32),true);
assert.equal(catchesDevice(20,32.01),false);
assert.equal(catchesDevice(80,68),true);
assert.equal(catchesDevice(80,50),false);
for (const target of [20,28,72,80]) assert.ok(catchesDevice(target,clampBasket(target)));
console.log('Handover game: collision edges, misses and reachable targets passed');
