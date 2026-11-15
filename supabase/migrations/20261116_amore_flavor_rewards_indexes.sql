-- Cover the new administrative foreign keys for efficient review and audit queries.
create index if not exists flavor_ideas_reviewed_by_idx
  on public.flavor_ideas (reviewed_by);
create index if not exists flavor_sales_recorded_by_idx
  on public.flavor_sales (recorded_by);
create index if not exists flavor_payout_requests_reviewed_by_idx
  on public.flavor_payout_requests (reviewed_by);
create index if not exists flavor_payout_events_actor_idx
  on public.flavor_payout_events (actor_user_id);
create index if not exists flavor_commercial_reviews_admin_user_idx
  on public.flavor_commercial_reviews (admin_user_id);
