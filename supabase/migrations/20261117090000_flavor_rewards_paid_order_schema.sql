-- LOCAL REVIEW DRAFT ONLY.
-- Additive Flavor Rewards structures for verified Stripe Test Mode orders.
-- This migration intentionally does not modify customer_orders, products,
-- authentication, inventory, checkout, or any existing financial ledger.

lock table public.flavor_ideas in share row exclusive mode;

do $$
begin
  if exists (
    select creator_user_id
    from public.flavor_ideas
    group by creator_user_id
    having count(*) > 1
  ) then
    raise exception
      'Flavor Rewards migration stopped: multiple existing ideas share a creator; review them before creating lifetime claims.';
  end if;
end;
$$;

create table public.flavor_creation_claims (
  creator_user_id uuid primary key references auth.users(id) on delete restrict,
  flavor_id uuid unique references public.flavor_ideas(id) on delete set null,
  claimed_at timestamptz not null default now()
);

comment on table public.flavor_creation_claims is
  'Permanent one-creation-per-account claim; flavor_id becomes null if a draft is deleted, but the account claim remains.';

insert into public.flavor_creation_claims (creator_user_id, flavor_id)
select creator_user_id, id
from public.flavor_ideas
on conflict (creator_user_id) do nothing;

create or replace function private.claim_flavor_creation_once()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claimed_creator uuid;
begin
  insert into public.flavor_creation_claims (creator_user_id, flavor_id)
  values (new.creator_user_id, new.id)
  on conflict (creator_user_id) do nothing
  returning creator_user_id into v_claimed_creator;

  if v_claimed_creator is null then
    raise exception using
      errcode = '23505',
      constraint = 'flavor_creation_claims_pkey',
      message = 'Only one lifetime Flavor Rewards creation is allowed per account';
  end if;

  return new;
end;
$function$;

create trigger flavor_idea_lifetime_creation_claim
  after insert on public.flavor_ideas
  for each row execute function private.claim_flavor_creation_once();

