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
export type ReplacementIntent = {
  instruction: string;
  desiredTerms: string[];
  excludedTerms: string[];
  desiredTypes: string[];
  excludedTypes: string[];
  needsClarification: boolean;
};
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

const cuisineTerms = ["italian", "mexican", "thai", "japanese", "chinese", "indian", "french", "greek", "spanish", "korean", "vietnamese", "mediterranean", "ethiopian", "lebanese", "american"];
const replacementCategories = [
  { pattern: /\b(outdoor|outdoors|park|garden|nature|walk|hike|waterfront)\b/i, term: "outdoors", types: ["park", "garden", "hiking_area", "tourist_attraction"] },
  { pattern: /\b(live music|concert|music venue)\b/i, term: "live music", types: ["live_music_venue", "concert_hall"] },
  { pattern: /\b(theater|theatre|show|performance|play)\b/i, term: "performance", types: ["performing_arts_theater"] },
  { pattern: /\b(comedy|comedian)\b/i, term: "comedy", types: ["comedy_club"] },
  { pattern: /\b(bookstore|book shop|books)\b/i, term: "bookstore", types: ["book_store"] },
  { pattern: /\b(market|food hall|farmers market)\b/i, term: "market", types: ["market", "farmers_market"] },
  { pattern: /\b(shop|shopping|retail|boutique)\b/i, term: "shopping", types: ["shopping_mall", "store"] },
  { pattern: /\b(museum)\b/i, term: "museum", types: ["museum"] },
  { pattern: /\b(gallery|art exhibit)\b/i, term: "gallery", types: ["art_gallery"] },
  { pattern: /\b(bar|cocktail|drinks|nightlife|wine bar)\b/i, term: "bar", types: ["bar", "wine_bar", "night_club"] },
];

function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }

