import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260819210000_dashboard_entitlements.sql", import.meta.url), "utf8");

test("signup creation grant is idempotent", () => {
  assert.match(migration, /'signup:' \|\| new\.id::text/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
});

test("save and entitlement consumption share one transaction boundary", () => {
  assert.match(migration, /function private\.persist_generated_plan/);
  assert.match(migration, /insert into public\.plans/);
  assert.match(migration, /insert into public\.entitlement_usage/);
  assert.match(migration, /insert into public\.generated_plan_saves/);
});

test("idempotent retries return the original plan", () => {
  assert.match(migration, /select plan_id into existing_plan from public\.generated_plan_saves/);
  assert.match(migration, /if existing_plan is not null then return existing_plan/);
});

test("billing storage is provider-neutral and Stripe is not a runtime dependency", () => {
  assert.match(migration, /source in \('signup','promotion','admin','stripe_subscription','stripe_purchase'\)/);
  assert.doesNotMatch(migration, /STRIPE_SECRET_KEY/);
});

test("normal clients cannot mutate billing or save audit tables", () => {
  assert.match(migration, /revoke all on public\.billing_provider_events from public, anon, authenticated/);
  assert.match(migration, /revoke all on public\.generated_plan_saves from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*entitlement_/i);
});
