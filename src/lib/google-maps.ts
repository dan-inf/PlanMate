import type { Plan, PlanItem } from "@/lib/plan-schema";

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
};

type LocatedItem = PlanItem & {
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
};

const placeTypes = new Set(["meal", "activity", "accommodation", "nightlife"]);

function placeQuery(item: PlanItem, plan: Plan) {
  if (item.type === "meal") return `${item.title}, restaurant in ${item.location}, ${plan.location}`;
  if (item.type === "accommodation") return `hotel or lodging in ${item.location}, ${plan.location}`;
  return `${item.title} in ${item.location}, ${plan.location}`;
}

async function findPlace(item: PlanItem, plan: Plan, apiKey: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location",
    },
    body: JSON.stringify({ textQuery: placeQuery(item, plan), pageSize: 1, languageCode: "en" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Places API returned ${response.status}`);
  const data = (await response.json()) as { places?: GooglePlace[] };
  return data.places?.[0] ?? null;
}

export async function findAlternativePlaces(plan: Plan, item: PlanItem, instruction: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) return [];
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location",
    },
    body: JSON.stringify({
      textQuery: `${instruction}. ${item.type === "meal" ? "Restaurant" : item.type} near ${item.location}, ${plan.location}`,
      pageSize: 5,
      languageCode: "en",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Places API returned ${response.status}`);
  const data = (await response.json()) as { places?: GooglePlace[] };
  return (data.places ?? [])
    .filter((place) => place.id && place.id !== item.placeId && place.displayName?.text && place.formattedAddress)
    .slice(0, 3)
    .map((place, index): PlanItem => ({
      ...item,
      id: `${item.id}-alternative-${place.id ?? index}`,
      title: place.displayName?.text ?? "Alternative",
      description: `A Google-verified alternative matching: ${instruction}`,
      location: place.formattedAddress ?? plan.location,
      status: "needs-booking",
      verification: "verified",
      bookingUrl: place.googleMapsUri ?? null,
      placeId: place.id ?? null,
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      travelMinutes: 0,
    }));
}

function durationMinutes(duration?: string) {
  const seconds = Number(duration?.replace(/s$/, ""));
  return Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null;
}

async function routeMinutes(origin: LocatedItem, destination: LocatedItem, apiKey: string) {
  if (origin.latitude == null || origin.longitude == null || destination.latitude == null || destination.longitude == null) return null;
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
      languageCode: "en-US",
      units: "IMPERIAL",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Routes API returned ${response.status}`);
  const data = (await response.json()) as { routes?: Array<{ duration?: string }> };
  return durationMinutes(data.routes?.[0]?.duration);
}

export async function enrichPlanWithGoogle(plan: Plan) {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  const routesKey = process.env.GOOGLE_ROUTES_API_KEY ?? process.env.GOOGLE_MAPS_SERVER_API_KEY;
  const enriched: Plan = structuredClone(plan);
  let placesVerified = 0;
  let routesCalculated = 0;

  if (placesKey) {
    const candidates = enriched.days
      .flatMap((day) => day.items)
      .filter((item) => placeTypes.has(item.type) && item.verification !== "verified")
      .slice(0, 10);
    await Promise.all(candidates.map(async (item) => {
      try {
        const place = await findPlace(item, enriched, placesKey);
        if (!place?.displayName?.text || !place.formattedAddress) return;
        item.title = place.displayName.text;
        item.location = place.formattedAddress;
        item.bookingUrl = place.googleMapsUri ?? null;
        item.verification = "verified";
        item.placeId = place.id ?? null;
        item.latitude = place.location?.latitude ?? null;
        item.longitude = place.location?.longitude ?? null;
        placesVerified += 1;
      } catch (error) {
        console.error("Places enrichment failed", error);
      }
    }));
  }

  if (routesKey) {
    for (const day of enriched.days) {
      for (let index = 1; index < day.items.length; index += 1) {
        const previous = day.items[index - 1] as LocatedItem;
        const current = day.items[index] as LocatedItem;
        try {
          const minutes = await routeMinutes(previous, current, routesKey);
          if (minutes !== null) {
            current.travelMinutes = minutes;
            routesCalculated += 1;
          }
        } catch (error) {
          console.error("Routes enrichment failed", error);
        }
      }
    }
  }

  return { plan: enriched, placesVerified, routesCalculated };
}
