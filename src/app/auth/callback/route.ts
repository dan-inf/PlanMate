import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { authContinuationFromParams, authContinuationPath, authContinuationQuery } from "@/lib/supabase/auth-continuation";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function appOrigin(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return request.nextUrl.origin;
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://agreeaway.com").replace(/\/$/, "");
}

export async function GET(request: NextRequest) {
  const continuation = authContinuationFromParams(request.nextUrl.searchParams);
  const destination = new URL(authContinuationPath(continuation), appOrigin(request));
  const failure = new URL("/auth/error", appOrigin(request));
  failure.searchParams.set("reason", "confirmation");
  for (const [key, value] of new URLSearchParams(authContinuationQuery(continuation))) failure.searchParams.set(key, value);

  const supabase = await createClient();
  const existing = await supabase.auth.getUser();
  if (existing.data.user) return NextResponse.redirect(destination);

  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  let failed = false;

  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(result.error);
  } else if (tokenHash && type) {
    const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(result.error);
  } else {
    const completion = new URL("/auth/complete", appOrigin(request));
    for (const [key, value] of new URLSearchParams(authContinuationQuery(continuation))) completion.searchParams.set(key, value);
    return NextResponse.redirect(completion);
  }

  if (failed) return NextResponse.redirect(failure);
  const verified = await supabase.auth.getUser();
  return NextResponse.redirect(verified.data.user ? destination : failure);
}
