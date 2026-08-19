"use client";

import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Heart,
  LoaderCircle,
  LogIn,
  Map,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  PartyPopper,
  Plane,
  Plus,
  Send,
  Trash2,
  RotateCcw,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Plan, PlanCategory, PlanItem } from "@/lib/plan-schema";
import { samplePlan } from "@/lib/sample-plan";
import { createClient } from "@/lib/supabase/client";
import {
  pendingPlanStorageKey,
  persistGeneratedPlan,
  type PendingGeneratedPlan,
} from "@/lib/supabase/save-generated-plan";

const categories: Array<{
  id: PlanCategory;
  label: string;
  description: string;
  prompt: string;
  icon: typeof Heart;
}> = [
  {
    id: "date",
    label: "A date",
    description: "Dinner, drinks, shows, and something memorable.",
    prompt:
      "Friday night in San Francisco for two. Dinner and something afterward, around $250 total. Lively but not clubby, and home by 10:30.",
    icon: Heart,
  },
  {
    id: "personal-trip",
    label: "A personal trip",
    description: "Flights, neighborhoods, stays, and full days that flow.",
    prompt:
      "About 10 days in Spain in September for two adults, flying from SFO. We love restaurants, beaches, and wineries and prefer staying in two places.",
    icon: Plane,
  },
  {
    id: "group-trip",
    label: "A group trip",
    description: "Weekends away, celebrations, and everyone’s constraints.",
    prompt:
      "A Friday-to-Sunday Napa weekend for 10 friends, around $1,500 each. Wineries on Saturday, a great dinner, and enough downtime.",
    icon: PartyPopper,
  },
  {
    id: "team-offsite",
    label: "A team offsite",
    description: "Focused work, shared meals, and time to reconnect.",
    prompt:
      "A two-day offsite near Austin for a 16-person remote team. Half strategy, half connection, with a comfortable hotel and one standout group dinner.",
    icon: Users,
  },
  {
    id: "something-else",
    label: "Something else",
    description: "Tell us what you’re trying to make happen.",
    prompt: "Help me plan ",
    icon: Sparkles,
  },
];

const statusLabels: Record<PlanItem["status"], string> = {
  idea: "Idea",
  selected: "Selected",
  "needs-booking": "Needs booking",
  booked: "Booked",
};

type DraftEditor =
  | { kind: "alternatives"; dayIndex: number; item: PlanItem }
  | { kind: "add"; dayIndex: number; afterIndex: number };

