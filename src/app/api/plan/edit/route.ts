import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";

import { enrichPlanWithGoogle, findAlternativePlaces } from "@/lib/google-maps";
import { planItemSchema, planSchema } from "@/lib/plan-schema";

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
]);

export async function POST(request: Request) {
  try {
    const body = editRequestSchema.parse(await request.json());
    const day = body.plan.days[body.dayIndex];
    if (!day) return NextResponse.json({ error: "That day is no longer available." }, { status: 400 });

    if (body.operation === "alternatives") {
      const item = day.items.find((candidate) => candidate.id === body.itemId);
      if (!item) return NextResponse.json({ error: "That plan item is no longer available." }, { status: 400 });
      const alternatives = await findAlternativePlaces(body.plan, item, body.instruction);
      return NextResponse.json({ alternatives });
    }

    if (body.operation === "replace") {
      const updated = structuredClone(body.plan);
      const itemIndex = updated.days[body.dayIndex]?.items.findIndex((item) => item.id === body.itemId) ?? -1;
      if (itemIndex < 0) return NextResponse.json({ error: "That plan item is no longer available." }, { status: 400 });
      const original = updated.days[body.dayIndex].items[itemIndex];
      updated.days[body.dayIndex].items[itemIndex] = { ...body.replacement, id: original.id, time: original.time };
      const enriched = await enrichPlanWithGoogle(updated);
      return NextResponse.json({ plan: enriched.plan });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Plan editing is not configured yet." }, { status: 503 });
    }

    const operation = body.operation === "remove"
      ? `Remove only the item with id ${body.itemId}. Do not remove anything else.`
      : `Insert one new step after item index ${body.insertAfterIndex ?? -1} on day index ${body.dayIndex}. The user wants: ${body.instruction}.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const makeEditRequest = () => openai.responses.parse({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(planSchema, "planmate_edited_plan"), verbosity: "low" },
      input: [
        {
          role: "system",
          content: `You are PlanMate's precise itinerary editor. Return the complete updated Plan object.

Rules:
- Apply exactly the requested edit and preserve every unrelated day, item, constraint, and piece of metadata.
- Reflow the edited day's times into a realistic chronological sequence. Account for travel and natural buffers.
- Keep stable ids for every existing item. Give a newly added item a new short unique id.
- Recalculate budget lines and estimatedTotalPerPerson when the edit changes cost, using 0 for unknown costs.
- Do not invent live venue names, addresses, prices, availability, ratings, booking URLs, or travel times.
- New place-based items should describe the desired venue type and area, use needs-live-verification, and leave place data empty. Google will verify places after this step.
- Keep accommodation separate from activities on multi-day plans.
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
      return NextResponse.json({ error: "PlanMate could not apply that change." }, { status: 422 });
    }
    const enriched = await enrichPlanWithGoogle(response.output_parsed);
    return NextResponse.json({ plan: enriched.plan });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "That edit needs a little more detail." }, { status: 400 });
    }
    console.error("Plan editing failed", error);
    return NextResponse.json({ error: "PlanMate could not update the plan. Try again." }, { status: 500 });
  }
}
