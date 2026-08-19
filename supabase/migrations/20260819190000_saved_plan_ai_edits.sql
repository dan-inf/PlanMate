alter table public.plans
  add column if not exists edit_version integer not null default 0 check (edit_version >= 0);

alter table public.plan_items
  add column if not exists archived_at timestamptz;

create table public.plan_edit_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  instruction text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (plan_id, idempotency_key)
);

create index plan_edit_events_plan_created_idx on public.plan_edit_events(plan_id, created_at desc);
alter table public.plan_edit_events enable row level security;
grant select on public.plan_edit_events to authenticated;

create policy "Editors can read plan edit history"
on public.plan_edit_events for select to authenticated
using (private.is_plan_member(plan_id));

create or replace function private.plan_snapshot(target_plan_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'plan', to_jsonb(plan_row),
    'days', coalesce((select jsonb_agg(to_jsonb(day_row) order by day_row.day_index) from public.plan_days day_row where day_row.plan_id = target_plan_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(item_row) order by item_row.day_id, item_row.sort_order) from public.plan_items item_row where item_row.plan_id = target_plan_id), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(to_jsonb(approval_row)) from public.plan_approvals approval_row where approval_row.plan_id = target_plan_id), '[]'::jsonb)
  )
  from public.plans plan_row
  where plan_row.id = target_plan_id
$$;

revoke all on function private.plan_snapshot(uuid) from public, anon, authenticated;

