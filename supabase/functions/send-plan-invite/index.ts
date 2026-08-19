import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return json({ error: "Authentication required" }, 401);

  const body = await request.json().catch(() => null) as { planId?: string; email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const planId = body?.planId;
  if (!planId || !email || !/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: "A valid plan and email address are required" }, 400);
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id,title,owner_id")
    .eq("id", planId)
    .single();
  if (planError || !plan || plan.owner_id !== authData.user.id) {
    return json({ error: "Only the plan owner can send invitations" }, 403);
  }

  const { data: existing } = await supabase
    .from("plan_invitations")
    .select("id")
    .eq("plan_id", planId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const invitationQuery = existing
    ? supabase.from("plan_invitations").update({ token, expires_at: expiresAt }).eq("id", existing.id)
    : supabase.from("plan_invitations").insert({ plan_id: planId, invited_by: authData.user.id, email, role: "collaborator", token, expires_at: expiresAt });
  const { data: invitation, error: inviteError } = await invitationQuery.select("id,token").single();
  if (inviteError || !invitation) return json({ error: inviteError?.message ?? "Could not create invitation" }, 400);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    if (!existing) await supabase.from("plan_invitations").delete().eq("id", invitation.id);
    return json({ error: "Invitation email delivery is not configured" }, 503);
  }

  const siteUrl = (Deno.env.get("AGREEAWAY_SITE_URL") ?? "https://agreeaway.com").replace(/\/$/, "");
  const inviteUrl = `${siteUrl}/collaborate?invite=${invitation.token}`;
  const safeTitle = escapeHtml(plan.title);
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM") ?? "AgreeAway <onboarding@resend.dev>",
      to: [email],
      subject: `You're invited to help plan ${plan.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1e2822"><h1 style="color:#194d3a">You've been invited to help plan</h1><p><strong>${safeTitle}</strong> is waiting for your input in AgreeAway.</p><p>View the itinerary, give input, comment, and agree when the details feel right.</p><p style="margin:32px 0"><a href="${inviteUrl}" style="background:#d96545;color:white;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700">Join this plan</a></p><p style="font-size:12px;color:#718078">This AgreeAway invitation expires in 14 days.</p></div>`,
    }),
  });

  if (!emailResponse.ok) {
    if (!existing) await supabase.from("plan_invitations").delete().eq("id", invitation.id);
    return json({ error: "The invitation email could not be sent" }, 502);
  }

  return json({ sent: true });
});
