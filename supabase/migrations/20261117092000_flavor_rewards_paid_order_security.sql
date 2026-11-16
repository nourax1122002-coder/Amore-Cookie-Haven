-- LOCAL REVIEW DRAFT ONLY.
-- The first migration now applies RLS, revokes default Supabase grants, and
-- installs the policies/RPC grants before it can commit. This migration is a
-- verification-only guard; it intentionally creates no duplicate policies
-- and issues no grants.

do $verify$
declare
  v_table text;
  v_privilege text;
  v_authenticated_select_expected boolean;
  v_function regprocedure;
begin
  foreach v_table in array array[
    'public.flavor_creation_claims',
    'public.flavor_reward_products',
    'public.flavor_reward_order_snapshots',
    'public.flavor_reward_stripe_events',
    'public.flavor_reward_order_disputes',
    'public.flavor_reward_event_reviews',
    'public.flavor_reward_paid_order_ledger'
  ] loop
    if not exists (
      select 1
      from pg_class as relation
      where relation.oid = to_regclass(v_table)
        and relation.relrowsecurity
    ) then
      raise exception 'Flavor Rewards table % is missing or does not have RLS enabled', v_table;
    end if;

    v_authenticated_select_expected := v_table = any (array[
      'public.flavor_creation_claims',
      'public.flavor_reward_event_reviews',
      'public.flavor_reward_paid_order_ledger'
    ]);

    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] loop
      if has_table_privilege('anon', v_table, v_privilege) then
        raise exception 'anon retains % privilege on Flavor Rewards table %', v_privilege, v_table;
      end if;
      if has_table_privilege('authenticated', v_table, v_privilege)
         and (v_privilege <> 'SELECT' or not v_authenticated_select_expected) then
        raise exception 'authenticated retains unexpected % privilege on Flavor Rewards table %',
          v_privilege, v_table;
      end if;
      if has_table_privilege('service_role', v_table, v_privilege)
         and v_privilege <> 'SELECT' then
        raise exception 'service_role retains direct write privilege % on Flavor Rewards table %',
          v_privilege, v_table;
      end if;
    end loop;

    if not has_table_privilege('service_role', v_table, 'SELECT') then
      raise exception 'service_role is missing required read access to Flavor Rewards table %', v_table;
    end if;
  end loop;

  foreach v_function in array array[
    'public.link_flavor_reward_product(uuid,uuid,uuid)'::regprocedure,
    'public.claim_flavor_reward_order(text,uuid)'::regprocedure,
    'public.record_flavor_reward_review_event(text,text,text,text,text,text,bigint,text,text,jsonb,timestamp with time zone)'::regprocedure,
    'public.resolve_flavor_reward_event_review(uuid,text,text,text)'::regprocedure,
    'public.process_flavor_reward_stripe_event(text,text,text,text,text,boolean,text,bigint,bigint,text,bigint,text,timestamp with time zone,bigint,bigint)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'API clients can execute privileged Flavor Rewards function %', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'service_role cannot execute required Flavor Rewards function %', v_function;
    end if;
  end loop;

  foreach v_function in array array[
    'private.claim_flavor_creation_once()'::regprocedure,
    'private.reject_flavor_reward_ledger_mutation()'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'API role can directly execute trigger-only function %', v_function;
    end if;
  end loop;

  foreach v_function in array array[
    'public.record_flavor_net_sale(uuid,uuid,text,bigint,text)'::regprocedure,
    'public.request_flavor_payout(uuid,bigint,uuid)'::regprocedure,
    'public.review_flavor_payout_request(uuid,uuid,text,text,text)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Legacy manual sale or payout function % is executable', v_function;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'flavor_creation_claims'
      and policyname = 'Creators and administrators read lifetime creation claims'
      and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'flavor_reward_paid_order_ledger'
      and policyname = 'Creators and administrators read paid-order reward ledger'
      and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'flavor_reward_event_reviews'
      and policyname = 'Administrators read pending payment review events'
      and cmd = 'SELECT'
  ) then
    raise exception 'Required creator/admin Flavor Rewards read policies are missing';
  end if;
end;
$verify$;