create or replace function private.apply_saved_plan_edit(
  target_plan_id uuid,
  expected_edit_version integer,
  edit_idempotency_key text,
  edit_instruction text,
  edited_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_version integer;
  current_status text;
  existing_event public.plan_edit_events;
  before_state jsonb;
  after_state jsonb;
  event_id uuid;
  day_json jsonb;
  item_json jsonb;
  target_day_id uuid;
  target_item_id uuid;
  item_id_text text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.plan_members
    where plan_id = target_plan_id and user_id = actor and role in ('owner', 'editor')
  ) then raise exception 'You do not have permission to edit this plan'; end if;

  select * into existing_event from public.plan_edit_events
  where plan_id = target_plan_id and idempotency_key = edit_idempotency_key;
  if found then
    return jsonb_build_object('event_id', existing_event.id, 'edit_version', expected_edit_version, 'idempotent', true);
  end if;

  select edit_version, status into current_version, current_status
  from public.plans where id = target_plan_id for update;
  if current_version is null then raise exception 'Plan not found'; end if;
  if current_version <> expected_edit_version then raise exception 'This plan changed while the edit was being prepared'; end if;

  before_state := private.plan_snapshot(target_plan_id);

  update public.plans set
    title = coalesce(edited_plan->>'title', title),
    description = coalesce(edited_plan->>'summary', description),
    primary_location = coalesce(edited_plan->>'location', primary_location),
    participant_count = greatest(1, coalesce((edited_plan->>'partySize')::integer, participant_count)),
    budget_per_person = greatest(0, coalesce((edited_plan->>'estimatedTotalPerPerson')::numeric, budget_per_person, 0)),
    currency = coalesce(edited_plan->>'currency', currency),
    edit_version = edit_version + 1,
    approval_version = case when current_status in ('approval-pending', 'agreed') then approval_version + 1 else approval_version end,
    status = case when current_status in ('approval-pending', 'agreed') then 'active' else status end,
    approval_requested_at = case when current_status in ('approval-pending', 'agreed') then null else approval_requested_at end,
    finalized_at = case when current_status in ('approval-pending', 'agreed') then null else finalized_at end,
    updated_at = now()
  where id = target_plan_id;

  if current_status in ('approval-pending', 'agreed') then
    delete from public.plan_approvals where plan_id = target_plan_id;
  end if;

  update public.plan_items set archived_at = now() where plan_id = target_plan_id and archived_at is null;

  for day_json in select value from jsonb_array_elements(coalesce(edited_plan->'days', '[]'::jsonb)) loop
    select id into target_day_id from public.plan_days
    where plan_id = target_plan_id and day_index = (day_json->>'dayIndex')::integer;
    if target_day_id is null then
      insert into public.plan_days(plan_id, day_index, label, plan_date)
      values (target_plan_id, (day_json->>'dayIndex')::integer, day_json->>'label', case when day_json->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (day_json->>'date')::date else null end)
      returning id into target_day_id;
    else
      update public.plan_days set label = day_json->>'label', plan_date = case when day_json->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (day_json->>'date')::date else plan_date end
      where id = target_day_id;
    end if;

    for item_json in select value from jsonb_array_elements(coalesce(day_json->'items', '[]'::jsonb)) loop
      item_id_text := item_json->>'id';
      target_item_id := null;
      if item_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select id into target_item_id from public.plan_items where id = item_id_text::uuid and plan_id = target_plan_id;
      end if;
      if target_item_id is null then target_item_id := gen_random_uuid(); end if;

      insert into public.plan_items(
        id, plan_id, day_id, sort_order, start_time, item_type, title, description, location_name,
        place_id, latitude, longitude, estimated_cost_per_person, travel_minutes, travel_mode,
        route_distance_meters, booking_status, verification_status, booking_url, google_maps_url,
        website_url, business_status, rating, user_rating_count, price_level, regular_opening_hours,
        match_reason, archived_at, updated_at
      ) values (
        target_item_id, target_plan_id, target_day_id, (item_json->>'sortOrder')::integer,
        case when item_json->>'time' ~* '^\d{1,2}:\d{2}\s*(am|pm)?$' then (item_json->>'time')::time else null end, item_json->>'type', item_json->>'title',
        coalesce(item_json->>'description', ''), coalesce(item_json->>'location', ''),
        nullif(item_json->>'placeId', ''), (item_json->>'latitude')::numeric, (item_json->>'longitude')::numeric,
        greatest(0, coalesce((item_json->>'costPerPerson')::numeric, 0)), greatest(0, coalesce((item_json->>'travelMinutes')::integer, 0)),
        nullif(item_json->>'travelMode', ''), (item_json->>'routeDistanceMeters')::integer,
        item_json->>'status', case item_json->>'verification' when 'verified' then 'google-verified' when 'planning-placeholder' then 'suggested' when 'needs-live-verification' then 'suggested' else item_json->>'verification' end, nullif(item_json->>'bookingUrl', ''),
        nullif(item_json->>'googleMapsUrl', ''), nullif(item_json->>'websiteUrl', ''), nullif(item_json->>'businessStatus', ''),
        (item_json->>'rating')::numeric, (item_json->>'userRatingCount')::integer, nullif(item_json->>'priceLevel', ''),
        item_json->'regularOpeningHours', nullif(item_json->>'matchReason', ''), null, now()
      )
      on conflict (id) do update set
        day_id = excluded.day_id, sort_order = excluded.sort_order, start_time = excluded.start_time,
        item_type = excluded.item_type, title = excluded.title, description = excluded.description,
        location_name = excluded.location_name, place_id = excluded.place_id, latitude = excluded.latitude,
        longitude = excluded.longitude, estimated_cost_per_person = excluded.estimated_cost_per_person,
        travel_minutes = excluded.travel_minutes, travel_mode = excluded.travel_mode,
        route_distance_meters = excluded.route_distance_meters, booking_status = excluded.booking_status,
        verification_status = excluded.verification_status, booking_url = excluded.booking_url,
        google_maps_url = excluded.google_maps_url, website_url = excluded.website_url,
        business_status = excluded.business_status, rating = excluded.rating,
        user_rating_count = excluded.user_rating_count, price_level = excluded.price_level,
        regular_opening_hours = excluded.regular_opening_hours, match_reason = excluded.match_reason,
        archived_at = null, updated_at = now();
    end loop;
  end loop;

  after_state := private.plan_snapshot(target_plan_id);
  insert into public.plan_edit_events(plan_id, actor_id, idempotency_key, instruction, before_snapshot, after_snapshot)
  values (target_plan_id, actor, edit_idempotency_key, edit_instruction, before_state, after_state)
  returning id into event_id;

  return jsonb_build_object('event_id', event_id, 'edit_version', current_version + 1, 'idempotent', false);
end;
$$;

