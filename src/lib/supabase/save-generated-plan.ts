import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Plan, PlanCategory } from "@/lib/plan-schema";
import type { PlanningAssumption, PlanningIntent } from "@/lib/planning-intake";

export const pendingPlanStorageKey = "agreeaway.pending-generated-plan";
const legacyPendingPlanStorageKey = "planmate.pending-generated-plan";
const pendingPlanHandoffKey = "agreeaway.pending-generated-plan-handoff";
const pendingSaveKey = "agreeaway.pending-save-key";
const handoffLifetimeMs = 2 * 60 * 60 * 1000;

type PendingHandoff = { value: string; createdAt: number };

export function stagePendingGeneratedPlan(value: string) {
  window.sessionStorage.setItem(pendingPlanStorageKey, value);
  window.localStorage.setItem(pendingPlanHandoffKey, JSON.stringify({ value, createdAt: Date.now() } satisfies PendingHandoff));
  if (!window.localStorage.getItem(pendingSaveKey)) window.localStorage.setItem(pendingSaveKey, crypto.randomUUID());
}

export function clearPendingGeneratedPlan() {
  window.sessionStorage.removeItem(pendingPlanStorageKey);
  window.localStorage.removeItem(pendingPlanHandoffKey);
  window.localStorage.removeItem(pendingSaveKey);
}

export function readPendingGeneratedPlan() {
  const current = window.sessionStorage.getItem(pendingPlanStorageKey);
  if (current) return current;
  const handoff = window.localStorage.getItem(pendingPlanHandoffKey);
  if (handoff) {
    try {
      const parsed = JSON.parse(handoff) as PendingHandoff;
      if (typeof parsed.value === "string" && Date.now() - parsed.createdAt <= handoffLifetimeMs) {
        window.sessionStorage.setItem(pendingPlanStorageKey, parsed.value);
        return parsed.value;
      }
    } catch { /* discard invalid handoff data below */ }
    window.localStorage.removeItem(pendingPlanHandoffKey);
    window.localStorage.removeItem(pendingSaveKey);
  }
  const legacy = window.sessionStorage.getItem(legacyPendingPlanStorageKey);
  if (!legacy) return null;
  window.sessionStorage.setItem(pendingPlanStorageKey, legacy);
  window.sessionStorage.removeItem(legacyPendingPlanStorageKey);
  return legacy;
}

export type PendingGeneratedPlan = {
  plan: Plan;
  category: PlanCategory;
  prompt: string;
  intent?: PlanningIntent;
  assumptions?: PlanningAssumption[];
};

export async function persistGeneratedPlan(
  supabase: SupabaseClient,
  user: User,
  pending: PendingGeneratedPlan,
) {
  const { plan, category, prompt } = pending;
  const sourceSnapshot = JSON.stringify({ version: 2, prompt, category, intent: pending.intent, assumptions: pending.assumptions, generatedPlan: plan });
  const storageKey = `agreeaway.save-key:${user.id}`;
  const legacyStorageKey = `planmate.save-key:${user.id}`;
  let saveKey = window.sessionStorage.getItem(storageKey);
  if (!saveKey) {
    saveKey = window.sessionStorage.getItem(legacyStorageKey);
    if (saveKey) {
      window.sessionStorage.setItem(storageKey, saveKey);
      window.sessionStorage.removeItem(legacyStorageKey);
    }
  }
  if (!saveKey) {
    saveKey = window.localStorage.getItem(pendingSaveKey);
  }
  if (!saveKey) {
    saveKey = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, saveKey);
    window.localStorage.setItem(pendingSaveKey, saveKey);
  }
  void supabase.rpc("track_product_event", { event_name: "free_creation_save_started", properties: {} });
  const { data, error } = await supabase.rpc("persist_generated_plan", {
    payload: { plan, category, sourceSnapshot },
    save_key: saveKey,
  });
  if (error || !data) {
    void supabase.rpc("track_product_event", { event_name: "free_creation_consume_failed", properties: { stage: "persist" } });
    throw new Error(error?.message ?? "Could not save this plan.");
  }
  window.sessionStorage.removeItem(storageKey);
  window.localStorage.removeItem(pendingSaveKey);
  return data as string;
}
