"use client";

import type { User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MapPin,
  Plus,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { planCategorySchema, planSchema } from "@/lib/plan-schema";
import { samplePlan } from "@/lib/sample-plan";
import { createClient } from "@/lib/supabase/client";
import {
  pendingPlanStorageKey,
  persistGeneratedPlan,
} from "@/lib/supabase/save-generated-plan";

type PlanRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  primary_location: string;
  dateLabel?: string;
  status: "draft" | "active" | "approval-pending" | "agreed" | "archived";
  approval_version: number;
  finalized_at: string | null;
  approval_rule: "unanimous" | "majority" | "owner-decides";
};
type Member = { plan_id: string; user_id: string; role: "owner" | "editor" | "collaborator"; display_name: string };
type Item = { id: string; plan_id: string; day_id: string; title: string; description: string; location_name: string; start_time: string | null; sort_order: number; estimated_cost_per_person: number | null; travel_minutes: number | null; booking_status: "idea" | "selected" | "needs-booking" | "booked" | "cancelled"; booking_url: string | null };
type Day = { id: string; label: string; day_index: number; items: Item[] };
type Vote = { plan_item_id: string; user_id: string; value: -1 | 1 };
type Comment = { id: string; plan_item_id: string; user_id: string; body: string; created_at: string };
type Approval = { user_id: string; plan_version: number };
type Invitation = { id: string; email: string; status: "pending" | "accepted" | "revoked" | "expired"; expires_at: string; created_at: string };

const statusCopy = {
  draft: "Draft",
  active: "Open for input",
  "approval-pending": "Awaiting agreement",
  agreed: "Everyone agrees",
  archived: "Archived",
};

