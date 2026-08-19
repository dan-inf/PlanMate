import { z } from "zod";

export const planCategorySchema = z.enum([
  "date",
  "personal-trip",
  "group-trip",
  "team-offsite",
  "something-else",
]);

export const planItemSchema = z.object({
  id: z.string(),
  time: z.string(),
  title: z.string(),
  type: z.enum([
    "meal",
    "activity",
    "transportation",
    "accommodation",
    "meeting",
    "free-time",
    "nightlife",
    "custom",
  ]),
  description: z.string(),
  location: z.string(),
  costPerPerson: z.number(),
  travelMinutes: z.number().int(),
  status: z.enum(["idea", "selected", "needs-booking", "booked"]),
  verification: z.enum(["planning-placeholder", "needs-live-verification", "verified"]),
  bookingUrl: z.string().nullable(),
  placeId: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

export const planDaySchema = z.object({
  label: z.string(),
  date: z.string(),
  items: z.array(planItemSchema),
});

export const budgetLineSchema = z.object({
  category: z.string(),
  total: z.number(),
  perPerson: z.number(),
});

export const planSchema = z.object({
  title: z.string(),
  summary: z.string(),
  location: z.string(),
  dateLabel: z.string(),
  partySize: z.number().int(),
  currency: z.string(),
  budgetLabel: z.string(),
  estimatedTotalPerPerson: z.number(),
  days: z.array(planDaySchema),
  budget: z.array(budgetLineSchema),
  considerations: z.array(z.string()),
});

export type PlanCategory = z.infer<typeof planCategorySchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
