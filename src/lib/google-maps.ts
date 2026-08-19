import type { Plan, PlanItem } from "@/lib/plan-schema";

export const PLACE_FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.googleMapsUri",
  "places.location", "places.businessStatus", "places.primaryType", "places.types",
  "places.rating", "places.userRatingCount", "places.priceLevel",
  "places.regularOpeningHours.weekdayDescriptions", "places.websiteUri",
].join(",");

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  primaryType?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
};

type RouteLeg = { minutes: number; distanceMeters: number; mode: "walk" | "drive" };
const placeTypes = new Set(["meal", "activity", "accommodation", "nightlife"]);
const stopWords = new Set(["the", "a", "an", "in", "at", "of", "and", "or", "for", "with", "to"]);

function tokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((token) => token.length > 2 && !stopWords.has(token)));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let matches = 0;
  for (const token of left) if (right.has(token)) matches += 1;
  return matches / Math.min(left.size, right.size);
}

function expectedGoogleTypes(item: PlanItem) {
  if (item.type === "meal") return new Set(["restaurant", "cafe", "bakery", "meal_takeaway"]);
  if (item.type === "nightlife") return new Set(["bar", "night_club", "wine_bar", "live_music_venue"]);
  if (item.type === "accommodation") return new Set(["hotel", "lodging", "resort_hotel", "hostel"]);
  const context = `${item.title} ${item.description}`.toLowerCase();
  if (/book(?:shop|store)|books/.test(context)) return new Set(["book_store"]);
  if (/coffee|cafe|bakery/.test(context)) return new Set(["cafe", "coffee_shop", "bakery"]);
  if (/market/.test(context)) return new Set(["market", "farmers_market"]);
  return new Set(["tourist_attraction", "museum", "park", "art_gallery", "performing_arts_theater", "amusement_center"]);
}

const countryAliases: Record<string, string[]> = {
  spain: ["spain", "españa"], france: ["france"], italy: ["italy", "italia"], portugal: ["portugal"],
  germany: ["germany", "deutschland"], greece: ["greece"], ireland: ["ireland"], japan: ["japan"],
  canada: ["canada"], mexico: ["mexico", "méxico"], australia: ["australia"],
  "united kingdom": ["united kingdom", "uk", "england", "scotland", "wales", "northern ireland"],
};

const usRegions: Record<string, string> = {
  oregon: "OR", washington: "WA", california: "CA", texas: "TX", illinois: "IL",
  "new york": "NY", florida: "FL", massachusetts: "MA", maine: "ME", colorado: "CO",
  arizona: "AZ", nevada: "NV", georgia: "GA", tennessee: "TN", pennsylvania: "PA",
};

function regionMatchesPlan(planLocation: string, address: string) {
  const normalizedPlan = planLocation.toLowerCase();
  const expected = Object.entries(usRegions).find(([name, abbreviation]) => normalizedPlan.includes(name) || new RegExp(`\\b${abbreviation.toLowerCase()}\\b`).test(normalizedPlan));
  if (!expected) return true;
  const normalizedAddress = address.toLowerCase();
  return normalizedAddress.includes(expected[0]) || new RegExp(`\\b${expected[1].toLowerCase()}\\b`).test(normalizedAddress);
}

function countryMatchesPlan(planLocation: string, address: string) {
  const expected = Object.entries(countryAliases).find(([country]) => planLocation.toLowerCase().includes(country));
  if (!expected) return true;
  const normalizedAddress = address.toLowerCase();
  return expected[1].some((alias) => normalizedAddress.includes(alias));
}

