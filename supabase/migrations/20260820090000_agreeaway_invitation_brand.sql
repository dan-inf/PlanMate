-- Customer-facing brand update only. Existing users, plans, and identifiers remain unchanged.
create or replace function public.get_invitation_preview(invitation_token uuid)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object(
    'planTitle', p.title,
    'location', p.primary_location,
    'startDate', p.start_date,
    'endDate', p.end_date,
    'inviterName', coalesce(pr.display_name, 'An AgreeAway organizer'),
    'available', i.status = 'pending' and i.expires_at > now()
  )
  from public.plan_invitations i
  join public.plans p on p.id=i.plan_id
  left join public.profiles pr on pr.id=i.invited_by
  where i.token=invitation_token;
$$;

revoke all on function public.get_invitation_preview(uuid) from public;
grant execute on function public.get_invitation_preview(uuid) to anon, authenticated;
