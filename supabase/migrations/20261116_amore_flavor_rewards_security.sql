-- Tighten the new feature's API surface before it receives customer data.
-- Existing storefront tables and records are not touched.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.flavor_rewards_is_admin()
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

create or replace function private.can_register_flavor_interest(p_flavor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.flavor_ideas as idea
    where idea.id = p_flavor_id
      and idea.status = 'published'
      and idea.creator_user_id <> (select auth.uid())
  );
$function$;

create or replace function private.can_read_flavor_idea(p_flavor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.flavor_ideas as idea
    where idea.id = p_flavor_id
      and (
        idea.status = 'published'
        or idea.creator_user_id = (select auth.uid())
        or private.flavor_rewards_is_admin()
      )
  );
$function$;

create or replace function private.owns_flavor_idea(p_flavor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.flavor_ideas as idea
    where idea.id = p_flavor_id
      and idea.creator_user_id = (select auth.uid())
  );
$function$;

revoke all on function private.flavor_rewards_is_admin() from public, anon;
revoke all on function private.can_register_flavor_interest(uuid) from public, anon;
revoke all on function private.can_read_flavor_idea(uuid) from public, anon;
revoke all on function private.owns_flavor_idea(uuid) from public, anon;
grant execute on function private.flavor_rewards_is_admin() to authenticated;
grant execute on function private.can_register_flavor_interest(uuid) to authenticated;
grant execute on function private.can_read_flavor_idea(uuid) to authenticated;
grant execute on function private.owns_flavor_idea(uuid) to authenticated;

alter view public.published_flavor_ideas set (security_invoker = true);

drop policy if exists "Owners and administrators read flavor ideas" on public.flavor_ideas;
drop policy if exists "Administrators manage flavor ideas" on public.flavor_ideas;
drop policy if exists "Owners edit their own drafts" on public.flavor_ideas;
create policy "Public read published flavor ideas"
  on public.flavor_ideas for select to anon
  using (status = 'published');
create policy "Owners and administrators read flavor ideas"
  on public.flavor_ideas for select to authenticated
  using (private.can_read_flavor_idea(id));
create policy "Owners edit their own drafts"
  on public.flavor_ideas for update to authenticated
  using (
    private.owns_flavor_idea(id)
    and status = 'draft'
    and commercial_status = 'not_reviewed'
    and confirmed_interest_count = 0
  )
  with check (
    private.owns_flavor_idea(id)
    and status in ('draft', 'published')
    and commercial_status = 'not_reviewed'
    and commercial_notes = ''
    and confirmed_interest_count = 0
    and reviewed_by is null
    and reviewed_at is null
  );
drop policy if exists "Owners delete their own drafts" on public.flavor_ideas;
create policy "Owners delete their own drafts"
  on public.flavor_ideas for delete to authenticated
  using (
    private.owns_flavor_idea(id)
    and status = 'draft'
    and commercial_status = 'not_reviewed'
    and confirmed_interest_count = 0
  );

revoke select on public.flavor_ideas from anon, authenticated;
grant select (
  id, title, title_ar, description, description_ar, ingredients, ingredients_ar,
  confirmed_interest_count, published_at, status
) on public.flavor_ideas to anon;
grant select (
  id, title, title_ar, description, description_ar, ingredients, ingredients_ar,
  confirmed_interest_count, published_at, status, commercial_status, created_at, updated_at
) on public.flavor_ideas to authenticated;
revoke update on public.flavor_ideas from authenticated;
grant update (
  title, title_ar, description, description_ar, ingredients, ingredients_ar,
  status, published_at, updated_at
) on public.flavor_ideas to authenticated;

drop policy if exists "Users and administrators read allowed flavor interests" on public.flavor_interests;
create policy "Users and administrators read allowed flavor interests"
  on public.flavor_interests for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.flavor_rewards_is_admin()
  );
drop policy if exists "Users register one confirmed flavor interest" on public.flavor_interests;
create policy "Users register one confirmed flavor interest"
  on public.flavor_interests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_register_flavor_interest(flavor_id)
  );
