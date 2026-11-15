-- Flavor Rewards is additive: it does not alter storefront orders, products,
-- inventory, customer profiles, or existing payment records.

create or replace function public.flavor_rewards_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.role = 'administrator'
  );
$function$;

revoke all on function public.flavor_rewards_is_admin() from public;
grant execute on function public.flavor_rewards_is_admin() to anon, authenticated;

create table public.flavor_ideas (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  title text not null check (char_length(title) between 2 and 120),
  title_ar text not null check (char_length(title_ar) between 2 and 120),
  description text not null default '' check (char_length(description) <= 1200),
  description_ar text not null default '' check (char_length(description_ar) <= 1200),
  ingredients text not null default '' check (char_length(ingredients) <= 1200),
  ingredients_ar text not null default '' check (char_length(ingredients_ar) <= 1200),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  commercial_status text not null default 'not_reviewed'
    check (commercial_status in ('not_reviewed', 'approved', 'rejected')),
  commercial_notes text not null default '' check (char_length(commercial_notes) <= 2000),
  confirmed_interest_count integer not null default 0 check (confirmed_interest_count >= 0),
  published_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_user_id, request_key)
);

create index flavor_ideas_owner_created_idx
  on public.flavor_ideas (creator_user_id, created_at desc);
create index flavor_ideas_published_idx
  on public.flavor_ideas (published_at desc)
  where status = 'published';

create table public.flavor_interests (
  id uuid primary key default gen_random_uuid(),
  flavor_id uuid not null references public.flavor_ideas(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  unique (flavor_id, user_id)
);
create index flavor_interests_user_idx on public.flavor_interests (user_id, confirmed_at desc);

create table public.flavor_sales (
  id uuid primary key default gen_random_uuid(),
  flavor_id uuid not null references public.flavor_ideas(id) on delete restrict,
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  source_reference text not null check (char_length(source_reference) between 2 and 120),
  net_sales_fils bigint not null check (net_sales_fils > 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (flavor_id, source_reference)
);
create index flavor_sales_creator_idx on public.flavor_sales (creator_user_id, recorded_at desc);

create table public.flavor_reward_ledger (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  flavor_id uuid not null references public.flavor_ideas(id) on delete restrict,
  source_sale_id uuid references public.flavor_sales(id) on delete restrict,
  entry_type text not null check (entry_type in ('interest_milestone', 'sales_commission')),
  amount_fils bigint not null check (amount_fils > 0),
  currency text not null default 'KWD' check (currency = 'KWD'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (entry_type = 'interest_milestone' and source_sale_id is null and amount_fils = 200000)
    or (entry_type = 'sales_commission' and source_sale_id is not null)
  )
);
create unique index flavor_reward_milestone_once
  on public.flavor_reward_ledger (flavor_id)
  where entry_type = 'interest_milestone';
create unique index flavor_reward_sale_once
  on public.flavor_reward_ledger (source_sale_id)
  where source_sale_id is not null;
create index flavor_reward_ledger_creator_idx
  on public.flavor_reward_ledger (creator_user_id, created_at desc);

create table public.flavor_payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  amount_fils bigint not null check (amount_fils > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  payout_reference text not null default '' check (char_length(payout_reference) <= 200),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_key)
);
create index flavor_payout_requests_user_idx
  on public.flavor_payout_requests (user_id, created_at desc);
create index flavor_payout_requests_status_idx
  on public.flavor_payout_requests (status, created_at);

create table public.flavor_payout_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.flavor_payout_requests(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('requested', 'approved', 'rejected', 'paid')),
  note text not null default '' check (char_length(note) <= 2000),
  payout_reference text not null default '' check (char_length(payout_reference) <= 200),
  created_at timestamptz not null default now()
);
create index flavor_payout_events_request_idx
  on public.flavor_payout_events (request_id, created_at);

