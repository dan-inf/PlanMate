create table public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_type text not null check (entitlement_type = 'plan_creation'),
  quantity_granted integer not null check (quantity_granted > 0),
  source text not null check (source in ('signup','promotion','admin','stripe_subscription','stripe_purchase')),
  source_reference text,
  idempotency_key text not null unique,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.entitlement_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_type text not null check (entitlement_type = 'plan_creation'),
  quantity_used integer not null default 1 check (quantity_used > 0),
  plan_id uuid not null references public.plans(id) on delete restrict,
  source text not null default 'owned_plan_save',
  idempotency_key text not null unique,
  used_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text,
  unique (plan_id, entitlement_type)
);

create table public.user_billing_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_customer_id text unique,
  status text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_subscription_id text not null unique,
  provider_price_id text not null,
  product_key text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'stripe'),
  environment text not null check (environment in ('test','live')),
  provider_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received' check (processing_status in ('received','processing','processed','failed')),
  attempt_count integer not null default 0,
  last_error text,
  payload_hash text,
  unique (provider, environment, provider_event_id)
);

create table public.generated_plan_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null unique,
  plan_id uuid not null references public.plans(id) on delete restrict,
  consumed_entitlement boolean not null,
  created_at timestamptz not null default now()
);

create index entitlement_grants_user_idx on public.entitlement_grants(user_id, entitlement_type);
create index entitlement_usage_user_idx on public.entitlement_usage(user_id, entitlement_type);
create index billing_subscriptions_user_idx on public.billing_subscriptions(user_id);

alter table public.entitlement_grants enable row level security;
alter table public.entitlement_usage enable row level security;
alter table public.user_billing_accounts enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_provider_events enable row level security;
alter table public.generated_plan_saves enable row level security;

grant select on public.entitlement_grants, public.entitlement_usage, public.user_billing_accounts, public.billing_subscriptions to authenticated;
revoke all on public.billing_provider_events from public, anon, authenticated;
revoke all on public.generated_plan_saves from public, anon, authenticated;

create policy "Users read own grants" on public.entitlement_grants for select to authenticated using (user_id = (select auth.uid()));
create policy "Users read own usage" on public.entitlement_usage for select to authenticated using (user_id = (select auth.uid()));
create policy "Users read own billing account" on public.user_billing_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy "Users read own subscriptions" on public.billing_subscriptions for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.grant_signup_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.entitlement_grants(user_id, entitlement_type, quantity_granted, source, idempotency_key)
  values (new.id, 'plan_creation', 1, 'signup', 'signup:' || new.id::text)
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;
revoke all on function private.grant_signup_creation() from public, anon, authenticated;

create trigger grant_signup_plan_creation
after insert on auth.users for each row execute function private.grant_signup_creation();

insert into public.entitlement_grants(user_id, entitlement_type, quantity_granted, source, idempotency_key, metadata)
select id, 'plan_creation', 1, 'signup', 'signup:' || id::text, '{"backfill":true}'::jsonb from auth.users
on conflict (idempotency_key) do nothing;

create or replace function public.get_creation_entitlement()
returns table(quantity_granted bigint, quantity_used bigint, balance bigint, enforcement_enabled boolean)
language sql security invoker set search_path = '' as $$
  select
    coalesce((select sum(g.quantity_granted) from public.entitlement_grants g where g.user_id = (select auth.uid()) and g.entitlement_type='plan_creation' and (g.expires_at is null or g.expires_at > now())),0),
    coalesce((select sum(u.quantity_used) from public.entitlement_usage u where u.user_id = (select auth.uid()) and u.entitlement_type='plan_creation' and u.reversed_at is null),0),
    greatest(0, coalesce((select sum(g.quantity_granted) from public.entitlement_grants g where g.user_id = (select auth.uid()) and g.entitlement_type='plan_creation' and (g.expires_at is null or g.expires_at > now())),0) - coalesce((select sum(u.quantity_used) from public.entitlement_usage u where u.user_id = (select auth.uid()) and u.entitlement_type='plan_creation' and u.reversed_at is null),0)),
    false;
$$;
revoke all on function public.get_creation_entitlement() from public, anon;
grant execute on function public.get_creation_entitlement() to authenticated;

