# AgreeAway production cutover

The application code and customer copy use **AgreeAway** and the canonical origin `https://agreeaway.com`. Keep the existing Supabase and Vercel projects; this is a non-destructive identity and domain cutover.

## 1. Vercel and DNS

1. In the existing Vercel project, add `agreeaway.com` and `www.agreeaway.com` under **Settings → Domains**.
2. Publish exactly the DNS records Vercel displays. Do not create a second Vercel project.
3. Choose the apex as canonical and configure `www.agreeaway.com` to redirect to `https://agreeaway.com`.
4. Set Production `NEXT_PUBLIC_APP_URL` to `https://agreeaway.com` and redeploy the exact rebrand commit.
5. Wait for Vercel to show valid configuration and SSL for both names.
6. Treat `myplanmate.app` according to the owner/legal decision. Do not redirect or retire it by assumption.

## 2. Supabase Auth

In project `hsmuzlztcwvfkudzmclt`, open **Authentication → URL Configuration**:

- Site URL: `https://agreeaway.com`
- Production redirect: `https://agreeaway.com/**`
- Local development redirect: `http://127.0.0.1:3000/**`
- Add only the specific Vercel Preview origins actively used for auth testing; avoid a broad third-party wildcard.

In **Authentication → Email Templates → Confirm signup**, use the server-verifiable token hash while retaining the app-provided continuation URL:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm email address</a>
```

The application always supplies an AgreeAway `/auth/callback` URL with an allowlisted continuation. Do not replace `.RedirectTo` with an arbitrary request parameter. The default `.ConfirmationURL` flow returns credentials in a browser fragment and cannot establish the required server cookie session.

Verify signup, email confirmation, sign-in, sign-out, generated-plan save, invitation acceptance, and password reset if enabled. Each callback must preserve the generated-save or invitation token and must reject unapproved redirect origins.

Apply `supabase/migrations/20260820090000_agreeaway_invitation_brand.sql`. Keep the existing database, users, schemas, and historical audit/source snapshots unchanged.

## 3. Invitation email

1. In Resend, add and verify `agreeaway.com` or a dedicated sending subdomain.
2. Publish Resend's exact SPF and DKIM records. Add DMARC after confirming the sending setup and policy with the domain owner.
3. Set the Supabase Edge Function secrets:
   - `AGREEAWAY_SITE_URL=https://agreeaway.com`
   - `RESEND_FROM=AgreeAway <invitations@agreeaway.com>` only after that sender domain is verified
4. Redeploy `send-plan-invite` and send a controlled test invitation.

Until the AgreeAway domain is verified, the function uses Resend's verified onboarding fallback. Never configure an unverified AgreeAway sender and never expose `RESEND_API_KEY`.

## 4. Google Maps Platform

For the browser-restricted key, allow:

- `https://agreeaway.com/*`
- `https://www.agreeaway.com/*`
- localhost only while local browser testing is needed

The server key does not use HTTP referrer restrictions. Retain old-domain referrers only when the owner/legal transition permits. Verify Places and Routes from the deployed AgreeAway domain.

## 5. Final acceptance

- Homepage, metadata, generated copy, progressive intake, dashboard, auth, saved edits, invitations, collaboration, print/share surfaces, and mobile show no mixed branding.
- Canonical and customer-facing links use `https://agreeaway.com`.
- A generated draft survives the legacy browser-storage migration.
- Signup/auth callbacks and an invitation link work on the new domain.
- Places and Routes work on the new domain.
- Browser console and relevant network requests contain no application errors or secrets.

Do not mark the cutover complete until DNS/SSL are live, auth callbacks pass, and a real invitation email links to `agreeaway.com`.
