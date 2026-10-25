// Run: node --experimental-strip-types tests/avatar.test.mjs
import assert from 'node:assert/strict';
import { decodeAvatar, avatarUrl } from '../app/lib/avatar.ts';
const sample = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(255,216,255,0,255,217));
assert.equal(decodeAvatar(sample).length,6);
assert.equal(decodeAvatar(''),null);
assert.equal(avatarUrl(''),'');
assert.equal(avatarUrl('test.jpg'),'/api/avatar/test.jpg');
for(const invalid of [null,123,'https://example.com/photo.jpg','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8=',sample.slice(0,-4),'data:image/jpeg;base64,'+'A'.repeat(90000)])assert.throws(()=>decodeAvatar(invalid));
console.log('Avatar validation: allowed data, deletion, invalid types and size limits passed');