create table public.flavor_commercial_reviews (
  id uuid primary key default gen_random_uuid(),
  flavor_id uuid not null references public.flavor_ideas(id) on delete restrict,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index flavor_commercial_reviews_flavor_idx
  on public.flavor_commercial_reviews (flavor_id, created_at desc);

alter table public.flavor_ideas enable row level security;
alter table public.flavor_interests enable row level security;
alter table public.flavor_sales enable row level security;
alter table public.flavor_reward_ledger enable row level security;
alter table public.flavor_payout_requests enable row level security;
alter table public.flavor_payout_events enable row level security;
alter table public.flavor_commercial_reviews enable row level security;

create policy "Owners and administrators read flavor ideas"
  on public.flavor_ideas for select to authenticated
  using (
    creator_user_id = (select auth.uid())
    or public.flavor_rewards_is_admin()
  );
create policy "Owners create flavor drafts"
  on public.flavor_ideas for insert to authenticated
  with check (
    creator_user_id = (select auth.uid())
    and status = 'draft'
    and commercial_status = 'not_reviewed'
    and commercial_notes = ''
    and confirmed_interest_count = 0
    and reviewed_by is null
    and reviewed_at is null
  );
create policy "Owners edit their own drafts"
  on public.flavor_ideas for update to authenticated
  using (
    creator_user_id = (select auth.uid())
    and status = 'draft'
    and commercial_status = 'not_reviewed'
    and commercial_notes = ''
    and confirmed_interest_count = 0
  )
  with check (
    creator_user_id = (select auth.uid())
    and status = 'draft'
    and commercial_status = 'not_reviewed'
    and commercial_notes = ''
    and confirmed_interest_count = 0
    and reviewed_by is null
    and reviewed_at is null
  );
create policy "Owners delete their own drafts"
  on public.flavor_ideas for delete to authenticated
  using (
    creator_user_id = (select auth.uid())
    and status = 'draft'
    and commercial_status = 'not_reviewed'
    and confirmed_interest_count = 0
  );
create policy "Administrators manage flavor ideas"
  on public.flavor_ideas for all to authenticated
  using (public.flavor_rewards_is_admin())
  with check (public.flavor_rewards_is_admin());

create policy "Users and administrators read allowed flavor interests"
  on public.flavor_interests for select to authenticated
  using (user_id = (select auth.uid()) or public.flavor_rewards_is_admin());
create policy "Administrators read flavor sales"
  on public.flavor_sales for select to authenticated
  using (public.flavor_rewards_is_admin());
create policy "Creators and administrators read reward ledger"
  on public.flavor_reward_ledger for select to authenticated
  using (creator_user_id = (select auth.uid()) or public.flavor_rewards_is_admin());
create policy "Owners and administrators read payout requests"
  on public.flavor_payout_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.flavor_rewards_is_admin());
create policy "Owners and administrators read payout events"
  on public.flavor_payout_events for select to authenticated
  using (
    public.flavor_rewards_is_admin()
    or exists (
      select 1
      from public.flavor_payout_requests as request
      where request.id = request_id
        and request.user_id = (select auth.uid())
    )
  );
create policy "Administrators read commercial reviews"
  on public.flavor_commercial_reviews for select to authenticated
  using (public.flavor_rewards_is_admin());

grant select, insert, update, delete on public.flavor_ideas to authenticated;
grant select on public.flavor_interests to authenticated;
grant select on public.flavor_sales to authenticated;
grant select on public.flavor_reward_ledger to authenticated;
grant select on public.flavor_payout_requests to authenticated;
grant select on public.flavor_payout_events to authenticated;
grant select on public.flavor_commercial_reviews to authenticated;
grant all on public.flavor_ideas, public.flavor_interests, public.flavor_sales,
  public.flavor_reward_ledger, public.flavor_payout_requests,
  public.flavor_payout_events, public.flavor_commercial_reviews to service_role;

create view public.published_flavor_ideas
with (security_barrier = true)
as
  select id, title, title_ar, description, description_ar, ingredients,
    ingredients_ar, confirmed_interest_count, published_at
  from public.flavor_ideas
  where status = 'published';
grant select on public.published_flavor_ideas to anon, authenticated;

