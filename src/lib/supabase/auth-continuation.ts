export type AuthContinuation =
  | { kind: "save" }
  | { kind: "invite"; token: string }
  | { kind: "account" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authContinuationFromParams(params: URLSearchParams): AuthContinuation {
  const kind = params.get("continue");
  if (kind === "save") return { kind: "save" };
  if (kind === "invite") {
    const token = params.get("invite") ?? "";
    if (uuidPattern.test(token)) return { kind: "invite", token };
  }
  return { kind: "account" };
}

export function authContinuationQuery(continuation: AuthContinuation) {
  const params = new URLSearchParams();
  params.set("continue", continuation.kind);
  if (continuation.kind === "invite") params.set("invite", continuation.token);
  return params.toString();
}

export function authContinuationPath(continuation: AuthContinuation) {
  if (continuation.kind === "save") return "/collaborate?save=generated";
  if (continuation.kind === "invite") return `/collaborate?invite=${encodeURIComponent(continuation.token)}`;
  return "/collaborate";
}

export function authCallbackUrl(origin: string, continuation: AuthContinuation) {
  const url = new URL("/auth/callback", origin);
  const query = authContinuationQuery(continuation);
  url.search = query;
  return url.toString();
}

export function authContinuationFromRedirectUrl(value: string, currentOrigin: string) {
  try {
    const redirect = new URL(value);
    if (redirect.origin !== currentOrigin || redirect.pathname !== "/auth/callback") return { kind: "account" } satisfies AuthContinuation;
    return authContinuationFromParams(redirect.searchParams);
  } catch {
    return { kind: "account" } satisfies AuthContinuation;
  }
}
