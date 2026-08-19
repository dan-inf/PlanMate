import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";

import { planCategorySchema, planSchema } from "@/lib/plan-schema";
import { enrichPlanWithGoogle } from "@/lib/google-maps";

export const runtime = "nodejs";

const requestSchema = z.object({
  category: planCategorySchema,
  prompt: z.string().trim().min(12).max(4000),
});
const generatedPlanSchema = planSchema.omit({ planningAssumptions: true });

const categoryNames = {
  date: "date",
  "personal-trip": "personal trip",
  "group-trip": "group trip",
  "team-offsite": "team offsite",
  "something-else": "custom real-world plan",
} as const;

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Plan generation is not configured yet." },
        { status: 503 },
      );
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.parse({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: zodTextFormat(generatedPlanSchema, "planmate_plan"),
        verbosity: "low",
      },
      input: [
        {
          role: "system",
          content: `You are PlanMate, an expert real-world planning engine. Turn the user's intent into a useful, geographically sensible, structured ${categoryNames[body.category]}.

Rules:
- Return a Plan, not general advice or a chat response.
- Respect every stated budget, time, participant, accessibility, and travel constraint.
- Treat every stated start and end point as inclusive. Create one Plan day for every calendar day or named day in the requested span, even when the final day only includes morning, checkout, or departure. A Friday-to-Sunday-morning request must return Friday, Saturday, and Sunday.
- Prefer a relaxed, realistic schedule with buffers over an overpacked day.
- Treat any "Additional planning context" as authoritative clarification. Family context must affect pacing, meal timing, transport buffers, lodging areas, backup options, and activity intensity—not merely the activity list.
- When children's ages or provider restrictions are unknown, avoid age-restricted or high-risk recommendations and say what needs confirmation. Never claim an activity is child-safe or age-eligible without verified provider information.
- For plans longer than one day, include lodging/check-in/check-out as accommodation items. Do not mix accommodation into the activity sequence conceptually: use accommodation only for the stay, check-in, checkout, and overnight context; use meal, activity, transportation, free-time, or nightlife for the daily itinerary.
- Do not invent real venue names, live availability, opening hours, exact travel times, prices, ratings, or booking URLs.
- Describe the kind of venue and best neighborhood/area so the server can find a strong real-place match. Mark it suggested.
- Make each recommendation concrete: state what the user will do, the specific area or desired venue, why it fits their constraints at that point in the itinerary, and what needs confirmation.
- Generic blocks are allowed only when intentional and clearly labeled, such as free time, rest/nap, or flexible neighborhood exploration. Do not disguise a generic filler block as a venue recommendation.
- Prefer a shorter, coherent plan over weak filler. Avoid redundant experiences and repetitive neighborhoods; give each multi-day itinerary a clear daily shape and geographic logic.
- Never use unsupported superlatives such as "best" or claim that something is open, accessible, suitable, safe, available, or within budget without supporting facts.
- Never mark a place Google verified or live availability yourself. Leave provider fields empty; the server verifies places after generation.
- Google verified means factual place fields came from Google, not endorsement or availability.
- Use 0 for unknown costs or travel minutes rather than inventing a number.
- Include 1-3 useful considerations, especially what needs confirmation.
- Keep titles warm, concise, and consumer-friendly.`,
        },
        { role: "user", content: body.prompt },
      ],
    });

    if (!response.output_parsed) {
      return NextResponse.json(
        { error: "PlanMate could not structure that plan. Please try again." },
        { status: 422 },
      );
    }

    const enriched = await enrichPlanWithGoogle(response.output_parsed);
    return NextResponse.json({
      plan: enriched.plan,
      maps: {
        placesVerified: enriched.placesVerified,
        routesCalculated: enriched.routesCalculated,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Tell PlanMate a little more about what you want to plan." },
        { status: 400 },
      );
    }

    console.error("Plan generation failed", error);
    return NextResponse.json(
      { error: "PlanMate hit a snag while building your plan. Try again in a moment." },
      { status: 500 },
    );
  }
}
