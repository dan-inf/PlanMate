import assert from "node:assert/strict";
import test from "node:test";

import { applyVerifiedPlace, enrichPlanWithGoogle, keepSingleAccommodationBase, scorePlaceMatch, selectStrongPlace } from "../src/lib/google-maps.ts";
import type { Plan, PlanItem } from "../src/lib/plan-schema.ts";
import { replacePlanItem } from "../src/lib/plan-edits.ts";

function item(overrides: Partial<PlanItem> = {}): PlanItem {
  return { id: "dinner", time: "19:00", title: "Italian dinner", type: "meal", description: "Relaxed neighborhood restaurant", location: "SoHo, New York", costPerPerson: 60, travelMinutes: 0, status: "needs-booking", verification: "suggested", bookingUrl: null, ...overrides };
}

function plan(planItem = item()): Plan {
  return { title: "NYC date", summary: "A relaxed evening", location: "New York", dateLabel: "Friday", partySize: 2, currency: "USD", budgetLabel: "Mid-range", estimatedTotalPerPerson: 100, days: [{ label: "Friday", date: "", items: [planItem] }], budget: [], considerations: ["Relaxed pace"] };
}

test("permanently closed place is rejected", () => {
  const source = plan();
  const closed = { id: "closed", displayName: { text: "Italian Dinner SoHo" }, formattedAddress: "SoHo, New York, NY", businessStatus: "CLOSED_PERMANENTLY", primaryType: "restaurant" };
  assert.equal(scorePlaceMatch(closed, source.days[0].items[0], source), 0);
  assert.equal(selectStrongPlace([closed], source.days[0].items[0], source), null);
});

test("weak or geographically implausible match remains suggested", () => {
  const source = plan();
  const weak = { id: "weak", displayName: { text: "Airport Hardware Store" }, formattedAddress: "Los Angeles, CA", primaryType: "hardware_store" };
  assert.equal(selectStrongPlace([weak], source.days[0].items[0], source), null);
  assert.equal(source.days[0].items[0].verification, "suggested");
});

test("a bar with only a secondary restaurant type is rejected for a meal", () => {
  const meal = item({ title: "Group dinner", description: "A full dinner at a moderately priced restaurant." });
  const source = plan(meal);
  source.location = "Austin, Texas";
  const place = {
    id: "cocktail-bar",
    displayName: { text: "Group Therapy" },
    formattedAddress: "400 Lavaca St, Austin, TX, USA",
    businessStatus: "OPERATIONAL",
    primaryType: "bar",
    types: ["bar", "restaurant"],
    rating: 4.6,
    userRatingCount: 900,
  };

  assert.equal(selectStrongPlace([place], meal, source), null);
});

test("a cafe is rejected for a dinner recommendation", () => {
  const dinner = item({ title: "Team dinner", description: "A quieter group dinner." });
  const source = plan(dinner);
  const cafe = {
    id: "cafe",
    displayName: { text: "Neighborhood Cafe" },
    formattedAddress: "Seattle, WA, USA",
    businessStatus: "OPERATIONAL",
    primaryType: "cafe",
    types: ["cafe", "restaurant"],
    rating: 4.8,
    userRatingCount: 800,
  };

  assert.equal(selectStrongPlace([cafe], dinner, { ...source, location: "Seattle, Washington" }), null);
});

test("generic neighborhood activity does not become an arbitrary landmark", () => {
  const activity = item({ type: "activity", title: "Relaxed SoHo stroll", description: "Walk quieter streets and browse storefronts" });
  const source = plan(activity);
  const landmark = { id: "building", displayName: { text: "Little Singer Building" }, formattedAddress: "561 Broadway, New York, NY", primaryType: "tourist_attraction" };
  assert.equal(selectStrongPlace([landmark], activity, source), null);
});

test("a specific bookstore request can match by provider type", () => {
  const bookstore = item({ type: "activity", title: "Browse an independent bookstore", description: "Spend an hour browsing books", location: "Capitol Hill, Seattle" });
  const source = { ...plan(bookstore), location: "Seattle, Washington" };
  const place = { id: "books", displayName: { text: "Elliott Bay Book Company" }, formattedAddress: "Seattle, WA, USA", primaryType: "book_store", types: ["book_store", "store"] };

  assert.ok(selectStrongPlace([place], bookstore, source));
});

test("an international plan rejects a same-name place in the wrong country", () => {
  const activity = item({ type: "activity", title: "Explore Santa Cruz", description: "Walk Seville's Santa Cruz quarter", location: "Santa Cruz, Seville" });
  const source = { ...plan(activity), location: "Madrid and Seville, Spain" };
  const wrongCountry = { id: "california", displayName: { text: "Visit Santa Cruz County" }, formattedAddress: "705 Front St, Santa Cruz, CA 95060, USA", primaryType: "tourist_attraction" };

  assert.equal(selectStrongPlace([wrongCountry], activity, source), null);
});

