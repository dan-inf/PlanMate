alter table public.plans
  add column if not exists approval_rule text not null default 'unanimous'
  check (approval_rule in ('unanimous', 'majority', 'owner-decides'));

create or replace function public.agree_to_plan(target_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
  current_rule text;
  owner_user_id uuid;
  collaborator_count integer;
  approval_count integer;
  should_finalize boolean := false;
begin
  if not private.is_plan_member(target_plan_id, (select auth.uid())) then
    raise exception 'You are not a member of this plan';
  end if;

  select approval_version, approval_rule, owner_id
  into current_version, current_rule, owner_user_id
  from public.plans
  where id = target_plan_id and status = 'approval-pending'
  for update;

  if current_version is null then raise exception 'This plan is not awaiting approval'; end if;
  if current_rule = 'owner-decides' and (select auth.uid()) <> owner_user_id then
    raise exception 'The plan owner makes the final decision for this plan';
  end if;

  insert into public.plan_approvals (plan_id, user_id, plan_version)
  values (target_plan_id, (select auth.uid()), current_version)
  on conflict do nothing;

  select count(*) into collaborator_count
  from public.plan_members where plan_id = target_plan_id and role <> 'owner';

  select count(*) into approval_count
  from public.plan_approvals approval
  join public.plan_members member on member.plan_id = approval.plan_id and member.user_id = approval.user_id
  where approval.plan_id = target_plan_id and approval.plan_version = current_version and member.role <> 'owner';

  should_finalize := case current_rule
    when 'owner-decides' then (select auth.uid()) = owner_user_id
    when 'majority' then approval_count >= greatest(1, ceil(collaborator_count / 2.0)::integer)
    else approval_count >= collaborator_count
  end;

  if should_finalize then
    update public.plans set status = 'agreed', finalized_at = now(), updated_at = now() where id = target_plan_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.agree_to_plan(uuid) from public, anon;
grant execute on function public.agree_to_plan(uuid) to authenticated;
