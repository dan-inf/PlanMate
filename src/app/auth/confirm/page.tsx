"use client";

import { CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { authContinuationFromRedirectUrl, authContinuationPath, type AuthContinuation } from "@/lib/supabase/auth-continuation";
import { createClient } from "@/lib/supabase/client";

type ConfirmationState = "ready" | "confirming" | "recover" | "missing";

export default function AuthConfirmPage() {
  const [state, setState] = useState<ConfirmationState>("missing");
  const [tokenHash, setTokenHash] = useState("");
  const [continuation, setContinuation] = useState<AuthContinuation>({ kind: "account" });

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("token_hash") ?? "";
    const redirectTo = fragment.get("redirect_to") ?? "";
    const nextContinuation = authContinuationFromRedirectUrl(redirectTo, window.location.origin);
    window.history.replaceState({}, "", window.location.pathname);
    const readyTimer = window.setTimeout(() => {
      setContinuation(nextContinuation);
      setTokenHash(token);
      setState(token ? "ready" : "missing");
    }, 0);
    return () => window.clearTimeout(readyTimer);
  }, []);

  async function confirm() {
    if (!tokenHash || state === "confirming") return;
    setState("confirming");
    const { error } = await createClient().auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error) {
      setTokenHash("");
      setState("recover");
      return;
    }
    window.location.replace(authContinuationPath(continuation));
  }

  function recover() {
    window.location.assign(authContinuationPath(continuation));
  }

  return <main className="grid min-h-screen place-items-center bg-[#f4f1ea] p-5"><div className="w-full max-w-md rounded-[30px] border border-[#1e2822]/10 bg-[#fffdf8] p-8 text-center shadow-xl"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#194d3a] text-white"><Sparkles className="size-6" /></span>{state === "ready" ? <><h1 className="mt-6 font-serif text-4xl tracking-[-.04em]">Confirm your AgreeAway account</h1><p className="mt-4 leading-7 text-[#69766e]">Your email link is ready. Confirm below to sign in and finish saving or joining your Plan.</p><button type="button" onClick={() => void confirm()} className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#d96545] px-6 text-sm font-bold text-white"><CheckCircle2 className="size-4" />Confirm and continue</button></> : state === "confirming" ? <><LoaderCircle className="mx-auto mt-7 size-7 animate-spin text-[#d96545]" /><h1 className="mt-5 font-serif text-4xl tracking-[-.04em]">Confirming your account</h1><p className="mt-3 text-sm leading-6 text-[#69766e]">You’ll return to your Plan automatically.</p></> : <><h1 className="mt-6 font-serif text-4xl tracking-[-.04em]">Your email may already be confirmed</h1><p className="mt-4 leading-7 text-[#69766e]">Sign in with the password you created to finish saving or joining your Plan. Your draft remains safe in this browser.</p><button type="button" onClick={recover} className="mt-7 inline-flex rounded-full bg-[#d96545] px-6 py-3 text-sm font-bold text-white">Sign in to continue</button></>}</div></main>;
}