create table public.flavor_reward_products (
  flavor_id uuid primary key references public.flavor_ideas(id) on delete restrict,
  product_id uuid not null unique references public.products(id) on delete restrict,
  linked_by_user_id uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.flavor_creation_claims is
  'Permanent one-creation claim. The auth.users RESTRICT reference intentionally blocks hard account deletion until an approved privacy/anonymization workflow preserves this anti-recreation tombstone.';

comment on table public.flavor_reward_products is
  'Admin-reviewed mapping from an approved published flavor to one existing catalog product; catalog price and inventory remain authoritative.';

create table public.flavor_reward_order_snapshots (
  customer_order_id text primary key references public.customer_orders(id) on delete restrict,
  flavor_id uuid not null references public.flavor_ideas(id) on delete restrict,
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  buyer_user_id uuid references auth.users(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  eligible_sales_fils bigint not null check (eligible_sales_fils > 0),
  eligible_order_number integer check (eligible_order_number is null or eligible_order_number > 0),
  verified_paid_at timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_payment_amount_minor bigint check (
    stripe_payment_amount_minor is null or stripe_payment_amount_minor > 0
  ),
  stripe_refunded_amount_minor bigint not null default 0 check (stripe_refunded_amount_minor >= 0),
  disputed_amount_minor bigint not null default 0 check (disputed_amount_minor >= 0),
  product_refunded_fils bigint not null default 0
    check (product_refunded_fils between 0 and eligible_sales_fils),
  product_disputed_fils bigint not null default 0
    check (product_disputed_fils between 0 and eligible_sales_fils),
  net_commissionable_sales_fils bigint not null default 0
    check (net_commissionable_sales_fils >= 0),
  commission_due_fils bigint not null default 0 check (commission_due_fils >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (verified_paid_at is null and eligible_order_number is null)
    or (verified_paid_at is not null and eligible_order_number is not null)
  )
);

comment on column public.flavor_reward_order_snapshots.eligible_sales_fils is
  'KWD fils for eligible cookie product sales only; shipping and delivery are excluded.';
comment on column public.flavor_reward_order_snapshots.product_refunded_fils is
  'Cumulative KWD fils explicitly attributed to product refunds; never inferred from Stripe charge-level USD refunds.';
comment on column public.flavor_reward_order_snapshots.product_disputed_fils is
  'KWD fils explicitly attributed to disputed product sales; shipping-only disputes contribute zero.';

create unique index flavor_reward_order_number_once
  on public.flavor_reward_order_snapshots (flavor_id, eligible_order_number)
  where eligible_order_number is not null;
create index flavor_reward_order_creator_paid_idx
  on public.flavor_reward_order_snapshots (creator_user_id, verified_paid_at desc)
  where verified_paid_at is not null;
create index flavor_reward_order_flavor_paid_idx
  on public.flavor_reward_order_snapshots (flavor_id, eligible_order_number)
  where verified_paid_at is not null;

create table public.flavor_reward_stripe_events (
  stripe_event_id text primary key
    check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (event_type in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.dispute.closed'
  )),
  customer_order_id text not null
    references public.flavor_reward_order_snapshots(customer_order_id) on delete restrict,
  stripe_payment_intent_id text not null,
  livemode boolean not null check (livemode = false),
  event_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);
create index flavor_reward_stripe_events_order_idx
  on public.flavor_reward_stripe_events (customer_order_id, event_created_at desc);

create table public.flavor_reward_order_disputes (
  stripe_dispute_id text primary key
    check (stripe_dispute_id ~ '^dp_[A-Za-z0-9]+$'),
  customer_order_id text not null
    references public.flavor_reward_order_snapshots(customer_order_id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  product_disputed_fils bigint not null check (product_disputed_fils >= 0),
  status text not null check (status in ('open', 'won', 'lost')),
  last_event_id text not null
    references public.flavor_reward_stripe_events(stripe_event_id) on delete restrict,
  last_event_created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index flavor_reward_disputes_order_status_idx
  on public.flavor_reward_order_disputes (customer_order_id, status);

-- Signed Stripe events whose product allocation cannot be verified are kept
-- for review instead of being discarded or prorated into commission changes.
create table public.flavor_reward_event_reviews (
  stripe_event_id text primary key
    check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (event_type in (
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.dispute.closed'
  )),
  stripe_object_type text not null check (stripe_object_type in ('charge', 'dispute')),
  stripe_object_id text not null check (
    (stripe_object_type = 'charge' and stripe_object_id ~ '^ch_[A-Za-z0-9]+$')
    or (stripe_object_type = 'dispute' and stripe_object_id ~ '^dp_[A-Za-z0-9]+$')
  ),
  customer_order_id text not null
    references public.flavor_reward_order_snapshots(customer_order_id) on delete restrict,
  stripe_payment_intent_id text not null
    check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'usd'),
  reason_code text not null check (reason_code in (
    'missing_allocation_metadata',
    'invalid_allocation_metadata',
    'allocation_order_mismatch',
    'allocation_amount_mismatch',
    'unsupported_dispute_status',
    'refund_list_incomplete',
    'refund_amount_mismatch',
    'invalid_refund',
    'duplicate_refund',
    'invalid_product_refund',
    'product_refund_exceeds_order',
    'invalid_dispute',
    'missing_dispute_metadata'
  )),
  allocation_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(allocation_metadata) = 'object'
      and octet_length(allocation_metadata::text) <= 4096
    ),
  event_created_at timestamptz not null,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'reviewed', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_snapshot uuid,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  check (
    (review_status = 'pending' and reviewed_at is null)
    or (review_status <> 'pending' and reviewed_at is not null)
  )
);
create index flavor_reward_event_reviews_pending_idx
  on public.flavor_reward_event_reviews (created_at)
  where review_status = 'pending';
create index flavor_reward_event_reviews_order_idx
  on public.flavor_reward_event_reviews (customer_order_id, created_at desc);

create table public.flavor_reward_paid_order_ledger (
  id uuid primary key default gen_random_uuid(),
  flavor_id uuid not null references public.flavor_ideas(id) on delete restrict,
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  customer_order_id text not null
    references public.flavor_reward_order_snapshots(customer_order_id) on delete restrict,
  eligible_order_number integer not null check (eligible_order_number > 0),
  entry_type text not null check (
    entry_type in ('milestone_bonus', 'commission', 'commission_adjustment')
  ),
  amount_fils bigint not null check (amount_fils <> 0),
  source_stripe_event_id text not null
    references public.flavor_reward_stripe_events(stripe_event_id) on delete restrict,
  reason text not null check (
    reason in ('paid_order', 'refund_adjustment', 'chargeback_adjustment')
  ),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (entry_type = 'milestone_bonus'
      and eligible_order_number = 100
      and amount_fils = 200000
      and reason = 'paid_order')
    or (entry_type = 'commission'
      and eligible_order_number >= 101
      and amount_fils > 0
      and reason = 'paid_order')
    or (entry_type = 'commission_adjustment'
      and eligible_order_number >= 101
      and reason in ('refund_adjustment', 'chargeback_adjustment'))
  ),
  unique (source_stripe_event_id, customer_order_id, entry_type)
);

