-- Repeated after each draft migration in the disposable PostgreSQL test.
-- The bootstrap grants Supabase-like default ACLs to anon/authenticated;
-- these assertions prove each committed stage remains least-privilege.
begin;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'stage-creator-a@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'stage-creator-b@example.test'),
  ('a1000000-0000-4000-8000-000000000003', 'stage-admin@example.test');

insert into public.user_profiles (user_id, email, display_name, role) values
  ('a1000000-0000-4000-8000-000000000001', 'stage-creator-a@example.test', 'Creator A', 'customer'),
  ('a1000000-0000-4000-8000-000000000002', 'stage-creator-b@example.test', 'Creator B', 'customer'),
  ('a1000000-0000-4000-8000-000000000003', 'stage-admin@example.test', 'Admin', 'administrator');

insert into public.products (id, handle, title, price, stock) values
  ('a2000000-0000-4000-8000-000000000001', 'stage-product-a', 'Stage product A', 1.000, 5),
  ('a2000000-0000-4000-8000-000000000002', 'stage-product-b', 'Stage product B', 1.000, 5);

insert into public.flavor_ideas (
  id, creator_user_id, request_key, title, title_ar
) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'Stage Flavor A', 'نكهة اختبار أ'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'Stage Flavor B', 'نكهة اختبار ب');

insert into public.customer_orders (
  id, number, cart_hash, request_key, request_hash, token_hash, phone, address,
  items, subtotal_fils, shipping_fils, total_fils, currency, payment_status,
  fulfillment_status, user_id, expires_at
) values
  ('stage-order-a', 'STAGE-A', 'cart-stage-a', 'request-stage-a', 'hash-stage-a', 'token-stage-a',
   '+96500000001', '{"line1":"test"}', '[]', 1000, 3000, 4000, 'KWD', 'paid',
   'confirmed', 'a1000000-0000-4000-8000-000000000002', now() + interval '1 day'),
  ('stage-order-b', 'STAGE-B', 'cart-stage-b', 'request-stage-b', 'hash-stage-b', 'token-stage-b',
   '+96500000002', '{"line1":"test"}', '[]', 1000, 3000, 4000, 'KWD', 'paid',
   'confirmed', 'a1000000-0000-4000-8000-000000000001', now() + interval '1 day');

insert into public.flavor_reward_order_snapshots (
  customer_order_id, flavor_id, creator_user_id, buyer_user_id, product_id,
  eligible_sales_fils, eligible_order_number, verified_paid_at
) values
  ('stage-order-a', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001',
   1000, 101, now()),
  ('stage-order-b', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002',
   'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
   1000, 101, now());

insert into public.flavor_reward_stripe_events (
  stripe_event_id, event_type, customer_order_id, stripe_payment_intent_id,
  livemode, event_created_at
) values
  ('evt_stagePaidA', 'checkout.session.completed', 'stage-order-a', 'pi_stageA', false, now()),
  ('evt_stagePaidB', 'checkout.session.completed', 'stage-order-b', 'pi_stageB', false, now());

insert into public.flavor_reward_paid_order_ledger (
  flavor_id, creator_user_id, customer_order_id, eligible_order_number,
  entry_type, amount_fils, source_stripe_event_id, reason
) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'stage-order-a', 101, 'commission', 150, 'evt_stagePaidA', 'paid_order'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002',
   'stage-order-b', 101, 'commission', 150, 'evt_stagePaidB', 'paid_order');

insert into public.flavor_reward_event_reviews (
  stripe_event_id, event_type, stripe_object_type, stripe_object_id,
  customer_order_id, stripe_payment_intent_id, amount_minor, currency, reason_code,
  event_created_at
) values (
  'evt_stageReviewA', 'charge.refunded', 'charge', 'ch_stageA', 'stage-order-a',
  'pi_stageA', 100, 'usd', 'missing_allocation_metadata', now()
);