export function scorePlaceMatch(place: GooglePlace, item: PlanItem, plan: Plan) {
  if (!place.id || !place.displayName?.text || !place.formattedAddress) return 0;
  if (place.businessStatus === "CLOSED_PERMANENTLY") return 0;
  if (!countryMatchesPlan(plan.location, place.formattedAddress)) return 0;
  if (!regionMatchesPlan(plan.location, place.formattedAddress)) return 0;
  const titleScore = overlap(tokens(`${item.title} ${item.description}`), tokens(place.displayName.text));
  const geographyScore = overlap(tokens(`${item.location} ${plan.location}`), tokens(place.formattedAddress));
  const actualTypes = new Set([place.primaryType, ...(place.types ?? [])].filter(Boolean) as string[]);
  const typeScore = [...expectedGoogleTypes(item)].some((type) => actualTypes.has(type)) ? 1 : 0;
  const ratingConfidence = place.rating && place.userRatingCount
    ? Math.min(1, Math.max(0, (place.rating - 3.5) / 1.2)) * Math.min(1, Math.log10(place.userRatingCount + 1) / 3)
    : 0;
  const score = (geographyScore * 0.4) + (typeScore * 0.3) + (titleScore * 0.2) + (ratingConfidence * 0.1);
  // A secondary restaurant tag is not enough to turn a bar or lounge into a
  // meal recommendation. Prefer a primary food-service type for meal slots.
  if (item.type === "meal" && place.primaryType && !/(restaurant|cafe|bakery|meal_takeaway)/.test(place.primaryType)) return Math.min(score, 0.35);
  if (item.type === "meal" && /\b(dinner|supper|evening meal)\b/i.test(`${item.title} ${item.description}`) && place.primaryType && !/restaurant/.test(place.primaryType)) return Math.min(score, 0.35);
  // A generic walk, neighborhood exploration, or flexible activity is not a venue.
  // Require some name/context agreement before attaching a specific Google place.
  if (item.type === "activity" && titleScore < 0.2 && /\b(explor|stroll|walk|free time|downtime|flexible|neighborhood)\b/i.test(`${item.title} ${item.description}`)) return Math.min(score, 0.35);
  if (item.type === "activity" && titleScore < 0.2 && /\b(taxi|rideshare|transfer|drop.?off|transport)\b/i.test(`${item.title} ${item.description}`)) return Math.min(score, 0.35);
  if (item.type === "meal" && titleScore < 0.2 && /^(?:(?:group|hosted|working|casual|affordable|closing)\s+)*(?:breakfast|lunch|dinner|meal)\b/i.test(item.title)) return Math.min(score, 0.35);
  return score;
}