test("verified provider fields map without claiming availability", () => {
  const target = item();
  applyVerifiedPlace(target, { id: "place-1", displayName: { text: "Test Trattoria" }, formattedAddress: "1 Spring St, New York, NY", googleMapsUri: "https://maps.google.com/test", websiteUri: "https://example.com", location: { latitude: 40.72, longitude: -74 }, businessStatus: "OPERATIONAL", rating: 4.6, userRatingCount: 321, priceLevel: "PRICE_LEVEL_MODERATE", regularOpeningHours: { weekdayDescriptions: ["Friday: 5–11 PM"] } }, 0.8);
  assert.equal(target.verification, "google-verified");
  assert.equal(target.placeId, "place-1");
  assert.equal(target.rating, 4.6);
  assert.equal(target.userRatingCount, 321);
  assert.equal(target.websiteUrl, "https://example.com");
  assert.notEqual(target.verification, "live-availability");
});

test("missing Maps keys degrades safely and preserves source state", async () => {
  const places = process.env.GOOGLE_PLACES_API_KEY; const routes = process.env.GOOGLE_ROUTES_API_KEY; const shared = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY; delete process.env.GOOGLE_ROUTES_API_KEY; delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  const source = plan(item({ verification: "needs-live-verification" }));
  const before = structuredClone(source);
  const result = await enrichPlanWithGoogle(source);
  assert.equal(result.plan.days[0].items[0].verification, "suggested");
  assert.deepEqual(source, before);
  if (places) process.env.GOOGLE_PLACES_API_KEY = places; if (routes) process.env.GOOGLE_ROUTES_API_KEY = routes; if (shared) process.env.GOOGLE_MAPS_SERVER_API_KEY = shared;
});

test("route failure does not fail plan enrichment", async () => {
  const oldFetch = globalThis.fetch; const oldPlaces = process.env.GOOGLE_PLACES_API_KEY; const oldRoutes = process.env.GOOGLE_ROUTES_API_KEY; const oldShared = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY; delete process.env.GOOGLE_MAPS_SERVER_API_KEY; process.env.GOOGLE_ROUTES_API_KEY = "test";
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const source = plan(); source.days[0].items.push(item({ id: "second", latitude: 40.71, longitude: -74.01 })); source.days[0].items[0].latitude = 40.72; source.days[0].items[0].longitude = -74;
  const result = await enrichPlanWithGoogle(source);
  assert.equal(result.routesCalculated, 0);
  assert.equal(result.plan.days[0].items.length, 2);
  globalThis.fetch = oldFetch; if (oldPlaces) process.env.GOOGLE_PLACES_API_KEY = oldPlaces; if (oldRoutes) process.env.GOOGLE_ROUTES_API_KEY = oldRoutes; else delete process.env.GOOGLE_ROUTES_API_KEY; if (oldShared) process.env.GOOGLE_MAPS_SERVER_API_KEY = oldShared;
});

test("replacement preserves unrelated Plan state and stable identity", () => {
  const source = plan();
  source.days.push({ label: "Saturday", date: "", items: [item({ id: "unrelated", title: "Museum" })] });
  const replacement = item({ id: "temporary", title: "New restaurant", time: "22:00" });
  const updated = replacePlanItem(source, 0, "dinner", replacement);
  assert.ok(updated);
  assert.equal(updated.days[0].items[0].id, "dinner");
  assert.equal(updated.days[0].items[0].time, "19:00");
  assert.deepEqual(updated.days[1], source.days[1]);
  assert.equal(source.days[0].items[0].title, "Italian dinner");
});

test("single-base plan keeps the same verified accommodation", () => {
  const source = plan(); source.summary = "A centrally located single lodging base with minimal driving";
  const first = item({ id: "hotel-1", type: "accommodation", title: "Fairmont", description: "Check in", verification: "google-verified", placeId: "fairmont", location: "101 Red River St" });
  const second = item({ id: "hotel-2", type: "accommodation", title: "Second overnight", description: "Second overnight at the same lodging", verification: "google-verified", placeId: "wrong", location: "Far away" });
  source.days[0].items = [first]; source.days.push({ label: "Saturday", date: "", items: [second] });
  keepSingleAccommodationBase(source);
  assert.equal(second.placeId, "fairmont"); assert.equal(second.id, "hotel-2"); assert.equal(second.description, "Second overnight at the same lodging");
});

test("single-city plan does not switch hotels only for checkout", () => {
  const source = plan();
  source.location = "Seattle, Washington";
  const first = item({ id: "hotel-1", type: "accommodation", title: "Downtown Hotel", description: "Check in", verification: "google-verified", placeId: "downtown", location: "Seattle" });
  const checkout = item({ id: "hotel-2", type: "accommodation", title: "Airport Hotel", description: "Complete hotel checkout and depart", verification: "google-verified", placeId: "airport", location: "SeaTac" });
  source.days[0].items = [first];
  source.days.push({ label: "Day 2", date: "", items: [checkout] });

  keepSingleAccommodationBase(source);

  assert.equal(checkout.placeId, "downtown");
  assert.equal(checkout.id, "hotel-2");
  assert.match(checkout.description, /checkout/i);
});
