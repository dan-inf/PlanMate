create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans
  add column approval_version integer not null default 0 check (approval_version >= 0),
  add column approval_requested_at timestamptz,
  add column finalized_at timestamptz;

alter table public.plans drop constraint plans_status_check;
alter table public.plans add constraint plans_status_check
  check (status in ('draft', 'active', 'approval-pending', 'agreed', 'archived'));

create table public.plan_members (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'collaborator' check (role in ('owner', 'editor', 'collaborator')),
  joined_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create unique index plan_members_one_owner_idx
  on public.plan_members(plan_id) where role = 'owner';

create table public.plan_invitations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'collaborator' check (role in ('editor', 'collaborator')),
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index plan_invitations_pending_email_idx
  on public.plan_invitations(plan_id, lower(email)) where status = 'pending';

create table public.plan_item_votes (
  plan_item_id uuid not null references public.plan_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_item_id, user_id)
);

create table public.plan_item_comments (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references public.plan_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_approvals (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_version integer not null check (plan_version > 0),
  agreed_at timestamptz not null default now(),
  primary key (plan_id, user_id, plan_version)
);

create index plan_members_user_id_idx on public.plan_members(user_id);
create index plan_invitations_plan_id_idx on public.plan_invitations(plan_id);
create index plan_item_votes_user_id_idx on public.plan_item_votes(user_id);
create index plan_item_comments_item_id_created_at_idx on public.plan_item_comments(plan_item_id, created_at);
create index plan_approvals_plan_version_idx on public.plan_approvals(plan_id, plan_version);
create index plan_approvals_user_id_idx on public.plan_approvals(user_id);
create index plan_invitations_invited_by_idx on public.plan_invitations(invited_by);
create index plan_invitations_accepted_by_idx on public.plan_invitations(accepted_by) where accepted_by is not null;
create index plan_item_comments_user_id_idx on public.plan_item_comments(user_id);

create or replace function private.is_plan_member(target_plan_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_members
    where plan_id = target_plan_id and user_id = target_user_id
  );
$$;

create or replace function private.is_plan_owner(target_plan_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plans
    where id = target_plan_id and owner_id = target_user_id
  );
$$;

create or replace function private.plan_id_for_item(target_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select plan_id from public.plan_items where id = target_item_id;
$$;

revoke all on function private.is_plan_member(uuid, uuid) from public;
revoke all on function private.is_plan_owner(uuid, uuid) from public;
revoke all on function private.plan_id_for_item(uuid) from public;
grant execute on function private.is_plan_member(uuid, uuid) to authenticated;
grant execute on function private.is_plan_owner(uuid, uuid) to authenticated;
grant execute on function private.plan_id_for_item(uuid) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (id, display_name, avatar_url)
select id, coalesce(raw_user_meta_data ->> 'display_name', split_part(coalesce(email, ''), '@', 1)), raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;

create or replace function private.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.plan_members (plan_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (plan_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger on_plan_created_add_owner
  after insert on public.plans
  for each row execute function private.add_owner_membership();

insert into public.plan_members (plan_id, user_id, role)
select id, owner_id, 'owner' from public.plans
on conflict (plan_id, user_id) do update set role = 'owner';

create or replace function public.accept_plan_invitation(invitation_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.plan_invitations;
  caller_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  caller_email := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  select * into invitation
  from public.plan_invitations
  where token = invitation_token and status = 'pending'
  for update;

  if invitation.id is null then raise exception 'Invitation is no longer available'; end if;
  if invitation.expires_at <= now() then
    update public.plan_invitations set status = 'expired' where id = invitation.id;
    raise exception 'Invitation has expired';
  end if;
  if lower(invitation.email) <> caller_email then
    raise exception 'Sign in with the email address that was invited';
  end if;

  insert into public.plan_members (plan_id, user_id, role)
  values (invitation.plan_id, (select auth.uid()), invitation.role)
  on conflict (plan_id, user_id) do update set role = excluded.role;

  update public.plan_invitations
  set status = 'accepted', accepted_by = (select auth.uid()), accepted_at = now()
  where id = invitation.id;

  return invitation.plan_id;
end;
$$;

revoke all on function public.accept_plan_invitation(uuid) from public, anon;
grant execute on function public.accept_plan_invitation(uuid) to authenticated;

create or replace function public.request_plan_approval(target_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare next_version integer;
begin
  if not private.is_plan_owner(target_plan_id, (select auth.uid())) then
    raise exception 'Only the plan owner can request approval';
  end if;

  update public.plans
  set approval_version = approval_version + 1,
      status = 'approval-pending',
      approval_requested_at = now(),
      finalized_at = null,
      updated_at = now()
  where id = target_plan_id
  returning approval_version into next_version;

  delete from public.plan_approvals where plan_id = target_plan_id;
  return next_version;
end;
$$;

revoke all on function public.request_plan_approval(uuid) from public, anon;
grant execute on function public.request_plan_approval(uuid) to authenticated;

create or replace function public.agree_to_plan(target_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
  pending_count integer;
begin
  if not private.is_plan_member(target_plan_id, (select auth.uid())) then
    raise exception 'You are not a member of this plan';
  end if;

  select approval_version into current_version
  from public.plans
  where id = target_plan_id and status = 'approval-pending'
  for update;

  if current_version is null then raise exception 'This plan is not awaiting approval'; end if;

  insert into public.plan_approvals (plan_id, user_id, plan_version)
  values (target_plan_id, (select auth.uid()), current_version)
  on conflict do nothing;

  select count(*) into pending_count
  from public.plan_members member
  where member.plan_id = target_plan_id
    and member.role <> 'owner'
    and not exists (
      select 1 from public.plan_approvals approval
      where approval.plan_id = target_plan_id
        and approval.user_id = member.user_id
        and approval.plan_version = current_version
    );

  if pending_count = 0 then
    update public.plans
    set status = 'agreed', finalized_at = now(), updated_at = now()
    where id = target_plan_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.agree_to_plan(uuid) from public, anon;
grant execute on function public.agree_to_plan(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.plan_members enable row level security;
alter table public.plan_invitations enable row level security;
alter table public.plan_item_votes enable row level security;
alter table public.plan_item_comments enable row level security;
alter table public.plan_approvals enable row level security;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.plan_members to authenticated;
grant select, insert, update, delete on public.plan_invitations to authenticated;
grant select, insert, update, delete on public.plan_item_votes to authenticated;
grant select, insert, update, delete on public.plan_item_comments to authenticated;
grant select, insert, delete on public.plan_approvals to authenticated;

create policy "Members can view profiles in shared plans" on public.profiles for select to authenticated
using (
  id = (select auth.uid()) or exists (
    select 1 from public.plan_members mine
    join public.plan_members theirs on theirs.plan_id = mine.plan_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
  )
);
create policy "Users can update their profile" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy "Owners can read plans" on public.plans;
drop policy "Owners can read plan days" on public.plan_days;
drop policy "Owners can read plan items" on public.plan_items;

create policy "Members can read plans" on public.plans for select to authenticated
using (private.is_plan_member(id));
create policy "Members can read plan days" on public.plan_days for select to authenticated
using (private.is_plan_member(plan_id));
create policy "Members can read plan items" on public.plan_items for select to authenticated
using (private.is_plan_member(plan_id));

create policy "Members can view memberships" on public.plan_members for select to authenticated
using (private.is_plan_member(plan_id));
create policy "Owners can add memberships" on public.plan_members for insert to authenticated
with check (private.is_plan_owner(plan_id));
create policy "Owners can update memberships" on public.plan_members for update to authenticated
using (private.is_plan_owner(plan_id)) with check (private.is_plan_owner(plan_id));
create policy "Owners can remove memberships" on public.plan_members for delete to authenticated
using (private.is_plan_owner(plan_id) and role <> 'owner');

create policy "Owners can view invitations" on public.plan_invitations for select to authenticated
using (private.is_plan_owner(plan_id));
create policy "Owners can create invitations" on public.plan_invitations for insert to authenticated
with check (private.is_plan_owner(plan_id) and invited_by = (select auth.uid()));
create policy "Owners can update invitations" on public.plan_invitations for update to authenticated
using (private.is_plan_owner(plan_id)) with check (private.is_plan_owner(plan_id));
create policy "Owners can delete invitations" on public.plan_invitations for delete to authenticated
using (private.is_plan_owner(plan_id));

create policy "Members can view votes" on public.plan_item_votes for select to authenticated
using (private.is_plan_member(private.plan_id_for_item(plan_item_id)));
create policy "Members can add their vote" on public.plan_item_votes for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_plan_member(private.plan_id_for_item(plan_item_id)));
create policy "Members can change their vote" on public.plan_item_votes for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.is_plan_member(private.plan_id_for_item(plan_item_id)));
create policy "Members can remove their vote" on public.plan_item_votes for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Members can view comments" on public.plan_item_comments for select to authenticated
using (private.is_plan_member(private.plan_id_for_item(plan_item_id)));
create policy "Members can add comments" on public.plan_item_comments for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_plan_member(private.plan_id_for_item(plan_item_id)));
create policy "Authors can update comments" on public.plan_item_comments for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Authors can delete comments" on public.plan_item_comments for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Members can view approvals" on public.plan_approvals for select to authenticated
using (private.is_plan_member(plan_id));
create policy "Members can add their approval" on public.plan_approvals for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_plan_member(plan_id));
create policy "Members can withdraw their approval" on public.plan_approvals for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function private.reopen_plan_after_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_plan_id uuid;
begin
  target_plan_id := coalesce(new.plan_id, old.plan_id);
  update public.plans
  set status = 'active', approval_requested_at = null, finalized_at = null, updated_at = now()
  where id = target_plan_id and status in ('approval-pending', 'agreed');
  if found then delete from public.plan_approvals where plan_id = target_plan_id; end if;
  return coalesce(new, old);
end;
$$;

create trigger reopen_plan_after_item_change
  after insert or update or delete on public.plan_items
  for each row execute function private.reopen_plan_after_item_change();
