import assert from "node:assert/strict";
import test from "node:test";

import {
  assumptionsForSkip,
  clarificationQuestions,
  extractPlanningIntent,
  helperCopy,
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
