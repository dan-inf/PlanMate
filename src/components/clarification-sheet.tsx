"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { clarificationAnswersComplete, type ClarificationQuestion, type IntakeField, type TimingDetails, type TimingMode } from "@/lib/planning-intake";

type Props = {
  questions: ClarificationQuestion[];
  answers: Record<string, string>;
  timingMode?: TimingMode;
  timingDetails: TimingDetails;
  loading: boolean;
  error: string | null;
  onAnswer: (field: IntakeField, value: string) => void;
  onTimingMode: (mode: TimingMode) => void;
  onTimingDetails: (details: TimingDetails) => void;
  onBuild: () => void;
  onSkip: () => void;
  onClose: () => void;
};

export function ClarificationSheet(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    scrollRef.current?.scrollTo({ top: 0 });
    return () => { document.body.style.overflow = previous; };
  }, []);

  const complete = clarificationAnswersComplete(props.questions, props.answers);
  const setTiming = (details: TimingDetails) => props.onTimingDetails(details);

  return <div className="fixed inset-0 z-50 flex items-end bg-[#17251e]/45 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5" role="dialog" aria-modal="true" aria-label="Plan clarification" aria-busy={props.loading}>
    <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-[#fffdf8] shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-[28px]">
      <header className="flex shrink-0 items-start justify-between border-b border-[#1e2822]/8 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-7 sm:pt-7">
        <div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#d15d3e]">A better first draft</p><h2 className="mt-1 font-serif text-3xl tracking-[-.04em]">Let’s make this useful.</h2><p className="mt-1 text-sm leading-6 text-[#6c7971]">A few details will change the plan.</p></div>
        <button type="button" disabled={props.loading} aria-label="Close clarification" onClick={props.onClose} className="grid size-11 shrink-0 place-items-center rounded-full text-[#526159] disabled:opacity-40"><X className="size-5" /></button>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
        <div className="space-y-6 pb-5">{props.questions.map((question) => <fieldset key={question.id} disabled={props.loading}><legend className="text-sm font-bold text-[#33423a]">{question.label}</legend>
          <div className="mt-2 flex flex-wrap gap-2">{question.options.map((option) => { const mode = option === "Exact dates" ? "exact" : option === "Month or season" ? "month-season" : option === "Flexible" ? "flexible" : undefined; const selected = question.id === "timing" ? props.timingMode === mode : props.answers[question.id] === option; return <button key={option} type="button" onClick={() => question.id === "timing" && mode ? props.onTimingMode(mode) : props.onAnswer(question.id, option)} aria-pressed={selected} className={`rounded-full border px-3 py-2 text-xs font-semibold ${selected ? "border-[#194d3a] bg-[#194d3a] text-white" : "border-[#1e2822]/12 bg-white text-[#526159]"}`}>{option}</button>; })}</div>
          {question.id === "timing" ? <div data-timing-details className="mt-3 rounded-2xl bg-[#f3f4ef] p-3">
            {props.timingMode === "exact" ? <div className="grid gap-3 sm:grid-cols-2"><DateField label="Start date" value={props.timingDetails.start} onChange={(start) => setTiming({ ...props.timingDetails, start })} /><DateField label="End date (optional)" min={props.timingDetails.start} value={props.timingDetails.end} onChange={(end) => setTiming({ ...props.timingDetails, end })} /></div> : null}
            {props.timingMode === "month-season" ? <div className="space-y-3"><label className="block text-xs font-semibold text-[#526159]">Month<input type="month" value={props.timingDetails.month ?? ""} onChange={(event) => setTiming({ month: event.target.value })} className="mt-1 block w-full rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2.5 text-sm" /></label><p className="text-center text-[11px] font-bold uppercase tracking-wider text-[#8a958e]">or</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-[#526159]">Season<select value={props.timingDetails.season ?? ""} onChange={(event) => setTiming({ season: event.target.value, seasonYear: props.timingDetails.seasonYear })} className="mt-1 block w-full rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2.5 text-sm"><option value="">Choose</option><option>Spring</option><option>Summer</option><option>Fall</option><option>Winter</option></select></label><label className="text-xs font-semibold text-[#526159]">Year (optional)<input inputMode="numeric" placeholder="Not sure" value={props.timingDetails.seasonYear ?? ""} onChange={(event) => setTiming({ season: props.timingDetails.season, seasonYear: event.target.value })} className="mt-1 block w-full rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2.5 text-sm" /></label></div></div> : null}
            {props.timingMode === "flexible" ? <div><p className="text-xs leading-5 text-[#657168]">Anytime is a complete answer. Add an optional window if useful.</p><div className="mt-2 grid gap-3 sm:grid-cols-2"><DateField label="Earliest" value={props.timingDetails.earliest} onChange={(earliest) => setTiming({ ...props.timingDetails, earliest })} /><DateField label="Latest" min={props.timingDetails.earliest} value={props.timingDetails.latest} onChange={(latest) => setTiming({ ...props.timingDetails, latest })} /></div></div> : null}
            {!props.timingMode ? <p className="text-xs text-[#657168]">Choose how specific your timing is.</p> : null}
          </div> : <input value={props.answers[question.id] ?? ""} onChange={(event) => props.onAnswer(question.id, event.target.value)} placeholder={question.placeholder} className="mt-2 w-full rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2.5 text-sm outline-none" />}
        </fieldset>)}</div>
      </div>
      <footer className="shrink-0 border-t border-[#1e2822]/8 bg-[#fffdf8]/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-7">
        <div aria-live="polite">{props.error ? <p className="mb-2 rounded-xl bg-[#fff0eb] px-3 py-2 text-sm text-[#a4452f]" role="alert">{props.error}</p> : null}</div>
        <button type="button" disabled={props.loading || !complete} onClick={props.onBuild} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#d96545] px-5 text-sm font-bold text-white disabled:opacity-50">{props.loading ? <><LoaderCircle className="size-4 animate-spin" />Building your plan…</> : props.error ? "Try again" : "Build my plan"}</button>
        <button type="button" disabled={props.loading} onClick={props.onSkip} className="mt-1 w-full py-2 text-sm font-semibold text-[#657168] disabled:opacity-40">Skip — make reasonable assumptions</button>
      </footer>
    </div>
  </div>;
}

function DateField({ label, value, min, onChange }: { label: string; value?: string; min?: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-[#526159]">{label}<input type="date" min={min} value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2.5 text-sm" /></label>;
}