create or replace function public.publish_flavor_idea(p_flavor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_published boolean;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  update public.flavor_ideas
  set status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  where id = p_flavor_id
    and creator_user_id = (select auth.uid())
    and status = 'draft'
    and commercial_status = 'not_reviewed'
  returning true into v_published;

  if v_published is not true and exists (
    select 1 from public.flavor_ideas
    where id = p_flavor_id
      and creator_user_id = (select auth.uid())
      and status = 'published'
  ) then
    return true;
  end if;
  if v_published is not true then
    raise exception using errcode = '42501', message = 'Draft cannot be published';
  end if;
  return true;
end;
$function$;

create or replace function public.on_flavor_interest_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_creator_id uuid;
  v_count integer;
begin
  if (select auth.uid()) is null or new.user_id <> (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Interest must belong to the signed-in user';
  end if;

  update public.flavor_ideas
  set confirmed_interest_count = confirmed_interest_count + 1,
      updated_at = now()
  where id = new.flavor_id
    and status = 'published'
    and creator_user_id <> new.user_id
  returning creator_user_id, confirmed_interest_count into v_creator_id, v_count;

  if not found then
    raise exception using errcode = '42501', message = 'Flavor is not available for interest';
  end if;

  if v_count = 100 then
    insert into public.flavor_reward_ledger (
      creator_user_id, flavor_id, entry_type, amount_fils, metadata
    ) values (
      v_creator_id, new.flavor_id, 'interest_milestone', 200000,
      jsonb_build_object('confirmed_interest_count', 100, 'reward_kwd', 200)
    )
    on conflict (flavor_id) where entry_type = 'interest_milestone' do nothing;
  end if;
  return new;
end;
$function$;

create trigger flavor_interest_increment_and_reward
  after insert on public.flavor_interests
  for each row execute function public.on_flavor_interest_insert();

create or replace function public.register_flavor_interest(p_flavor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_creator_id uuid;
  v_status text;
  v_count integer;
  v_inserted integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('flavor:' || p_flavor_id::text, 0));
  select creator_user_id, status
  into v_creator_id, v_status
  from public.flavor_ideas
  where id = p_flavor_id
  for update;
  if not found or v_status <> 'published' then
    raise exception using errcode = 'P0002', message = 'Published flavor not found';
  end if;
  if v_creator_id = v_user_id then
    raise exception using errcode = '42501', message = 'Creators cannot register interest in their own flavor';
  end if;

  insert into public.flavor_interests (flavor_id, user_id)
  values (p_flavor_id, v_user_id)
  on conflict (flavor_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  select confirmed_interest_count into v_count
  from public.flavor_ideas where id = p_flavor_id;
  return jsonb_build_object(
    'alreadyInterested', v_inserted = 0,
    'interestCount', v_count,
    'rewardUnlocked', v_count >= 100
  );
end;
$function$;

create or replace function public.record_flavor_commercial_review(
  p_flavor_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := (select auth.uid());
  v_status text;
begin
  if v_admin_id is null or not public.flavor_rewards_is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  if p_decision not in ('approved', 'rejected')
     or char_length(coalesce(p_notes, '')) > 2000 then
    raise exception using errcode = '22023', message = 'Invalid commercial review';
  end if;
  update public.flavor_ideas
  set commercial_status = p_decision,
      commercial_notes = coalesce(p_notes, ''),
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_flavor_id
    and status = 'published'
  returning commercial_status into v_status;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published flavor not found';
  end if;
  insert into public.flavor_commercial_reviews (flavor_id, admin_user_id, decision, notes)
  values (p_flavor_id, v_admin_id, p_decision, coalesce(p_notes, ''));
  return jsonb_build_object('flavorId', p_flavor_id, 'commercialStatus', v_status);
end;
$function$;

create or replace function public.record_flavor_net_sale(
  p_flavor_id uuid,
  p_source_reference text,
  p_net_sales_fils bigint,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := (select auth.uid());
  v_creator_id uuid;
  v_commercial_status text;
  v_sale_id uuid;
  v_existing_amount bigint;
  v_commission bigint;
begin
  if v_admin_id is null or not public.flavor_rewards_is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  if char_length(coalesce(p_source_reference, '')) not between 2 and 120
     or char_length(coalesce(p_notes, '')) > 2000
     or p_net_sales_fils is null
     or p_net_sales_fils <= 0 then
    raise exception using errcode = '22023', message = 'Invalid eligible sale';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sale:' || p_flavor_id::text, 1));
  select creator_user_id, commercial_status
  into v_creator_id, v_commercial_status
  from public.flavor_ideas
  where id = p_flavor_id and status = 'published'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published flavor not found';
  end if;
  if v_commercial_status <> 'approved' then
    raise exception using errcode = '42501', message = 'Flavor must be commercially approved first';
  end if;

  select id, net_sales_fils into v_sale_id, v_existing_amount
  from public.flavor_sales
  where flavor_id = p_flavor_id and source_reference = p_source_reference;
  if found then
    if v_existing_amount <> p_net_sales_fils then
      raise exception using errcode = '23505', message = 'Sale reference already exists with a different amount';
    end if;
    select amount_fils into v_commission
    from public.flavor_reward_ledger where source_sale_id = v_sale_id;
    return jsonb_build_object(
      'duplicate', true, 'saleId', v_sale_id,
      'commissionFils', coalesce(v_commission, 0)
    );
  end if;

  v_commission := round(p_net_sales_fils::numeric * 15 / 100)::bigint;
  if v_commission < 1 then
    raise exception using errcode = '22023', message = 'Eligible sale is too small to create a KWD commission entry';
  end if;
  insert into public.flavor_sales (
    flavor_id, creator_user_id, source_reference, net_sales_fils, notes, recorded_by
  ) values (
    p_flavor_id, v_creator_id, p_source_reference, p_net_sales_fils, coalesce(p_notes, ''), v_admin_id
  ) returning id into v_sale_id;
  insert into public.flavor_reward_ledger (
    creator_user_id, flavor_id, source_sale_id, entry_type, amount_fils, metadata
  ) values (
    v_creator_id, p_flavor_id, v_sale_id, 'sales_commission', v_commission,
    jsonb_build_object('commission_percent', 15, 'net_sales_fils', p_net_sales_fils)
  );
  return jsonb_build_object(
    'duplicate', false, 'saleId', v_sale_id,
    'commissionFils', v_commission
  );
end;
$function$;

create or replace function public.request_flavor_payout(
  p_amount_fils bigint,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_request public.flavor_payout_requests%rowtype;
  v_earned bigint;
  v_reserved bigint;
  v_available bigint;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_amount_fils is null or p_amount_fils <= 0 or p_request_key is null then
    raise exception using errcode = '22023', message = 'Invalid payout request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payout:' || v_user_id::text, 2));
  select * into v_request
  from public.flavor_payout_requests
  where user_id = v_user_id and request_key = p_request_key;
  if found then
    return jsonb_build_object(
      'id', v_request.id, 'amountFils', v_request.amount_fils,
      'status', v_request.status, 'duplicate', true
    );
  end if;
  select coalesce(sum(amount_fils), 0) into v_earned
  from public.flavor_reward_ledger where creator_user_id = v_user_id;
  select coalesce(sum(amount_fils), 0) into v_reserved
  from public.flavor_payout_requests
  where user_id = v_user_id and status in ('pending', 'approved', 'paid');
  v_available := v_earned - v_reserved;
  if p_amount_fils > v_available then
    raise exception using errcode = '22023', message = 'Payout amount exceeds available rewards';
  end if;
  insert into public.flavor_payout_requests (user_id, request_key, amount_fils)
  values (v_user_id, p_request_key, p_amount_fils)
  returning * into v_request;
  insert into public.flavor_payout_events (request_id, actor_user_id, action)
  values (v_request.id, v_user_id, 'requested');
  return jsonb_build_object(
    'id', v_request.id, 'amountFils', v_request.amount_fils,
    'status', v_request.status, 'duplicate', false
  );
end;
$function$;

create or replace function public.review_flavor_payout_request(
  p_request_id uuid,
  p_status text,
  p_admin_note text default '',
  p_payout_reference text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := (select auth.uid());
  v_request public.flavor_payout_requests%rowtype;
begin
  if v_admin_id is null or not public.flavor_rewards_is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  if p_status not in ('approved', 'rejected', 'paid')
     or char_length(coalesce(p_admin_note, '')) > 2000
     or char_length(coalesce(p_payout_reference, '')) > 200 then
    raise exception using errcode = '22023', message = 'Invalid payout review';
  end if;
  select * into v_request
  from public.flavor_payout_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payout request not found';
  end if;
  if not (
    (v_request.status = 'pending' and p_status in ('approved', 'rejected'))
    or (v_request.status = 'approved' and p_status in ('paid', 'rejected'))
  ) then
    raise exception using errcode = '22023', message = 'Invalid payout status transition';
  end if;
  if p_status = 'paid' and char_length(btrim(coalesce(p_payout_reference, ''))) < 2 then
    raise exception using errcode = '22023', message = 'A payout reference is required before marking a request paid';
  end if;
  update public.flavor_payout_requests
  set status = p_status,
      admin_note = coalesce(p_admin_note, ''),
      payout_reference = case when p_status = 'paid' then p_payout_reference else payout_reference end,
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_request;
  insert into public.flavor_payout_events (
    request_id, actor_user_id, action, note, payout_reference
  ) values (
    v_request.id, v_admin_id, p_status, coalesce(p_admin_note, ''),
    case when p_status = 'paid' then p_payout_reference else ''
    end
  );
  return jsonb_build_object(
    'id', v_request.id, 'status', v_request.status,
    'reviewedAt', v_request.reviewed_at
  );
end;
$function$;

revoke all on function public.publish_flavor_idea(uuid) from public, anon;
revoke all on function public.register_flavor_interest(uuid) from public, anon;
revoke all on function public.record_flavor_commercial_review(uuid, text, text) from public, anon;
revoke all on function public.record_flavor_net_sale(uuid, text, bigint, text) from public, anon;
revoke all on function public.request_flavor_payout(bigint, uuid) from public, anon;
revoke all on function public.review_flavor_payout_request(uuid, text, text, text) from public, anon;
grant execute on function public.publish_flavor_idea(uuid) to authenticated;
grant execute on function public.register_flavor_interest(uuid) to authenticated;
grant execute on function public.record_flavor_commercial_review(uuid, text, text) to authenticated;
grant execute on function public.record_flavor_net_sale(uuid, text, bigint, text) to authenticated;
grant execute on function public.request_flavor_payout(bigint, uuid) to authenticated;
grant execute on function public.review_flavor_payout_request(uuid, text, text, text) to authenticated;
