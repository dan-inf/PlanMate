import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Plan, PlanCategory } from "@/lib/plan-schema";
import type { PlanningAssumption, PlanningIntent } from "@/lib/planning-intake";

export const pendingPlanStorageKey = "planmate.pending-generated-plan";

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
  const storageKey = `planmate.save-key:${user.id}`;
  let saveKey = window.sessionStorage.getItem(storageKey);
  if (!saveKey) {
    saveKey = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, saveKey);
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
  return data as string;
}
