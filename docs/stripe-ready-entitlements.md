# Stripe-ready entitlement architecture

AgreeAway owns product access in Supabase. A future payment provider reports commercial events; it never becomes the browser-side authority for whether someone may create a Plan.

## Current model

- `entitlement_grants` records provider-neutral allowances from signup, promotions, administrators, and future purchases or subscriptions.
- `entitlement_usage` records an auditable Plan-linked consumption and optional reversal.
- `generated_plan_saves` makes the Plan save transaction idempotent even when beta access allows a save without consuming a credit.
- `user_billing_accounts` and `billing_subscriptions` isolate provider identifiers from product logic.
- `billing_provider_events` is a minimal, replayable event ledger; full webhook payloads are not retained.
- `get_creation_entitlement()` supplies the server-derived dashboard balance.
- `persist_generated_plan()` atomically saves the complete generated hierarchy and consumes an available signup creation.

The current launch state grants one creation at signup, tracks its use, and leaves additional beta creation access open. There is no checkout, price claim, Stripe runtime dependency, or zero-balance paywall.

## Future product keys

Provider price identifiers will map server-side to internal keys such as `free_signup_creation`, `individual_monthly`, `individual_annual`, and `plan_creation_pack`. Final names, prices, renewal allowances, trial behavior, and “unlimited” semantics require Product approval.

## Future environment variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_INDIVIDUAL_MONTHLY`
- `STRIPE_PRICE_INDIVIDUAL_ANNUAL`
- `STRIPE_PRICE_PLAN_CREATION_PACK`

These remain server-only and must never use a `NEXT_PUBLIC_` prefix. Development and Preview use Stripe test mode only. Production may use live mode only after explicit owner approval, with distinct customers, products, prices, subscriptions, events, and webhook secrets.

## Webhook contract

A future verified server endpoint will first insert the unique `(provider, environment, provider_event_id)` receipt, then idempotently reconcile customer, checkout, subscription, invoice, purchase, refund, or reversal state. Duplicate and out-of-order events must be safe; failed events remain retryable with sanitized errors. Browser redirects are never payment proof.

## Launch checklist

Before activating payments, Product must approve pricing, allowances, renewal timing, trial/cancellation/refund behavior, tax and terms, and the post-free-creation UX. Engineering must then add signature verification, test/live isolation tests, replay/reconciliation tooling, webhook monitoring, and rollback procedures. A rollback disables commercial enforcement without deleting grants, usage, provider events, or access to existing/shared Plans.
