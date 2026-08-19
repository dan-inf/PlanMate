create table public.product_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (event_name in (
    'invitation_opened','invitation_auth_started','invitation_account_created','invitation_accepted','shared_plan_opened',
    'collaborator_create_cta_seen','collaborator_create_cta_clicked','collaborator_generated_own_plan','collaborator_saved_own_plan',
    'free_creation_granted','free_creation_save_started','free_creation_consumed','free_creation_consume_failed',
    'free_creation_reversed','free_creation_balance_viewed','create_cta_clicked'
  )),
  plan_id uuid references public.plans(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(properties::text) <= 2048)
);

create index product_events_user_created_idx on public.product_events(user_id, created_at desc);
create index product_events_name_created_idx on public.product_events(event_name, created_at desc);
alter table public.product_events enable row level security;
revoke all on public.product_events from public, anon, authenticated;

create or replace function public.track_product_event(event_name text, plan_id uuid default null, properties jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if event_name not in ('invitation_opened','invitation_auth_started','invitation_account_created','invitation_accepted','shared_plan_opened','collaborator_create_cta_seen','collaborator_create_cta_clicked','collaborator_generated_own_plan','collaborator_saved_own_plan','free_creation_granted','free_creation_save_started','free_creation_consumed','free_creation_consume_failed','free_creation_reversed','free_creation_balance_viewed','create_cta_clicked') then raise exception 'Unsupported event'; end if;
  if properties ?| array['prompt','email','token','comment','api_key'] or octet_length(properties::text) > 2048 then raise exception 'Sensitive or oversized event properties'; end if;
  insert into public.product_events(user_id,event_name,plan_id,properties) values (auth.uid(),event_name,plan_id,properties);
end;
$$;
revoke all on function public.track_product_event(text,uuid,jsonb) from public;
grant execute on function public.track_product_event(text,uuid,jsonb) to anon, authenticated;

create or replace function private.track_entitlement_ledger_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'entitlement_grants' then
    insert into public.product_events(user_id,event_name,properties) values (new.user_id,'free_creation_granted',jsonb_build_object('source',new.source));
  elsif tg_table_name = 'entitlement_usage' then
    insert into public.product_events(user_id,event_name,plan_id,properties) values (new.user_id,'free_creation_consumed',new.plan_id,jsonb_build_object('source',new.source));
  elsif tg_table_name = 'generated_plan_saves' then
    insert into public.product_events(user_id,event_name,plan_id,properties) values (new.user_id,'collaborator_saved_own_plan',new.plan_id,jsonb_build_object('consumed_entitlement',new.consumed_entitlement));
  end if;
  return new;
end;
$$;
revoke all on function private.track_entitlement_ledger_event() from public, anon, authenticated;
create trigger track_creation_grant after insert on public.entitlement_grants for each row execute function private.track_entitlement_ledger_event();
create trigger track_creation_usage after insert on public.entitlement_usage for each row execute function private.track_entitlement_ledger_event();
create trigger track_owned_plan_save after insert on public.generated_plan_saves for each row execute function private.track_entitlement_ledger_event();
