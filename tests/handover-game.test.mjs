// Run: node --experimental-strip-types tests/handover-game.test.mjs
import assert from 'node:assert/strict';
import { catchesDevice, clampBasket, movingDeviceX } from '../app/lib/handover-game.ts';
assert.equal(clampBasket(-100),16);assert.equal(clampBasket(200),84);assert.equal(clampBasket(50),50);
assert.equal(catchesDevice(20,20),true);
assert.equal(catchesDevice(20,32),true);
assert.equal(catchesDevice(20,32.01),false);
assert.equal(catchesDevice(80,68),true);
assert.equal(catchesDevice(80,50),false);
for (const target of [20,28,72,80]) assert.ok(catchesDevice(target,clampBasket(target)));
console.log('Handover game: collision edges, misses and reachable targets passed');

for (const start of [20,24,28,72,76,80]) {
  assert.ok(Math.abs(movingDeviceX(start,0,1)-start)<1e-9);
  for(const direction of [-1,1]) {
    for(let ms=0;ms<=3200;ms+=10) {
      const x=movingDeviceX(start,ms,direction);
      assert.ok(x>=20 && x<=80);
      assert.ok(catchesDevice(x,clampBasket(x)));
    }
  }
}
const x=movingDeviceX(24,1000,1);
assert.ok(Math.abs(x-24)>12);
assert.equal(catchesDevice(x,24),false);
assert.equal(catchesDevice(x,x),true);
console.log('Horizontal path: moving target collision and reachable bounds passed');
