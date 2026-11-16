-- Test-only integration cases. Run only against a disposable local database.
begin;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'creator-one@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'creator-two@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'creator-three@example.test'),
  ('20000000-0000-4000-8000-000000000001', 'buyer@example.test'),
  ('30000000-0000-4000-8000-000000000001', 'admin@example.test'),
  ('40000000-0000-4000-8000-000000000001', 'interest@example.test');

insert into public.user_profiles (user_id, email, display_name, role) values
  ('10000000-0000-4000-8000-000000000001', 'creator-one@example.test', 'Creator One', 'customer'),
  ('10000000-0000-4000-8000-000000000002', 'creator-two@example.test', 'Creator Two', 'customer'),
  ('10000000-0000-4000-8000-000000000003', 'creator-three@example.test', 'Creator Three', 'customer'),
  ('20000000-0000-4000-8000-000000000001', 'buyer@example.test', 'Repeat Buyer', 'customer'),
  ('30000000-0000-4000-8000-000000000001', 'admin@example.test', 'Admin', 'administrator'),
  ('40000000-0000-4000-8000-000000000001', 'interest@example.test', 'Interest User', 'customer');

insert into public.products (id, handle, title, price, currency, image_url, stock, is_active) values
  ('50000000-0000-4000-8000-000000000001', 'flavor-cookie-test', 'Flavor Cookie', 10.000, 'KWD', '/test.png', 100, true),
  ('50000000-0000-4000-8000-000000000002', 'regular-cookie-test', 'Regular Cookie', 2.000, 'KWD', '/regular.png', 100, true);

insert into public.flavor_ideas (
  id, creator_user_id, request_key, title, title_ar, status, commercial_status
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'Rose Cookie', 'بسكويت الورد', 'published', 'approved'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000002',
    'Cardamom Cookie', 'بسكويت الهيل', 'published', 'approved'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000003',
    'Draft Cookie', 'بسكويت تجريبي', 'draft', 'not_reviewed'
  );

select public.test_assert(
  (select count(*) = 3 from public.flavor_creation_claims),
  'existing/new creator ideas create one durable lifetime claim each'
);

do $$
begin
  begin
    insert into public.flavor_ideas (
      id, creator_user_id, request_key, title, title_ar
    ) values (
      '60000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000004',
      'Second Cookie', 'بسكويت ثان'
    );
    raise exception 'Expected a second lifetime creation to be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'Only one lifetime Flavor Rewards creation is allowed per account' then
        raise;
      end if;
  end;
end;
$$;
select public.test_assert(true, 'a creator cannot create a second idea');

delete from public.flavor_ideas
where id = '60000000-0000-4000-8000-000000000003';
select public.test_assert(
  (select flavor_id is null from public.flavor_creation_claims
   where creator_user_id = '10000000-0000-4000-8000-000000000003'),
  'deleting a draft keeps its lifetime claim as a tombstone'
);
do $$
begin
  begin
    delete from auth.users
    where id = '10000000-0000-4000-8000-000000000003';
    raise exception 'Expected the retained creation claim to block hard account deletion';
  exception
    when foreign_key_violation then
      null;
  end;
end;
$$;
select public.test_assert(
  exists (
    select 1 from auth.users
    where id = '10000000-0000-4000-8000-000000000003'
  ),
  'hard deletion is blocked while the lifetime creation tombstone exists'
);

do $$
begin
  begin
    insert into public.flavor_ideas (
      id, creator_user_id, request_key, title, title_ar
    ) values (
      '60000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000005',
      'Replacement Cookie', 'بسكويت بديل'
    );
    raise exception 'Expected a deleted draft claim to remain reserved';
  exception
    when unique_violation then
      if sqlerrm <> 'Only one lifetime Flavor Rewards creation is allowed per account' then
        raise;
      end if;
  end;
end;
$$;
select public.test_assert(true, 'a deleted draft cannot be replaced with another lifetime creation');

select public.link_flavor_reward_product(
  '30000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001'
);

