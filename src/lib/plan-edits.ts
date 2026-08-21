import type { Plan, PlanItem } from "@/lib/plan-schema";

export function replacePlanItem(plan: Plan, dayIndex: number, itemId: string, replacement: PlanItem) {
  const updated = structuredClone(plan);
  const itemIndex = updated.days[dayIndex]?.items.findIndex((item) => item.id === itemId) ?? -1;
  if (itemIndex < 0) return null;
  const original = updated.days[dayIndex].items[itemIndex];
  updated.days[dayIndex].items[itemIndex] = { ...replacement, id: original.id, time: original.time };
  return updated;
}

export function mergeAddedPlanItem(plan: Plan, editedPlan: Plan, dayIndex: number, insertAfterIndex: number) {
  const sourceDay = plan.days[dayIndex];
  const editedDay = editedPlan.days[dayIndex];
  if (!sourceDay || !editedDay) return null;

  const existingIds = new Set(sourceDay.items.map((item) => item.id));
  const inserted = editedDay.items.find((item) => !existingIds.has(item.id));
  if (!inserted) return null;

  const editedById = new Map(editedDay.items.map((item) => [item.id, item]));
  const preservedItems = sourceDay.items.map((item) => {
    const reflowed = editedById.get(item.id);
    if (!reflowed) return item;
    return {
      ...item,
      time: reflowed.time,
      travelMinutes: reflowed.travelMinutes,
      travelMode: reflowed.travelMode,
    };
  });
  preservedItems.splice(Math.min(Math.max(insertAfterIndex + 1, 0), preservedItems.length), 0, inserted);

  return {
    ...plan,
    budget: editedPlan.budget,
    estimatedTotalPerPerson: editedPlan.estimatedTotalPerPerson,
    days: plan.days.map((day, index) => index === dayIndex ? { ...day, items: preservedItems } : day),
  };
}