export function selectStrongPlace(places: GooglePlace[], item: PlanItem, plan: Plan) {
  return places
    .map((place) => ({ place, score: scorePlaceMatch(place, item, plan) }))
    .filter(({ place, score }) => place.businessStatus !== "CLOSED_PERMANENTLY" && score >= 0.42)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function contextualQuery(item: PlanItem, plan: Plan, adjacent?: { previous?: PlanItem; next?: PlanItem }) {
  if (/book(?:shop|store)|books/i.test(`${item.title} ${item.description}`)) return `${item.title}, ${item.location}, ${plan.location}`.slice(0, 300);
  if (/coffee|cafe|bakery|waterfront|market/i.test(`${item.title} ${item.description}`)) return `${item.title}, ${item.type}, ${item.location}, ${plan.location}`.slice(0, 300);
  const context = [
    item.title, item.type, item.description, item.location, plan.location, plan.budgetLabel,
    `${plan.partySize} people`, plan.considerations.join(" "),
    adjacent?.previous ? `after ${adjacent.previous.title}` : "",
    adjacent?.next ? `before ${adjacent.next.title}` : "",
  ].filter(Boolean).join(", ");
  return context.slice(0, 700);
}

async function searchPlaces(textQuery: string, apiKey: string, pageSize = 5) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACE_FIELD_MASK },
    body: JSON.stringify({ textQuery, pageSize, languageCode: "en", rankPreference: "RELEVANCE" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Places API returned ${response.status}`);
  return ((await response.json()) as { places?: GooglePlace[] }).places ?? [];
}

export function applyVerifiedPlace(item: PlanItem, place: GooglePlace, score: number) {
  item.title = place.displayName?.text ?? item.title;
  item.location = place.formattedAddress ?? item.location;
  item.googleMapsUrl = place.googleMapsUri ?? null;
  item.bookingUrl = place.googleMapsUri ?? null;
  item.websiteUrl = place.websiteUri ?? null;
  item.verification = "google-verified";
  item.placeId = place.id ?? null;
  item.latitude = place.location?.latitude ?? null;
  item.longitude = place.location?.longitude ?? null;
  item.businessStatus = place.businessStatus ?? null;
  item.rating = place.rating ?? null;
  item.userRatingCount = place.userRatingCount ?? null;
  item.priceLevel = place.priceLevel ?? null;
  item.regularOpeningHours = place.regularOpeningHours?.weekdayDescriptions ?? null;
  item.matchReason = score >= 0.72 ? "Strong match for the requested place, area, and plan context." : "Matches the requested area and activity type; confirm it fits your preferences.";
}

export function normalizeSuggestedItem(item: PlanItem) {
  if (!["google-verified", "live-availability", "verified"].includes(item.verification)) item.verification = "suggested";
  return item;
}

export async function findAlternativePlaces(plan: Plan, item: PlanItem, instruction: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) return [];
  const found = new Map<string, GooglePlace>();
  const queries = [
    `${instruction}, ${contextualQuery(item, plan)}`,
    `${instruction}, ${item.type} near ${item.location}, ${plan.location}`,
    `${item.type} alternative, ${plan.budgetLabel}, ${plan.location}`,
  ];
  for (const query of queries) {
    const places = await searchPlaces(query, apiKey, 8);
    for (const place of places) {
      if (place.id && place.id !== item.placeId && selectStrongPlace([place], item, plan)) found.set(place.id, place);
    }
    if (found.size >= 3) break;
  }
  return [...found.values()].slice(0, 3).map((place, index): PlanItem => {
    const alternative = { ...item, id: `${item.id}-alternative-${place.id ?? index}`, travelMinutes: 0, travelMode: null, routeDistanceMeters: null };
    applyVerifiedPlace(alternative, place, scorePlaceMatch(place, item, plan));
    return alternative;
  });
}

function durationMinutes(duration?: string) {
  const seconds = Number(duration?.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null;
}

function haversineMeters(origin: PlanItem, destination: PlanItem) {
  if (origin.latitude == null || origin.longitude == null || destination.latitude == null || destination.longitude == null) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(destination.latitude - origin.latitude);
  const dLon = radians(destination.longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function chooseTravelMode(origin: PlanItem, destination: PlanItem): "walk" | "drive" {
  const distance = haversineMeters(origin, destination);
  return distance !== null && distance <= 2200 ? "walk" : "drive";
}

async function routeLeg(origin: PlanItem, destination: PlanItem, apiKey: string): Promise<RouteLeg | null> {
  if (origin.latitude == null || origin.longitude == null || destination.latitude == null || destination.longitude == null) return null;
  const preferredMode = chooseTravelMode(origin, destination);
  const requestRoute = async (mode: "walk" | "drive") => {
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters" },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
      travelMode: mode === "walk" ? "WALK" : "DRIVE",
      ...(mode === "drive" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
      computeAlternativeRoutes: false, languageCode: "en-US", units: "IMPERIAL",
    }), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Routes API returned ${response.status}`);
  const route = ((await response.json()) as { routes?: Array<{ duration?: string; distanceMeters?: number }> }).routes?.[0];
  const minutes = durationMinutes(route?.duration);
    return minutes === null || route?.distanceMeters == null ? null : { minutes, distanceMeters: route.distanceMeters, mode };
  };
  const preferred = await requestRoute(preferredMode);
  if (preferred?.mode === "walk" && preferred.minutes > 30) return await requestRoute("drive");
  return preferred;
}

export function keepSingleAccommodationBase(plan: Plan) {
  const explicitlySingleBase = /(single|same|central|downtown).{0,20}(base|stay|hotel|lodging)|minimal driving|downtown-based/i.test(`${plan.summary} ${plan.considerations.join(" ")}`);
  const locationSuggestsOneBase = !/\b(?:and|to)\b|\//i.test(plan.location);
  if (!explicitlySingleBase && !locationSuggestsOneBase) return plan;
  const stays = plan.days.flatMap((day) => day.items).filter((item) => item.type === "accommodation");
  const base = stays.find((item) => ["google-verified", "verified"].includes(item.verification) && item.placeId);
  if (!base) return plan;
  for (const stay of stays) {
    if (stay === base || !/(overnight|second night|same lodging|check.?out|depart)/i.test(`${stay.title} ${stay.description}`)) continue;
    const description = stay.description;
    const time = stay.time;
    Object.assign(stay, structuredClone(base), { id: stay.id, description, time });
  }
  return plan;
}

function semanticPlaceKey(item: PlanItem) {
  return `${item.type}:${item.title.toLowerCase().replace(/\b(the|at|of|official|visitor|center|centre|restaurant|cafe)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()}`;
}