create or replace function public.apply_saved_plan_edit(
  target_plan_id uuid,
  expected_edit_version integer,
  edit_idempotency_key text,
  edit_instruction text,
  edited_plan jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_saved_plan_edit(target_plan_id, expected_edit_version, edit_idempotency_key, edit_instruction, edited_plan)
$$;

revoke all on function private.apply_saved_plan_edit(uuid, integer, text, text, jsonb) from public, anon;
grant execute on function private.apply_saved_plan_edit(uuid, integer, text, text, jsonb) to authenticated;
revoke all on function public.apply_saved_plan_edit(uuid, integer, text, text, jsonb) from public, anon;
grant execute on function public.apply_saved_plan_edit(uuid, integer, text, text, jsonb) to authenticated;

create or replace function private.undo_saved_plan_edit(target_plan_id uuid, target_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  edit_event public.plan_edit_events;
  current_version integer;
  day_json jsonb;
  item_json jsonb;
  approval_json jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.plan_members
    where plan_id = target_plan_id and user_id = actor and role in ('owner', 'editor')
  ) then raise exception 'You do not have permission to edit this plan'; end if;

  select * into edit_event from public.plan_edit_events
  where id = target_event_id and plan_id = target_plan_id and undone_at is null
  for update;
  if edit_event.id is null then raise exception 'That edit is no longer available to undo'; end if;
  if exists (
    select 1 from public.plan_edit_events
    where plan_id = target_plan_id and undone_at is null and created_at > edit_event.created_at
  ) then raise exception 'Only the most recent edit can be undone'; end if;

  select edit_version into current_version from public.plans where id = target_plan_id for update;

  for day_json in select value from jsonb_array_elements(edit_event.before_snapshot->'days') loop
    insert into public.plan_days select * from jsonb_populate_record(null::public.plan_days, day_json)
    on conflict (id) do update set day_index = excluded.day_index, label = excluded.label, plan_date = excluded.plan_date;
  end loop;

  update public.plan_items set archived_at = now() where plan_id = target_plan_id;
  for item_json in select value from jsonb_array_elements(edit_event.before_snapshot->'items') loop
    insert into public.plan_items select * from jsonb_populate_record(null::public.plan_items, item_json)
    on conflict (id) do update set
      day_id = excluded.day_id, sort_order = excluded.sort_order, start_time = excluded.start_time,
      end_time = excluded.end_time, item_type = excluded.item_type, title = excluded.title,
      description = excluded.description, location_name = excluded.location_name, place_id = excluded.place_id,
      latitude = excluded.latitude, longitude = excluded.longitude,
      estimated_cost_per_person = excluded.estimated_cost_per_person, travel_minutes = excluded.travel_minutes,
      travel_mode = excluded.travel_mode, route_distance_meters = excluded.route_distance_meters,
      booking_status = excluded.booking_status, verification_status = excluded.verification_status,
      booking_url = excluded.booking_url, google_maps_url = excluded.google_maps_url,
      website_url = excluded.website_url, business_status = excluded.business_status,
      rating = excluded.rating, user_rating_count = excluded.user_rating_count,
      price_level = excluded.price_level, regular_opening_hours = excluded.regular_opening_hours,
      match_reason = excluded.match_reason, notes = excluded.notes, archived_at = excluded.archived_at,
      updated_at = now();
  end loop;

  update public.plans set
    title = edit_event.before_snapshot#>>'{plan,title}',
    description = edit_event.before_snapshot#>>'{plan,description}',
    primary_location = edit_event.before_snapshot#>>'{plan,primary_location}',
    participant_count = (edit_event.before_snapshot#>>'{plan,participant_count}')::integer,
    budget_per_person = (edit_event.before_snapshot#>>'{plan,budget_per_person}')::numeric,
    currency = edit_event.before_snapshot#>>'{plan,currency}',
    status = edit_event.before_snapshot#>>'{plan,status}',
    approval_version = (edit_event.before_snapshot#>>'{plan,approval_version}')::integer,
    approval_requested_at = (edit_event.before_snapshot#>>'{plan,approval_requested_at}')::timestamptz,
    finalized_at = (edit_event.before_snapshot#>>'{plan,finalized_at}')::timestamptz,
    edit_version = current_version + 1,
    updated_at = now()
  where id = target_plan_id;

  delete from public.plan_approvals where plan_id = target_plan_id;
  for approval_json in select value from jsonb_array_elements(edit_event.before_snapshot->'approvals') loop
    insert into public.plan_approvals select * from jsonb_populate_record(null::public.plan_approvals, approval_json)
    on conflict (plan_id, user_id, plan_version) do update set agreed_at = excluded.agreed_at;
  end loop;

  update public.plan_edit_events set undone_at = now() where id = edit_event.id;
  return jsonb_build_object('event_id', edit_event.id, 'edit_version', current_version + 1);
end;
$$;

create or replace function public.undo_saved_plan_edit(target_plan_id uuid, target_event_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.undo_saved_plan_edit(target_plan_id, target_event_id)
$$;

revoke all on function private.undo_saved_plan_edit(uuid, uuid) from public, anon;
grant execute on function private.undo_saved_plan_edit(uuid, uuid) to authenticated;
revoke all on function public.undo_saved_plan_edit(uuid, uuid) from public, anon;
grant execute on function public.undo_saved_plan_edit(uuid, uuid) to authenticated;
