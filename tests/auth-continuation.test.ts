import assert from "node:assert/strict";
import test from "node:test";

import { authCallbackUrl, authContinuationFromParams, authContinuationFromRedirectUrl, authContinuationPath } from "../src/lib/supabase/auth-continuation.ts";
import { clearPendingGeneratedPlan, readPendingGeneratedPlan, stagePendingGeneratedPlan } from "../src/lib/supabase/save-generated-plan.ts";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

test("generated save continuation is allowlisted", () => {
  const continuation = authContinuationFromParams(new URLSearchParams("continue=save&next=https://evil.example"));
  assert.deepEqual(continuation, { kind: "save" });
  assert.equal(authContinuationPath(continuation), "/collaborate?save=generated");
});

test("only UUID invitation tokens survive auth continuation", () => {
  const token = "123e4567-e89b-42d3-a456-426614174000";
  const continuation = authContinuationFromParams(new URLSearchParams(`continue=invite&invite=${token}`));
  assert.deepEqual(continuation, { kind: "invite", token });
  assert.equal(authContinuationPath(continuation), `/collaborate?invite=${token}`);
  assert.deepEqual(authContinuationFromParams(new URLSearchParams("continue=invite&invite=../../admin")), { kind: "account" });
});

test("unknown and external continuation input falls back to the account workspace", () => {
  assert.equal(authContinuationPath(authContinuationFromParams(new URLSearchParams("continue=https://evil.example"))), "/collaborate");
  assert.equal(authCallbackUrl("https://agreeaway.com", { kind: "account" }), "https://agreeaway.com/auth/callback?continue=account");
});

test("email confirmation accepts only an AgreeAway callback continuation", () => {
  assert.deepEqual(authContinuationFromRedirectUrl("https://agreeaway.com/auth/callback?continue=save", "https://agreeaway.com"), { kind: "save" });
  assert.deepEqual(authContinuationFromRedirectUrl("https://evil.example/auth/callback?continue=save", "https://agreeaway.com"), { kind: "account" });
  assert.deepEqual(authContinuationFromRedirectUrl("https://agreeaway.com/not-auth?continue=save", "https://agreeaway.com"), { kind: "account" });
});

test("pending generated plan survives a new browser tab and is cleared after save", () => {
  const localStorage = new MemoryStorage();
  let sessionStorage = new MemoryStorage();
  const browserGlobal = globalThis as unknown as { window: { localStorage: Storage; sessionStorage: Storage } };
  const previousWindow = browserGlobal.window;
  browserGlobal.window = { localStorage: localStorage as unknown as Storage, sessionStorage: sessionStorage as unknown as Storage };
  try {
    stagePendingGeneratedPlan("exact-plan-json");
    sessionStorage = new MemoryStorage();
    browserGlobal.window.sessionStorage = sessionStorage as unknown as Storage;
    assert.equal(readPendingGeneratedPlan(), "exact-plan-json");
    clearPendingGeneratedPlan();
    assert.equal(readPendingGeneratedPlan(), null);
  } finally {
    browserGlobal.window = previousWindow;
  }
});