create or replace function private.persist_generated_plan(payload jsonb, save_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); existing_plan uuid; created_plan uuid; created_day uuid;
  day_json jsonb; item_json jsonb; day_position integer := 0; item_position integer;
  available bigint;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  if char_length(save_key) < 8 then raise exception 'Invalid save key'; end if;
  select plan_id into existing_plan from public.generated_plan_saves where user_id=caller and idempotency_key=save_key;
  if existing_plan is not null then return existing_plan; end if;

  select coalesce(sum(quantity_granted),0) - coalesce((select sum(quantity_used) from public.entitlement_usage where user_id=caller and entitlement_type='plan_creation' and reversed_at is null),0)
  into available from public.entitlement_grants where user_id=caller and entitlement_type='plan_creation' and (expires_at is null or expires_at > now());

  insert into public.plans(owner_id,title,plan_type,description,primary_location,participant_count,budget_per_person,currency,status,source_prompt)
  values (caller, payload#>>'{plan,title}', payload->>'category', coalesce(payload#>>'{plan,summary}',''), coalesce(payload#>>'{plan,location}',''), greatest(1,coalesce((payload#>>'{plan,partySize}')::integer,1)), (payload#>>'{plan,estimatedTotalPerPerson}')::numeric, coalesce(payload#>>'{plan,currency}','USD'), 'active', payload->>'sourceSnapshot')
  returning id into created_plan;

  for day_json in select value from jsonb_array_elements(payload#>'{plan,days}') loop
    insert into public.plan_days(plan_id,day_index,label,plan_date)
    values (created_plan,day_position,day_json->>'label',case when day_json->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (day_json->>'date')::date else null end)
    returning id into created_day;
    item_position := 0;
    for item_json in select value from jsonb_array_elements(day_json->'items') loop
      insert into public.plan_items(plan_id,day_id,sort_order,start_time,item_type,title,description,location_name,estimated_cost_per_person,travel_minutes,travel_mode,route_distance_meters,booking_status,verification_status,booking_url,google_maps_url,website_url,place_id,latitude,longitude,business_status,rating,user_rating_count,price_level,regular_opening_hours,match_reason)
      values (created_plan,created_day,item_position,case when item_json->>'time' ~ '^\d{1,2}:\d{2}' then (substring(item_json->>'time' from '^\d{1,2}:\d{2}') || ':00')::time else null end,item_json->>'type',item_json->>'title',coalesce(item_json->>'description',''),coalesce(item_json->>'location',''),coalesce((item_json->>'costPerPerson')::numeric,0),coalesce((item_json->>'travelMinutes')::integer,0),nullif(item_json->>'travelMode',''),(item_json->>'routeDistanceMeters')::integer,item_json->>'status',case item_json->>'verification' when 'google-verified' then 'google-verified' when 'live-availability' then 'live-availability' else 'suggested' end,item_json->>'bookingUrl',item_json->>'googleMapsUrl',item_json->>'websiteUrl',item_json->>'placeId',(item_json->>'latitude')::numeric,(item_json->>'longitude')::numeric,item_json->>'businessStatus',(item_json->>'rating')::numeric,(item_json->>'userRatingCount')::integer,item_json->>'priceLevel',array(select jsonb_array_elements_text(coalesce(item_json->'regularOpeningHours','[]'::jsonb))),item_json->>'matchReason');
      item_position := item_position + 1;
    end loop;
    day_position := day_position + 1;
  end loop;

  if available > 0 then
    insert into public.entitlement_usage(user_id,entitlement_type,quantity_used,plan_id,source,idempotency_key)
    values (caller,'plan_creation',1,created_plan,'owned_plan_save',save_key);
  end if;
  insert into public.generated_plan_saves(user_id,idempotency_key,plan_id,consumed_entitlement)
  values (caller,save_key,created_plan,available > 0);
  return created_plan;
end;
$$;

create or replace function public.persist_generated_plan(payload jsonb, save_key text)
returns uuid language sql security invoker set search_path = '' as $$ select private.persist_generated_plan(payload,save_key) $$;
revoke all on function private.persist_generated_plan(jsonb,text) from public, anon;
grant execute on function private.persist_generated_plan(jsonb,text) to authenticated;
revoke all on function public.persist_generated_plan(jsonb,text) from public, anon;
grant execute on function public.persist_generated_plan(jsonb,text) to authenticated;

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
