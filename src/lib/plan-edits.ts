import type { Plan, PlanItem } from "@/lib/plan-schema";

export function replacePlanItem(plan: Plan, dayIndex: number, itemId: string, replacement: PlanItem) {
  const updated = structuredClone(plan);
  const itemIndex = updated.days[dayIndex]?.items.findIndex((item) => item.id === itemId) ?? -1;
  if (itemIndex < 0) return null;
  const original = updated.days[dayIndex].items[itemIndex];
  updated.days[dayIndex].items[itemIndex] = { ...replacement, id: original.id, time: original.time };
  return updated;
}