do $security$
declare
  v_table text;
  v_privilege text;
  v_function regprocedure;
  v_auth_select_expected boolean;
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
    perform public.test_assert(
      exists (
        select 1 from pg_class
        where oid = to_regclass(v_table) and relrowsecurity
      ),
      'RLS enabled at this migration stage on ' || v_table
    );

    v_auth_select_expected := v_table = any (array[
      'public.flavor_creation_claims',
      'public.flavor_reward_event_reviews',
      'public.flavor_reward_paid_order_ledger'
    ]);
    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] loop
      perform public.test_assert(
        not has_table_privilege('anon', v_table, v_privilege),
        'anon has no ' || v_privilege || ' privilege on ' || v_table
      );
      perform public.test_assert(
        not has_table_privilege('authenticated', v_table, v_privilege)
          or (v_privilege = 'SELECT' and v_auth_select_expected),
        'authenticated has only intended read access on ' || v_table
      );
      perform public.test_assert(
        not has_table_privilege('service_role', v_table, v_privilege)
          or v_privilege = 'SELECT',
        'service_role has no direct write privilege on ' || v_table
      );
    end loop;
    perform public.test_assert(
      has_table_privilege('service_role', v_table, 'SELECT'),
      'service_role retains required reads on ' || v_table
    );
  end loop;

  foreach v_function in array array[
    'public.link_flavor_reward_product(uuid,uuid,uuid)'::regprocedure,
    'public.claim_flavor_reward_order(text,uuid)'::regprocedure,
    'public.record_flavor_reward_review_event(text,text,text,text,text,text,bigint,text,text,jsonb,timestamptz)'::regprocedure,
    'public.resolve_flavor_reward_event_review(uuid,text,text,text)'::regprocedure,
    'public.process_flavor_reward_stripe_event(text,text,text,text,text,boolean,text,bigint,bigint,text,bigint,text,timestamptz,bigint,bigint)'::regprocedure
  ] loop
    perform public.test_assert(
      not has_function_privilege('anon', v_function, 'EXECUTE')
        and not has_function_privilege('authenticated', v_function, 'EXECUTE'),
      'API clients cannot execute ' || v_function
    );
    perform public.test_assert(
      has_function_privilege('service_role', v_function, 'EXECUTE'),
      'server role can execute ' || v_function
    );
  end loop;

  foreach v_function in array array[
    'private.claim_flavor_creation_once()'::regprocedure,
    'private.reject_flavor_reward_ledger_mutation()'::regprocedure
  ] loop
    perform public.test_assert(
      not has_function_privilege('anon', v_function, 'EXECUTE')
        and not has_function_privilege('authenticated', v_function, 'EXECUTE')
        and not has_function_privilege('service_role', v_function, 'EXECUTE'),
      'trigger-only function is not directly callable: ' || v_function
    );
  end loop;

  foreach v_function in array array[
    'public.record_flavor_net_sale(uuid,uuid,text,bigint,text)'::regprocedure,
    'public.request_flavor_payout(uuid,bigint,uuid)'::regprocedure,
    'public.review_flavor_payout_request(uuid,uuid,text,text,text)'::regprocedure
  ] loop
    perform public.test_assert(
      not has_function_privilege('anon', v_function, 'EXECUTE')
        and not has_function_privilege('authenticated', v_function, 'EXECUTE')
        and not has_function_privilege('service_role', v_function, 'EXECUTE'),
      'legacy manual sales and payout function remains disabled: ' || v_function
    );
  end loop;
end;
$security$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select public.test_assert(
  (select count(*) = 1 from public.flavor_reward_paid_order_ledger),
  'creator A reads their own wallet entry'
);
select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_paid_order_ledger
   where creator_user_id = 'a1000000-0000-4000-8000-000000000002'),
  'creator A cannot read creator B wallet entries'
);
select public.test_assert(
  (select count(*) = 1 from public.flavor_creation_claims
   where creator_user_id = 'a1000000-0000-4000-8000-000000000001'),
  'creator A reads their own lifetime claim'
);
select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_event_reviews),
  'non-admin creator cannot read refund review cases'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select public.test_assert(
  (select count(*) = 1 from public.flavor_reward_paid_order_ledger),
  'creator B reads their own wallet entry'
);
select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_paid_order_ledger
   where creator_user_id = 'a1000000-0000-4000-8000-000000000001'),
  'creator B cannot read creator A wallet entries'
);
select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_event_reviews),
  'second non-admin creator cannot read refund review cases'
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);
select public.test_assert(
  (select count(*) = 2 from public.flavor_reward_paid_order_ledger),
  'administrator can read creator reward ledger for review'
);
select public.test_assert(
  (select count(*) = 1 from public.flavor_reward_event_reviews),
  'administrator can read pending refund review case'
);

reset role;
rollback;
