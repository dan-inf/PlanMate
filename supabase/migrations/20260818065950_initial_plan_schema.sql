create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  plan_type text not null check (plan_type in ('date', 'personal-trip', 'group-trip', 'team-offsite', 'something-else')),
  description text not null default '',
  primary_location text not null default '',
  start_date date,
  end_date date,
  participant_count integer not null default 1 check (participant_count > 0),
  budget_per_person numeric(12, 2) check (budget_per_person is null or budget_per_person >= 0),
  currency text not null default 'USD',
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  source_prompt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  day_index integer not null check (day_index >= 0),
  label text not null,
  plan_date date,
  created_at timestamptz not null default now(),
  unique (plan_id, day_index)
);

create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  day_id uuid not null references public.plan_days(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  start_time time,
  end_time time,
  item_type text not null check (item_type in ('meal', 'activity', 'transportation', 'accommodation', 'meeting', 'free-time', 'nightlife', 'custom')),
  title text not null,
  description text not null default '',
  location_name text not null default '',
  place_id text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  estimated_cost_per_person numeric(12, 2) check (estimated_cost_per_person is null or estimated_cost_per_person >= 0),
  travel_minutes integer check (travel_minutes is null or travel_minutes >= 0),
  booking_status text not null default 'idea' check (booking_status in ('idea', 'selected', 'needs-booking', 'booked', 'cancelled')),
  verification_status text not null default 'planning-placeholder' check (verification_status in ('planning-placeholder', 'verified', 'live-availability')),
  booking_url text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plans_owner_id_idx on public.plans(owner_id);
create index plan_days_plan_id_idx on public.plan_days(plan_id);
create index plan_items_plan_id_idx on public.plan_items(plan_id);
create index plan_items_day_id_sort_order_idx on public.plan_items(day_id, sort_order);

alter table public.plans enable row level security;
alter table public.plan_days enable row level security;
alter table public.plan_items enable row level security;

grant select, insert, update, delete on table public.plans to authenticated;
grant select, insert, update, delete on table public.plan_days to authenticated;
grant select, insert, update, delete on table public.plan_items to authenticated;

create policy "Owners can read plans"
on public.plans for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can create plans"
on public.plans for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "Owners can update plans"
on public.plans for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Owners can delete plans"
on public.plans for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Owners can read plan days"
on public.plan_days for select
to authenticated
using (exists (
  select 1 from public.plans
  where plans.id = plan_days.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can create plan days"
on public.plan_days for insert
to authenticated
with check (exists (
  select 1 from public.plans
  where plans.id = plan_days.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can update plan days"
on public.plan_days for update
to authenticated
using (exists (
  select 1 from public.plans
  where plans.id = plan_days.plan_id
    and plans.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.plans
  where plans.id = plan_days.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can delete plan days"
on public.plan_days for delete
to authenticated
using (exists (
  select 1 from public.plans
  where plans.id = plan_days.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can read plan items"
on public.plan_items for select
to authenticated
using (exists (
  select 1 from public.plans
  where plans.id = plan_items.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can create plan items"
on public.plan_items for insert
to authenticated
with check (exists (
  select 1 from public.plans
  where plans.id = plan_items.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can update plan items"
on public.plan_items for update
to authenticated
using (exists (
  select 1 from public.plans
  where plans.id = plan_items.plan_id
    and plans.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.plans
  where plans.id = plan_items.plan_id
    and plans.owner_id = (select auth.uid())
));

create policy "Owners can delete plan items"
on public.plan_items for delete
to authenticated
using (exists (
  select 1 from public.plans
  where plans.id = plan_items.plan_id
    and plans.owner_id = (select auth.uid())
));

-- Supabase's automatic-RLS project setting installs this trigger helper in
-- public. It must remain callable by the database owner, not by API roles.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