revoke insert on public.flavor_interests from authenticated;
grant insert (flavor_id, user_id) on public.flavor_interests to authenticated;

drop policy if exists "Administrators read flavor sales" on public.flavor_sales;
create policy "Administrators read flavor sales"
  on public.flavor_sales for select to authenticated
  using (private.flavor_rewards_is_admin());

drop policy if exists "Creators and administrators read reward ledger" on public.flavor_reward_ledger;
create policy "Creators and administrators read reward ledger"
  on public.flavor_reward_ledger for select to authenticated
  using (
    creator_user_id = (select auth.uid())
    or private.flavor_rewards_is_admin()
  );

drop policy if exists "Owners and administrators read payout requests" on public.flavor_payout_requests;
create policy "Owners and administrators read payout requests"
  on public.flavor_payout_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.flavor_rewards_is_admin()
  );

drop policy if exists "Owners and administrators read payout events" on public.flavor_payout_events;
create policy "Owners and administrators read payout events"
  on public.flavor_payout_events for select to authenticated
  using (
    private.flavor_rewards_is_admin()
    or exists (
      select 1
      from public.flavor_payout_requests as request
      where request.id = request_id
        and request.user_id = (select auth.uid())
    )
  );

drop policy if exists "Administrators read commercial reviews" on public.flavor_commercial_reviews;
create policy "Administrators read commercial reviews"
  on public.flavor_commercial_reviews for select to authenticated
  using (private.flavor_rewards_is_admin());

