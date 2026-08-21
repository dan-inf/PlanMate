import type { PlanCategory } from "@/lib/plan-schema";

export type IntakeField = "timing" | "location" | "duration" | "travelers" | "childrenAges" | "budget" | "priorities";
export type ClarificationQuestion = { id: IntakeField; label: string; options: string[]; placeholder: string };
export type PlanningAssumption = { label: string; value: string; assumed: boolean };

export type PlanningIntent = {
  timing?: string; location?: string; duration?: string; travelers?: string; childrenAges?: string;
  childrenState: "positive" | "negative" | "unknown";
  budget?: string; priorities?: string; startingPoint?: string; constraints: string[];
};

const monthOrSeason = /\b(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter|flexible dates?|this (?:friday|saturday|sunday|weekend)|\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2})\b/i;
const durationPattern = /\b(?:(?:about|around|roughly|approximately|approx\.?|nearly)\s+)?(?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[- ]?\s*(?:day|days|night|nights|week|weeks)\b|\bweekend\b|\bfrom\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:to|until|through)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
const travelerPattern = /\b(?:solo(?:\s+(?:trip|travel|traveler|travelling|traveling))?|travel(?:l)?ing alone|by myself|on my own|just me|couple|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(?:adult|adults|people|person|friends|travelers|guests|team members?))\b/i;
const positiveFamilyPattern = /\b(?:with|bringing|and our|our)\s+(?:the\s+)?(?:kids?|children|family|toddler|teenagers?|teens?)\b|\bfamily(?:\s+trip|\s+vacation|\s+holiday)?\b/i;
const negativeFamilyPattern = /\b(?:no\s+(?:kids?|children)|without\s+(?:kids?|children)|adults?\s+only|don['’]?t\s+have\s+(?:any\s+)?(?:kids?|children)|not\s+travel(?:l)?ing\s+with\s+(?:kids?|children)|solo(?:\s+(?:trip|travel|traveler|travelling|traveling))?|travel(?:l)?ing alone|by myself|on my own|just me)\b/i;
const agesPattern = /\b(?:ages?|aged)\s*[:\-]?\s*\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*/i;
const budgetPattern = /(?:[$€£]\s?[\d,]+)|(?:\b[\d,]+\s*(?:usd|eur|gbp)\b)|(?:\b(?:budget|around|under|up to)\s+[$€£]?\s?[\d,]+)/i;
const locationPattern = /\b(?:in|to|near|around|visiting|trip to|week in)\s+([A-Z][A-Za-zÀ-ÿ.' -]{2,45})/;

export function extractPlanningIntent(prompt: string): PlanningIntent {
  const timing = prompt.match(monthOrSeason)?.[0];
  const duration = prompt.match(durationPattern)?.[0];
  const travelers = prompt.match(travelerPattern)?.[0];
  const childrenAges = prompt.match(agesPattern)?.[0];
  const budget = prompt.match(budgetPattern)?.[0];
  const location = prompt.match(locationPattern)?.[1]?.replace(/\s+(?:for|from|with|this|next|in)\b.*$/i, "").trim();
  const constraints = prompt.match(/\b(?:wheelchair|accessible|accessibility|gluten[- ]free|vegetarian|vegan|allerg(?:y|ies|ic)|mobility|car seat|stroller|nap|bedtime)\b/gi) ?? [];
  const priorities = /\b(food|dinner|restaurants?|coffee|books?|history|culture|beach|nightlife|outdoors?|relax(?:ed|ation)?|museums?|music|wine|hiking|strategy|team building|shopping|art|architecture)\b/i.exec(prompt)?.[0];
  const startingPoint = /\b(?:from|starting in|departing from)\s+([A-Z][A-Za-z.' -]{2,35})/.exec(prompt)?.[1];
  const childrenState = childrenStateFromText(prompt);
  return { timing, location, duration, travelers, childrenAges, childrenState, budget, priorities, startingPoint, constraints };
}

export function childrenStateFromText(text: string): PlanningIntent["childrenState"] {
  if (negativeFamilyPattern.test(text)) return "negative";
  if (positiveFamilyPattern.test(text)) return "positive";
  return "unknown";
}

const questionBank: Record<IntakeField, ClarificationQuestion> = {
  timing: { id: "timing", label: "When should this happen?", options: ["Exact dates", "Month or season", "Flexible"], placeholder: "Dates, month, season, or time window" },
  location: { id: "location", label: "Where should AgreeAway focus?", options: ["One destination", "Open to ideas"], placeholder: "City, region, or destination flexibility" },
  duration: { id: "duration", label: "How much time do you have?", options: ["One evening", "Weekend", "About a week"], placeholder: "Duration or start/end time" },
  travelers: { id: "travelers", label: "Who’s going?", options: ["Solo", "Two adults", "Group of friends", "Family with children"], placeholder: "Adults, children, team size, or group size" },
  childrenAges: { id: "childrenAges", label: "How old are the children?", options: ["Under 5", "Ages 5–12", "Teenagers", "No children", "Not sure yet"], placeholder: "Ages or age ranges" },
  budget: { id: "budget", label: "What budget should we plan around?", options: ["Budget-conscious", "Mid-range", "Flexible"], placeholder: "Total or per-person budget" },
  priorities: { id: "priorities", label: "What matters most?", options: ["Food & culture", "Outdoors", "Relaxation", "Nightlife"], placeholder: "Interests, must-dos, pace, or constraints" },
};

export function clarificationQuestions(category: PlanCategory, prompt: string) {
  const intent = extractPlanningIntent(prompt);
  const missing: IntakeField[] = [];
  if (!intent.timing) missing.push("timing");
  if (!intent.location) missing.push("location");
  if (!intent.duration) missing.push("duration");
  if (!intent.travelers) missing.push("travelers");
  if (intent.childrenState === "positive" && !intent.childrenAges) missing.push("childrenAges");
  if (!intent.budget && category !== "date") missing.push("budget");
  if (!intent.priorities) missing.push("priorities");
  return missing.slice(0, 5).map((field) => questionBank[field]);
}

export function reconcileClarificationQuestions(
  category: PlanCategory,
  prompt: string,
  answers: Partial<Record<IntakeField, string>>,
) {
  const travelerState = answers.travelers ? childrenStateFromText(answers.travelers) : "unknown";
  const ageState = answers.childrenAges ? childrenStateFromText(answers.childrenAges) : "unknown";
  const childrenState = ageState === "negative" ? "negative" : travelerState !== "unknown" ? travelerState : childrenStateFromText(prompt);
  const questions = clarificationQuestions(category, prompt).filter((question) => question.id !== "childrenAges");
  if (childrenState !== "positive") return questions;
  return [...questions.filter((question) => question.id !== "priorities").slice(0, 4), questionBank.childrenAges];
}

export function assumptionsForSkip(questions: ClarificationQuestion[]): PlanningAssumption[] {
  const defaults: Record<IntakeField, string> = { timing: "Not set; sequencing is provisional", location: "Destination scope assumed from the request", duration: "A practical duration assumed", travelers: "Two travelers assumed", childrenAges: "Children’s ages not provided; suitability needs confirmation", budget: "Mid-range assumed", priorities: "Relaxed pace and balanced interests assumed" };
  return questions.map((question) => ({ label: question.label.replace(/\?$/, ""), value: defaults[question.id], assumed: true }));
}

export function helperCopy(category: PlanCategory) {
  if (category === "date") return "Helpful details: date/time, location, budget, vibe, dietary or accessibility needs, and any required end time.";
  if (category === "team-offsite") return "Helpful details: dates, team size and origins, budget, work/social goals, and dietary or accessibility needs.";
  if (category === "personal-trip" || category === "group-trip") return "Helpful details: dates or season, starting point, who’s going (including children’s ages), budget, interests, pace, and accessibility needs.";
  return "Helpful details: who, when, where, budget, desired outcome, and important constraints.";
}
