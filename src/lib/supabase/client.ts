import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://hsmuzlztcwvfkudzmclt.supabase.co";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "sb_publishable_cRK0hZv9V27YrVmP5YCbWw_D3dCTTE9";

  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is missing.");
  }

  return createBrowserClient(url, publishableKey);
}
