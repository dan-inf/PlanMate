# PlanMate

PlanMate turns a person’s intent into a structured, persistent real-world plan.

The product is not the chat response—the Plan is the product.

## Current vertical slice

- Responsive category-driven planning intake
- Structured itinerary and budget experience
- Server-side OpenAI plan generation with Zod-enforced output
- Clear planning placeholders until Google Maps data is connected
- Supabase schema for plans, days, and plan items
- Explicit Data API grants and owner-scoped Row Level Security

## Stack

- Next.js 16 with the App Router
- React 19 and TypeScript
- Tailwind CSS 4
- OpenAI Responses API
- Supabase Postgres and Auth foundation
- Vercel deployment target

## Local setup

Install dependencies:

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and configure the required values. Never commit `.env.local`.

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Supabase

The initial schema is recorded in `supabase/migrations`. New exposed tables must always include explicit grants, RLS, and ownership-aware policies in the same migration.

## Next milestones

1. Add Supabase sign-up and sign-in.
2. Persist generated plans for authenticated users.
3. Add Google Places and Routes data.
4. Add conversational plan edits.
5. Add read-only share links.