export function CollaborationWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledEntryAction = useRef(false);

  const loadPlan = useCallback(async (planId: string) => {
    setBusy(true);
    setError(null);
    const [planResult, daysResult, itemsResult, membersResult, approvalsResult, invitationsResult] = await Promise.all([
      supabase.from("plans").select("id,owner_id,title,description,primary_location,status,approval_version,finalized_at,approval_rule").eq("id", planId).single(),
      supabase.from("plan_days").select("id,label,day_index").eq("plan_id", planId).order("day_index"),
      supabase.from("plan_items").select("id,plan_id,day_id,title,description,location_name,start_time,sort_order,estimated_cost_per_person,travel_minutes,booking_status,booking_url").eq("plan_id", planId).order("sort_order"),
      supabase.from("plan_members").select("plan_id,user_id,role").eq("plan_id", planId),
      supabase.from("plan_approvals").select("user_id,plan_version").eq("plan_id", planId),
      supabase.from("plan_invitations").select("id,email,status,expires_at,created_at").eq("plan_id", planId).order("created_at", { ascending: false }),
    ]);
    const firstError = planResult.error ?? daysResult.error ?? itemsResult.error ?? membersResult.error ?? approvalsResult.error ?? invitationsResult.error;
    if (firstError || !planResult.data) {
      setError(firstError?.message ?? "Plan not found.");
      setBusy(false);
      return;
    }
    const itemRows = (itemsResult.data ?? []) as Item[];
    const memberRows = (membersResult.data ?? []) as Omit<Member, "display_name">[];
    const memberIds = memberRows.map((member) => member.user_id);
    const [profilesResult, votesResult, commentsResult] = await Promise.all([
      memberIds.length ? supabase.from("profiles").select("id,display_name").in("id", memberIds) : Promise.resolve({ data: [], error: null }),
      itemRows.length ? supabase.from("plan_item_votes").select("plan_item_id,user_id,value").in("plan_item_id", itemRows.map((item) => item.id)) : Promise.resolve({ data: [], error: null }),
      itemRows.length ? supabase.from("plan_item_comments").select("id,plan_item_id,user_id,body,created_at").in("plan_item_id", itemRows.map((item) => item.id)).order("created_at") : Promise.resolve({ data: [], error: null }),
    ]);
    const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.display_name]));
    setPlan(planResult.data as PlanRow);
    const nextDays = ((daysResult.data ?? []) as Omit<Day, "items">[]).map((day) => ({ ...day, items: itemRows.filter((item) => item.day_id === day.id) }));
    setDays(nextDays);
    setMembers(memberRows.map((member) => ({ ...member, display_name: profileMap.get(member.user_id) || "PlanMate member" })));
    setVotes((votesResult.data ?? []) as Vote[]);
    setComments((commentsResult.data ?? []) as Comment[]);
    setApprovals((approvalsResult.data ?? []) as Approval[]);
    setInvitations((invitationsResult.data ?? []) as Invitation[]);
    setBusy(false);
  }, [supabase]);

  const loadPlans = useCallback(async (preferredPlanId?: string) => {
    const { data, error: queryError } = await supabase
      .from("plans")
      .select("id,owner_id,title,description,primary_location,status,approval_version,finalized_at,approval_rule")
      .order("updated_at", { ascending: false });
    if (queryError) setError(queryError.message);
    const nextPlans = (data ?? []) as PlanRow[];
    setPlans(nextPlans);
    const preferredPlan = nextPlans.find((candidate) => candidate.id === preferredPlanId);
    if (preferredPlan) await loadPlan(preferredPlan.id);
    else if (nextPlans.length && !plan) await loadPlan(nextPlans[0].id);
  }, [loadPlan, plan, supabase]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setCheckingAuth(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!user) return;
    if (handledEntryAction.current) return;
    handledEntryAction.current = true;
    const params = new URLSearchParams(window.location.search);
    const invitationToken = params.get("invite");
    const shouldSaveGeneratedPlan = params.get("save") === "generated";
    const requestedPlanId = params.get("plan") ?? undefined;
    if (invitationToken) {
      supabase.rpc("accept_plan_invitation", { invitation_token: invitationToken }).then(({ data, error: inviteError }) => {
        setBusy(false);
        if (inviteError) setError(inviteError.message);
        else if (data) {
          window.history.replaceState({}, "", "/collaborate");
          setNotice("Invitation accepted. Welcome to the plan.");
          loadPlans().then(() => loadPlan(data as string));
        }
      });
    } else if (shouldSaveGeneratedPlan) {
      const stored = window.sessionStorage.getItem(pendingPlanStorageKey);
      if (!stored) {
        void Promise.resolve().then(() => {
          setError("Your generated plan is no longer available. Return to the planner and generate it again.");
          return loadPlans();
        });
        return;
      }
      void (async () => {
        setBusy(true);
        try {
          const parsed = JSON.parse(stored) as { plan?: unknown; category?: unknown; prompt?: unknown };
          const parsedPlan = planSchema.parse(parsed.plan);
          const parsedCategory = planCategorySchema.parse(parsed.category);
          const savedPlanId = await persistGeneratedPlan(supabase, user, {
            plan: parsedPlan,
            category: parsedCategory,
            prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
          });
          window.sessionStorage.removeItem(pendingPlanStorageKey);
          window.history.replaceState({}, "", `/collaborate?plan=${savedPlanId}`);
          setNotice("Your plan is saved. It’s ready to edit and share.");
          await loadPlans(savedPlanId);
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "Could not save this plan.");
        } finally {
          setBusy(false);
        }
      })();
    } else {
      void Promise.resolve().then(() => {
        if (params.get("saved") === "1") setNotice("Your plan is saved. It’s ready to edit and share.");
        return loadPlans(requestedPlanId);
      });
    }
  }, [loadPlan, loadPlans, supabase, user]);

  async function createDemoPlan() {
    if (!user) return;
    setBusy(true);
    setError(null);
    const { data: createdPlan, error: planError } = await supabase.from("plans").insert({
      owner_id: user.id,
      title: samplePlan.title,
      plan_type: "group-trip",
      description: samplePlan.summary,
      primary_location: samplePlan.location,
      participant_count: samplePlan.partySize,
      budget_per_person: samplePlan.estimatedTotalPerPerson,
      currency: samplePlan.currency,
      status: "active",
      source_prompt: "PlanMate collaboration starter",
    }).select("id").single();
    if (planError || !createdPlan) {
      setError(planError?.message ?? "Could not create the plan.");
      setBusy(false);
      return;
    }
    for (const [dayIndex, sourceDay] of samplePlan.days.entries()) {
      const { data: createdDay, error: dayError } = await supabase.from("plan_days").insert({
        plan_id: createdPlan.id,
        day_index: dayIndex,
        label: sourceDay.label,
      }).select("id").single();
      if (dayError || !createdDay) { setError(dayError?.message ?? "Could not add a day."); break; }
      const { error: itemError } = await supabase.from("plan_items").insert(sourceDay.items.map((item, sortOrder) => ({
        plan_id: createdPlan.id,
        day_id: createdDay.id,
        sort_order: sortOrder,
        start_time: /^\d{1,2}:\d{2}/.test(item.time) ? item.time.replace(/\s.*$/, "") : null,
        item_type: item.type,
        title: item.title,
        description: item.description,
        location_name: item.location,
        estimated_cost_per_person: item.costPerPerson,
        travel_minutes: item.travelMinutes,
        booking_status: item.status,
        verification_status: item.verification,
      })));
      if (itemError) { setError(itemError.message); break; }
    }
    await loadPlans();
    await loadPlan(createdPlan.id);
    setNotice("Collaboration plan created. Invite your group when you’re ready.");
    setBusy(false);
  }

  async function castVote(itemId: string, value: -1 | 1) {
    if (!user || !plan || plan.status === "agreed") return;
    const current = votes.find((vote) => vote.plan_item_id === itemId && vote.user_id === user.id);
    const query = current?.value === value
      ? supabase.from("plan_item_votes").delete().eq("plan_item_id", itemId).eq("user_id", user.id)
      : supabase.from("plan_item_votes").upsert({ plan_item_id: itemId, user_id: user.id, value }, { onConflict: "plan_item_id,user_id" });
    const { error: voteError } = await query;
    if (voteError) setError(voteError.message); else await loadPlan(plan.id);
  }

  async function addComment(itemId: string, body: string) {
    if (!user || !plan || !body.trim()) return;
    const { error: commentError } = await supabase.from("plan_item_comments").insert({ plan_item_id: itemId, user_id: user.id, body: body.trim() });
    if (commentError) setError(commentError.message); else await loadPlan(plan.id);
  }

  async function requestApproval() {
    if (!plan) return;
    setBusy(true);
    const { error: approvalError } = await supabase.rpc("request_plan_approval", { target_plan_id: plan.id });
    if (approvalError) setError(approvalError.message); else setNotice("Final agreement requested from every collaborator.");
    await loadPlan(plan.id);
    setBusy(false);
  }

  async function changeApprovalRule(rule: PlanRow["approval_rule"]) {
    if (!plan || !owner) return;
    const { error: ruleError } = await supabase.from("plans").update({ approval_rule: rule }).eq("id", plan.id);
    if (ruleError) setError(ruleError.message); else await loadPlan(plan.id);
  }

  async function agree() {
    if (!plan) return;
    setBusy(true);
    const { data: finalized, error: approvalError } = await supabase.rpc("agree_to_plan", { target_plan_id: plan.id });
    if (approvalError) setError(approvalError.message);
    else setNotice(finalized ? "Everyone agrees—the plan is final." : "Your agreement is recorded.");
    await loadPlan(plan.id);
    setBusy(false);
  }

  if (checkingAuth) return <FullPageLoader />;
  if (!user) return <AuthScreen supabase={supabase} />;

  const owner = plan?.owner_id === user.id;
  const collaborators = members.filter((member) => member.role !== "owner");
  const approvedIds = new Set(approvals.filter((approval) => approval.plan_version === plan?.approval_version).map((approval) => approval.user_id));
  const currentUserApproved = approvedIds.has(user.id);
  const totalItems = days.reduce((total, day) => total + day.items.length, 0);
  const openComments = comments.length;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-[#1e2822]">
      <header className="border-b border-[#1e2822]/10 bg-[#fffdf8]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-[14px] bg-[#194d3a] text-white"><Sparkles className="size-5" /></span><span className="text-xl font-semibold tracking-[-0.04em]">PlanMate</span></Link>
          <div className="flex items-center gap-3"><span className="hidden text-sm text-[#68736d] sm:block">{user.email}</span><button onClick={() => supabase.auth.signOut()} className="grid size-10 place-items-center rounded-full border border-[#1e2822]/10 bg-white" aria-label="Sign out"><LogOut className="size-4" /></button></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-[#1e2822]/10 bg-[#eee9df] p-5 lg:min-h-[calc(100vh-80px)] lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#758078]">Your plans</p><button onClick={createDemoPlan} disabled={busy} className="grid size-9 place-items-center rounded-full bg-[#194d3a] text-white" aria-label="Create collaboration plan"><Plus className="size-4" /></button></div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:flex-col">
            {plans.map((candidate) => <button key={candidate.id} onClick={() => loadPlan(candidate.id)} className={`min-w-56 rounded-2xl border p-4 text-left lg:min-w-0 ${plan?.id === candidate.id ? "border-[#194d3a] bg-white shadow-sm" : "border-transparent hover:bg-white/60"}`}><span className="block truncate text-sm font-bold">{candidate.title}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-[#758078]"><span className={`size-2 rounded-full ${candidate.status === "agreed" ? "bg-[#2c7a55]" : "bg-[#d96545]"}`} />{statusCopy[candidate.status]}</span></button>)}
          </div>
        </aside>

        <section className="min-w-0 p-5 sm:p-8 lg:p-10 xl:p-12">
          {notice ? <div className="mb-6 flex items-center justify-between rounded-2xl bg-[#e4efe7] px-4 py-3 text-sm font-semibold text-[#245f43]"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />{notice}</span><button onClick={() => setNotice(null)}>×</button></div> : null}
          {error ? <div role="alert" className="mb-6 rounded-2xl bg-[#fff0eb] px-4 py-3 text-sm text-[#a4452f]">{error}</div> : null}
          {!plan ? <EmptyWorkspace busy={busy} onCreate={createDemoPlan} /> : <>
            <div className="flex flex-col gap-7 xl:flex-row xl:items-start xl:justify-between">
              <div><Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[#657168] transition hover:text-[#194d3a]"><ArrowLeft className="size-4" />Back to planner</Link><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${plan.status === "agreed" ? "bg-[#dcecdf] text-[#246143]" : plan.status === "approval-pending" ? "bg-[#fff0d8] text-[#8d5b15]" : "bg-[#e8ece8] text-[#55635b]"}`}>{statusCopy[plan.status]}</span>{plan.status === "agreed" ? <LockKeyhole className="size-4 text-[#2c6b4c]" /> : null}</div><h1 className="mt-5 max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.045em] sm:text-5xl">{plan.title}</h1><p className="mt-3 max-w-2xl leading-7 text-[#68756d]">{plan.description}</p><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#68756d]"><span className="flex items-center gap-2"><MapPin className="size-4 text-[#d15d3e]" />{plan.primary_location}</span><span className="flex items-center gap-2"><CalendarDays className="size-4 text-[#d15d3e]" />{days.length} {days.length === 1 ? "day" : "days"}</span><span className="flex items-center gap-2"><Users className="size-4 text-[#d15d3e]" />{members.length} {members.length === 1 ? "member" : "members"}</span></div></div>
              <ApprovalCardV2 plan={plan} owner={owner} busy={busy} collaborators={collaborators} approvedIds={approvedIds} currentUserApproved={currentUserApproved} onRequest={requestApproval} onAgree={agree} onRule={changeApprovalRule} />
            </div>

            <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0">
                <div className="divide-y divide-[#1e2822]/12">{days.map((day) => <section key={day.id} className="py-9 first:pt-0"><div className="mb-5 flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#d15d3e]">Day {day.day_index + 1}</p><h2 className="mt-1 text-2xl font-bold tracking-[-.03em]">{day.label}</h2></div><p className="text-xs font-medium text-[#818b85]">{day.items.length} {day.items.length === 1 ? "stop" : "stops"}</p></div><div className="space-y-3">{day.items.map((item) => <UnifiedPlanItemCard key={item.id} item={item} userId={user.id} members={members} votes={votes.filter((vote) => vote.plan_item_id === item.id)} comments={comments.filter((comment) => comment.plan_item_id === item.id)} locked={plan.status === "agreed"} onVote={castVote} onComment={addComment} />)}</div></section>)}</div>
              </div>
              <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><div className="rounded-[18px] border border-[#1e2822]/8 bg-white/70 p-4"><p className="text-2xl font-bold tracking-[-.04em]">{totalItems}</p><p className="mt-1 text-xs text-[#758078]">Plan items</p></div><div className="rounded-[18px] border border-[#1e2822]/8 bg-white/70 p-4"><p className="text-2xl font-bold tracking-[-.04em]">{openComments}</p><p className="mt-1 text-xs text-[#758078]">Comments</p></div></div><MembersPanelV2 plan={plan} user={user} members={members} invitations={invitations} owner={owner} onRefresh={() => loadPlan(plan.id)} /></div>
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}

function AuthScreen({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [savingPlan] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("save") === "generated");
  const [mode, setMode] = useState<"signin" | "signup">(() => savingPlan ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name },
            emailRedirectTo: `${window.location.origin}/collaborate${savingPlan ? "?save=generated" : ""}`,
          },
        });
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account, then return here to sign in.");
    setBusy(false);
  }
  if (savingPlan) return <main className="grid min-h-screen place-items-center bg-[#f4f1ea] p-5"><div className="w-full max-w-md rounded-[30px] border border-[#1e2822]/10 bg-[#fffdf8] p-7 shadow-[0_30px_80px_rgba(35,48,40,.12)] sm:p-9"><Link href="/plan/draft" className="inline-flex items-center gap-2 text-sm font-semibold text-[#657168]"><ArrowLeft className="size-4" />Back to your draft</Link><Link href="/" className="mt-6 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#194d3a] text-white"><Sparkles className="size-5" /></span><span className="text-xl font-bold">PlanMate</span></Link><div className="mt-8 flex items-center gap-2 rounded-2xl bg-[#e7eee8] px-4 py-3 text-sm font-semibold text-[#315c44]"><CheckCircle2 className="size-4" />Your plan is ready to save</div><h1 className="mt-8 font-serif text-4xl tracking-[-0.04em]">{mode === "signup" ? "Create an account to save this plan" : "Sign in to save your plan"}</h1><p className="mt-3 text-sm leading-6 text-[#69766e]">{mode === "signup" ? "Create your free account and we’ll save the exact plan you just generated." : "Welcome back. Sign in and we’ll save your plan to your workspace."}</p><form onSubmit={submit} className="mt-7 space-y-4">{mode === "signup" ? <label className="block text-sm font-semibold">Your name<input value={name} onChange={(event) => setName(event.target.value)} required className="mt-2 w-full rounded-xl border border-[#1e2822]/12 bg-white px-4 py-3 outline-none" /></label> : null}<label className="block text-sm font-semibold">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-[#1e2822]/12 bg-white px-4 py-3 outline-none" /></label><label className="block text-sm font-semibold">Password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required className="mt-2 w-full rounded-xl border border-[#1e2822]/12 bg-white px-4 py-3 outline-none" /></label>{message ? <p className="rounded-xl bg-[#fff0e7] p-3 text-sm text-[#985039]">{message}</p> : null}<button disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#d96545] font-bold text-white">{busy ? <LoaderCircle className="size-4 animate-spin" /> : mode === "signup" ? "Create account & save plan" : "Sign in & save plan"}<ChevronRight className="size-4" /></button></form><button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(null); }} className="mt-5 w-full text-sm font-semibold text-[#526159]">{mode === "signup" ? "Already have an account? Sign in" : "New to PlanMate? Create an account"}</button></div></main>;
  return <main className="grid min-h-screen place-items-center bg-[#f4f1ea] p-5"><div className="w-full max-w-md rounded-[30px] border border-[#1e2822]/10 bg-[#fffdf8] p-7 shadow-[0_30px_80px_rgba(35,48,40,.12)] sm:p-9"><Link href="/" className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#194d3a] text-white"><Sparkles className="size-5" /></span><span className="text-xl font-bold">PlanMate</span></Link>{savingPlan ? <div className="mt-8 flex items-center gap-2 rounded-2xl bg-[#e7eee8] px-4 py-3 text-sm font-semibold text-[#315c44]"><CheckCircle2 className="size-4" />Your plan is ready to save</div> : null}<h1 className="mt-8 font-serif text-4xl tracking-[-0.04em]">{mode === "signin" ? (savingPlan ? "Sign in to save your plan" : "Welcome back") : savingPlan ? "Create an account to save this plan" : "Create your account"}</h1><p className="mt-3 text-sm leading-6 text-[#69766e]">{savingPlan ? (mode === "signup" ? "Create your free account and we’ll save the exact plan you just generated." : "Welcome back. Sign in and we’ll save your plan to your workspace.") : "Sign in to create plans, invite collaborators, vote, comment, and agree on the final version."}</p><form onSubmit={submit} className="mt-7 space-y-4">{mode === "signup" ? <label className="block text-sm font-semibold">Your name<input value={name} onChange={(event) => setName(event.target.value)} required className="mt-2 w-full rounded-xl border border-[#1e2822]/12 bg-white px-4 py-3 outline-none" /></label> : null}<label className="block text-sm font-semibold">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 w-full rounded-xl border border-[#1e2822]/12 bg-white px-4 py-3 outline-none" /></label><label className="block text-sm font-semibold">Password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required className="mt-2 w-full rounded-xl border border-[#1e2822]/12 bg-white px-4 py-3 outline-none" /></label>{message ? <p className="rounded-xl bg-[#fff0e7] p-3 text-sm text-[#985039]">{message}</p> : null}<button disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#d96545] font-bold text-white">{busy ? <LoaderCircle className="size-4 animate-spin" /> : mode === "signin" ? (savingPlan ? "Sign in & save plan" : "Sign in") : savingPlan ? "Create account & save plan" : "Create account"}<ChevronRight className="size-4" /></button></form><button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(null); }} className="mt-5 w-full text-sm font-semibold text-[#526159]">{mode === "signin" ? "New to PlanMate? Create an account" : "Already have an account? Sign in"}</button></div></main>;
}

function ApprovalCard({ plan, owner, busy, collaborators, approvedIds, currentUserApproved, onRequest, onAgree }: { plan: PlanRow; owner: boolean; busy: boolean; collaborators: Member[]; approvedIds: Set<string>; currentUserApproved: boolean; onRequest: () => void; onAgree: () => void }) {
  if (plan.status === "agreed") return <div className="w-full max-w-sm rounded-[22px] bg-[#194d3a] p-5 text-white"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#efbd72]"><CheckCircle2 className="size-4" />Final plan</p><p className="mt-3 text-xl font-bold">Everyone agrees</p><p className="mt-1 text-sm text-white/65">Finalized {plan.finalized_at ? new Date(plan.finalized_at).toLocaleDateString() : "today"}</p></div>;
  if (plan.status === "approval-pending") {
    const agreed = collaborators.filter((member) => approvedIds.has(member.user_id)).length;
    return <div className="w-full max-w-sm rounded-[22px] border border-[#d69b45]/25 bg-[#fff8e9] p-5"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#9b671c]">Final agreement</p><div className="mt-3 flex items-end justify-between"><p className="text-2xl font-bold">{agreed} of {collaborators.length}</p><p className="text-xs text-[#7b6c55]">collaborators agreed</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e9ddc8]"><div className="h-full rounded-full bg-[#d18b31]" style={{ width: `${collaborators.length ? (agreed / collaborators.length) * 100 : 100}%` }} /></div>{!owner && !currentUserApproved ? <button disabled={busy} onClick={onAgree} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#194d3a] px-4 py-3 text-sm font-bold text-white"><Check className="size-4" />Agree to this plan</button> : <p className="mt-4 text-sm font-semibold text-[#6d715f]">{owner ? "Waiting for the group." : "Your agreement is recorded."}</p>}</div>;
  }
  return owner ? <button disabled={busy} onClick={onRequest} className="flex w-full max-w-sm items-center justify-between rounded-[22px] bg-[#194d3a] p-5 text-left text-white shadow-lg"><span><span className="block text-sm font-bold">Ready for the group?</span><span className="mt-1 block text-xs text-white/60">Request everyone’s final agreement</span></span><ChevronRight className="size-5" /></button> : null;
}

function ApprovalCardV2({ plan, owner, busy, collaborators, approvedIds, currentUserApproved, onRequest, onAgree, onRule }: { plan: PlanRow; owner: boolean; busy: boolean; collaborators: Member[]; approvedIds: Set<string>; currentUserApproved: boolean; onRequest: () => void; onAgree: () => void; onRule: (rule: PlanRow["approval_rule"]) => void }) {
  const agreed = collaborators.filter((member) => approvedIds.has(member.user_id)).length;
  const threshold = plan.approval_rule === "majority" ? Math.max(1, Math.ceil(collaborators.length / 2)) : plan.approval_rule === "owner-decides" ? 1 : collaborators.length;
  const ruleLabel = plan.approval_rule === "majority" ? "Majority agrees" : plan.approval_rule === "owner-decides" ? "Owner decides" : "Everyone agrees";
  if (plan.status === "agreed") return <div className="w-full max-w-sm rounded-[22px] bg-[#194d3a] p-5 text-white"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#efbd72]"><CheckCircle2 className="size-4" />Final plan</p><p className="mt-3 text-xl font-bold">Plan agreed</p><p className="mt-1 text-sm text-white/65">{ruleLabel} · Finalized {plan.finalized_at ? new Date(plan.finalized_at).toLocaleDateString() : "today"}</p></div>;
  if (plan.status === "approval-pending") return <div className="w-full max-w-sm rounded-[22px] border border-[#d69b45]/25 bg-[#fff8e9] p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#9b671c]">Final agreement</p><span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-bold text-[#7b6c55]">{ruleLabel}</span></div>{plan.approval_rule === "owner-decides" ? <p className="mt-3 text-sm leading-6 text-[#6d715f]">The owner makes the final call after reviewing the discussion.</p> : <><div className="mt-3 flex items-end justify-between"><p className="text-2xl font-bold">{agreed} of {threshold}</p><p className="text-xs text-[#7b6c55]">needed to finalize</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e9ddc8]"><div className="h-full rounded-full bg-[#d18b31]" style={{ width: `${threshold ? Math.min(100, (agreed / threshold) * 100) : 100}%` }} /></div></>}{plan.approval_rule === "owner-decides" && owner ? <button disabled={busy} onClick={onAgree} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#194d3a] px-4 py-3 text-sm font-bold text-white"><Check className="size-4" />Finalize this plan</button> : !owner && !currentUserApproved && plan.approval_rule !== "owner-decides" ? <button disabled={busy} onClick={onAgree} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#194d3a] px-4 py-3 text-sm font-bold text-white"><Check className="size-4" />Agree to this plan</button> : <p className="mt-4 text-sm font-semibold text-[#6d715f]">{owner ? "Agreement is open for the group." : plan.approval_rule === "owner-decides" ? "The owner will finalize this plan." : "Your agreement is recorded."}</p>}</div>;
  return owner ? <div className="w-full max-w-sm rounded-[22px] bg-[#194d3a] p-5 text-white shadow-lg"><p className="text-sm font-bold">Ready to finalize?</p><p className="mt-1 text-xs leading-5 text-white/60">Choose how this group reaches final agreement.</p><select value={plan.approval_rule} onChange={(event) => onRule(event.target.value as PlanRow["approval_rule"])} className="mt-4 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-semibold text-white outline-none"><option className="text-[#1e2822]" value="unanimous">Everyone agrees</option><option className="text-[#1e2822]" value="majority">Majority agrees</option><option className="text-[#1e2822]" value="owner-decides">Owner decides</option></select><button disabled={busy} onClick={onRequest} className="mt-3 flex w-full items-center justify-between rounded-full bg-[#d96545] px-4 py-3 text-left text-sm font-bold text-white"><span>Request final agreement</span><ChevronRight className="size-4" /></button></div> : null;
}

function UnifiedPlanItemCard({ item, userId, members, votes, comments, locked, onVote, onComment }: { item: Item; userId: string; members: Member[]; votes: Vote[]; comments: Comment[]; locked: boolean; onVote: (id: string, value: -1 | 1) => void; onComment: (id: string, body: string) => void }) {
  const [open, setOpen] = useState(false); const [body, setBody] = useState("");
  const mine = votes.find((vote) => vote.user_id === userId)?.value;
  const nameFor = (id: string) => members.find((member) => member.user_id === id)?.display_name ?? "PlanMate member";
  const ups = votes.filter((vote) => vote.value === 1).length; const downs = votes.filter((vote) => vote.value === -1).length;
  return <article className="overflow-hidden rounded-[20px] border border-[#1e2822]/8 bg-[#fffdf8] shadow-sm"><div className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#d15d3e]">{item.start_time?.slice(0, 5) || "Flexible"}</p><h3 className="mt-1 text-lg font-bold">{item.title}</h3></div><span className="rounded-full bg-[#eef1ee] px-2.5 py-1 text-[10px] font-bold uppercase text-[#66736b]">{item.booking_status.replace("-", " ")}</span></div><p className="mt-2 text-sm leading-6 text-[#6d7a72]">{item.description}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#1e2822]/7 pt-3"><span className="text-xs text-[#7b867f]">{item.location_name}</span><button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full bg-[#edf0ed] px-3 py-2 text-xs font-bold text-[#526159]"><MessageCircle className="size-4" />Discuss {votes.length || comments.length ? `· ${ups}↑ ${downs}↓ ${comments.length} comments` : ""}</button></div></div>{open ? <div className="border-t border-[#1e2822]/8 bg-[#f6f2e9] p-4"><div className="mb-4 flex items-center gap-2"><span className="text-xs font-bold text-[#657168]">Your vote</span><button disabled={locked} onClick={() => onVote(item.id, 1)} className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${mine === 1 ? "bg-[#dcecdf] text-[#245e42]" : "bg-white text-[#617068]"}`}><ThumbsUp className="size-3.5" />{ups}</button><button disabled={locked} onClick={() => onVote(item.id, -1)} className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${mine === -1 ? "bg-[#fde4dc] text-[#a54931]" : "bg-white text-[#617068]"}`}><ThumbsDown className="size-3.5" />{downs}</button></div><div className="space-y-3">{comments.map((comment) => <div key={comment.id} className="rounded-xl bg-white p-3"><p className="text-xs font-bold">{nameFor(comment.user_id)} <span className="ml-1 font-normal text-[#8a948e]">{new Date(comment.created_at).toLocaleDateString()}</span></p><p className="mt-1 text-sm text-[#59675f]">{comment.body}</p></div>)}</div>{!locked ? <form onSubmit={(event) => { event.preventDefault(); onComment(item.id, body); setBody(""); }} className="mt-3 flex gap-2"><input value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="Add a comment…" className="min-w-0 flex-1 rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2 text-sm outline-none" /><button className="grid size-10 place-items-center rounded-xl bg-[#d96545] text-white" aria-label="Send comment"><Send className="size-4" /></button></form> : null}</div> : null}</article>;
}

function PlanItemCard({ item, userId, members, votes, comments, locked, onVote, onComment }: { item: Item; userId: string; members: Member[]; votes: Vote[]; comments: Comment[]; locked: boolean; onVote: (id: string, value: -1 | 1) => void; onComment: (id: string, body: string) => void }) {
  const [open, setOpen] = useState(false); const [body, setBody] = useState("");
  const mine = votes.find((vote) => vote.user_id === userId)?.value;
  const nameFor = (id: string) => members.find((member) => member.user_id === id)?.display_name ?? "PlanMate member";
  return <article className="overflow-hidden rounded-[22px] border border-[#1e2822]/9 bg-[#fffdf8] shadow-sm"><div className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#d15d3e]">{item.start_time?.slice(0, 5) || "Flexible"}</p><h3 className="mt-1 text-lg font-bold">{item.title}</h3></div><div className="flex gap-1"><button disabled={locked} onClick={() => onVote(item.id, 1)} className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${mine === 1 ? "bg-[#dcecdf] text-[#245e42]" : "bg-[#edf0ed] text-[#617068]"}`}><ThumbsUp className="size-3.5" />{votes.filter((vote) => vote.value === 1).length}</button><button disabled={locked} onClick={() => onVote(item.id, -1)} className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${mine === -1 ? "bg-[#fde4dc] text-[#a54931]" : "bg-[#edf0ed] text-[#617068]"}`}><ThumbsDown className="size-3.5" />{votes.filter((vote) => vote.value === -1).length}</button></div></div><p className="mt-2 text-sm leading-6 text-[#6d7a72]">{item.description}</p><div className="mt-4 flex items-center justify-between border-t border-[#1e2822]/7 pt-3"><span className="text-xs text-[#7b867f]">{item.location_name}</span><button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs font-bold text-[#526159]"><MessageCircle className="size-4" />{comments.length} {comments.length === 1 ? "comment" : "comments"}</button></div></div>{open ? <div className="border-t border-[#1e2822]/8 bg-[#f6f2e9] p-4"><div className="space-y-3">{comments.map((comment) => <div key={comment.id} className="rounded-xl bg-white p-3"><p className="text-xs font-bold">{nameFor(comment.user_id)} <span className="ml-1 font-normal text-[#8a948e]">{new Date(comment.created_at).toLocaleDateString()}</span></p><p className="mt-1 text-sm text-[#59675f]">{comment.body}</p></div>)}</div>{!locked ? <form onSubmit={(event) => { event.preventDefault(); onComment(item.id, body); setBody(""); }} className="mt-3 flex gap-2"><input value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="Add a comment…" className="min-w-0 flex-1 rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2 text-sm outline-none" /><button className="grid size-10 place-items-center rounded-xl bg-[#d96545] text-white" aria-label="Send comment"><Send className="size-4" /></button></form> : null}</div> : null}</article>;
}

function MembersPanelV2({ plan, user, members, invitations, owner, onRefresh }: { plan: PlanRow; user: User; members: Member[]; invitations: Invitation[]; owner: boolean; onRefresh: () => void }) {
  const supabase = useMemo(() => createClient(), []); const [email, setEmail] = useState(""); const [message, setMessage] = useState<string | null>(null); const [workingId, setWorkingId] = useState<string | null>(null);
  const pending = invitations.filter((invitation) => invitation.status === "pending");
  async function sendInvite(inviteEmail: string, id = "new") { setWorkingId(id); setMessage(id === "new" ? "Sending invitation…" : "Resending invitation…"); const { error } = await supabase.functions.invoke("send-plan-invite", { body: { planId: plan.id, email: inviteEmail.trim().toLowerCase() } }); if (error) setMessage(error.message); else { setMessage(id === "new" ? "Invitation email sent." : "Invitation resent with a fresh link."); setEmail(""); onRefresh(); } setWorkingId(null); }
  async function invite(event: FormEvent) { event.preventDefault(); await sendInvite(email); }
  async function revoke(invitation: Invitation) { setWorkingId(invitation.id); const { error } = await supabase.from("plan_invitations").update({ status: "revoked" }).eq("id", invitation.id); setMessage(error ? error.message : "Invitation canceled."); setWorkingId(null); if (!error) onRefresh(); }
  return <aside className="rounded-[22px] border border-[#1e2822]/9 bg-[#fffdf8] p-5"><div className="flex items-center gap-2"><Users className="size-4 text-[#d15d3e]" /><h2 className="font-bold">People</h2></div><div className="mt-4 space-y-3">{members.map((member) => <div key={member.user_id} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[#e5ebe5] text-[#315440]"><CircleUserRound className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{member.display_name}</p><p className="text-xs capitalize text-[#7d8881]">{member.role} · joined</p></div>{member.user_id === user.id ? <span className="text-[10px] font-bold uppercase text-[#a56a26]">You</span> : null}</div>)}</div>{owner && pending.length ? <div className="mt-5 border-t border-[#1e2822]/8 pt-4"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#718078]">Pending invitations</p><div className="mt-3 space-y-3">{pending.map((invitation) => <div key={invitation.id} className="rounded-xl bg-[#f4f1ea] p-3"><p className="truncate text-sm font-semibold">{invitation.email}</p><p className="mt-0.5 text-[11px] text-[#7d8881]">Expires {new Date(invitation.expires_at).toLocaleDateString()}</p><div className="mt-2 flex gap-3 text-xs font-bold"><button disabled={workingId === invitation.id} onClick={() => sendInvite(invitation.email, invitation.id)} className="text-[#315c44]">Resend</button><button disabled={workingId === invitation.id} onClick={() => revoke(invitation)} className="text-[#a54931]">Cancel</button></div></div>)}</div></div> : null}{owner ? <form onSubmit={invite} className="mt-5 border-t border-[#1e2822]/8 pt-5"><label className="text-xs font-bold uppercase tracking-[.12em] text-[#718078]">Invite by email</label><div className="mt-2 flex gap-2"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="friend@example.com" className="min-w-0 flex-1 rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2 text-sm outline-none" /><button disabled={workingId === "new"} className="grid size-10 place-items-center rounded-xl bg-[#194d3a] text-white" aria-label="Send invitation"><UserPlus className="size-4" /></button></div>{message ? <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[#657269]"><Clipboard className="mt-0.5 size-3.5 shrink-0" />{message}</p> : null}</form> : null}</aside>;
}

function MembersPanel({ plan, user, members, owner, onRefresh }: { plan: PlanRow; user: User; members: Member[]; owner: boolean; onRefresh: () => void }) {
  const supabase = useMemo(() => createClient(), []); const [email, setEmail] = useState(""); const [message, setMessage] = useState<string | null>(null);
  async function invite(event: FormEvent) { event.preventDefault(); setMessage("Sending invitation…"); const { error } = await supabase.functions.invoke("send-plan-invite", { body: { planId: plan.id, email: email.trim().toLowerCase() } }); if (error) setMessage(error.message); else { setMessage("Invitation email sent."); setEmail(""); onRefresh(); } }
  return <aside><div className="rounded-[22px] border border-[#1e2822]/9 bg-[#fffdf8] p-5"><div className="flex items-center gap-2"><Users className="size-4 text-[#d15d3e]" /><h2 className="font-bold">Plan members</h2></div><div className="mt-4 space-y-3">{members.map((member) => <div key={member.user_id} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-[#e5ebe5] text-[#315440]"><CircleUserRound className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{member.display_name}</p><p className="text-xs capitalize text-[#7d8881]">{member.role}</p></div>{member.user_id === user.id ? <span className="text-[10px] font-bold uppercase text-[#a56a26]">You</span> : null}</div>)}</div>{owner ? <form onSubmit={invite} className="mt-5 border-t border-[#1e2822]/8 pt-5"><label className="text-xs font-bold uppercase tracking-[.12em] text-[#718078]">Invite by email</label><div className="mt-2 flex gap-2"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="friend@example.com" className="min-w-0 flex-1 rounded-xl border border-[#1e2822]/10 bg-white px-3 py-2 text-sm outline-none" /><button className="grid size-10 place-items-center rounded-xl bg-[#194d3a] text-white" aria-label="Create invitation"><UserPlus className="size-4" /></button></div>{message ? <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[#657269]"><Clipboard className="mt-0.5 size-3.5 shrink-0" />{message}</p> : null}</form> : null}</div></aside>;
}

function EmptyWorkspace({ busy, onCreate }: { busy: boolean; onCreate: () => void }) { return <div className="grid min-h-[65vh] place-items-center"><div className="max-w-md text-center"><span className="mx-auto grid size-16 place-items-center rounded-[22px] bg-[#e2ebe4] text-[#194d3a]"><Users className="size-7" /></span><h1 className="mt-6 font-serif text-4xl tracking-[-0.04em]">Make the plan together</h1><p className="mt-3 leading-7 text-[#6c7971]">Create your first collaboration plan, then invite people to vote, comment, and give final agreement.</p><button onClick={onCreate} disabled={busy} className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#d96545] px-6 py-3 text-sm font-bold text-white">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}Create a starter plan</button></div></div>; }
function FullPageLoader() { return <main className="grid min-h-screen place-items-center bg-[#f4f1ea]"><LoaderCircle className="size-8 animate-spin text-[#194d3a]" /></main>; }

// Keep the legacy cards temporarily available while saved plans transition to the unified UI.
void ApprovalCard;
void PlanItemCard;
void MembersPanel;
