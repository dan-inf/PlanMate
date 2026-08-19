# Google Maps enrichment

PlanMate uses Places API (New) Text Search and Routes API from server-side code only.

## Place fields and billing

The production field mask is exported as `PLACE_FIELD_MASK` in `src/lib/google-maps.ts`. It deliberately requests:

- Pro fields for identity and location: place ID, display name, formatted address, Maps URI, coordinates, business status, and place type.
- Enterprise fields needed for useful recommendations: rating, review count, price level, regular opening hours, and official website URI.

Google bills a Text Search request according to the highest-cost field tier requested. The current mask therefore triggers the Text Search Enterprise SKU. Do not add `*`, current opening hours, atmosphere fields, photos, reviews, or accessibility claims without a product and cost review.

Regular opening hours describe the normal schedule; they do not prove that a place is currently open or available. PlanMate labels matched records **Google verified**, never “live availability.”

## Matching and fallbacks

- Search queries include the item title/type/description, requested area, plan location, budget, party size, considerations, and adjacent stops.
- Up to five results are scored for geographic, type, and name/context agreement.
- Permanently closed places are rejected.
- A result below the confidence threshold remains a **Suggested** concept with no provider fields attached.
- Places or Routes failures are isolated and never fail plan generation.

## Routes

Consecutive items with coordinates receive a route request using only duration and distance. Stops within roughly 2.2 km use walking; longer legs use traffic-aware driving. The UI shows the returned duration and mode. It never displays an invented travel time.
