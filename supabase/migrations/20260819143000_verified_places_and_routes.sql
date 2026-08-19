alter table public.plan_items
  drop constraint if exists plan_items_verification_status_check;

update public.plan_items
set verification_status = case verification_status
  when 'verified' then 'google-verified'
  when 'live-availability' then 'live-availability'
  else 'suggested'
end;

alter table public.plan_items
  alter column verification_status set default 'suggested',
  add constraint plan_items_verification_status_check
    check (verification_status in ('suggested', 'google-verified', 'live-availability')),
  add column if not exists google_maps_url text,
  add column if not exists website_url text,
  add column if not exists business_status text,
  add column if not exists rating numeric(2, 1) check (rating is null or (rating >= 0 and rating <= 5)),
  add column if not exists user_rating_count integer check (user_rating_count is null or user_rating_count >= 0),
  add column if not exists price_level text,
  add column if not exists regular_opening_hours jsonb,
  add column if not exists match_reason text,
  add column if not exists travel_mode text check (travel_mode is null or travel_mode in ('walk', 'drive')),
  add column if not exists route_distance_meters integer check (route_distance_meters is null or route_distance_meters >= 0);
