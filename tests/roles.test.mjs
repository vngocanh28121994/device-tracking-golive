import assert from "node:assert/strict";
import { canManageAccountRoles, validRole } from "../app/lib/roles.ts";

assert.equal(canManageAccountRoles("QE", "vngocanh281219941@gmail.com"), true);
assert.equal(canManageAccountRoles("", "vngocanh281219941@gmail.com"), true);
assert.equal(canManageAccountRoles("Manager", "manager@example.invalid"), true);
assert.equal(canManageAccountRoles("QE", "qe@example.invalid"), false);
assert.equal(canManageAccountRoles("DEV", "dev@example.invalid"), false);
assert.equal(validRole("QE"), true);
assert.equal(validRole("Admin"), false);
console.log("Role permissions: administrator keeps access independently of work role; ordinary QE/DEV cannot assign roles.");
