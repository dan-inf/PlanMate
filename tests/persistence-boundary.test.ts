import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260821113000_secure_generated_plan_persistence.sql", import.meta.url), "utf8");
const saveClient = readFileSync(new URL("../src/lib/supabase/save-generated-plan.ts", import.meta.url), "utf8");

test("generated-plan persistence uses one authenticated security boundary", () => {
  assert.match(migration, /function public\.persist_generated_plan\(payload jsonb, save_key text\)[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /if \(select auth\.uid\(\)\) is null/i);
  assert.match(migration, /revoke all on schema private from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function private\.persist_generated_plan\(jsonb, text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.persist_generated_plan\(jsonb, text\) to authenticated/i);
  assert.doesNotMatch(migration, /grant usage on schema private/i);
});

test("trigger-only private routines are not directly executable", () => {
  for (const routine of ["add_owner_membership", "handle_new_user", "reopen_plan_after_item_change"]) {
    assert.match(migration, new RegExp(`revoke all on function private\\.${routine}\\(\\) from public, anon, authenticated`, "i"));
  }
});

test("save failures expose a stable recovery message rather than database text", () => {
  assert.match(saveClient, /Your draft is still safe—try again/);
  assert.doesNotMatch(saveClient, /throw new Error\(error\?\.message/);
});
