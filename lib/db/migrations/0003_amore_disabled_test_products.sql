insert into public.products (
  handle, title, title_ar, description, description_ar, price, currency,
  pieces, image_url, stock, low_stock_threshold, ingredients, ingredients_ar, is_active
)
values
  (
    'test-classic-belgian-cocoa',
    'TEST ONLY — Classic Belgian Cocoa',
    'تجريبي فقط — كاكاو بلجيكي كلاسيكي',
    'Internal test record. Not for sale.',
    'سجل اختبار داخلي. غير متاح للبيع.',
    10.000, 'KWD', 12,
    'https://fnuhkqkebztnyrdcukno.supabase.co/storage/v1/object/public/amore-products/amore-cookie.jpg',
    0, 0, '', '', false
  ),
  (
    'test-kinder-stuffed-cookie',
    'TEST ONLY — Kinder Stuffed Cookie',
    'تجريبي فقط — كوكيز محشي بالكندر',
    'Internal test record. Not for sale.',
    'سجل اختبار داخلي. غير متاح للبيع.',
    10.000, 'KWD', 12,
    'https://fnuhkqkebztnyrdcukno.supabase.co/storage/v1/object/public/amore-products/amore-package.png',
    0, 0, '', '', false
  )
on conflict (handle) do nothing;
