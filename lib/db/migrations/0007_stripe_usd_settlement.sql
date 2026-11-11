-- Stripe collects in USD; original product and order totals remain in KWD.
-- All new fields are nullable/defaulted so existing order records stay intact.
alter table public.customer_orders
  add column if not exists stripe_payment_currency text
    check (stripe_payment_currency is null or stripe_payment_currency = 'USD'),
  add column if not exists stripe_payment_amount_minor bigint
    check (stripe_payment_amount_minor is null or stripe_payment_amount_minor > 0),
  add column if not exists stripe_exchange_rate numeric(18, 10)
    check (stripe_exchange_rate is null or stripe_exchange_rate > 0),
  add column if not exists stripe_exchange_rate_source text
    check (stripe_exchange_rate_source is null or stripe_exchange_rate_source = 'ExchangeRate-API'),
  add column if not exists stripe_exchange_rate_updated_at timestamptz,
  add column if not exists stripe_refunded_amount_minor bigint not null default 0
    check (stripe_refunded_amount_minor >= 0);

alter table public.orders
  add column if not exists stripe_payment_currency text
    check (stripe_payment_currency is null or stripe_payment_currency = 'USD'),
  add column if not exists stripe_payment_amount_minor bigint
    check (stripe_payment_amount_minor is null or stripe_payment_amount_minor > 0),
  add column if not exists stripe_exchange_rate numeric(18, 10)
    check (stripe_exchange_rate is null or stripe_exchange_rate > 0),
  add column if not exists stripe_exchange_rate_source text
    check (stripe_exchange_rate_source is null or stripe_exchange_rate_source = 'ExchangeRate-API'),
  add column if not exists stripe_exchange_rate_updated_at timestamptz,
  add column if not exists stripe_refunded_amount_minor bigint not null default 0
    check (stripe_refunded_amount_minor >= 0);

create or replace function public.sync_amore_account_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is null then
    delete from public.orders where id = new.id;
    return new;
  end if;

  insert into public.orders (
    id, user_id, number, payment_status, fulfillment_status,
    total_fils, currency, items, created_at, updated_at,
    payment_provider, stripe_checkout_session_id, stripe_payment_intent_id,
    stripe_charge_id, stripe_refunded_amount_fils, paid_at,
    stripe_payment_currency, stripe_payment_amount_minor,
    stripe_exchange_rate, stripe_exchange_rate_source,
    stripe_exchange_rate_updated_at, stripe_refunded_amount_minor
  ) values (
    new.id, new.user_id, new.number, new.payment_status, new.fulfillment_status,
    new.total_fils, new.currency,
    coalesce((
      select jsonb_agg(jsonb_build_object('title', item->>'title', 'quantity', (item->>'quantity')::integer))
      from jsonb_array_elements(new.items) item
    ), '[]'::jsonb),
    new.created_at, new.updated_at, new.payment_provider, new.stripe_checkout_session_id,
    new.stripe_payment_intent_id, new.stripe_charge_id, new.stripe_refunded_amount_fils, new.paid_at,
    new.stripe_payment_currency, new.stripe_payment_amount_minor,
    new.stripe_exchange_rate, new.stripe_exchange_rate_source,
    new.stripe_exchange_rate_updated_at, new.stripe_refunded_amount_minor
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    number = excluded.number,
    payment_status = excluded.payment_status,
    fulfillment_status = excluded.fulfillment_status,
    total_fils = excluded.total_fils,
    currency = excluded.currency,
    items = excluded.items,
    updated_at = excluded.updated_at,
    payment_provider = excluded.payment_provider,
    stripe_checkout_session_id = excluded.stripe_checkout_session_id,
    stripe_payment_intent_id = excluded.stripe_payment_intent_id,
    stripe_charge_id = excluded.stripe_charge_id,
    stripe_refunded_amount_fils = excluded.stripe_refunded_amount_fils,
    paid_at = excluded.paid_at,
    stripe_payment_currency = excluded.stripe_payment_currency,
    stripe_payment_amount_minor = excluded.stripe_payment_amount_minor,
    stripe_exchange_rate = excluded.stripe_exchange_rate,
    stripe_exchange_rate_source = excluded.stripe_exchange_rate_source,
    stripe_exchange_rate_updated_at = excluded.stripe_exchange_rate_updated_at,
    stripe_refunded_amount_minor = excluded.stripe_refunded_amount_minor;
  return new;
end;
$$;

drop trigger if exists sync_amore_account_order_after_change on public.customer_orders;
create trigger sync_amore_account_order_after_change
  after insert or update of user_id, number, payment_status, fulfillment_status,
    total_fils, currency, items, created_at, updated_at, payment_provider,
    stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
    stripe_refunded_amount_fils, paid_at, stripe_payment_currency,
    stripe_payment_amount_minor, stripe_exchange_rate,
    stripe_exchange_rate_source, stripe_exchange_rate_updated_at,
    stripe_refunded_amount_minor
  on public.customer_orders
  for each row execute function public.sync_amore_account_order();
