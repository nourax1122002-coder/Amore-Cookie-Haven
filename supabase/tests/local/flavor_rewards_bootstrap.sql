-- Test-only Supabase compatibility fixture for a disposable local PostgreSQL DB.
-- Never run this file against the connected Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text not null unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'customer'
    check (role in ('customer', 'administrator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  title text not null,
  price numeric(12,3) not null check (price > 0),
  currency text not null default 'KWD' check (currency = 'KWD'),
  image_url text not null default '',
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.customer_orders (
  id text primary key,
  number text not null unique,
  cart_hash text not null,
  request_key text not null unique,
  request_hash text not null,
  token_hash text not null,
  phone text not null,
  address jsonb not null,
  note text not null default '',
  items jsonb not null,
  subtotal_fils integer not null check (subtotal_fils >= 0),
  shipping_fils integer not null check (shipping_fils >= 0),
  total_fils integer not null check (total_fils >= 0),
  currency text not null default 'KWD',
  payment_status text not null default 'pending',
  payment_provider text,
  fulfillment_status text not null default 'received',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  stripe_payment_currency text,
  stripe_payment_amount_minor bigint,
  stripe_refunded_amount_minor bigint not null default 0,
  stripe_exchange_rate numeric(18,10),
  stripe_exchange_rate_source text,
  stripe_exchange_rate_updated_at timestamptz,
  paid_at timestamptz,
  stock_status text not null default 'unreserved',
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
grant usage on schema public to anon, authenticated, service_role;

create or replace function public.test_assert(p_ok boolean, p_description text)
returns void
language plpgsql
as $function$
begin
  if p_ok is distinct from true then
    raise exception 'Assertion failed: %', p_description;
  end if;
  raise notice 'PASS: %', p_description;
end;
$function$;
grant execute on function public.test_assert(boolean, text)
  to public, anon, authenticated, service_role;