export function removeSemanticDuplicates(plan: Plan) {
  const seen = new Set<string>();
  for (const day of plan.days) {
    day.items = day.items.filter((item) => {
      if (!placeTypes.has(item.type) || item.type === "accommodation") return true;
      const key = semanticPlaceKey(item);
      if (!key.split(":")[1] || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return plan;
}

export function applyConstraintConfirmations(plan: Plan) {
  const context = `${plan.summary} ${plan.considerations.join(" ")}`;
  const mobility = /wheelchair|mobility|stairs|step-free|accessible/i.test(context);
  const dietary = /celiac|coeliac|gluten|food allerg|nut allerg|dairy allerg|shellfish allerg/i.test(context);
  for (const item of plan.days.flatMap((day) => day.items)) {
    if (mobility && ["activity", "meal", "accommodation"].includes(item.type) && item.verification === "google-verified") {
      item.description += ` Accessibility needs confirmation${item.websiteUrl ? " on the official website" : " directly with the venue"}: verify step-free entrance, accessible restrooms, and whether the activity itself is suitable.`;
      item.status = "idea";
    }
    if (dietary && item.type === "meal" && item.verification === "google-verified") {
      item.description += ` Dietary suitability needs confirmation${item.websiteUrl ? " through the official menu or venue" : " directly with the venue"}: ask about a dedicated preparation area, cross-contamination controls, and allergen handling.`;
      item.status = "idea";
    }
  }
  if (mobility && !plan.considerations.some((value) => /Accessibility needs confirmation/i.test(value))) plan.considerations.push("Accessibility needs confirmation for each venue and activity; use the official link or call before relying on the stop.");
  if (dietary && !plan.considerations.some((value) => /Dietary suitability needs confirmation/i.test(value))) plan.considerations.push("Dietary suitability needs confirmation; ask specifically about preparation areas, cross-contamination, and allergen handling.");
  return plan;
}

export function routeIsPlausible(leg: RouteLeg) {
  return leg.minutes <= 180 && leg.distanceMeters <= 300_000;
}

export async function enrichPlanWithGoogle(plan: Plan) {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  const routesKey = process.env.GOOGLE_ROUTES_API_KEY ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  const enriched: Plan = structuredClone(plan);
  const originalItems = new Map(plan.days.flatMap((day) => day.items).map((item) => [item.id, structuredClone(item)]));
  let placesVerified = 0; let routesCalculated = 0;
  for (const day of enriched.days) for (const item of day.items) normalizeSuggestedItem(item);
  if (placesKey) {
    const candidates = enriched.days.flatMap((day) => day.items.map((item, index) => ({ item, previous: day.items[index - 1], next: day.items[index + 1] }))).filter(({ item }) => placeTypes.has(item.type) && !["google-verified", "live-availability", "verified"].includes(item.verification)).slice(0, 10);
    const usedPlaceIds = new Set<string>();
    for (const { item, previous, next } of candidates) {
      try {
        const places = await searchPlaces(contextualQuery(item, enriched, { previous, next }), placesKey);
        const match = selectStrongPlace(places.filter((place) => !place.id || !usedPlaceIds.has(place.id)), item, enriched);
        if (!match) continue;
        applyVerifiedPlace(item, match.place, match.score); if (match.place.id) usedPlaceIds.add(match.place.id); placesVerified += 1;
      } catch (error) { console.warn("Places enrichment unavailable", error instanceof Error ? error.message : "unknown error"); }
    }
    keepSingleAccommodationBase(enriched);
    removeSemanticDuplicates(enriched);
    applyConstraintConfirmations(enriched);
  }
  if (routesKey) for (const day of enriched.days) for (let index = 1; index < day.items.length; index += 1) {
    const current = day.items[index];
    try {
      const leg = await routeLeg(day.items[index - 1], current, routesKey);
      if (leg && !routeIsPlausible(leg)) { const original = originalItems.get(current.id); if (original) Object.assign(current, original); continue; }
      if (leg) { current.travelMinutes = leg.minutes; current.travelMode = leg.mode; current.routeDistanceMeters = leg.distanceMeters; routesCalculated += 1; }
    } catch (error) { console.warn("Route enrichment unavailable", error instanceof Error ? error.message : "unknown error"); }
  }
  return { plan: enriched, placesVerified, routesCalculated };
}
