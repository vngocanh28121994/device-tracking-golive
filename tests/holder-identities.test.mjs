import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("legacy devices inherit an unambiguous account and current name", () => {
  const migration = readFileSync(new URL("../drizzle/0010_sync-holder-identities.sql", import.meta.url), "utf8");
  const result = spawnSync("sqlite3", [":memory:"], {
    encoding: "utf8",
    input: `
      CREATE TABLE user_profiles (user_id TEXT PRIMARY KEY, display_name TEXT);
      CREATE TABLE devices (id TEXT PRIMARY KEY, holder TEXT, holder_user_id TEXT);
      INSERT INTO user_profiles VALUES ('owner', 'New name'), ('other', 'Other name');
      INSERT INTO devices VALUES
        ('a51', 'Old name', 'owner'), ('a52', 'Old name', NULL),
        ('manual', 'Old name', ''), ('unknown', 'Unknown', NULL),
        ('conflict1', 'Ambiguous', 'owner'), ('conflict2', 'Ambiguous', 'other'),
        ('ambiguous', 'Ambiguous', NULL);
      ${migration}
      SELECT id || '|' || holder || '|' || coalesce(holder_user_id, 'NULL') FROM devices ORDER BY id;
    `,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "a51|New name|owner", "a52|New name|owner", "ambiguous|Ambiguous|NULL",
    "conflict1|New name|owner", "conflict2|Other name|other",
    "manual|Old name|", "unknown|Unknown|NULL",
  ]);
});
