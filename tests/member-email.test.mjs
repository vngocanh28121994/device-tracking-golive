import assert from "node:assert/strict";
import { memberEmail } from "../app/lib/member-email.ts";

assert.equal(memberEmail("  Toan.Phung@OUTLOOK.COM  "), "toan.phung@outlook.com");
assert.equal(memberEmail("person+qe@example.com"), "person+qe@example.com");
for (const input of [null, {}, 123, "", "invalid", "a b@example.com", "a@example..com", "<a>@example.com", "a@-example.com", "a".repeat(250) + "@example.com"]) assert.equal(memberEmail(input), null, String(input));
console.log("Member email validation: normalization, aliases, invalid types, syntax and length passed.");