create unique index flavor_paid_order_milestone_once
  on public.flavor_reward_paid_order_ledger (flavor_id)
  where entry_type = 'milestone_bonus';
create unique index flavor_paid_order_commission_once
  on public.flavor_reward_paid_order_ledger (customer_order_id)
  where entry_type = 'commission';
create index flavor_paid_order_ledger_creator_idx
  on public.flavor_reward_paid_order_ledger (creator_user_id, created_at desc);
create index flavor_paid_order_ledger_flavor_idx
  on public.flavor_reward_paid_order_ledger (flavor_id, eligible_order_number);

create or replace function private.reject_flavor_reward_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'Flavor Rewards financial ledger entries are append-only';
end;
$function$;

create trigger flavor_reward_paid_order_ledger_append_only
  before update or delete on public.flavor_reward_paid_order_ledger
  for each row execute function private.reject_flavor_reward_ledger_mutation();

create or replace function public.link_flavor_reward_product(
  p_admin_user_id uuid,
  p_flavor_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_creator_user_id uuid;
begin
  perform private.assert_flavor_rewards_admin(p_admin_user_id);

  select idea.creator_user_id
  into v_creator_user_id
  from public.flavor_ideas as idea
  where idea.id = p_flavor_id
    and idea.status = 'published'
    and idea.commercial_status = 'approved'
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'Only published, commercially approved flavors can be linked';
  end if;

  if not exists (
    select 1
    from public.products as product
    where product.id = p_product_id
      and product.is_active
      and product.currency = 'KWD'
      and product.price > 0
  ) then
    raise exception using errcode = '22023', message = 'Active KWD catalog product not found';
  end if;

  insert into public.flavor_reward_products (
    flavor_id, product_id, linked_by_user_id
  ) values (
    p_flavor_id, p_product_id, p_admin_user_id
  );

  return jsonb_build_object(
    'flavorId', p_flavor_id,
    'productId', p_product_id,
    'creatorUserId', v_creator_user_id
  );
end;
$function$;

create or replace function public.claim_flavor_reward_order(
  p_customer_order_id text,
  p_flavor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.customer_orders%rowtype;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_fils bigint;
  v_eligible_sales_fils bigint;
  v_creator_user_id uuid;
  v_product_price numeric;
  v_existing_snapshot public.flavor_reward_order_snapshots%rowtype;
begin
  select *
  into v_order
  from public.customer_orders
  where id = p_customer_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Customer order not found';
  end if;
  if v_order.payment_provider <> 'stripe'
     or v_order.currency <> 'KWD'
     or v_order.payment_status not in ('creating', 'pending', 'review')
     or jsonb_typeof(v_order.items) <> 'array'
     or jsonb_array_length(v_order.items) <> 1 then
    raise exception using
      errcode = '22023',
      message = 'Flavor Rewards orders must be pending, Stripe-only, KWD, and contain one catalog line';
  end if;

  v_item := v_order.items -> 0;
  if jsonb_typeof(v_item) <> 'object'
     or coalesce(v_item ->> 'variantId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(v_item ->> 'quantity', '') !~ '^[1-9][0-9]{0,2}$'
     or coalesce(v_item ->> 'unitFils', '') !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Invalid flavor order line';
  end if;

  v_product_id := (v_item ->> 'variantId')::uuid;
  v_quantity := (v_item ->> 'quantity')::integer;
  v_unit_fils := (v_item ->> 'unitFils')::bigint;
  v_eligible_sales_fils := v_unit_fils * v_quantity;

  select idea.creator_user_id, product.price
  into v_creator_user_id, v_product_price
  from public.flavor_reward_products as mapping
  join public.flavor_ideas as idea on idea.id = mapping.flavor_id
  join public.products as product on product.id = mapping.product_id
  where mapping.flavor_id = p_flavor_id
    and mapping.product_id = v_product_id
    and mapping.is_active
    and product.is_active
    and idea.status = 'published'
    and idea.commercial_status = 'approved';
  if not found then
    raise exception using
      errcode = '42501',
      message = 'Order product is not mapped to an approved published flavor';
  end if;
  if round(v_product_price * 1000)::bigint <> v_unit_fils
     or v_order.subtotal_fils::bigint <> v_eligible_sales_fils
     or v_order.total_fils::bigint <> v_order.subtotal_fils::bigint + v_order.shipping_fils::bigint then
    raise exception using errcode = '22023', message = 'Flavor order price does not match the catalog';
  end if;

  select *
  into v_existing_snapshot
  from public.flavor_reward_order_snapshots
  where customer_order_id = p_customer_order_id
  for update;
  if found then
    if v_existing_snapshot.flavor_id <> p_flavor_id
       or v_existing_snapshot.product_id <> v_product_id
       or v_existing_snapshot.creator_user_id <> v_creator_user_id
       or v_existing_snapshot.eligible_sales_fils <> v_eligible_sales_fils then
      raise exception using errcode = '23505', message = 'Order is already claimed for a different flavor';
    end if;
    return jsonb_build_object(
      'duplicate', true,
      'customerOrderId', p_customer_order_id,
      'flavorId', p_flavor_id,
      'eligibleSalesFils', v_eligible_sales_fils
    );
  end if;

  insert into public.flavor_reward_order_snapshots (
    customer_order_id, flavor_id, creator_user_id, buyer_user_id,
    product_id, eligible_sales_fils
  ) values (
    p_customer_order_id, p_flavor_id, v_creator_user_id, v_order.user_id,
    v_product_id, v_eligible_sales_fils
  );

  return jsonb_build_object(
    'duplicate', false,
    'customerOrderId', p_customer_order_id,
    'flavorId', p_flavor_id,
    'eligibleSalesFils', v_eligible_sales_fils
  );
end;
$function$;

create or replace function public.record_flavor_reward_review_event(
  p_stripe_event_id text,
  p_event_type text,
  p_stripe_object_type text,
  p_stripe_object_id text,
  p_customer_order_id text,
  p_payment_intent_id text,
  p_amount_minor bigint,
  p_currency text,
  p_reason_code text,
  p_allocation_metadata jsonb,
  p_event_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.customer_orders%rowtype;
  v_snapshot public.flavor_reward_order_snapshots%rowtype;
  v_existing public.flavor_reward_event_reviews%rowtype;
begin
  if p_stripe_event_id is null
     or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_event_type not in (
       'charge.refunded',
       'charge.dispute.created',
       'charge.dispute.updated',
       'charge.dispute.closed'
     )
     or p_stripe_object_type not in ('charge', 'dispute')
     or (p_event_type = 'charge.refunded' and p_stripe_object_type <> 'charge')
     or (p_event_type like 'charge.dispute.%' and p_stripe_object_type <> 'dispute')
     or p_stripe_object_id is null
     or (p_stripe_object_type = 'charge' and p_stripe_object_id !~ '^ch_[A-Za-z0-9]+$')
     or (p_stripe_object_type = 'dispute' and p_stripe_object_id !~ '^dp_[A-Za-z0-9]+$')
     or p_payment_intent_id is null
     or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
     or p_amount_minor is null
     or p_amount_minor < 1
     or p_currency is distinct from 'usd'
     or p_reason_code not in (
       'missing_allocation_metadata',
       'invalid_allocation_metadata',
       'allocation_order_mismatch',
       'allocation_amount_mismatch',
       'unsupported_dispute_status',
       'refund_list_incomplete',
       'refund_amount_mismatch',
       'invalid_refund',
       'duplicate_refund',
       'invalid_product_refund',
       'product_refund_exceeds_order',
       'invalid_dispute',
       'missing_dispute_metadata'
     )
     or p_allocation_metadata is null
     or jsonb_typeof(p_allocation_metadata) <> 'object'
     or octet_length(p_allocation_metadata::text) > 4096
     or p_event_created_at is null then
    raise exception using errcode = '22023', message = 'Invalid Flavor Rewards review event';
  end if;

  select *
  into v_order
  from public.customer_orders
  where id = p_customer_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Customer order not found';
  end if;
  select *
  into v_snapshot
  from public.flavor_reward_order_snapshots
  where customer_order_id = p_customer_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Flavor Rewards order snapshot not found';
  end if;
  if v_order.payment_provider <> 'stripe'
     or v_order.currency <> 'KWD'
     or v_order.stripe_payment_currency <> 'USD'
     or v_order.stripe_payment_intent_id <> p_payment_intent_id
     or v_order.stripe_payment_amount_minor is null
     or v_order.payment_status not in ('paid', 'partially_refunded', 'refunded')
     or p_amount_minor > v_order.stripe_payment_amount_minor then
    raise exception using errcode = '23514', message = 'Review event does not match the saved test order';
  end if;

  if exists (
    select 1
    from public.flavor_reward_stripe_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return jsonb_build_object('duplicate', true, 'alreadyProcessed', true);
  end if;

  select *
  into v_existing
  from public.flavor_reward_event_reviews
  where stripe_event_id = p_stripe_event_id;
  if found then
    if v_existing.event_type <> p_event_type
       or v_existing.customer_order_id <> p_customer_order_id
       or v_existing.stripe_object_id <> p_stripe_object_id
       or v_existing.stripe_payment_intent_id <> p_payment_intent_id then
      raise exception using errcode = '23505', message = 'Stripe review event ID was reused for another object';
    end if;
    return jsonb_build_object('duplicate', true, 'reviewId', v_existing.stripe_event_id);
  end if;

  insert into public.flavor_reward_event_reviews (
    stripe_event_id, event_type, stripe_object_type, stripe_object_id,
    customer_order_id, stripe_payment_intent_id, amount_minor, currency,
    reason_code, allocation_metadata, event_created_at
  ) values (
    p_stripe_event_id, p_event_type, p_stripe_object_type, p_stripe_object_id,
    p_customer_order_id, p_payment_intent_id, p_amount_minor, p_currency,
    p_reason_code, p_allocation_metadata, p_event_created_at
  );
  return jsonb_build_object('duplicate', false, 'reviewId', p_stripe_event_id);
end;
$function$;

create or replace function public.resolve_flavor_reward_event_review(
  p_admin_user_id uuid,
  p_stripe_event_id text,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_review public.flavor_reward_event_reviews%rowtype;
begin
  perform private.assert_flavor_rewards_admin(p_admin_user_id);
  if p_stripe_event_id is null
     or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_decision is null
     or p_decision not in ('reviewed', 'dismissed')
     or p_note is null
     or char_length(btrim(p_note)) < 5
     or char_length(p_note) > 2000 then
    raise exception using errcode = '22023', message = 'Invalid Flavor Rewards review decision';
  end if;

  update public.flavor_reward_event_reviews
  set review_status = p_decision,
      reviewed_by = p_admin_user_id,
      reviewed_by_snapshot = p_admin_user_id,
      reviewed_at = now(),
      review_note = btrim(p_note)
  where stripe_event_id = p_stripe_event_id
    and review_status = 'pending'
  returning * into v_review;

  if found then
    return jsonb_build_object(
      'reviewId', v_review.stripe_event_id,
      'status', v_review.review_status,
      'reviewedBy', v_review.reviewed_by_snapshot,
      'reviewedAt', v_review.reviewed_at
    );
  end if;

  select * into v_review
  from public.flavor_reward_event_reviews
  where stripe_event_id = p_stripe_event_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Flavor Rewards review event not found';
  end if;
  if v_review.review_status = p_decision
     and v_review.reviewed_by_snapshot = p_admin_user_id
     and v_review.review_note = btrim(p_note) then
    return jsonb_build_object(
      'reviewId', v_review.stripe_event_id,
      'status', v_review.review_status,
      'reviewedBy', v_review.reviewed_by_snapshot,
      'reviewedAt', v_review.reviewed_at,
      'duplicate', true
    );
  end if;
  raise exception using errcode = '23505', message = 'Flavor Rewards review event was already resolved';
end;
$function$;

create or replace function public.process_flavor_reward_stripe_event(
  p_stripe_event_id text,
  p_event_type text,
  p_customer_order_id text,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_livemode boolean,
  p_payment_status text default null,
  p_payment_amount_minor bigint default null,
  p_refunded_amount_minor bigint default null,
  p_dispute_id text default null,
  p_dispute_amount_minor bigint default null,
  p_dispute_status text default null,
  p_event_created_at timestamptz default now(),
  p_product_refunded_fils bigint default null,
  p_dispute_product_amount_fils bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.customer_orders%rowtype;
  v_snapshot public.flavor_reward_order_snapshots%rowtype;
  v_existing_event public.flavor_reward_stripe_events%rowtype;
  v_event_inserted integer;
  v_product_disputed_fils bigint;
  v_net_sales_fils bigint;
  v_new_commission_fils bigint;
  v_commission_delta bigint;
  v_next_order_number integer;
  v_event_reason text;
  v_current_eligible_orders integer;
begin
  if p_livemode is distinct from false
     or p_stripe_event_id is null
     or p_stripe_event_id !~ '^evt_[A-Za-z0-9]+$'
     or p_event_type is null
     or p_event_created_at is null
     or p_event_type not in (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'charge.refunded',
       'charge.dispute.created',
       'charge.dispute.updated',
       'charge.dispute.closed'
     ) then
    raise exception using errcode = '22023', message = 'Invalid or live Stripe event';
  end if;
  if p_checkout_session_id is null
     or p_checkout_session_id !~ '^cs_test_[A-Za-z0-9]+$'
     or p_payment_intent_id is null
     or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
     or p_payment_amount_minor is null
     or p_payment_amount_minor < 1 then
    raise exception using errcode = '22023', message = 'Stripe event is missing its test payment references';
  end if;

  select *
  into v_order
  from public.customer_orders
  where id = p_customer_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Customer order not found';
  end if;
  select *
  into v_snapshot
  from public.flavor_reward_order_snapshots
  where customer_order_id = p_customer_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Flavor Rewards order snapshot not found';
  end if;

  if v_order.payment_provider <> 'stripe'
     or v_order.currency <> 'KWD'
     or v_order.stripe_payment_currency <> 'USD'
     or v_order.stripe_checkout_session_id <> p_checkout_session_id
     or v_order.stripe_payment_intent_id <> p_payment_intent_id
     or v_order.stripe_payment_amount_minor is null
     or (p_payment_amount_minor is not null
       and p_payment_amount_minor <> v_order.stripe_payment_amount_minor) then
    raise exception using errcode = '23514', message = 'Stripe payment does not match the saved flavor order';
  end if;

  -- Duplicate delivery of one event is a no-op; reusing its ID for a different
  -- event/order is rejected. The unique order-level snapshot also prevents a
  -- second Stripe success event from counting the same order twice.
  select *
  into v_existing_event
  from public.flavor_reward_stripe_events
  where stripe_event_id = p_stripe_event_id;
  if found then
    if v_existing_event.event_type <> p_event_type
       or v_existing_event.customer_order_id <> p_customer_order_id
       or v_existing_event.stripe_payment_intent_id <> p_payment_intent_id then
      raise exception using errcode = '23505', message = 'Stripe event ID was reused for another payment event';
    end if;
    return jsonb_build_object('duplicate', true, 'customerOrderId', p_customer_order_id);
  end if;

  if p_event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    if p_payment_status <> 'paid'
       or v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
      raise exception using errcode = '23514', message = 'Stripe Checkout Session is not verified as paid';
    end if;
  elsif p_event_type = 'charge.refunded' then
    if p_refunded_amount_minor is null
       or p_refunded_amount_minor < v_snapshot.stripe_refunded_amount_minor
       or p_refunded_amount_minor < v_order.stripe_refunded_amount_minor
       or p_refunded_amount_minor > v_order.stripe_payment_amount_minor
       or p_product_refunded_fils is null
       or p_product_refunded_fils < v_snapshot.product_refunded_fils
       or p_product_refunded_fils > v_snapshot.eligible_sales_fils then
      raise exception using errcode = '22023', message = 'Invalid cumulative Stripe refund amount';
    end if;
  else
    if p_dispute_id is null
       or p_dispute_id !~ '^dp_[A-Za-z0-9]+$'
       or p_dispute_amount_minor is null
       or p_dispute_amount_minor < 1
       or p_dispute_amount_minor > v_order.stripe_payment_amount_minor
        or p_dispute_product_amount_fils is null
        or p_dispute_product_amount_fils < 0
        or p_dispute_product_amount_fils > v_snapshot.eligible_sales_fils
       or p_dispute_status is null
       or p_dispute_status not in ('open', 'won', 'lost') then
      raise exception using errcode = '22023', message = 'Invalid Stripe dispute details';
    end if;
  end if;

  insert into public.flavor_reward_stripe_events (
    stripe_event_id, event_type, customer_order_id, stripe_payment_intent_id,
    livemode, event_created_at
  ) values (
    p_stripe_event_id, p_event_type, p_customer_order_id, p_payment_intent_id,
    false, p_event_created_at
  );

  if p_event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
     and v_snapshot.eligible_order_number is null then
    perform 1
    from public.flavor_ideas
    where id = v_snapshot.flavor_id
    for update;
    select coalesce(max(eligible_order_number), 0) + 1
    into v_next_order_number
    from public.flavor_reward_order_snapshots
    where flavor_id = v_snapshot.flavor_id
      and eligible_order_number is not null;
  end if;

  if p_event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    update public.flavor_reward_order_snapshots
    set stripe_checkout_session_id = p_checkout_session_id,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_payment_amount_minor = v_order.stripe_payment_amount_minor,
        eligible_order_number = coalesce(eligible_order_number, v_next_order_number),
        stripe_refunded_amount_minor = greatest(
          stripe_refunded_amount_minor,
          v_order.stripe_refunded_amount_minor
        ),
        verified_paid_at = coalesce(verified_paid_at, p_event_created_at),
        updated_at = now()
    where customer_order_id = p_customer_order_id;
  elsif p_event_type = 'charge.refunded' then
    update public.flavor_reward_order_snapshots
    set stripe_refunded_amount_minor = p_refunded_amount_minor,
        product_refunded_fils = p_product_refunded_fils,
        stripe_checkout_session_id = p_checkout_session_id,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_payment_amount_minor = v_order.stripe_payment_amount_minor,
        updated_at = now()
    where customer_order_id = p_customer_order_id;
  else
    insert into public.flavor_reward_order_disputes (
      stripe_dispute_id, customer_order_id, amount_minor, product_disputed_fils, status,
      last_event_id, last_event_created_at
    ) values (
      p_dispute_id, p_customer_order_id, p_dispute_amount_minor,
      p_dispute_product_amount_fils,
      p_dispute_status, p_stripe_event_id, p_event_created_at
    )
    on conflict (stripe_dispute_id) do update
      set amount_minor = excluded.amount_minor,
          product_disputed_fils = excluded.product_disputed_fils,
          status = excluded.status,
          last_event_id = excluded.last_event_id,
          last_event_created_at = excluded.last_event_created_at,
          updated_at = now()
      where flavor_reward_order_disputes.customer_order_id = excluded.customer_order_id
        and excluded.last_event_created_at
          >= flavor_reward_order_disputes.last_event_created_at;
    if not found then
      if not exists (
        select 1
        from public.flavor_reward_order_disputes
        where stripe_dispute_id = p_dispute_id
          and customer_order_id = p_customer_order_id
      ) then
        raise exception using errcode = '23505', message = 'Stripe dispute belongs to another order';
      end if;
    end if;
    update public.flavor_reward_order_snapshots
    set stripe_checkout_session_id = p_checkout_session_id,
        stripe_payment_intent_id = p_payment_intent_id,
        stripe_payment_amount_minor = v_order.stripe_payment_amount_minor,
        updated_at = now()
    where customer_order_id = p_customer_order_id;
  end if;

  select *
  into v_snapshot
  from public.flavor_reward_order_snapshots
  where customer_order_id = p_customer_order_id
  for update;

  select coalesce(sum(product_disputed_fils), 0)
  into v_product_disputed_fils
  from public.flavor_reward_order_disputes
  where customer_order_id = p_customer_order_id
    and status in ('open', 'lost');

  update public.flavor_reward_order_snapshots
  set disputed_amount_minor = coalesce((
        select sum(dispute.amount_minor)
        from public.flavor_reward_order_disputes as dispute
        where dispute.customer_order_id = p_customer_order_id
          and dispute.status in ('open', 'lost')
      ), 0),
      product_disputed_fils = v_product_disputed_fils,
      updated_at = now()
  where customer_order_id = p_customer_order_id
  returning * into v_snapshot;

  if v_snapshot.verified_paid_at is not null then
    v_net_sales_fils := greatest(
      0,
      v_snapshot.eligible_sales_fils
        - v_snapshot.product_refunded_fils
        - v_snapshot.product_disputed_fils
    );
    v_new_commission_fils := case
      when v_snapshot.eligible_order_number >= 101
        then round(v_net_sales_fils::numeric * 15 / 100)::bigint
      else 0
    end;

    if v_snapshot.eligible_order_number = 100 then
      insert into public.flavor_reward_paid_order_ledger (
        flavor_id, creator_user_id, customer_order_id, eligible_order_number,
        entry_type, amount_fils, source_stripe_event_id, reason, metadata
      ) values (
        v_snapshot.flavor_id, v_snapshot.creator_user_id, p_customer_order_id, 100,
        'milestone_bonus', 200000, p_stripe_event_id, 'paid_order',
        jsonb_build_object('milestone', 100, 'currency', 'KWD', 'permanent', true)
      )
      on conflict (flavor_id) where entry_type = 'milestone_bonus' do nothing;
    end if;

    if v_new_commission_fils <> v_snapshot.commission_due_fils then
      v_commission_delta := v_new_commission_fils - v_snapshot.commission_due_fils;
      if v_snapshot.commission_due_fils = 0 and v_new_commission_fils > 0 then
        insert into public.flavor_reward_paid_order_ledger (
          flavor_id, creator_user_id, customer_order_id, eligible_order_number,
          entry_type, amount_fils, source_stripe_event_id, reason, metadata
        ) values (
          v_snapshot.flavor_id, v_snapshot.creator_user_id, p_customer_order_id,
          v_snapshot.eligible_order_number, 'commission', v_new_commission_fils,
          p_stripe_event_id, 'paid_order',
          jsonb_build_object('commission_percent', 15, 'net_sales_fils', v_net_sales_fils)
        );
      elsif v_commission_delta <> 0 then
        v_event_reason := case
          when p_event_type = 'charge.refunded' then 'refund_adjustment'
          else 'chargeback_adjustment'
        end;
        insert into public.flavor_reward_paid_order_ledger (
          flavor_id, creator_user_id, customer_order_id, eligible_order_number,
          entry_type, amount_fils, source_stripe_event_id, reason, metadata
        ) values (
          v_snapshot.flavor_id, v_snapshot.creator_user_id, p_customer_order_id,
          v_snapshot.eligible_order_number, 'commission_adjustment', v_commission_delta,
          p_stripe_event_id, v_event_reason,
          jsonb_build_object(
            'commission_percent', 15,
            'net_sales_fils', v_net_sales_fils,
            'prior_commission_fils', v_snapshot.commission_due_fils
          )
        );
      end if;
    end if;

    update public.flavor_reward_order_snapshots
    set net_commissionable_sales_fils = v_net_sales_fils,
        commission_due_fils = v_new_commission_fils,
        updated_at = now()
    where customer_order_id = p_customer_order_id;
  end if;

  select count(*)
  into v_current_eligible_orders
  from public.flavor_reward_order_snapshots
  where flavor_id = v_snapshot.flavor_id
    and verified_paid_at is not null
    and net_commissionable_sales_fils > 0;

  return jsonb_build_object(
    'duplicate', false,
    'customerOrderId', p_customer_order_id,
    'eligibleOrderNumber', v_snapshot.eligible_order_number,
    'currentEligibleOrderCount', v_current_eligible_orders,
    'milestoneEarned', exists (
      select 1
      from public.flavor_reward_paid_order_ledger
      where flavor_id = v_snapshot.flavor_id
        and entry_type = 'milestone_bonus'
    ),
    'commissionDueFils', coalesce(v_new_commission_fils, v_snapshot.commission_due_fils)
  );
end;
$function$;

-- Establish the complete least-privilege boundary in this migration.
-- Supabase grants new public tables and functions to API roles by default;
-- do not leave any commit point between schema creation and this hardening.
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

-- Trigger functions are invoked by PostgreSQL triggers, never by API clients.
revoke all on function private.claim_flavor_creation_once()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_flavor_reward_ledger_mutation()
  from public, anon, authenticated, service_role;

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

-- Payouts and manual sales remain disabled from the first migration commit.
revoke all on function public.record_flavor_net_sale(uuid, uuid, text, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.request_flavor_payout(uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.review_flavor_payout_request(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
