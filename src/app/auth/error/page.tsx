import Link from "next/link";
import { Sparkles } from "lucide-react";

import { authContinuationFromParams, authContinuationPath } from "@/lib/supabase/auth-continuation";

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["continue", "invite"] as const) {
    const value = values[key];
    if (typeof value === "string") params.set(key, value);
  }
  const recoveryPath = authContinuationPath(authContinuationFromParams(params));
  return <main className="grid min-h-screen place-items-center bg-[#f4f1ea] p-5"><div className="w-full max-w-md rounded-[30px] border border-[#1e2822]/10 bg-[#fffdf8] p-8 text-center shadow-xl"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#194d3a] text-white"><Sparkles className="size-6" /></span><h1 className="mt-6 font-serif text-4xl tracking-[-.04em]">That confirmation link didn’t work</h1><p className="mt-4 leading-7 text-[#69766e]">It may have expired or already been used. Your draft is still safe in this browser. Sign in to finish where you left off, or request a new confirmation email.</p><Link href={recoveryPath} className="mt-7 inline-flex rounded-full bg-[#d96545] px-6 py-3 text-sm font-bold text-white">Continue to sign in</Link><Link href="/" className="mt-4 block text-sm font-semibold text-[#657168]">Back to AgreeAway</Link></div></main>;
}
