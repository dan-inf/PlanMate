import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";

import { enrichPlanWithGoogle, findAlternativePlaces, parseReplacementIntent } from "@/lib/google-maps";
import { planItemSchema, planSchema } from "@/lib/plan-schema";
import { mergeAddedPlanItem, replacePlanItem } from "@/lib/plan-edits";

export const runtime = "nodejs";

const editRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("alternatives"),
    plan: planSchema,
    dayIndex: z.number().int().nonnegative(),
    itemId: z.string().min(1),
    instruction: z.string().trim().min(3).max(500),
  }),
  z.object({
    operation: z.literal("replace"),
    plan: planSchema,
    dayIndex: z.number().int().nonnegative(),
    itemId: z.string().min(1),
    replacement: planItemSchema,
  }),
  z.object({
    operation: z.enum(["add", "remove"]),
    plan: planSchema,
    dayIndex: z.number().int().nonnegative(),
    itemId: z.string().min(1).optional(),
    insertAfterIndex: z.number().int().min(-1).optional(),
    instruction: z.string().trim().min(3).max(500).optional(),
  }),
  z.object({
    operation: z.literal("context"),
    plan: planSchema,
    instruction: z.string().trim().min(3).max(2000),
  }),
]);
const editedPlanSchema = planSchema.omit({ planningAssumptions: true });

export async function POST(request: Request) {
  try {
    const body = editRequestSchema.parse(await request.json());
    const day = "dayIndex" in body ? body.plan.days[body.dayIndex] : null;
    if ("dayIndex" in body && !day) return NextResponse.json({ error: "That day is no longer available." }, { status: 400 });

    if (body.operation === "alternatives") {
      if (!day) return NextResponse.json({ error: "That day is no longer available." }, { status: 400 });
      const item = day.items.find((candidate) => candidate.id === body.itemId);
      if (!item) return NextResponse.json({ error: "That plan item is no longer available." }, { status: 400 });
      const replacementIntent = parseReplacementIntent(body.instruction, item);
      if (replacementIntent.needsClarification) {
        return NextResponse.json({
          alternatives: [],
          needsClarification: true,
          suggestedCategories: ["Something outdoors", "Live music or a show", "A bookstore or market", "A local landmark"],
        });
      }
      const alternatives = await findAlternativePlaces(body.plan, item, body.instruction);
      return NextResponse.json({ alternatives });
    }

    if (body.operation === "replace") {
      const updated = replacePlanItem(body.plan, body.dayIndex, body.itemId, body.replacement);
      if (!updated) return NextResponse.json({ error: "That plan item is no longer available." }, { status: 400 });
      const enriched = await enrichPlanWithGoogle(updated);
      return NextResponse.json({ plan: enriched.plan });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Plan editing is not configured yet." }, { status: 503 });
    }

    const operation = body.operation === "context" ? `Apply this corrected planning context: ${body.instruction}. Update only affected timings, pacing, suitability, costs, and recommendations; preserve unrelated selections and every stable id.` : body.operation === "remove"
      ? `Remove only the item with id ${body.itemId}. Do not remove anything else.`
      : `Insert one new step after item index ${body.insertAfterIndex ?? -1} on day index ${body.dayIndex}. The user wants: ${body.instruction}.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const makeEditRequest = () => openai.responses.parse({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(editedPlanSchema, "agreeaway_edited_plan"), verbosity: "low" },
      input: [
        {
          role: "system",
          content: `You are AgreeAway's precise itinerary editor. Return the complete updated Plan object.

Rules:
- Apply exactly the requested edit and preserve every unrelated day, item, constraint, and piece of metadata.
- Reflow the edited day's times into a realistic chronological sequence. Account for travel and natural buffers.
- Keep stable ids for every existing item. Give a newly added item a new short unique id.
- Recalculate budget lines and estimatedTotalPerPerson when the edit changes cost, using 0 for unknown costs.
- Do not invent live venue names, addresses, prices, availability, ratings, booking URLs, or travel times.
- New place-based items should describe the desired venue type and area, use suggested, and leave provider data empty. Google may verify a strong match after this step.
- Keep accommodation separate from activities on multi-day plans.
- Apply family composition across pacing, meal timing, transport buffers, lodging area, backups, and activity intensity. Never claim child safety or eligibility without verified provider information.
- Every changed recommendation must be concrete and explain its fit. Preserve intentional rest/free-time blocks as generic rather than attempting to turn them into arbitrary venues.
- Avoid redundant experiences, geographic backtracking, weak filler, and unsupported claims about opening, accessibility, suitability, safety, availability, or budget fit.
- Use 0 for unknown travel time or cost.`,
        },
        {
          role: "user",
          content: `${operation}\n\nCurrent Plan JSON:\n${JSON.stringify(body.plan)}`,
        },
      ],
    });
    let response;
    try {
      response = await makeEditRequest();
    } catch (error) {
      if (!(error instanceof OpenAI.APIError) || !error.status || error.status < 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      response = await makeEditRequest();
    }
    if (!response.output_parsed) {
      return NextResponse.json({ error: "AgreeAway could not apply that change." }, { status: 422 });
    }
    const parsedPlan = {
      ...response.output_parsed,
      planningAssumptions: body.plan.planningAssumptions,
    };
    const safePlan = body.operation === "add"
      ? mergeAddedPlanItem(body.plan, parsedPlan, body.dayIndex, body.insertAfterIndex ?? -1)
      : parsedPlan;
    if (!safePlan) {
      return NextResponse.json({ error: "AgreeAway could not identify the new stop. Try describing it more specifically." }, { status: 422 });
    }
    if (body.operation === "add") {
      const originalIds = new Set(body.plan.days[body.dayIndex].items.map((item) => item.id));
      const inserted = safePlan.days[body.dayIndex].items.find((item) => !originalIds.has(item.id));
      if (!inserted) return NextResponse.json({ error: "AgreeAway could not identify the new stop." }, { status: 422 });
      const alternatives = await findAlternativePlaces(safePlan, inserted, body.instruction ?? inserted.title);
      return NextResponse.json({ plan: safePlan, alternatives, addedItemId: inserted.id });
    }
    const enriched = await enrichPlanWithGoogle(safePlan);
    return NextResponse.json({ plan: enriched.plan });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "That edit needs a little more detail." }, { status: 400 });
    }
    console.error("Plan editing failed", error);
    return NextResponse.json({ error: "AgreeAway could not update the plan. Try again." }, { status: 500 });
  }
}