update public.flavor_ideas
set confirmed_interest_count = 99
where id = '60000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select public.test_assert(
  (public.register_flavor_interest('60000000-0000-4000-8000-000000000001')->>'rewardUnlocked')::boolean = false,
  'interest registration never reports a monetary reward'
);
select public.test_assert(
  (select confirmed_interest_count = 100
   from public.flavor_ideas
   where id = '60000000-0000-4000-8000-000000000001'),
  'interest registration still increments the count to 100'
);
reset role;

select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_ledger),
  'the legacy interest trigger inserts no money at 100 interests'
);
select public.test_assert(
  not has_function_privilege(
    'service_role',
    'public.record_flavor_net_sale(uuid, uuid, text, bigint, text)',
    'EXECUTE'
  ),
  'the legacy manual-sale award function is no longer executable'
);
select public.test_assert(
  not has_table_privilege('authenticated', 'public.flavor_reward_stripe_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.flavor_reward_paid_order_ledger', 'INSERT'),
  'clients cannot read Stripe event payloads or write the financial ledger'
);
select public.test_assert(
  has_function_privilege(
    'service_role',
    'public.process_flavor_reward_stripe_event(text, text, text, text, text, boolean, text, bigint, bigint, text, bigint, text, timestamp with time zone, bigint, bigint)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.process_flavor_reward_stripe_event(text, text, text, text, text, boolean, text, bigint, bigint, text, bigint, text, timestamp with time zone, bigint, bigint)',
    'EXECUTE'
  ),
  'only the server role can invoke payment reward processing'
);
select public.test_assert(
  has_function_privilege(
    'service_role',
    'public.record_flavor_reward_review_event(text, text, text, text, text, text, bigint, text, text, jsonb, timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_flavor_reward_review_event(text, text, text, text, text, text, bigint, text, text, jsonb, timestamp with time zone)',
    'EXECUTE'
  ),
  'only the server can enqueue payment allocation review events'
);
select public.test_assert(
  not has_function_privilege(
    'service_role',
    'public.request_flavor_payout(uuid, bigint, uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.review_flavor_payout_request(uuid, uuid, text, text, text)',
    'EXECUTE'
  ),
  'legacy payout submission and approval remain disabled'
);
select public.test_assert(
  position('flavor_reward_paid_order_ledger' in pg_get_functiondef(
    'public.request_flavor_payout(uuid, bigint, uuid)'::regprocedure
  )) > 0
  and position('flavor_reward_ledger' in pg_get_functiondef(
    'public.request_flavor_payout(uuid, bigint, uuid)'::regprocedure
  )) = 0,
  'legacy payout balance logic reads only verified paid-order ledger rows'
);
select public.test_assert(
  has_function_privilege(
    'service_role',
    'public.link_flavor_reward_product(uuid, uuid, uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.link_flavor_reward_product(uuid, uuid, uuid)',
    'EXECUTE'
  ),
  'only the server role can link a flavor to a catalog product'
);
do $$
begin
  begin
    perform public.link_flavor_reward_product(
      '10000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000002'
    );
    raise exception 'Expected a non-admin link request to be rejected';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;
select public.test_assert(true, 'non-admin product mapping is rejected by the database function');

do $$
declare
  v_order_id text;
  v_suffix text;
  v_session_id text;
  v_payment_intent_id text;
  v_result jsonb;
  v_index integer;