export function parseReplacementIntent(instruction: string, item: PlanItem): ReplacementIntent {
  const normalized = instruction.toLowerCase().replace(/[’]/g, "'");
  const desiredTerms: string[] = [];
  const excludedTerms: string[] = [];
  const desiredTypes: string[] = [];
  const excludedTypes: string[] = [];

  for (const cuisine of cuisineTerms) {
    if (new RegExp(`\\b${cuisine}\\b`).test(normalized)) {
      const excluded = new RegExp(`(?:not|no|avoid|anything but|instead of|don't like|do not like)[^.!?]{0,28}\\b${cuisine}\\b`).test(normalized)
        || new RegExp(`\\b${cuisine}\\b[^.!?]{0,18}(?:excluded|avoid)`).test(normalized);
      (excluded ? excludedTerms : desiredTerms).push(cuisine);
    }
  }
  for (const category of replacementCategories) {
    if (!category.pattern.test(normalized)) continue;
    const match = normalized.match(category.pattern)?.[0] ?? category.term;
    const before = normalized.slice(Math.max(0, normalized.indexOf(match) - 32), normalized.indexOf(match));
    const excluded = /(?:not|no|avoid|anything but|instead of|don't like|do not like)\s+(?:an?\s+|the\s+)?$/i.test(before);
    (excluded ? excludedTerms : desiredTerms).push(category.term);
    (excluded ? excludedTypes : desiredTypes).push(...category.types);
  }
  const insteadOf = normalized.match(/(.+?)\s+instead of\s+(.+)/i);
  if (insteadOf) {
    const desired = insteadOf[1].replace(/^(?:i(?:'d)? (?:like|want)|give me|find|somewhere|something|an?|the)\s+/i, "").trim();
    const excluded = insteadOf[2].trim();
    if (desired) desiredTerms.push(...[...tokens(desired)]);
    if (excluded) excludedTerms.push(...[...tokens(excluded)]);
  }
  const rejectedContext = `${item.title} ${item.description}`.toLowerCase();
  if (/museum|gallery/.test(rejectedContext) && /don't like museums|do not like museums|no museums|not (?:a )?museum|anything but museums?/i.test(normalized)) {
    excludedTerms.push("museum", "gallery"); excludedTypes.push("museum", "art_gallery");
  }
  if (item.type === "nightlife" && /not (?:a )?bar|no bars?|anything but (?:a )?bar/i.test(normalized)) {
    excludedTerms.push("bar", "nightlife"); excludedTypes.push("bar", "wine_bar", "night_club");
  }
  const cleanedDesired = unique(desiredTerms).filter((term) => !excludedTerms.includes(term));
  const cleanedTypes = unique(desiredTypes).filter((type) => !excludedTypes.includes(type));
  const onlyExclusions = cleanedDesired.length === 0 && cleanedTypes.length === 0;
  return {
    instruction: instruction.trim(),
    desiredTerms: cleanedDesired,
    excludedTerms: unique(excludedTerms),
    desiredTypes: cleanedTypes,
    excludedTypes: unique(excludedTypes),
    needsClarification: item.type === "activity" && onlyExclusions,
  };
}

function placeEvidence(place: GooglePlace) {
  return `${place.displayName?.text ?? ""} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase().replaceAll("_", " ");
}

export function placeMatchesReplacementIntent(place: GooglePlace, intent: ReplacementIntent, item: PlanItem) {
  if (!place.id || place.id === item.placeId || !place.displayName?.text || !place.formattedAddress) return false;
  const evidence = placeEvidence(place);
  const actualTypes = new Set([place.primaryType, ...(place.types ?? [])].filter(Boolean) as string[]);
  if (intent.excludedTypes.some((type) => actualTypes.has(type))) return false;
  if (intent.excludedTerms.some((term) => new RegExp(`\\b${term.replace(/\s+/g, "[ _-]")}\\b`, "i").test(evidence))) return false;
  if (intent.desiredTerms.some((term) => cuisineTerms.includes(term)) && ![...actualTypes].some((type) => /restaurant|cafe|meal_takeaway/.test(type))) return false;
  if (intent.desiredTypes.length && !intent.desiredTypes.some((type) => actualTypes.has(type))) return false;
  if (!intent.desiredTypes.length && intent.desiredTerms.length && !intent.desiredTerms.some((term) => new RegExp(`\\b${term.replace(/\s+/g, "[ _-]")}\\b`, "i").test(evidence))) return false;
  if (item.type === "activity" && !intent.desiredTypes.some((type) => /store|shopping/.test(type)) && [...actualTypes].some((type) => /store|supplier|hardware|home_goods|wholesaler/.test(type))) return false;
  return true;
}

export function buildAlternativeQueries(plan: Plan, item: PlanItem, intent: ReplacementIntent) {
  const desired = [...intent.desiredTerms, ...intent.desiredTypes.map((type) => type.replaceAll("_", " "))].join(" ") || instructionCategory(item);
  const exclusions = intent.excludedTerms.length ? `exclude ${intent.excludedTerms.join(" and ")}` : "";
  return unique([
    `${intent.instruction}, ${desired}, ${item.location}, ${plan.location}, ${plan.budgetLabel}, ${exclusions}`,
    `${desired} near ${item.location}, ${plan.location}, ${plan.budgetLabel}, requested change: ${intent.instruction}, ${exclusions}`,
    `${desired}, ${plan.location}, ${item.location}, ${intent.instruction}, ${exclusions}`,
  ]).map((query) => query.replace(/,\s*,/g, ",").slice(0, 450));
}

function instructionCategory(item: PlanItem) {
  return item.type === "meal" ? "restaurant" : item.type === "nightlife" ? "evening activity" : "activity";
}

function replacementItemFor(item: PlanItem, intent: ReplacementIntent): PlanItem {
  const requestedType = intent.desiredTypes.some((type) => /restaurant|cafe|bakery/.test(type)) || intent.desiredTerms.some((term) => cuisineTerms.includes(term))
    ? "meal"
    : intent.desiredTypes.some((type) => /bar|night_club|wine_bar/.test(type))
      ? "nightlife"
      : intent.desiredTypes.length ? "activity" : item.type;
  return { ...item, type: requestedType, title: intent.desiredTerms.join(" ") || intent.instruction, description: intent.instruction };
}

export function selectAlternativeCandidates(places: GooglePlace[], plan: Plan, item: PlanItem, intent: ReplacementIntent) {
  const replacementItem = replacementItemFor(item, intent);
  return places
    .filter((place) => placeMatchesReplacementIntent(place, intent, item))
    .map((place) => ({ place, score: Math.min(1, scorePlaceMatch(place, replacementItem, plan) + 0.2) }))
    .filter((candidate) => candidate.score >= 0.42)
    .sort((left, right) => right.score - left.score);
}

function expectedGoogleTypes(item: PlanItem) {
  if (item.type === "meal") return new Set(["restaurant", "cafe", "bakery", "meal_takeaway"]);
  if (item.type === "nightlife") return new Set(["bar", "night_club", "wine_bar", "live_music_venue"]);
  if (item.type === "accommodation") return new Set(["hotel", "lodging", "resort_hotel", "hostel"]);
  const context = `${item.title} ${item.description}`.toLowerCase();
  if (/museum|gallery/.test(context)) return new Set(["museum", "art_gallery"]);
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
  if (item.type === "activity" && typeScore === 0 && /museum|gallery/i.test(`${item.title} ${item.description}`)) return Math.min(score, 0.35);
  if (item.type === "activity" && titleScore < 0.2 && /\b(workshop|strategy|breakout|facilitated|meeting room)\b/i.test(`${item.title} ${item.description}`)) return Math.min(score, 0.35);
  if (item.type === "meal" && titleScore < 0.2 && /\b(hotel|meeting (?:room|space)|cater|on-site|onsite)\b/i.test(`${item.title} ${item.description} ${item.location}`)) return Math.min(score, 0.35);
  return score;
}

export function selectStrongPlace(places: GooglePlace[], item: PlanItem, plan: Plan) {
  return places
    .map((place) => ({ place, score: scorePlaceMatch(place, item, plan) }))
    .filter(({ place, score }) => place.businessStatus !== "CLOSED_PERMANENTLY" && score >= 0.42)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function contextualQuery(item: PlanItem, plan: Plan, adjacent?: { previous?: PlanItem; next?: PlanItem }) {
  void adjacent;
  const focusedTitle = item.title.replace(/^(browse|visit|explore|have|enjoy|choose)\s+/i, "");
  return [focusedTitle, item.type, item.location, plan.location, plan.budgetLabel, item.description.slice(0, 160)].filter(Boolean).join(", ").slice(0, 450);
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
  const intent = parseReplacementIntent(instruction, item);
  if (intent.needsClarification) return [];
  const found = new Map<string, GooglePlace>();
  const replacementItem = replacementItemFor(item, intent);
  const queries = buildAlternativeQueries(plan, item, intent);
  for (const query of queries) {
    const places = await searchPlaces(query, apiKey, 8);
    for (const { place } of selectAlternativeCandidates(places, plan, item, intent)) {
      if (place.id) found.set(place.id, place);
    }
    if (found.size >= 3) break;
  }
  return [...found.values()].slice(0, 3).map((place, index): PlanItem => {
    const alternative = { ...item, id: `${item.id}-alternative-${place.id ?? index}`, travelMinutes: 0, travelMode: null, routeDistanceMeters: null };
    applyVerifiedPlace(alternative, place, scorePlaceMatch(place, replacementItem, plan));
    alternative.matchReason = `Matches the requested change: ${instruction.trim()}.`;
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
    if (stay === base || !/(overnight|second night|same (?:lodging|hotel|base)|check.?out|depart)/i.test(`${stay.title} ${stay.description}`)) continue;
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
    const candidates = enriched.days.flatMap((day) => day.items.map((item, index) => ({ item, previous: day.items[index - 1], next: day.items[index + 1] }))).filter(({ item }) => placeTypes.has(item.type) && !["google-verified", "live-availability", "verified"].includes(item.verification)).slice(0, 14);
    const usedPlaceIds = new Set<string>();
    for (const { item, previous, next } of candidates) {
      try {
        const places = await searchPlaces(contextualQuery(item, enriched, { previous, next }), placesKey);
        let match = selectStrongPlace(places.filter((place) => !place.id || !usedPlaceIds.has(place.id)), item, enriched);
        const itemContext = `${item.title} ${item.description} ${item.location}`;
        const canRetry = (item.type === "meal" && !/\b(hotel|meeting (?:room|space)|cater|on-site|onsite)\b/i.test(itemContext))
          || (item.type === "activity" && !/\b(explor|stroll|walk|free time|downtime|flexible|neighborhood|taxi|rideshare|transfer|drop.?off|transport|workshop|strategy|breakout|facilitated|meeting room)\b/i.test(itemContext));
        if (!match && canRetry) {
          const typeHint = [...expectedGoogleTypes(item)][0].replaceAll("_", " ");
          const focusedTitle = item.title.replace(/^(browse|visit|explore|have|enjoy|choose)\s+/i, "");
          const retryPlaces = await searchPlaces(`${focusedTitle}, ${typeHint}, ${item.location}, ${enriched.location}`, placesKey, 8);
          match = selectStrongPlace(retryPlaces.filter((place) => !place.id || !usedPlaceIds.has(place.id)), item, enriched);
        }
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
