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

// TEMPORARY: STATISTIC_OPEN_TO_ALL is on, so every signed-in member reaches the report.
// When that override goes back to false, QE/DEV/PM and a role-less account must be false again.
import { canViewStatistic } from "../app/lib/roles.ts";
assert.equal(canViewStatistic("Manager", "manager@example.invalid"), true);
assert.equal(canViewStatistic("QE", "vngocanh281219941@gmail.com"), true);
assert.equal(canViewStatistic("QE", "qe@example.invalid"), true);
assert.equal(canViewStatistic("", "pm@example.invalid"), true);
console.log("Statistic screen: temporarily open to every signed-in member.");