begin
  for v_index in 1..102 loop
    v_suffix := lpad(v_index::text, 3, '0');
    v_order_id := 'fr-order-' || v_suffix;
    v_session_id := 'cs_test_session' || v_suffix;
    v_payment_intent_id := 'pi_testintent' || v_suffix;

    insert into public.customer_orders (
      id, number, cart_hash, request_key, request_hash, token_hash, phone,
      address, note, items, subtotal_fils, shipping_fils, total_fils, currency,
      payment_status, payment_provider, fulfillment_status, stripe_checkout_session_id,
      stripe_payment_intent_id, stripe_payment_currency, stripe_payment_amount_minor,
      stock_status, user_id, expires_at
    ) values (
      v_order_id, 'FR-' || v_suffix, 'cart-' || v_suffix, 'request-' || v_suffix,
      'hash-' || v_suffix, 'token-' || v_suffix, '96500000000',
      '{}'::jsonb, '',
      jsonb_build_array(jsonb_build_object(
        'variantId', '50000000-0000-4000-8000-000000000001',
        'title', 'Flavor Cookie', 'quantity', 1, 'unitFils', 10000
      )),
      10000, 0, 10000, 'KWD', 'pending', 'stripe', 'received',
      v_session_id, v_payment_intent_id, 'USD', 3230,
      'reserved', '20000000-0000-4000-8000-000000000001',
      now() + interval '1 day'
    );

    perform public.claim_flavor_reward_order(
      v_order_id, '60000000-0000-4000-8000-000000000001'
    );

    update public.customer_orders
    set payment_status = 'paid',
        fulfillment_status = 'confirmed',
        paid_at = now()
    where id = v_order_id;

    v_result := public.process_flavor_reward_stripe_event(
      'evt_testpayment' || v_suffix,
      'checkout.session.completed',
      v_order_id,
      v_session_id,
      v_payment_intent_id,
      false,
      'paid',
      3230,
      null,
      null,
      null,
      null,
      now() + v_index * interval '1 second'
    );
  end loop;

  v_result := public.record_flavor_reward_review_event(
    'evt_testrefundreview101',
    'charge.refunded',
    'charge',
    'ch_testcharge101',
    'fr-order-101',
    'pi_testintent101',
    500,
    'usd',
    'missing_allocation_metadata',
    jsonb_build_object('refunds', jsonb_build_array(
      jsonb_build_object('id', 're_missing', 'amount', 500, 'currency', 'usd')
    )),
    now()
  );
  perform public.test_assert(
    not (v_result->>'duplicate')::boolean,
    'a refund without verified allocation is durably queued for review'
  );
  v_result := public.record_flavor_reward_review_event(
    'evt_testrefundreview101',
    'charge.refunded',
    'charge',
    'ch_testcharge101',
    'fr-order-101',
    'pi_testintent101',
    500,
    'usd',
    'missing_allocation_metadata',
    jsonb_build_object('refunds', jsonb_build_array(
      jsonb_build_object('id', 're_missing', 'amount', 500, 'currency', 'usd')
    )),
    now()
  );
  perform public.test_assert(
    (v_result->>'duplicate')::boolean
      and (select count(*) = 1 from public.flavor_reward_event_reviews
        where stripe_event_id = 'evt_testrefundreview101'),
    'Stripe webhook retry does not duplicate the review record'
  );
  perform public.test_assert(
    (select commission_due_fils = 1500
      from public.flavor_reward_order_snapshots
      where customer_order_id = 'fr-order-101')
    and (select sum(amount_fils) = 200000
      from public.flavor_reward_paid_order_ledger
      where flavor_id = '60000000-0000-4000-8000-000000000001'
        and entry_type = 'milestone_bonus'),
    'queued ambiguous refunds do not alter commission or milestone bonuses'
  );

  -- Unpaid, failed, and cancelled attempts have no verified paid order number.
  insert into public.customer_orders (
    id, number, cart_hash, request_key, request_hash, token_hash, phone,
    address, note, items, subtotal_fils, shipping_fils, total_fils, currency,
    payment_status, payment_provider, fulfillment_status, stock_status,
    user_id, expires_at
  ) values
    (
      'fr-failed-order', 'FR-FAILED', 'cart-failed', 'request-failed',
      'hash-failed', 'token-failed', '96500000000', '{}'::jsonb, '',
      jsonb_build_array(jsonb_build_object(
        'variantId', '50000000-0000-4000-8000-000000000001',
        'title', 'Flavor Cookie', 'quantity', 1, 'unitFils', 10000
      )),
      10000, 0, 10000, 'KWD', 'pending', 'stripe', 'received', 'reserved',
      '20000000-0000-4000-8000-000000000001', now() + interval '1 day'
    ),
    (
      'fr-cancelled-order', 'FR-CANCELLED', 'cart-cancelled', 'request-cancelled',
      'hash-cancelled', 'token-cancelled', '96500000000', '{}'::jsonb, '',
      jsonb_build_array(jsonb_build_object(
        'variantId', '50000000-0000-4000-8000-000000000001',
        'title', 'Flavor Cookie', 'quantity', 1, 'unitFils', 10000
      )),
      10000, 0, 10000, 'KWD', 'pending', 'stripe', 'received', 'reserved',
      '20000000-0000-4000-8000-000000000001', now() + interval '1 day'
    );
  perform public.claim_flavor_reward_order(
    'fr-failed-order', '60000000-0000-4000-8000-000000000001'
  );
  perform public.claim_flavor_reward_order(
    'fr-cancelled-order', '60000000-0000-4000-8000-000000000001'
  );
  update public.customer_orders set payment_status = 'failed' where id = 'fr-failed-order';
  update public.customer_orders set payment_status = 'cancelled' where id = 'fr-cancelled-order';
  perform public.test_assert(
    (select count(*) = 0
     from public.flavor_reward_order_snapshots
     where customer_order_id in ('fr-failed-order', 'fr-cancelled-order')
       and (verified_paid_at is not null or eligible_order_number is not null)),
    'failed and cancelled payment attempts never receive eligible order numbers'
  );

  v_result := public.process_flavor_reward_stripe_event(
    'evt_testpayment101',
    'checkout.session.completed',
    'fr-order-101',
    'cs_test_session101',
    'pi_testintent101',
    false,
    'paid',
    3230,
    null,
    null,
    null,
    null,
    now()
  );
  perform public.test_assert(
    (v_result->>'duplicate')::boolean,
    'replaying the same Stripe event is idempotent'
  );
