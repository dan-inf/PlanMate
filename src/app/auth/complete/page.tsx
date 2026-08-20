"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { authContinuationFromParams, authContinuationPath } from "@/lib/supabase/auth-continuation";
import { createClient } from "@/lib/supabase/client";

export default function AuthCompletePage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const continuation = authContinuationFromParams(new URLSearchParams(window.location.search));
    const destination = authContinuationPath(continuation);
    let finished = false;

    const continueAuthenticated = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || finished) return;
      finished = true;
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
      window.location.replace(destination);
    };

    void continueAuthenticated();
    const { data: listener } = supabase.auth.onAuthStateChange(() => void continueAuthenticated());
    const timeout = window.setTimeout(() => { if (!finished) setFailed(true); }, 4000);
    return () => { window.clearTimeout(timeout); listener.subscription.unsubscribe(); };
  }, []);

  function recover() {
    const continuation = authContinuationFromParams(new URLSearchParams(window.location.search));
    window.location.assign(authContinuationPath(continuation));
  }

  return <main className="grid min-h-screen place-items-center bg-[#f4f1ea] p-5"><div className="w-full max-w-md rounded-[30px] border border-[#1e2822]/10 bg-[#fffdf8] p-8 text-center shadow-xl"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#194d3a] text-white"><Sparkles className="size-6" /></span>{failed ? <><h1 className="mt-6 font-serif text-4xl tracking-[-.04em]">We couldn’t finish signing you in</h1><p className="mt-4 leading-7 text-[#69766e]">The confirmation link may have expired. Your draft is still safe in this browser. Sign in to finish saving or joining your Plan.</p><button type="button" onClick={recover} className="mt-7 inline-flex rounded-full bg-[#d96545] px-6 py-3 text-sm font-bold text-white">Continue to sign in</button></> : <><LoaderCircle className="mx-auto mt-7 size-7 animate-spin text-[#d96545]" /><h1 className="mt-5 font-serif text-4xl tracking-[-.04em]">Finishing your account</h1><p className="mt-3 text-sm leading-6 text-[#69766e]">You’ll return to your Plan automatically.</p></>}</div></main>;
}
