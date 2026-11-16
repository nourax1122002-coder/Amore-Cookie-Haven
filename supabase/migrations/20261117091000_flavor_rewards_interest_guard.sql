-- LOCAL REVIEW DRAFT ONLY.
-- Preserve interest records and counts, but do not award money from interest.
-- The existing trigger is retained and its body is changed in place.

create or replace function public.on_flavor_interest_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
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
  returning confirmed_interest_count into v_count;

  if not found then
    raise exception using errcode = '42501', message = 'Flavor is not available for interest';
  end if;

  -- Intentionally no insert into flavor_reward_ledger. Interest counts remain
  -- available for product feedback but cannot create financial rewards.
  return new;
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
  select status
  into v_status
  from public.flavor_ideas
  where id = p_flavor_id
    and status = 'published';
  if not found then
    raise exception using errcode = 'P0002', message = 'Published flavor not found';
  end if;
  if not private.can_register_flavor_interest(p_flavor_id) then
    raise exception using errcode = '42501', message = 'Creators cannot register interest in their own flavor';
  end if;

  insert into public.flavor_interests (flavor_id, user_id)
  values (p_flavor_id, v_user_id)
  on conflict (flavor_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  select confirmed_interest_count
  into v_count
  from public.flavor_ideas
  where id = p_flavor_id;

  return jsonb_build_object(
    'alreadyInterested', v_inserted = 0,
    'interestCount', v_count,
    'rewardUnlocked', false,
    'rewardPolicy', 'verified_paid_orders_only'
  );
end;
$function$;

-- Keep the old function and its historical records, but prevent it from being
-- used as a new reward source. The current application route is already paused.
revoke all on function public.record_flavor_net_sale(uuid, uuid, text, bigint, text)
  from public, anon, authenticated, service_role;

comment on function public.on_flavor_interest_insert() is
  'Preserves interest counts only. Monetary rewards are created exclusively by the verified paid-order processor.';
comment on function public.record_flavor_net_sale(uuid, uuid, text, bigint, text) is
  'Legacy manual-sale entry retained for historical compatibility but execution is revoked; Stripe-verified paid-order processing is separate.';
