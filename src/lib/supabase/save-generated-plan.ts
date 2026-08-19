import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Plan, PlanCategory } from "@/lib/plan-schema";

export const pendingPlanStorageKey = "planmate.pending-generated-plan";

export type PendingGeneratedPlan = {
  plan: Plan;
  category: PlanCategory;
  prompt: string;
};

function parseTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:00`;
}

export async function persistGeneratedPlan(
  supabase: SupabaseClient,
  user: User,
  pending: PendingGeneratedPlan,
) {
  const { plan, category, prompt } = pending;
  const sourceSnapshot = JSON.stringify({ version: 1, prompt, category, generatedPlan: plan });
  const { data: createdPlan, error: planError } = await supabase
    .from("plans")
    .insert({
      owner_id: user.id,
      title: plan.title,
      plan_type: category,
      description: plan.summary,
      primary_location: plan.location,
      participant_count: plan.partySize,
      budget_per_person: plan.estimatedTotalPerPerson,
      currency: plan.currency,
      status: "active",
      source_prompt: sourceSnapshot,
    })
    .select("id")
    .single();
  if (planError || !createdPlan) throw new Error(planError?.message ?? "Could not save this plan.");

  try {
    for (const [dayIndex, day] of plan.days.entries()) {
      const { data: createdDay, error: dayError } = await supabase
        .from("plan_days")
        .insert({ plan_id: createdPlan.id, day_index: dayIndex, label: day.label, plan_date: /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : null })
        .select("id")
        .single();
      if (dayError || !createdDay) throw new Error(dayError?.message ?? "Could not save a plan day.");
      const { error: itemError } = await supabase.from("plan_items").insert(day.items.map((item, sortOrder) => ({
        plan_id: createdPlan.id,
        day_id: createdDay.id,
        sort_order: sortOrder,
        start_time: parseTime(item.time),
        item_type: item.type,
        title: item.title,
        description: item.description,
        location_name: item.location,
        estimated_cost_per_person: item.costPerPerson,
        travel_minutes: item.travelMinutes,
        travel_mode: item.travelMode ?? null,
        route_distance_meters: item.routeDistanceMeters ?? null,
        booking_status: item.status,
        verification_status: item.verification,
          booking_url: item.bookingUrl,
          google_maps_url: item.googleMapsUrl ?? null,
          website_url: item.websiteUrl ?? null,
          place_id: item.placeId ?? null,
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
          business_status: item.businessStatus ?? null,
          rating: item.rating ?? null,
          user_rating_count: item.userRatingCount ?? null,
          price_level: item.priceLevel ?? null,
          regular_opening_hours: item.regularOpeningHours ?? null,
          match_reason: item.matchReason ?? null,
      })));
      if (itemError) throw new Error(itemError.message);
    }
    return createdPlan.id as string;
  } catch (error) {
    await supabase.from("plans").delete().eq("id", createdPlan.id);
    throw error;
  }
}
