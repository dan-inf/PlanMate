import assert from "node:assert/strict";
import test from "node:test";

import {
  assumptionsForSkip,
  clarificationQuestions,
  extractPlanningIntent,
  helperCopy,
  reconcileClarificationQuestions,
  resolveTimingAnswer,
  clarificationAnswersComplete,
} from "../src/lib/planning-intake.ts";

test("a sparse week in Spain asks only high-impact missing questions", () => {
  const questions = clarificationQuestions("personal-trip", "I'm spending a week in Spain. What should I do?");
  const ids = questions.map((question) => question.id);

  assert.deepEqual(ids, ["timing", "travelers", "budget", "priorities"]);
  assert.ok(questions.length <= 5);
});

test("a fully specified Spain prompt takes the fast path", () => {
  const prompt = "Two adults are spending seven days in Spain in October with a $4,000 budget, focused on food and history at a relaxed pace.";
  assert.deepEqual(clarificationQuestions("personal-trip", prompt), []);
});

test("hyphenated durations do not trigger a redundant question", () => {
  const prompt = "A three-day team offsite in Seattle in October for 12 team members with a $15,000 budget, strategy and team building.";
  assert.deepEqual(clarificationQuestions("team-offsite", prompt), []);
});

test("a stated start and end time count as the plan duration", () => {
  const prompt = "A Seattle date in October from 5 PM to 11 PM for two adults with a $250 budget, coffee, books, and dinner.";
  assert.deepEqual(clarificationQuestions("date", prompt), []);
});

test("family trips ask for missing child ages", () => {
  const questions = clarificationQuestions("personal-trip", "Our family with kids is spending a week in Spain in June with a $5,000 budget for food and history.");
  assert.ok(questions.some((question) => question.id === "childrenAges"));
});

test("provided child ages are retained and are not asked twice", () => {
  const prompt = "Two adults and our children ages 3 and 6 are spending a week in Spain in June with a $5,000 budget for food and history.";
  const intent = extractPlanningIntent(prompt);

  assert.equal(intent.childrenAges, "ages 3 and 6");
  assert.ok(!clarificationQuestions("personal-trip", prompt).some((question) => question.id === "childrenAges"));
});

test("skipping child ages makes suitability uncertainty explicit", () => {
  const questions = clarificationQuestions("personal-trip", "Our family with kids is spending a week in Spain in June with a $5,000 budget for food and history.");
  const assumptions = assumptionsForSkip(questions);
  const ageAssumption = assumptions.find((assumption) => assumption.label === "How old are the children");

  assert.equal(ageAssumption?.assumed, true);
  assert.match(ageAssumption?.value ?? "", /suitability needs confirmation/i);
});

test("helper copy adapts to category without becoming input text", () => {
  assert.match(helperCopy("date"), /date\/time/i);
  assert.match(helperCopy("personal-trip"), /children.*ages/i);
  assert.match(helperCopy("team-offsite"), /team size/i);
});

test("solo trip for about a week with no kids does not repeat answered questions", () => {
  const prompt = "Solo trip to Spain for about a week, no kids, in October with a $3,000 budget focused on food.";
  const ids = clarificationQuestions("personal-trip", prompt).map((question) => question.id);
  assert.ok(!ids.includes("duration"));
  assert.ok(!ids.includes("travelers"));
  assert.ok(!ids.includes("childrenAges"));
  assert.equal(extractPlanningIntent(prompt).childrenState, "negative");
});

test("natural solo and approximate-duration phrases are recognized", () => {
  for (const prompt of [
    "Traveling alone for roughly one week in Spain in June with a $2,000 budget for history",
    "On my own for around 7 days in Spain in June with a $2,000 budget for history",
  ]) {
    const ids = clarificationQuestions("personal-trip", prompt).map((question) => question.id);
    assert.ok(!ids.includes("duration"));
    assert.ok(!ids.includes("travelers"));
    assert.ok(!ids.includes("childrenAges"));
  }
});

test("adult-only and negated child context never asks ages", () => {
  for (const phrase of ["Two adults, without children", "Two adults, adults only", "Two adults who don't have kids", "Two adults not traveling with children"]) {
    assert.ok(!clarificationQuestions("personal-trip", `${phrase}, a week in Spain in June with a $2,000 budget for food`).some((question) => question.id === "childrenAges"));
  }
});

test("family question offers no-children and uncertainty escapes", () => {
  const ageQuestion = clarificationQuestions("personal-trip", "Family trip for a week in Spain in June with a $2,000 budget for food").find((question) => question.id === "childrenAges");
  assert.ok(ageQuestion?.options.includes("No children"));
  assert.ok(ageQuestion?.options.includes("Not sure yet"));
});

test("changing a family answer to solo removes the child-age requirement", () => {
  const prompt = "A week in Spain in June with a $2,000 budget for food";
  const familyQuestions = reconcileClarificationQuestions("personal-trip", prompt, { travelers: "Family with children" });
  assert.ok(familyQuestions.some((question) => question.id === "childrenAges"));
  const soloQuestions = reconcileClarificationQuestions("personal-trip", prompt, { travelers: "Solo", childrenAges: "Under 5" });
  assert.ok(!soloQuestions.some((question) => question.id === "childrenAges"));
});

test("timing modes require semantic detail rather than their labels", () => {
  assert.equal(resolveTimingAnswer("exact", {}), "");
  assert.equal(resolveTimingAnswer("exact", { start: "2027-03-12", end: "2027-03-19" }), "2027-03-12 to 2027-03-19");
  assert.equal(resolveTimingAnswer("exact", { start: "2027-03-19", end: "2027-03-12" }), "");
  assert.equal(resolveTimingAnswer("month-season", {}), "");
  assert.equal(resolveTimingAnswer("month-season", { month: "2026-10" }), "2026-10");
  assert.equal(resolveTimingAnswer("month-season", { season: "Summer" }), "Summer, year not sure");
  assert.equal(resolveTimingAnswer("flexible"), "Flexible timing — anytime");
});

test("clarification completion validates resolved values", () => {
  const timing = clarificationQuestions("personal-trip", "A week in Spain with two adults and a $2,000 food budget").find((question) => question.id === "timing");
  assert.ok(timing);
  assert.equal(clarificationAnswersComplete([timing], { timing: "" }), false);
  assert.equal(clarificationAnswersComplete([timing], { timing: "2026-10" }), true);
});
