create table if not exists public.orders (
  id text primary key references public.customer_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null unique,
  payment_status text not null,
  fulfillment_status text not null,
  total_fils integer not null check (total_fils >= 0),
  currency text not null default 'KWD' check (currency = 'KWD'),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_user_product_unique unique (user_id, product_id)
);

create index if not exists favorites_user_created_idx
  on public.favorites (user_id, created_at desc);

alter table public.orders enable row level security;
alter table public.favorites enable row level security;

revoke all on table public.orders, public.favorites from public, anon, authenticated;
grant select on table public.orders to authenticated;
grant select, insert, update, delete on table public.favorites to authenticated;
grant select, insert, update, delete on table public.orders, public.favorites to service_role;

drop policy if exists "Users read their own orders" on public.orders;
create policy "Users read their own orders"
  on public.orders for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users read their own favorites" on public.favorites;
create policy "Users read their own favorites"
  on public.favorites for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add their own favorites" on public.favorites;
create policy "Users add their own favorites"
  on public.favorites for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.products
      where products.id = product_id and products.is_active
    )
  );

drop policy if exists "Users update their own favorites" on public.favorites;
create policy "Users update their own favorites"
  on public.favorites for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.products
      where products.id = product_id and products.is_active
    )
  );

drop policy if exists "Users remove their own favorites" on public.favorites;
create policy "Users remove their own favorites"
  on public.favorites for delete to authenticated
  using ((select auth.uid()) = user_id);

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
    total_fils, currency, items, created_at, updated_at
  ) values (
    new.id, new.user_id, new.number, new.payment_status, new.fulfillment_status,
    new.total_fils, new.currency,
    coalesce((
      select jsonb_agg(jsonb_build_object('title', item->>'title', 'quantity', (item->>'quantity')::integer))
      from jsonb_array_elements(new.items) item
    ), '[]'::jsonb),
    new.created_at, new.updated_at
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    number = excluded.number,
    payment_status = excluded.payment_status,
    fulfillment_status = excluded.fulfillment_status,
    total_fils = excluded.total_fils,
    currency = excluded.currency,
    items = excluded.items,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.sync_amore_account_order() from public, anon, authenticated;

drop trigger if exists sync_amore_account_order_after_change on public.customer_orders;
create trigger sync_amore_account_order_after_change
  after insert or update of user_id, number, payment_status, fulfillment_status,
    total_fils, currency, items, created_at, updated_at
  on public.customer_orders
  for each row execute function public.sync_amore_account_order();

insert into public.orders (
  id, user_id, number, payment_status, fulfillment_status,
  total_fils, currency, items, created_at, updated_at
)
select
  co.id, co.user_id, co.number, co.payment_status, co.fulfillment_status,
  co.total_fils, co.currency,
  coalesce((
    select jsonb_agg(jsonb_build_object('title', item->>'title', 'quantity', (item->>'quantity')::integer))
    from jsonb_array_elements(co.items) item
  ), '[]'::jsonb),
  co.created_at, co.updated_at
from public.customer_orders co
where co.user_id is not null
on conflict (id) do update set
  user_id = excluded.user_id,
  payment_status = excluded.payment_status,
  fulfillment_status = excluded.fulfillment_status,
  total_fils = excluded.total_fils,
  currency = excluded.currency,
  items = excluded.items,
  updated_at = excluded.updated_at;
