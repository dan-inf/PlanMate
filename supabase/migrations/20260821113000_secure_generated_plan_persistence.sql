-- Keep privileged persistence inside the private schema while exposing one
-- authenticated, least-privilege RPC entry point to PostgREST.
create or replace function public.persist_generated_plan(payload jsonb, save_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return private.persist_generated_plan(payload, save_key);
end;
$$;

alter function public.persist_generated_plan(jsonb, text) owner to postgres;

-- The browser only needs the public RPC. It must not be able to traverse the
-- private schema or invoke its privileged implementation directly.
revoke all on schema private from public, anon, authenticated;
revoke all on function private.persist_generated_plan(jsonb, text) from public, anon, authenticated;
revoke all on function public.persist_generated_plan(jsonb, text) from public, anon, authenticated;
grant execute on function public.persist_generated_plan(jsonb, text) to authenticated;

-- Trigger-only routines must never retain PostgreSQL's default PUBLIC execute.
revoke all on function private.add_owner_membership() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.reopen_plan_after_item_change() from public, anon, authenticated;

-- Prevent future private routines created by this migration owner from
-- inheriting PUBLIC execute. Each callable routine must be granted explicitly.
alter default privileges in schema private revoke execute on functions from public;
