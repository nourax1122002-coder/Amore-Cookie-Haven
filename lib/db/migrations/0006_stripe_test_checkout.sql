alter table public.customer_orders
  add column if not exists payment_provider text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refunded_amount_fils integer not null default 0
    check (stripe_refunded_amount_fils >= 0),
  add column if not exists paid_at timestamptz;

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_refunded_amount_fils integer not null default 0
    check (stripe_refunded_amount_fils >= 0),
  add column if not exists paid_at timestamptz;

create unique index if not exists customer_orders_stripe_session_unique
  on public.customer_orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists customer_orders_stripe_payment_intent_unique
  on public.customer_orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

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
    stripe_charge_id, stripe_refunded_amount_fils, paid_at
  ) values (
    new.id, new.user_id, new.number, new.payment_status, new.fulfillment_status,
    new.total_fils, new.currency,
    coalesce((
      select jsonb_agg(jsonb_build_object('title', item->>'title', 'quantity', (item->>'quantity')::integer))
      from jsonb_array_elements(new.items) item
    ), '[]'::jsonb),
    new.created_at, new.updated_at, new.payment_provider, new.stripe_checkout_session_id,
    new.stripe_payment_intent_id, new.stripe_charge_id, new.stripe_refunded_amount_fils, new.paid_at
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
    paid_at = excluded.paid_at;
  return new;
end;
$$;

drop trigger if exists sync_amore_account_order_after_change on public.customer_orders;
create trigger sync_amore_account_order_after_change
  after insert or update of user_id, number, payment_status, fulfillment_status,
    total_fils, currency, items, created_at, updated_at, payment_provider,
    stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
    stripe_refunded_amount_fils, paid_at
  on public.customer_orders
  for each row execute function public.sync_amore_account_order();
