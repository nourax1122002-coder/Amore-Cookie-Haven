update public.products
set image_url = 'https://fnuhkqkebztnyrdcukno.supabase.co/storage/v1/object/public/amore-products/amore-package.png',
    updated_at = now()
where handle = 'test-kinder-stuffed-cookie'
  and is_active = false
  and title = 'TEST ONLY — Kinder Stuffed Cookie';
