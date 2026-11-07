create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  title text not null,
  title_ar text not null default '',
  description text not null default '',
  description_ar text not null default '',
  price numeric(12,3) not null check (price > 0),
  currency text not null default 'KWD' check (currency = 'KWD'),
  pieces integer not null default 12 check (pieces > 0),
  image_url text not null,
  stock integer not null default 0 check (stock >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  ingredients text not null default '',
  ingredients_ar text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_active_created_idx
  on public.products (is_active, created_at);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'customer' check (role in ('customer', 'administrator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.carts (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
);

alter table public.customer_orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists customer_orders_user_created_idx
  on public.customer_orders (user_id, created_at desc)
  where user_id is not null;

alter table public.products enable row level security;
alter table public.user_profiles enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

revoke all on table public.products, public.user_profiles, public.carts, public.cart_items
  from public, anon, authenticated;
grant select on table public.products to anon, authenticated;
grant select, insert, update, delete on table public.products,
  public.user_profiles, public.carts, public.cart_items to service_role;

drop policy if exists "Active products are publicly readable" on public.products;
create policy "Active products are publicly readable"
  on public.products for select to anon, authenticated using (is_active);

create or replace function public.handle_new_amore_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_profiles (user_id, email, display_name, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'display_name', ''), 'customer')
  on conflict (user_id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    updated_at = statement_timestamp();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_amore on auth.users;
create trigger on_auth_user_created_amore
  after insert on auth.users
  for each row execute procedure public.handle_new_amore_user();
revoke all on function public.handle_new_amore_user() from public, anon, authenticated;

create or replace function public.reserve_order_stock(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.customer_orders%rowtype;
  requested record;
  updated_stock integer;
  plan jsonb := '[]'::jsonb;
begin
  select * into order_row
    from public.customer_orders
    where id = p_order_id
    for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if order_row.stock_status = 'reserved' then
    return;
  end if;
  if order_row.stock_status not in ('unreserved', 'reserving') or order_row.payment_status = 'paid' then
    raise exception 'order inventory cannot be reserved' using errcode = 'P0001';
  end if;

  for requested in
    select (item->>'variantId')::uuid as product_id, sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(order_row.items) item
    group by (item->>'variantId')::uuid
    order by (item->>'variantId')::uuid
  loop
    if requested.quantity < 1 then
      raise exception 'invalid stock quantity' using errcode = 'P0001';
    end if;
    update public.products
      set stock = stock - requested.quantity, updated_at = statement_timestamp()
      where id = requested.product_id and is_active and stock >= requested.quantity
      returning stock into updated_stock;
    if not found then
      raise exception 'requested product stock is unavailable' using errcode = 'P0001';
    end if;
    plan := plan || jsonb_build_array(jsonb_build_object(
      'productId', requested.product_id::text, 'quantity', requested.quantity
    ));
  end loop;
  if jsonb_array_length(plan) = 0 then
    raise exception 'order has no stock items' using errcode = 'P0001';
  end if;
  update public.customer_orders
    set stock_plan = plan, stock_status = 'reserved', updated_at = statement_timestamp()
    where id = p_order_id;
end;
$$;

create or replace function public.release_order_stock(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_row public.customer_orders%rowtype;
  reserved record;
begin
  select * into order_row
    from public.customer_orders
    where id = p_order_id
    for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if order_row.payment_status = 'paid' then
    raise exception 'paid order stock cannot be released' using errcode = 'P0001';
  end if;
  if order_row.stock_status = 'released' then
    return;
  end if;
  if order_row.stock_status not in ('reserved', 'releasing') or jsonb_typeof(order_row.stock_plan) <> 'array' then
    raise exception 'order inventory cannot be released' using errcode = 'P0001';
  end if;

  for reserved in
    select (item->>'productId')::uuid as product_id, (item->>'quantity')::integer as quantity
    from jsonb_array_elements(order_row.stock_plan) item
    order by (item->>'productId')::uuid
  loop
    update public.products
      set stock = stock + reserved.quantity, updated_at = statement_timestamp()
      where id = reserved.product_id;
    if not found then
      raise exception 'reserved product no longer exists' using errcode = 'P0001';
    end if;
  end loop;
  update public.customer_orders
    set stock_status = 'released', updated_at = statement_timestamp()
    where id = p_order_id;
end;
$$;

revoke all on function public.reserve_order_stock(text) from public, anon, authenticated;
revoke all on function public.release_order_stock(text) from public, anon, authenticated;
grant execute on function public.reserve_order_stock(text) to service_role;
grant execute on function public.release_order_stock(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('amore-products', 'amore-products', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read Amore product images" on storage.objects;
create policy "Public can read Amore product images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'amore-products');

insert into public.products (
  handle, title, title_ar, description, description_ar, price, currency, pieces,
  image_url, stock, low_stock_threshold, ingredients, ingredients_ar, is_active
) values
  (
    'classic-belgian-cocoa',
    'Classic Belgian Cocoa',
    'كاكاو بلجيكي كلاسيكي',
    'Classic cookie dough with Belgian cocoa. Frozen Cookie Dough – Ready to Bake. Each bag contains 12 cookies.',
    'عجينة كوكيز كلاسيكية بالكاكاو البلجيكي. عجينة كوكيز مفرزنة وجاهزة للخبز. يحتوي كل كيس على 12 حبة.',
    10.000, 'KWD', 12,
    'https://fnuhkqkebztnyrdcukno.supabase.co/storage/v1/object/public/amore-products/amore-cookie.jpg',
    11, 0, '', '', true
  ),
  (
    'kinder-stuffed-cookie',
    'Kinder Stuffed Cookie',
    'كوكيز محشي بالكندر',
    'Cookie dough stuffed with Kinder. Frozen Cookie Dough – Ready to Bake. Each bag contains 12 cookies.',
    'عجينة كوكيز محشية بالكندر. عجينة كوكيز مفرزنة وجاهزة للخبز. يحتوي كل كيس على 12 حبة.',
    10.000, 'KWD', 12,
    'https://fnuhkqkebztnyrdcukno.supabase.co/storage/v1/object/public/amore-products/amore-package.png',
    11, 0, '', '', true
  )
on conflict (handle) do nothing;