end;
$$;

select public.test_assert(
  (select eligible_order_number = 100
   from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-100'),
  'the 100th verified paid order receives order number 100'
);
select public.test_assert(
  (select count(*) = 0
   from public.flavor_reward_paid_order_ledger
   where customer_order_id = 'fr-order-100'
     and entry_type = 'commission'),
  'order 100 earns no commission'
);
select public.test_assert(
  (select amount_fils = 200000
   from public.flavor_reward_paid_order_ledger
   where flavor_id = '60000000-0000-4000-8000-000000000001'
     and entry_type = 'milestone_bonus'),
  'order 100 earns exactly one permanent 200 KWD milestone'
);
select public.test_assert(
  (select amount_fils = 1500
   from public.flavor_reward_paid_order_ledger
   where customer_order_id = 'fr-order-101'
     and entry_type = 'commission'),
  'order 101 earns exactly 15 percent commission'
);
select public.test_assert(
  (select count(*) = 102
   from public.flavor_reward_order_snapshots
   where buyer_user_id = '20000000-0000-4000-8000-000000000001'
     and verified_paid_at is not null),
  'repeat purchases by the same buyer count as separate paid orders'
);

do $$
declare
  v_index integer;
  v_suffix text;
  v_order_id text;
  v_session_id text;
  v_payment_intent_id text;
  v_event_id text;
  v_result jsonb;
begin
  -- Shipping-only refunds affect the Stripe total but not the product
  -- allocation or creator commission.
  update public.customer_orders
  set payment_status = 'partially_refunded',
      stripe_refunded_amount_minor = 500
  where id = 'fr-order-101';
  v_result := public.process_flavor_reward_stripe_event(
    'evt_testshippingrefund101', 'charge.refunded', 'fr-order-101',
    'cs_test_session101', 'pi_testintent101', false, null, 3230,
    500, null, null, null, now(),
    p_product_refunded_fils => 0
  );
  perform public.test_assert(
    (select product_refunded_fils = 0 and commission_due_fils = 1500
     from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-101'),
    'a shipping-only refund leaves product sales and commission unchanged'
  );
  begin
    perform public.process_flavor_reward_stripe_event(
      'evt_testrefundmissingallocation101', 'charge.refunded', 'fr-order-101',
      'cs_test_session101', 'pi_testintent101', false, null, 3230,
      700, null, null, null, now() + interval '1 second'
    );
    raise exception 'Expected refund without product allocation to fail closed';
  exception when sqlstate '22023' then
    null;
  end;
  perform public.test_assert(
    not exists (
      select 1 from public.flavor_reward_stripe_events
      where stripe_event_id = 'evt_testrefundmissingallocation101'
    ),
    'an unallocated Stripe refund is not processed or prorated'
  );

  -- An explicitly attributed product refund adjusts only its order's
  -- commissionable KWD sales.
  update public.customer_orders
  set stripe_refunded_amount_minor = 1615
  where id = 'fr-order-101';
  v_result := public.process_flavor_reward_stripe_event(
    'evt_testrefundhalf101', 'charge.refunded', 'fr-order-101',
    'cs_test_session101', 'pi_testintent101', false, null, 3230,
    1615, null, null, null, now() + interval '2 seconds',
    p_product_refunded_fils => 5000
  );
  perform public.test_assert(
    (select commission_due_fils = 750
     from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-101'),
    'a half refund reduces order 101 commission by half'
  );

  foreach v_index in array array[1, 2, 3, 100, 101] loop
    v_suffix := lpad(v_index::text, 3, '0');
    v_order_id := 'fr-order-' || v_suffix;
    v_session_id := 'cs_test_session' || v_suffix;
    v_payment_intent_id := 'pi_testintent' || v_suffix;
    v_event_id := 'evt_testrefundfull' || v_suffix;

    update public.customer_orders
    set payment_status = 'refunded',
        stripe_refunded_amount_minor = 3230
    where id = v_order_id;

    v_result := public.process_flavor_reward_stripe_event(
      v_event_id, 'charge.refunded', v_order_id, v_session_id,
      v_payment_intent_id, false, null, 3230, 3230,
      null, null, null, now() + (v_index + 2) * interval '1 minute',
      p_product_refunded_fils => 10000
    );
  end loop;

  perform public.test_assert(
    (select count(*) = 97
     from public.flavor_reward_order_snapshots
     where flavor_id = '60000000-0000-4000-8000-000000000001'
       and verified_paid_at is not null
       and net_commissionable_sales_fils > 0),
    'full refunds can reduce the current eligible count below 100'
  );
  perform public.test_assert(
    (select sum(amount_fils) = 200000
     from public.flavor_reward_paid_order_ledger
     where flavor_id = '60000000-0000-4000-8000-000000000001'
       and entry_type = 'milestone_bonus'),
    'the 200 KWD milestone remains earned after refunds reduce the count below 100'
  );
  perform public.test_assert(
    (select coalesce(sum(amount_fils), 0) = 0
     from public.flavor_reward_paid_order_ledger
     where customer_order_id = 'fr-order-101'
       and entry_type in ('commission', 'commission_adjustment')),
    'refunds reverse only the affected order 101 commission'
  );
  perform public.test_assert(
    (select coalesce(sum(amount_fils), 0) = 1500
     from public.flavor_reward_paid_order_ledger
     where customer_order_id = 'fr-order-102'
       and entry_type in ('commission', 'commission_adjustment')),
    'refunds on order 101 do not change order 102 commission'
  );

  -- A chargeback temporarily adjusts only order 102; a won dispute restores
  -- that order's commission without touching the milestone.
  v_result := public.process_flavor_reward_stripe_event(
    'evt_testshippingdispute102', 'charge.dispute.created', 'fr-order-102',
    'cs_test_session102', 'pi_testintent102', false, null, 3230,
    null, 'dp_testshippingdispute102', 500, 'open', now(),
    p_dispute_product_amount_fils => 0
  );
  perform public.test_assert(
    (select commission_due_fils = 1500
     from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-102'),
    'a shipping-only dispute does not reduce product commission'
  );

  v_result := public.process_flavor_reward_stripe_event(
    'evt_testdisputeopen102', 'charge.dispute.created', 'fr-order-102',
    'cs_test_session102', 'pi_testintent102', false, null, 3230,
    null, 'dp_testdispute102', 1615, 'open', now(),
    p_dispute_product_amount_fils => 5000
  );
  perform public.test_assert(
    (select commission_due_fils = 750
     from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-102'),
    'an open chargeback adjusts only the affected order commission'
  );

  v_result := public.process_flavor_reward_stripe_event(
    'evt_testdisputewon102', 'charge.dispute.closed', 'fr-order-102',
    'cs_test_session102', 'pi_testintent102', false, null, 3230,
    null, 'dp_testdispute102', 1615, 'won', now() + interval '1 minute',
    p_dispute_product_amount_fils => 5000
  );
  perform public.test_assert(
    (select commission_due_fils = 1500
     from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-102'),
    'a won chargeback restores only order 102 commission'
  );
  v_result := public.process_flavor_reward_stripe_event(
    'evt_testdisputeopenlate102', 'charge.dispute.updated', 'fr-order-102',
    'cs_test_session102', 'pi_testintent102', false, null, 3230,
    null, 'dp_testdispute102', 1615, 'open', now() - interval '1 day',
    p_dispute_product_amount_fils => 5000
  );
  perform public.test_assert(
    (select status = 'won'
     from public.flavor_reward_order_disputes
     where stripe_dispute_id = 'dp_testdispute102')
    and (select commission_due_fils = 1500
     from public.flavor_reward_order_snapshots where customer_order_id = 'fr-order-102'),
    'a late older dispute event cannot undo a newer final result'
  );
  perform public.test_assert(
    (select sum(amount_fils) = 200000
     from public.flavor_reward_paid_order_ledger
     where flavor_id = '60000000-0000-4000-8000-000000000001'
       and entry_type = 'milestone_bonus'),
    'chargeback changes never reverse or duplicate the milestone bonus'
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.test_assert(
  (select count(*) > 0 from public.flavor_reward_paid_order_ledger),
  'a creator can read their own reward ledger'
);
select public.test_assert(
  (select count(*) = 1 from public.flavor_creation_claims),
  'a creator can read only their own lifetime claim'
);
select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_event_reviews),
  'non-admin creators cannot read payment review data'
);
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select public.test_assert(
  (select count(*) = 1
   from public.flavor_reward_event_reviews
   where stripe_event_id = 'evt_testrefundreview101'),
  'admins can inspect pending payment review events'
);
select public.test_assert(
  not has_table_privilege('authenticated', 'public.flavor_reward_event_reviews', 'INSERT')
    and not has_table_privilege('authenticated', 'public.flavor_reward_event_reviews', 'UPDATE'),
  'authenticated clients cannot create or resolve payment review events directly'
);
select public.test_assert(
  not has_function_privilege('authenticated',
    'public.resolve_flavor_reward_event_review(uuid,text,text,text)', 'EXECUTE'),
  'authenticated clients cannot resolve payment review cases through the RPC'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.test_assert(
  (select count(*) = 0 from public.flavor_reward_paid_order_ledger),
  'a different creator cannot read another creator ledger'
);
select public.test_assert(
  (select count(*) = 1 from public.flavor_creation_claims),
  'a different creator cannot read another account claim'
);
reset role;

do $$
declare
  v_result jsonb;
  v_count_before bigint;
  v_total_before bigint;
begin
  select count(*), coalesce(sum(amount_fils), 0)
  into v_count_before, v_total_before
  from public.flavor_reward_paid_order_ledger;
  v_result := public.resolve_flavor_reward_event_review(
    '30000000-0000-4000-8000-000000000001',
    'evt_testrefundreview101',
    'reviewed',
    'Verified the Stripe refund allocation; no ledger adjustment.'
  );
  perform public.test_assert(
    v_result->>'status' = 'reviewed'
      and (select reviewed_by_snapshot = '30000000-0000-4000-8000-000000000001'
             and reviewed_at is not null
             and review_note = 'Verified the Stripe refund allocation; no ledger adjustment.'
           from public.flavor_reward_event_reviews
           where stripe_event_id = 'evt_testrefundreview101'),
    'admin payment review records the reviewer, timestamp, and reason'
  );
  perform public.test_assert(
    (select count(*) = v_count_before
       and coalesce(sum(amount_fils), 0) = v_total_before
     from public.flavor_reward_paid_order_ledger),
    'review resolution alone never changes reward ledger balances'
  );
end;
$$;

select public.test_assert(
  not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.customer_orders'::regclass
      and tgname like 'flavor_reward%'
      and not tgisinternal
  ),
  'the draft adds no trigger to the existing customer_orders table'
);

rollback;