create or replace function public.publish_flavor_idea(p_flavor_id uuid)
returns boolean
language plpgsql
security invoker
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
    and private.owns_flavor_idea(id)
    and status = 'draft'
    and commercial_status = 'not_reviewed'
  returning true into v_published;

  if v_published is not true and exists (
    select 1 from public.flavor_ideas
    where id = p_flavor_id
      and private.owns_flavor_idea(id)
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

create or replace function public.register_flavor_interest(p_flavor_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_status text;
  v_count integer;
  v_inserted integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('flavor:' || p_flavor_id::text, 0));
  select status into v_status
  from public.flavor_ideas
  where id = p_flavor_id and status = 'published';
  if not found or v_status <> 'published' then
    raise exception using errcode = 'P0002', message = 'Published flavor not found';
  end if;
  insert into public.flavor_interests (flavor_id, user_id)
  values (p_flavor_id, v_user_id)
  on conflict (flavor_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;
  select confirmed_interest_count into v_count
  from public.published_flavor_ideas
  where id = p_flavor_id;
  return jsonb_build_object(
    'alreadyInterested', v_inserted = 0,
    'interestCount', v_count,
    'rewardUnlocked', v_count >= 100
  );
end;
$function$;

revoke all on function public.publish_flavor_idea(uuid) from public, anon;
revoke all on function public.register_flavor_interest(uuid) from public, anon;
grant execute on function public.publish_flavor_idea(uuid) to authenticated;
grant execute on function public.register_flavor_interest(uuid) to authenticated;
revoke all on function public.on_flavor_interest_insert() from public, anon, authenticated;

create or replace function private.assert_flavor_rewards_admin(p_admin_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_admin_user_id is null or not exists (
    select 1
    from public.user_profiles as profile
    where profile.user_id = p_admin_user_id
      and profile.role = 'administrator'
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
end;
$function$;
revoke all on function private.assert_flavor_rewards_admin(uuid) from public, anon, authenticated;

drop function public.record_flavor_commercial_review(uuid, text, text);
create function public.record_flavor_commercial_review(
  p_admin_user_id uuid,
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
  v_status text;
begin
  perform private.assert_flavor_rewards_admin(p_admin_user_id);
  if p_decision not in ('approved', 'rejected')
     or char_length(coalesce(p_notes, '')) > 2000 then
    raise exception using errcode = '22023', message = 'Invalid commercial review';
  end if;
  update public.flavor_ideas
  set commercial_status = p_decision,
      commercial_notes = coalesce(p_notes, ''),
      reviewed_by = p_admin_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_flavor_id and status = 'published'
  returning commercial_status into v_status;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published flavor not found';
  end if;
  insert into public.flavor_commercial_reviews (flavor_id, admin_user_id, decision, notes)
  values (p_flavor_id, p_admin_user_id, p_decision, coalesce(p_notes, ''));
  return jsonb_build_object('flavorId', p_flavor_id, 'commercialStatus', v_status);
end;
$function$;

drop function public.record_flavor_net_sale(uuid, text, bigint, text);
create function public.record_flavor_net_sale(
  p_admin_user_id uuid,
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
  v_creator_id uuid;
  v_commercial_status text;
  v_sale_id uuid;
  v_existing_amount bigint;
  v_commission bigint;
begin
  perform private.assert_flavor_rewards_admin(p_admin_user_id);
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
    p_flavor_id, v_creator_id, p_source_reference, p_net_sales_fils, coalesce(p_notes, ''), p_admin_user_id
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

drop function public.request_flavor_payout(bigint, uuid);
create function public.request_flavor_payout(
  p_user_id uuid,
  p_amount_fils bigint,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.flavor_payout_requests%rowtype;
  v_earned bigint;
  v_reserved bigint;
  v_available bigint;
begin
  if p_user_id is null or p_amount_fils is null or p_amount_fils <= 0 or p_request_key is null then
    raise exception using errcode = '22023', message = 'Invalid payout request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payout:' || p_user_id::text, 2));
  select * into v_request
  from public.flavor_payout_requests
  where user_id = p_user_id and request_key = p_request_key;
  if found then
    return jsonb_build_object(
      'id', v_request.id, 'amountFils', v_request.amount_fils,
      'status', v_request.status, 'duplicate', true
    );
  end if;
  select coalesce(sum(amount_fils), 0) into v_earned
  from public.flavor_reward_ledger where creator_user_id = p_user_id;
  select coalesce(sum(amount_fils), 0) into v_reserved
  from public.flavor_payout_requests
  where user_id = p_user_id and status in ('pending', 'approved', 'paid');
  v_available := v_earned - v_reserved;
  if p_amount_fils > v_available then
    raise exception using errcode = '22023', message = 'Payout amount exceeds available rewards';
  end if;
  insert into public.flavor_payout_requests (user_id, request_key, amount_fils)
  values (p_user_id, p_request_key, p_amount_fils)
  returning * into v_request;
  insert into public.flavor_payout_events (request_id, actor_user_id, action)
  values (v_request.id, p_user_id, 'requested');
  return jsonb_build_object(
    'id', v_request.id, 'amountFils', v_request.amount_fils,
    'status', v_request.status, 'duplicate', false
  );
end;
$function$;

drop function public.review_flavor_payout_request(uuid, text, text, text);
create function public.review_flavor_payout_request(
  p_admin_user_id uuid,
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
  v_request public.flavor_payout_requests%rowtype;
begin
  perform private.assert_flavor_rewards_admin(p_admin_user_id);
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
      reviewed_by = p_admin_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into v_request;
  insert into public.flavor_payout_events (
    request_id, actor_user_id, action, note, payout_reference
  ) values (
    v_request.id, p_admin_user_id, p_status, coalesce(p_admin_note, ''),
    case when p_status = 'paid' then p_payout_reference else ''
    end
  );
  return jsonb_build_object(
    'id', v_request.id, 'status', v_request.status,
    'reviewedAt', v_request.reviewed_at
  );
end;
$function$;

drop function public.flavor_rewards_is_admin();

revoke all on function public.record_flavor_commercial_review(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_flavor_net_sale(uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.request_flavor_payout(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.review_flavor_payout_request(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_flavor_commercial_review(uuid, uuid, text, text) to service_role;
grant execute on function public.record_flavor_net_sale(uuid, uuid, text, bigint, text) to service_role;
grant execute on function public.request_flavor_payout(uuid, bigint, uuid) to service_role;
grant execute on function public.review_flavor_payout_request(uuid, uuid, text, text, text) to service_role;