function formatMoney(value: number, currency = "USD") {
  if (!value) return "TBD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function PlanMateExperience({ draftMode = false }: { draftMode?: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState<PlanCategory>("group-trip");
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activeDay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<DraftEditor | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [alternatives, setAlternatives] = useState<PlanItem[]>([]);
  const [searchedAlternatives, setSearchedAlternatives] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [undoPlan, setUndoPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (!draftMode) return;
    const stored = window.sessionStorage.getItem(pendingPlanStorageKey);
    if (!stored) {
      router.replace("/");
      return;
    }
    try {
      const pending = JSON.parse(stored) as PendingGeneratedPlan;
      void Promise.resolve().then(() => {
        setPlan(pending.plan);
        setCategory(pending.category);
        setPrompt(pending.prompt);
      });
    } catch {
      window.sessionStorage.removeItem(pendingPlanStorageKey);
      router.replace("/");
    }
  }, [draftMode, router]);

  const activeCategory = useMemo(
    () => categories.find((item) => item.id === category) ?? categories[2],
    [category],
  );

  function chooseCategory(nextCategory: (typeof categories)[number]) {
    setCategory(nextCategory.id);
    setPrompt("");
    setError(null);
  }

  async function generatePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, prompt }),
      });
      const data = (await response.json()) as { plan?: Plan; error?: string };

      if (!response.ok || !data.plan) {
        throw new Error(data.error ?? "PlanMate could not build that plan.");
      }

      const pending: PendingGeneratedPlan = { plan: data.plan, category, prompt };
      window.sessionStorage.setItem(pendingPlanStorageKey, JSON.stringify(pending));
      setPlan(data.plan);
      router.push("/plan/draft");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "PlanMate could not build that plan.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function savePlan() {
    if (!plan) return;
    setSaving(true);
    setError(null);
    const pending: PendingGeneratedPlan = { plan, category, prompt };
    window.sessionStorage.setItem(pendingPlanStorageKey, JSON.stringify(pending));

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || !data.user) {
        router.push("/collaborate?save=generated");
        return;
      }
      const planId = await persistGeneratedPlan(supabase, data.user, pending);
      window.sessionStorage.removeItem(pendingPlanStorageKey);
      router.push(`/collaborate?plan=${planId}&saved=1`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save this plan.");
      setSaving(false);
    }
  }

  function commitDraft(nextPlan: Plan) {
    if (plan) setUndoPlan(plan);
    setPlan(nextPlan);
    window.sessionStorage.setItem(
      pendingPlanStorageKey,
      JSON.stringify({ plan: nextPlan, category, prompt } satisfies PendingGeneratedPlan),
    );
  }

  async function requestEdit(payload: Record<string, unknown>) {
    const response = await fetch("/api/plan/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as { plan?: Plan; alternatives?: PlanItem[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "PlanMate could not update the plan.");
    return data;
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || !editor || !editInstruction.trim()) return;
    setEditing(true); setError(null); setEditError(null);
    try {
      if (editor.kind === "alternatives") {
        const data = await requestEdit({ operation: "alternatives", plan, dayIndex: editor.dayIndex, itemId: editor.item.id, instruction: editInstruction });
        setAlternatives(data.alternatives ?? []);
        setSearchedAlternatives(true);
      } else {
        const data = await requestEdit({ operation: "add", plan, dayIndex: editor.dayIndex, insertAfterIndex: editor.afterIndex, instruction: editInstruction });
        if (data.plan) commitDraft(data.plan);
        closeEditor();
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "PlanMate could not update the plan.";
      setError(message); setEditError(message);
    } finally { setEditing(false); }
  }

  async function replaceItem(replacement: PlanItem) {
    if (!plan || editor?.kind !== "alternatives") return;
    setEditing(true); setError(null); setEditError(null);
    try {
      const data = await requestEdit({ operation: "replace", plan, dayIndex: editor.dayIndex, itemId: editor.item.id, replacement });
      if (data.plan) commitDraft(data.plan);
      closeEditor();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "PlanMate could not replace that stop.";
      setError(message); setEditError(message);
    } finally { setEditing(false); }
  }

  async function removeItem(dayIndex: number, item: PlanItem) {
    if (!plan) return;
    setEditing(true); setError(null);
    try {
      const data = await requestEdit({ operation: "remove", plan, dayIndex, itemId: item.id, instruction: `Remove ${item.title} and reflow the remaining day.` });
      if (data.plan) commitDraft(data.plan);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "PlanMate could not remove that stop.");
    } finally { setEditing(false); }
  }

  function openEditor(nextEditor: DraftEditor) {
    setEditor(nextEditor); setAlternatives([]); setSearchedAlternatives(false); setEditInstruction(""); setEditError(null); setError(null);
  }

  function closeEditor() {
    setEditor(null); setAlternatives([]); setSearchedAlternatives(false); setEditInstruction(""); setEditError(null);
  }

  function undoLastEdit() {
    if (!undoPlan) return;
    const previous = undoPlan;
    setUndoPlan(plan);
    setPlan(previous);
    window.sessionStorage.setItem(pendingPlanStorageKey, JSON.stringify({ plan: previous, category, prompt } satisfies PendingGeneratedPlan));
  }

  const displayedPlan = plan ?? samplePlan;
  const activeItems = displayedPlan.days[activeDay]?.items ?? [];
  const accommodationItems = displayedPlan.days.length > 1 ? activeItems.filter((item) => item.type === "accommodation") : [];
  const activityItems = displayedPlan.days.length > 1 ? activeItems.filter((item) => item.type !== "accommodation") : activeItems;

  if (draftMode && !plan) {
    return <main className="grid min-h-screen place-items-center bg-[#e9eee8]"><LoaderCircle className="size-8 animate-spin text-[#194d3a]" /></main>;
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f6f3ed] text-[#1e2822]">
      <header className={draftMode ? "hidden" : "relative z-20 border-b border-[#1e2822]/10 bg-[#f6f3ed]/90 backdrop-blur-xl"}>
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <a href="#top" className="flex items-center gap-3" aria-label="PlanMate home">
            <span className="grid size-10 place-items-center rounded-[14px] bg-[#194d3a] text-white shadow-[0_8px_30px_rgba(25,77,58,0.2)]">
              <Sparkles className="size-5" strokeWidth={1.8} />
            </span>
            <span className="text-[21px] font-semibold tracking-[-0.04em]">PlanMate</span>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#526057] md:flex">
            <a className="transition-colors hover:text-[#194d3a]" href="#how-it-works">
              How it works
            </a>
            <a className="transition-colors hover:text-[#194d3a]" href="#example-plan">
              See an example
            </a>
          </nav>

          <Link href="/collaborate" className="rounded-full border border-[#1e2822]/15 bg-white px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-[#194d3a]/30 hover:shadow-md">
            Sign in
          </Link>
        </div>
      </header>

      <section id="top" className={draftMode ? "hidden" : "relative px-5 pb-24 pt-16 sm:px-8 sm:pt-24 lg:px-12"}>
        <div className="pointer-events-none absolute -right-28 top-4 size-[440px] rounded-full border border-[#d96d4b]/15" />
        <div className="pointer-events-none absolute -right-8 top-24 size-[240px] rounded-full border border-[#194d3a]/15" />

        <div className="relative mx-auto grid max-w-[1280px] gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-12 xl:gap-20">
          <div className="pt-2 lg:sticky lg:top-28">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#194d3a]/15 bg-[#e9efe9] px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[#194d3a]">
              <Sparkles className="size-3.5" />
              AI planning + collaboration
            </div>
            <h1 className="max-w-2xl font-serif text-[clamp(3.25rem,6.5vw,6.8rem)] leading-[0.9] tracking-[-0.06em] text-[#17261f]">
              What are you planning?
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#627067] sm:text-xl">
              Plan anything with AI, then invite the people involved to vote, comment, and agree on the final plan together.
            </p>

            <div id="how-it-works" className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#667269]">
              {["Built around your constraints", "Easy to change", "Ready to share"].map(
                (benefit) => (
                  <span key={benefit} className="flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-[#194d3a] text-white">
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                    {benefit}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-[#1e2822]/10 bg-[#fffdf8] p-4 shadow-[0_28px_80px_rgba(40,53,46,0.12)] sm:p-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories.map((item) => {
                const Icon = item.icon;
                const selected = item.id === category;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseCategory(item)}
                    className={`group min-h-24 rounded-[20px] border p-4 text-left transition duration-200 sm:min-h-28 ${
                      selected
                        ? "border-[#194d3a] bg-[#194d3a] text-white shadow-lg shadow-[#194d3a]/15"
                        : "border-[#1e2822]/10 bg-white text-[#26352d] hover:-translate-y-0.5 hover:border-[#194d3a]/30 hover:shadow-md"
                    } ${item.id === "something-else" ? "col-span-2 sm:col-span-1" : ""}`}
                  >
                    <Icon className={`mb-3 size-5 ${selected ? "text-[#f1c47b]" : "text-[#cc6448]"}`} strokeWidth={1.8} />
                    <span className="block text-sm font-bold sm:text-[15px]">{item.label}</span>
                    <span className={`mt-1.5 hidden text-xs leading-5 sm:block ${selected ? "text-white/70" : "text-[#718078]"}`}>
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <form onSubmit={generatePlan} className="mt-4 rounded-[24px] border border-[#1e2822]/10 bg-white p-4 sm:p-5">
              <label htmlFor="plan-prompt" className="flex items-center gap-2 text-sm font-bold text-[#33423a]">
                <MessageCircle className="size-4 text-[#cc6448]" />
                Tell us a little more
              </label>
              <textarea
                id="plan-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={`${activeCategory.prompt} Include dates, budget, people, and the vibe you want.`}
                className="mt-3 w-full resize-none border-0 bg-transparent text-base leading-7 text-[#25352c] outline-none placeholder:text-[#9aa39e] sm:text-[17px]"
              />
              {error ? (
                <p className="mb-3 rounded-xl bg-[#fff0eb] px-3 py-2 text-sm text-[#a4452f]" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 border-t border-[#1e2822]/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-[#859087]">
                  You can change anything after the first draft.
                </p>
                <button
                  type="submit"
                  disabled={loading || prompt.trim().length < 12}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#d96545] px-6 text-sm font-bold text-white shadow-[0_10px_26px_rgba(217,101,69,0.25)] transition hover:-translate-y-0.5 hover:bg-[#c75739] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {loading ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      Building your plan
                    </>
                  ) : (
                    <>
                      Make my plan
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section
        id={plan ? "your-plan" : "example-plan"}
        className="scroll-mt-24 border-y border-[#1e2822]/8 bg-[#e9eee8] px-5 py-20 sm:px-8 lg:px-12 lg:py-28"
      >
        <div className="mx-auto max-w-[1280px]">
          <div className="mb-9 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#d15d3e]">
                  {plan ? "Your first draft" : "A PlanMate plan"}
                </span>
                {!plan ? <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#607067]">Example</span> : null}
              </div>
              <h2 className="max-w-3xl font-serif text-4xl leading-tight tracking-[-0.04em] text-[#1b2c23] sm:text-5xl">
                {displayedPlan.title}
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[#66736b]">
                {displayedPlan.summary}
              </p>
            </div>

            {plan ? (
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                {undoPlan ? <button type="button" onClick={undoLastEdit} className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1e2822]/15 bg-white/70 px-4 py-3 text-sm font-semibold"><RotateCcw className="size-4" />Undo edit</button> : null}
                <button type="button" onClick={() => { setPlan(null); router.push("/"); }} className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1e2822]/15 bg-white/70 px-4 py-3 text-sm font-semibold"><RotateCcw className="size-4" />Start another</button>
                <button type="button" onClick={savePlan} disabled={saving} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#d96545] px-6 text-sm font-bold text-white shadow-[0_10px_26px_rgba(217,101,69,0.25)] transition hover:-translate-y-0.5 hover:bg-[#c75739] disabled:opacity-60">{saving ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}Save this plan</button>
              </div>
            ) : null}
          </div>

          <div className="grid overflow-hidden rounded-[28px] border border-[#1e2822]/10 bg-[#fffdf8] shadow-[0_30px_80px_rgba(35,48,40,0.12)] lg:grid-cols-[260px_minmax(0,1fr)_310px]">
            <aside className="border-b border-[#1e2822]/10 bg-[#f7f3eb] p-5 lg:border-b-0 lg:border-r lg:p-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#d15d3e]">At a glance</p>
                <p className="mt-2 text-sm leading-6 text-[#6d7a72]">{displayedPlan.days.length} {displayedPlan.days.length === 1 ? "day" : "days"}, arranged in one continuous itinerary.</p>
              </div>

              <div className="mt-6 border-t border-[#1e2822]/10 pt-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a958e]">Plan details</p>
                <div className="mt-4 space-y-3 text-sm text-[#526259]">
                  <p className="flex items-center gap-2.5"><MapPin className="size-4 text-[#d15d3e]" />{displayedPlan.location}</p>
                  <p className="flex items-center gap-2.5"><CalendarDays className="size-4 text-[#d15d3e]" />{displayedPlan.dateLabel}</p>
                  <p className="flex items-center gap-2.5"><Users className="size-4 text-[#d15d3e]" />{displayedPlan.partySize} people</p>
                </div>
              </div>
            </aside>

            <div className="min-w-0 p-5 sm:p-8 lg:p-9">
              <div className="divide-y divide-[#1e2822]/12">
                {displayedPlan.days.map((day, dayIndex) => <StackedPlanDay key={`${day.label}-${dayIndex}`} day={day} dayIndex={dayIndex} multiDay={displayedPlan.days.length > 1} currency={displayedPlan.currency} editable={Boolean(plan)} editing={editing} onExplore={(item) => openEditor({ kind: "alternatives", dayIndex, item })} onRemove={(item) => removeItem(dayIndex, item)} onAdd={(afterIndex) => openEditor({ kind: "add", dayIndex, afterIndex })} />)}
              </div>
              <div className="hidden">
              <div className="mb-7 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d15d3e]">Day {activeDay + 1}</p>
                  <h3 className="mt-1 text-2xl font-bold tracking-[-0.03em]">
                    {displayedPlan.days[activeDay]?.label}
                  </h3>
                </div>
                <button className="grid size-10 place-items-center rounded-full border border-[#1e2822]/10 text-[#637168] transition hover:bg-[#f4f0e8]" aria-label="More plan options">
                  <MoreHorizontal className="size-5" />
                </button>
              </div>

              {accommodationItems.length ? (
                <div className="mb-6 rounded-[20px] border border-[#194d3a]/12 bg-[#eef3ed] p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#315d45]"><Building2 className="size-4" />Your stay</div>
                  <div className="mt-3 space-y-3">{accommodationItems.map((item) => <div key={item.id}><p className="text-sm font-bold text-[#25362d]">{item.title}</p><p className="mt-1 text-sm leading-6 text-[#6d7a72]">{item.description}</p><p className="mt-1 text-xs text-[#718078]">{item.location}</p>{item.bookingUrl ? <a href={item.bookingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#315d45]">View in Google Maps<ExternalLink className="size-3" /></a> : null}</div>)}</div>
                </div>
              ) : null}

              <div className="relative space-y-3 before:absolute before:bottom-7 before:left-[19px] before:top-7 before:w-px before:bg-[#1e2822]/10">
                {activityItems.map((item, index) => (
                  <div key={item.id} className="relative">
                  <article className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-4">
                    <div className="relative z-10 mt-5 grid size-10 place-items-center rounded-full border-4 border-[#fffdf8] bg-[#e8eee8] text-[#194d3a]">
                      {index === 0 ? <MapPin className="size-4" /> : <Clock3 className="size-4" />}
                    </div>
                    <div className="rounded-[20px] border border-[#1e2822]/9 bg-white p-4 transition hover:border-[#194d3a]/20 hover:shadow-md sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#d15d3e]">{item.time}</p>
                          <h4 className="mt-1.5 text-[17px] font-bold tracking-[-0.02em] text-[#25362d]">{item.title}</h4>
                        </div>
                        <span className={`self-start rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${item.status === "selected" ? "bg-[#e4efe7] text-[#2b684a]" : "bg-[#fff0e7] text-[#a95538]"}`}>
                          {statusLabels[item.status]}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#718078]">{item.description}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#1e2822]/7 pt-3 text-xs text-[#718078]">
                        <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{item.location}</span>
                        <span className="flex items-center gap-1.5"><CircleDollarSign className="size-3.5" />{formatMoney(item.costPerPerson, displayedPlan.currency)} / person</span>
                        {item.travelMinutes > 0 ? <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{item.travelMinutes} min {item.travelMode ?? "travel"}</span> : null}
                        {["verified", "google-verified"].includes(item.verification) ? <span className="font-bold text-[#2b684a]">Google verified</span> : item.verification === "live-availability" ? <span className="font-bold text-[#2b684a]">Live availability</span> : <span className="font-semibold text-[#8a6b43]">Suggested</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        {(item.googleMapsUrl ?? item.bookingUrl) ? <a href={item.googleMapsUrl ?? item.bookingUrl ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#315d45]">View in Google Maps<ExternalLink className="size-3" /></a> : null}
                        {item.websiteUrl ? <a href={item.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#315d45]">Official website<ExternalLink className="size-3" /></a> : null}
                        {plan && ["meal", "activity", "nightlife"].includes(item.type) ? <button type="button" onClick={() => openEditor({ kind: "alternatives", dayIndex: activeDay, item })} className="text-xs font-bold text-[#c3573b]">Explore alternatives</button> : null}
                        {plan ? <button type="button" onClick={() => removeItem(activeDay, item)} disabled={editing} className="inline-flex items-center gap-1 text-xs font-bold text-[#7c817e] transition hover:text-[#a4452f] disabled:opacity-50"><Trash2 className="size-3" />Remove</button> : null}
                      </div>
                    </div>
                  </article>
                  {plan ? <div className="relative z-20 ml-14 flex h-10 items-center"><button type="button" onClick={() => openEditor({ kind: "add", dayIndex: activeDay, afterIndex: displayedPlan.days[activeDay].items.findIndex((candidate) => candidate.id === item.id) })} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#194d3a]/25 bg-[#fffdf8] px-3 py-1.5 text-xs font-bold text-[#315d45] transition hover:border-[#194d3a]/50 hover:bg-white"><Plus className="size-3.5" />Add a stop here</button></div> : null}
                  </div>
                ))}
              </div>
              </div>
            </div>

            <aside className="border-t border-[#1e2822]/10 bg-[#f7f3eb] p-5 lg:border-l lg:border-t-0 lg:p-6">
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold">Budget snapshot</h4>
                  <button className="text-xs font-bold text-[#c3573b]">View all</button>
                </div>
                <div className="mt-3 divide-y divide-[#1e2822]/8">
                  {displayedPlan.budget.slice(0, 5).map((line) => (
                    <div key={line.category} className="flex items-center justify-between py-3 text-sm">
                      <span className="text-[#6e7b73]">{line.category}</span>
                      <span className="font-semibold">{formatMoney(line.perPerson, displayedPlan.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 rounded-[18px] border border-[#d15d3e]/15 bg-[#fff7ef] p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#9e4c36]">
                  <Sparkles className="size-4" />
                  Ask PlanMate
                </div>
                <p className="mt-2 text-xs leading-5 text-[#7e6e66]">
                  “Make Saturday less packed” or “Bring this under $1,200.”
                </p>
                <button className="mt-3 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2.5 text-left text-xs text-[#8b918d] shadow-sm">
                  Change anything…
                  <ArrowRight className="size-3.5 text-[#d15d3e]" />
                </button>
              </div>
            </aside>
          </div>

          <div className="mt-6 flex items-start gap-2.5 text-xs leading-5 text-[#718078]">
            <Map className="mt-0.5 size-4 shrink-0 text-[#d15d3e]" />
            Suggested places are unverified concepts. Google verified means place details came from Google; it does not mean endorsement or live availability.
          </div>
        </div>
      </section>

      {editor ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#17251e]/45 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={editor.kind === "alternatives" ? "Explore alternatives" : "Add a plan stop"}>
        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-[#fffdf8] shadow-2xl sm:rounded-[28px]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1e2822]/8 bg-[#fffdf8]/95 px-5 py-4 backdrop-blur sm:px-6">
            <div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#d15d3e]">Ask PlanMate</p><h3 className="mt-1 text-xl font-bold">{editor.kind === "alternatives" ? `Explore alternatives to ${editor.item.title}` : "What should we add here?"}</h3></div>
            <button type="button" onClick={closeEditor} className="grid size-10 place-items-center rounded-full bg-[#f0eee8]" aria-label="Close"><X className="size-4" /></button>
          </div>
          <div className="p-5 sm:p-6">
            {editor.kind === "alternatives" ? <div className="mb-5 rounded-2xl border border-[#194d3a]/12 bg-[#eef3ed] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#587166]">Current choice</p><p className="mt-1 font-bold">{editor.item.title}</p><p className="mt-1 text-sm text-[#6d7a72]">{editor.item.location}</p></div> : null}
            <p className="text-sm leading-6 text-[#65736b]">{editor.kind === "alternatives" ? "Tell us what should be different. We’ll keep the rest of your plan in context." : "Describe the stop naturally. PlanMate will insert it and adjust the day’s timing and flow."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(editor.kind === "alternatives" ? ["More romantic", "Less expensive", "Closer to the next stop", "More casual"] : ["A drink spot before dinner", "A coffee stop", "Something outdoors", "Add some downtime"]).map((suggestion) => <button key={suggestion} type="button" onClick={() => setEditInstruction(suggestion)} className="rounded-full border border-[#1e2822]/10 bg-[#f6f3ed] px-3 py-2 text-xs font-semibold text-[#526159]">{suggestion}</button>)}
            </div>
            <form onSubmit={submitEditor} className="mt-5 flex items-end gap-2 rounded-2xl border border-[#1e2822]/12 bg-white p-2 shadow-sm">
              <label className="min-w-0 flex-1"><span className="sr-only">Describe the change</span><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} rows={2} maxLength={500} placeholder={editor.kind === "alternatives" ? "I want somewhere quieter and more intimate…" : "How about a drink spot before dinner?"} className="w-full resize-none bg-transparent px-3 py-2 text-sm outline-none" /></label>
              <button disabled={editing || editInstruction.trim().length < 3} className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#d96545] text-white disabled:opacity-40" aria-label="Send request">{editing ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
            </form>
            {editError ? <p role="alert" className="mt-3 rounded-2xl bg-[#fff0e7] p-4 text-sm text-[#985039]">{editError}</p> : null}
            {editor.kind === "alternatives" && alternatives.length ? <div className="mt-6 space-y-3"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#69766e]">Google-verified options</p>{alternatives.map((alternative) => <div key={alternative.id} className="rounded-2xl border border-[#1e2822]/9 bg-white p-4"><div className="flex items-start justify-between gap-4"><div><h4 className="font-bold">{alternative.title}</h4><p className="mt-1 text-sm text-[#6d7a72]">{alternative.location}</p><p className="mt-2 text-xs text-[#315d45]">Matches “{editInstruction}”</p></div><button type="button" disabled={editing} onClick={() => replaceItem(alternative)} className="shrink-0 rounded-full bg-[#194d3a] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Choose</button></div>{alternative.bookingUrl ? <a href={alternative.bookingUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#315d45]">View on Maps<ExternalLink className="size-3" /></a> : null}</div>)}</div> : null}
            {editor.kind === "alternatives" && searchedAlternatives && !alternatives.length ? <p className="mt-5 rounded-2xl bg-[#fff0e7] p-4 text-sm text-[#985039]">No strong matches came back. Try describing a neighborhood, cuisine, price point, or vibe.</p> : null}
            {editor.kind === "alternatives" ? <button type="button" onClick={closeEditor} className="mt-5 w-full py-2 text-sm font-semibold text-[#65736b]">Keep original choice</button> : null}
          </div>
        </div>
      </div> : null}

      <footer className="bg-[#183b2d] px-5 py-10 text-white sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1280px] flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-white/10 text-[#f1c47b]"><Sparkles className="size-4" /></span>
            <span className="font-semibold tracking-[-0.03em]">PlanMate</span>
          </div>
          <p className="text-sm text-white/55">The plan is the product.</p>
        </div>
      </footer>
    </main>
  );
}

function StackedPlanDay({ day, dayIndex, multiDay, currency, editable, editing, onExplore, onRemove, onAdd }: { day: Plan["days"][number]; dayIndex: number; multiDay: boolean; currency: string; editable: boolean; editing: boolean; onExplore: (item: PlanItem) => void; onRemove: (item: PlanItem) => void; onAdd: (afterIndex: number) => void }) {
  const accommodations = multiDay ? day.items.filter((item) => item.type === "accommodation") : [];
  const activities = multiDay ? day.items.filter((item) => item.type !== "accommodation") : day.items;
  return <section className="py-9 first:pt-0 last:pb-0">
    <div className="mb-7 flex items-end justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d15d3e]">Day {dayIndex + 1} · {day.date}</p><h3 className="mt-1 text-2xl font-bold tracking-[-0.03em]">{day.label}</h3></div>
      <span className="text-xs font-semibold text-[#8a958e]">{activities.length} {activities.length === 1 ? "stop" : "stops"}</span>
    </div>
    {accommodations.length ? <div className="mb-6 rounded-[18px] border border-[#194d3a]/10 bg-[#eef3ed] px-4 py-3.5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#315d45]"><Building2 className="size-4" />Your stay</div>{accommodations.map((item) => <div key={item.id} className="mt-3"><p className="text-sm font-bold text-[#25362d]">{item.title}</p><p className="mt-1 text-sm leading-6 text-[#6d7a72]">{item.description}</p><p className="mt-1 text-xs text-[#718078]">{item.location}</p></div>)}</div> : null}
    <div className="relative space-y-3 before:absolute before:bottom-7 before:left-[19px] before:top-7 before:w-px before:bg-[#1e2822]/10">
      {activities.map((item, index) => <div key={item.id} className="relative">
        <article className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-4">
          <div className="relative z-10 mt-5 grid size-10 place-items-center rounded-full border-4 border-[#fffdf8] bg-[#e8eee8] text-[#194d3a]">{index === 0 ? <MapPin className="size-4" /> : <Clock3 className="size-4" />}</div>
          <div className="rounded-[18px] border border-[#1e2822]/8 bg-white p-4 transition hover:border-[#194d3a]/20 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#d15d3e]">{item.time}</p><h4 className="mt-1.5 text-[17px] font-bold tracking-[-0.02em] text-[#25362d]">{item.title}</h4></div><span className={`self-start rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${item.status === "selected" ? "bg-[#e4efe7] text-[#2b684a]" : "bg-[#fff0e7] text-[#a95538]"}`}>{statusLabels[item.status]}</span></div>
            <p className="mt-2 text-sm leading-6 text-[#718078]">{item.description}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#1e2822]/7 pt-3 text-xs text-[#718078]"><span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{item.location}</span><span className="flex items-center gap-1.5"><CircleDollarSign className="size-3.5" />{formatMoney(item.costPerPerson, currency)} / person</span>{item.travelMinutes > 0 ? <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{item.travelMinutes} min {item.travelMode ?? "travel"}</span> : null}{["verified", "google-verified"].includes(item.verification) ? <span className="font-bold text-[#2b684a]">Google verified</span> : <span className="font-semibold text-[#8a6b43]">Suggested</span>}</div>
            <div className="mt-3 flex flex-wrap items-center gap-4">{item.bookingUrl ? <a href={item.bookingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#315d45]">View in Google Maps<ExternalLink className="size-3" /></a> : null}{editable && ["meal", "activity", "nightlife"].includes(item.type) ? <button type="button" onClick={() => onExplore(item)} className="text-xs font-bold text-[#c3573b]">Explore alternatives</button> : null}{editable ? <button type="button" onClick={() => onRemove(item)} disabled={editing} className="inline-flex items-center gap-1 text-xs font-bold text-[#7c817e] hover:text-[#a4452f] disabled:opacity-50"><Trash2 className="size-3" />Remove</button> : null}</div>
          </div>
        </article>
        {editable ? <div className="relative z-20 ml-14 flex h-10 items-center"><button type="button" onClick={() => onAdd(day.items.findIndex((candidate) => candidate.id === item.id))} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#194d3a]/25 bg-[#fffdf8] px-3 py-1.5 text-xs font-bold text-[#315d45]"><Plus className="size-3.5" />Add a stop here</button></div> : null}
      </div>)}
    </div>
  </section>;
}
