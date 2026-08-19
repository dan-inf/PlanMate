# PlanMate

PlanMate turns natural-language intent into a structured, persistent real-world plan. The Plan—not a chat transcript—is the product.

## Current product state

- Public planning intake across date, celebration, trip, personal, and team plans
- Server-side OpenAI generation with Zod-validated structured output
- Multi-day draft itinerary with add, remove, and alternative-location editing
- Google Places and Routes enrichment when server credentials are configured
- Account creation and sign-in through Supabase Auth
- Exact generated-plan persistence into plans, days, and itinerary items
- Saved collaboration workspace with stacked days
- Owner invitations, pending/resend/cancel states, item voting, and comments
- Final agreement using unanimous, majority, or owner-decides rules
- Owner- and member-scoped Row Level Security on exposed tables
- Production deployment at [myplanmate.app](https://myplanmate.app)

Not yet shipped: progressive intake questions, persistent-plan AI editing, decision summaries, public sharing/PDF, full budget tools, and mobile execution mode.

## Stack

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS 4
- OpenAI Responses API
- Supabase Postgres, Auth, Row Level Security, and Edge Functions
- Google Places API (New) and Routes API
- Resend for collaboration invitation email
- Vercel hosting

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and add the required credentials. Never commit `.env.local`.
3. Run `pnpm dev`.
4. Open [http://localhost:3000](http://localhost:3000).

Only the Supabase project URL and publishable key use the `NEXT_PUBLIC_` prefix. OpenAI, Google server API, and Resend keys must remain server-only.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Phase 0 also requires an authenticated production acceptance pass: generate, save, reload, sign out, sign back in, and confirm the exact plan hierarchy persists.

## Database changes

Schema changes live in `supabase/migrations`. Every exposed table must include explicit grants, Row Level Security, and ownership- or membership-aware policies. Privileged functions must validate the authenticated user and restrict `EXECUTE` to the intended role.

## Ordered roadmap

1. Healthy authenticated persistence baseline
2. Verified places and geographic routing
3. Conversational progressive intake
4. AI editing in the saved Plan
5. Decision-oriented collaboration
6. Public summary, sharing, print, and PDF
7. Budget and booking readiness
8. Mobile execution mode
9. Product analytics and user-interest testing
