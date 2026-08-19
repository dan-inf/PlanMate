import { NextResponse } from "next/server";

import { enrichPlanWithGoogle } from "@/lib/google-maps";
import type { Plan } from "@/lib/plan-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const probePlan: Plan = {
  title: "Maps integration probe",
  summary: "Temporary production verification.",
  location: "San Francisco, California",
  dateLabel: "Friday",
  partySize: 2,
  currency: "USD",
  budgetLabel: "$300 total",
  estimatedTotalPerPerson: 150,
  days: [{
    label: "Friday",
    date: "Friday",
    items: [
      { id: "probe-dinner", time: "6:00 PM", title: "Italian dinner", type: "meal", description: "Dinner near the theater.", location: "North Beach", costPerPerson: 75, travelMinutes: 0, status: "idea", verification: "needs-live-verification", bookingUrl: null },
      { id: "probe-music", time: "8:00 PM", title: "Live music", type: "nightlife", description: "Live music nearby.", location: "North Beach", costPerPerson: 40, travelMinutes: 0, status: "idea", verification: "needs-live-verification", bookingUrl: null },
    ],
  }],
  budget: [],
  considerations: [],
};

export async function GET() {
  const result = await enrichPlanWithGoogle(probePlan);
  return NextResponse.json({
    placesVerified: result.placesVerified,
    routesCalculated: result.routesCalculated,
    items: result.plan.days[0].items.map((item) => ({
      title: item.title,
      verification: item.verification,
      hasMapsUrl: Boolean(item.bookingUrl),
      travelMinutes: item.travelMinutes,
    })),
  });
}
