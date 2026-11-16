-- LOCAL REVIEW DRAFT ONLY.
-- Least-privilege access for new Flavor Rewards structures and RPCs.

alter table public.flavor_creation_claims enable row level security;
alter table public.flavor_reward_products enable row level security;
alter table public.flavor_reward_order_snapshots enable row level security;
alter table public.flavor_reward_stripe_events enable row level security;
alter table public.flavor_reward_order_disputes enable row level security;
alter table public.flavor_reward_event_reviews enable row level security;
alter table public.flavor_reward_paid_order_ledger enable row level security;

revoke all on table
  public.flavor_creation_claims,
  public.flavor_reward_products,
  public.flavor_reward_order_snapshots,
  public.flavor_reward_stripe_events,
  public.flavor_reward_order_disputes,
  public.flavor_reward_event_reviews,
  public.flavor_reward_paid_order_ledger
from public, anon, authenticated, service_role;

grant select on table
  public.flavor_creation_claims,
  public.flavor_reward_paid_order_ledger
to authenticated, service_role;

grant select on table public.flavor_reward_event_reviews to authenticated, service_role;

grant select on table
  public.flavor_reward_products,
  public.flavor_reward_order_snapshots,
  public.flavor_reward_stripe_events,
  public.flavor_reward_order_disputes
to service_role;

create policy "Creators and administrators read lifetime creation claims"
  on public.flavor_creation_claims
  for select to authenticated
  using (
    creator_user_id = (select auth.uid())
    or private.flavor_rewards_is_admin()
  );

create policy "Creators and administrators read paid-order reward ledger"
  on public.flavor_reward_paid_order_ledger
  for select to authenticated
  using (
    creator_user_id = (select auth.uid())
    or private.flavor_rewards_is_admin()
  );

create policy "Administrators read pending payment review events"
  on public.flavor_reward_event_reviews
  for select to authenticated
  using (private.flavor_rewards_is_admin());

-- No client insert/update/delete policies are created for the new financial
-- or payment tables. Definer RPCs below are the only write path.
revoke all on function public.link_flavor_reward_product(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_flavor_reward_order(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_flavor_reward_review_event(
  text, text, text, text, text, text, bigint, text, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.resolve_flavor_reward_event_review(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.process_flavor_reward_stripe_event(
  text, text, text, text, text, boolean, text, bigint, bigint, text, bigint, text,
  timestamptz, bigint, bigint
) from public, anon, authenticated, service_role;

grant execute on function public.link_flavor_reward_product(uuid, uuid, uuid)
  to service_role;
grant execute on function public.claim_flavor_reward_order(text, uuid)
  to service_role;
grant execute on function public.record_flavor_reward_review_event(
  text, text, text, text, text, text, bigint, text, text, jsonb, timestamptz
) to service_role;
grant execute on function public.resolve_flavor_reward_event_review(uuid, text, text, text)
  to service_role;
grant execute on function public.process_flavor_reward_stripe_event(
  text, text, text, text, text, boolean, text, bigint, bigint, text, bigint, text,
  timestamptz, bigint, bigint
) to service_role;

comment on function public.process_flavor_reward_stripe_event(
  text, text, text, text, text, boolean, text, bigint, bigint, text, bigint, text,
  timestamptz, bigint, bigint
) is
  'Must only be called by the existing Stripe Edge Function after raw-body signature verification, Test Mode validation, and order/session/amount matching.';
