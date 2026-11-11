import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  getGetAdminSessionQueryKey, getGetAdminSummaryQueryKey, getGetAdminSettingsQueryKey,
  getGetCartQueryKey, getGetProductQueryKey, getGetStoreQueryKey, getListAdminProductsQueryKey,
  getListInquiriesQueryKey, getListProductsQueryKey, useCreateInquiry, useGetAdminSession,
  useGetAdminSettings, useGetAdminSummary, useGetCart, useGetProduct, useGetStore,
  useListAdminProducts, useListInquiries, useListProducts, useSaveProduct, useSaveSettings,
  useStartCheckout, useTrackOrder, useUpdateCart, useUpdateInquiry,
  useGetPaymentAvailability, useGetCurrencyConversion,
} from '@workspace/api-client-react';
import type { Cart, Inquiry, Product, ProductInput, StoreSettings, TrackingResult, GetCurrencyConversionParams } from '@workspace/api-client-react';
import { OrderDetails } from '@/components/order-status';
import { PaymentResult, LocalOrdersAdmin } from '@/components/payments';
import { SafeAssistantWidget } from '@/components/assistant-widget';
import { AuthPage, PasswordRecoveryPage } from '@/components/auth-pages';
import { MyFavoritesPage, MyOrdersPage, UserPortalPage } from '@/components/account-pages';
import { FavoriteButton } from '@/components/favorite-button';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ErrorBoundary } from '@/components/error-boundary';
import { uploadAdminProductImage } from '@/lib/admin-product-image-upload';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleHelp, Cookie,
  ExternalLink, Flame, LogOut, Menu, Minus, Plus, RefreshCw,
  ShoppingBag, Snowflake, Sparkles, X,
} from 'lucide-react';
import { getListAccountFavoritesQueryKey, useListAccountFavorites } from '@workspace/api-client-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const images = {
  logo: `${basePath}/images/amore-logo.png`,
  mascot: `${basePath}/images/amore-baker.png`,
  package: `${basePath}/images/amore-package.png`,
  cookie: `${basePath}/images/amore-cookie.jpg`,
};
type Lang = 'en' | 'ar';
type DisplayCurrency = GetCurrencyConversionParams['currency'] | 'KWD';
const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = ['KWD', 'USD', 'SAR'];
const DISPLAY_CURRENCY_STORAGE_KEY = 'amore-display-currency';

function useDisplayCurrency() {
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() => {
    try {
      const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
      return DISPLAY_CURRENCIES.includes(stored as DisplayCurrency) ? stored as DisplayCurrency : 'KWD';
    } catch {
      return 'KWD';
    }
  });

  const selectDisplayCurrency = (currency: DisplayCurrency) => {
    setDisplayCurrency(currency);
    try {
      window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
    } catch {
      // Currency selection remains usable if browser storage is unavailable.
    }
  };

  return [displayCurrency, selectDisplayCurrency] as const;
}

const copy: Record<Lang, Record<string, string>> = {
  en: {
    home:'Home', products:'Our cookies', about:'Our story', baking:'How to bake', cafes:'For cafés', individuals:'For home',
    account:'Account', logout:'Log out', myOrders:'My orders', myFavorites:'My favorites',
    bag:'Bag', shop:'Shop the dough', seeAll:'Meet the cookies', made:'A little love, ready for the oven.',
    hero:'The warmest thing in your freezer.', heroText:'Small-batch frozen cookie dough, made for the moments worth making a little sweeter.',
    frozen:'Frozen cookie dough · Ready to bake', pieces:'12 pieces per bag', sold:'Currently sold out', learn:'The Amore way',
    storyTitle:'A little love, in every batch.', story:'Amore Cookies brings the bakery feeling home. Keep a bag close, bake just what you need, and let the kitchen do the rest.',
    ritual:'Good things take a few minutes.', ritualText:'From freezer to warm, soft-centred cookies. No fuss, just the smell everyone follows.',
    step1:'Heat the oven', step1t:'Preheat to 175°C.', step2:'Bake from frozen', step2t:'Place cookies in the oven for 10–12 minutes at 150°C.', step3:'Let them rest', step3t:'Take them out and let them cool outside the oven before serving.',
    ingredients:'Ingredients', storage:'Storage & baking', awaiting:'Ingredients awaiting approval.', wholesale:'A good thing for your café.', wholesaleText:'Tell us a little about your café and what you have in mind. We’ll be in touch to explore a fit.',
    inquiry:'Start a café conversation', browse:'Browse the collection', all:'All cookies', details:'Discover this dough', add:'Add to bag', shopBlocked:'Stripe Test Mode checkout is not ready yet. Only test payments will be accepted.', piece:'pieces',
    checkoutNote:'Prices are in KWD. Live payment opens only after the merchant account, fees and delivery settings are approved.',
    empty:'Your bag is waiting for something lovely.', continue:'Continue browsing', subtotal:'Subtotal', discount:'Discount', total:'Total', shipping:'Shipping is calculated at checkout.',
    review:'Review your bag', checkout:'Pay now', email:'Email', phone:'Phone', note:'Order note (optional)', promo:'Discount code', apply:'Apply code',
    notReady:'Checkout is not available yet. Your bag is saved; please check back later.', policies:'Policies', tracking:'Track an order',
    orderNumber:'Order number', track:'Check order status', trackingHelp:'Enter the order number and phone number used for the order.',
    cafeName:'Café name', contact:'Contact name', area:'Area', requested:'Products & quantities', notes:'Notes', send:'Send inquiry',
    saved:'Inquiry received', reference:'Reference number', required:'Please complete the required fields.', loading:'Gathering the good things…', retry:'Try again',
    admin:'Shop management', access:'Sign in to manage Amore', pending:'Admin access is pending. The shop owner must configure the owner email before management access is available.',
    overview:'Overview', inventory:'Products & inventory', inquiries:'Café inquiries', settings:'Store content & settings',
    new:'New', contacted:'Contacted', closed:'Closed', markContacted:'Mark contacted', markClosed:'Close inquiry', edit:'Edit', create:'Add product', save:'Save changes',
    stock:'Stock', threshold:'Low-stock alert at', price:'Catalog price (KWD)', title:'Product title', titleAr:'Arabic title', description:'Description',
    descriptionAr:'Arabic description', piecesLabel:'Pieces per bag', image:'Image URL', ingredientsAr:'Ingredients (Arabic)', ingredientsEn:'Ingredients (English)',
    heroTitle:'Hero title', heroTextLabel:'Hero text', aboutLabel:'About', storageLabel:'Storage guidance', policyLabel:'Policies (approved copy only)',
    hours:'Hours', whatsapp:'WhatsApp (approved number)', contactEmail:'Email', contactPhone:'Phone', checkoutEnabled:'Stripe Test Mode', deliveryFee:'Delivery fee (KWD)', bakingSteps:'Baking steps',
    saveSettings:'Save store settings', noSales:'No sales reports yet.', ordersLink:'Orders', unknownStock:'Inventory unavailable', reviewBefore:'Review before continuing',
    trackingUnavailable:'Order tracking is not available right now. Please try again later.', noProducts:'The collection is being prepared.',
    launch:'A little patience. Something lovely is coming.', checkoutDisabled:'Stripe Test Mode setup pending', awaitingApproval:'Awaiting approved ingredients',
    displayCurrency:'Display price in', conversionLoading:'Loading an indicative conversion…', conversionError:'Currency conversion is temporarily unavailable. The KWD price remains unchanged.',
    conversionNote:'Approximate price for reference only. Checkout remains in KWD.', rateSources:'Rate sources and dates',
    rateUpdated:'Rate data updated', rateLabel:'Indicative exchange rate', originalKwd:'Original amount',
  },
  ar: {
    home:'الرئيسية', products:'منتجاتنا', about:'من نحن', baking:'طريقة التحضير', cafes:'للمقاهي', individuals:'للأفراد',
    account:'حسابي', logout:'تسجيل الخروج', myOrders:'طلباتي', myFavorites:'مفضلتي',
    bag:'السلة', shop:'تسوقي العجينة', seeAll:'اكتشفي الكوكيز', made:'قليل من الحب، جاهز للفرن.',
    hero:'أجمل شيء في الفريزر.', heroText:'عجينة كوكيز مجمدة تُحضّر على دفعات صغيرة، للحظات تستحق أن تكون أحلى.',
    frozen:'عجينة كوكيز مجمدة · جاهزة للخبز', pieces:'١٢ قطعة في الكيس', sold:'نفدت الكمية حالياً', learn:'طريقة أموري',
    storyTitle:'قليل من الحب، في كل دفعة.', story:'تأخذ أموري أجواء المخبز إلى بيتك. احتفظي بكيس في الفريزر، اخبزي ما تحتاجينه، ودعي الباقي على المطبخ.',
    ritual:'الأشياء الجميلة تحتاج دقائق.', ritualText:'من الفريزر إلى كوكيز دافئ وطري من الوسط. بلا تعقيد، فقط الرائحة التي يتبعها الجميع.',
    step1:'سخّني الفرن', step1t:'سخّني الفرن مسبقاً إلى ١٧٥°م.', step2:'اخبزي العجينة', step2t:'ضعي الكوكيز في الفرن لمدة ١٠–١٢ دقيقة على ١٥٠°م.', step3:'اتركيها ترتاح', step3t:'أخرجي الكوكيز واتركيه يبرد خارج الفرن قبل التقديم.',
    ingredients:'المكونات', storage:'الحفظ والخبز', awaiting:'المكونات بانتظار الاعتماد.', wholesale:'حلاوة تناسب مقهاك.', wholesaleText:'أخبرينا قليلاً عن مقهاك وما تفكرين به. سنتواصل معك لاستكشاف فرص التعاون.',
    inquiry:'ابدئي محادثة للمقاهي', browse:'تصفحي المجموعة', all:'كل الكوكيز', details:'اكتشفي العجينة', add:'أضيفي إلى السلة', shopBlocked:'الدفع التجريبي عبر Stripe غير جاهز بعد. لن تُقبل إلا مدفوعات الاختبار.',
    checkoutNote:'الأسعار بالدينار الكويتي. يتاح الدفع الحقيقي بعد اعتماد حساب التاجر والرسوم وإعدادات التوصيل.',
    empty:'سلتك تنتظر شيئاً لذيذاً.', continue:'تابعي التصفح', subtotal:'المجموع الفرعي', discount:'الخصم', total:'الإجمالي', shipping:'تُحسب رسوم التوصيل في صفحة الدفع.',
    review:'راجعي سلتك', checkout:'الدفع الآن', email:'البريد الإلكتروني', phone:'رقم الهاتف', note:'ملاحظة الطلب (اختياري)', promo:'رمز الخصم', apply:'تطبيق الرمز',
    notReady:'الدفع غير متاح حالياً. سلتك محفوظة، يرجى العودة لاحقاً.', policies:'السياسات', tracking:'تتبع طلب', orderNumber:'رقم الطلب', track:'تحققي من حالة الطلب',
    trackingHelp:'أدخلي رقم الطلب ورقم الهاتف المستخدم في الطلب.', cafeName:'اسم المقهى', contact:'اسم المسؤول', area:'المنطقة', requested:'المنتجات والكميات',
    notes:'ملاحظات', send:'إرسال الاستفسار', saved:'تم استلام الاستفسار', reference:'رقم المرجع', required:'يرجى إكمال الحقول المطلوبة.',
    admin:'إدارة المتجر', access:'سجّلي الدخول لإدارة أموري', pending:'صلاحية الإدارة بانتظار الإعداد. يجب على مالك المتجر ضبط بريده الإلكتروني قبل إتاحة الوصول.',
    overview:'نظرة عامة', inventory:'المنتجات والمخزون', inquiries:'استفسارات المقاهي', settings:'محتوى المتجر وإعداداته',
    new:'جديد', contacted:'تم التواصل', closed:'مغلق', markContacted:'تحديد تم التواصل', markClosed:'إغلاق الاستفسار', edit:'تعديل', create:'إضافة منتج', save:'حفظ التغييرات',
    stock:'المخزون', threshold:'تنبيه انخفاض المخزون عند', price:'سعر الكتالوج (د.ك)', title:'اسم المنتج', titleAr:'الاسم بالعربية', description:'الوصف',
    descriptionAr:'الوصف بالعربية', piecesLabel:'عدد القطع في الكيس', image:'رابط الصورة', ingredientsAr:'المكونات (عربي)', ingredientsEn:'المكونات (إنجليزي)',
    heroTitle:'عنوان الواجهة', heroTextLabel:'نص الواجهة', aboutLabel:'من نحن', storageLabel:'إرشادات الحفظ', policyLabel:'السياسات (النص المعتمد فقط)',
    hours:'ساعات العمل', whatsapp:'واتساب (رقم معتمد)', contactEmail:'البريد الإلكتروني', contactPhone:'الهاتف', checkoutEnabled:'وضع اختبار Stripe', deliveryFee:'رسوم التوصيل (د.ك)', bakingSteps:'خطوات الخبز',
    saveSettings:'حفظ إعدادات المتجر', noSales:'لا توجد تقارير مبيعات بعد.', ordersLink:'الطلبات', unknownStock:'المخزون غير متاح', reviewBefore:'مراجعة قبل المتابعة',
    trackingUnavailable:'تتبع الطلب غير متاح حالياً. يرجى المحاولة لاحقاً.', noProducts:'المجموعة قيد التحضير.',
    launch:'قليل من الصبر. شيء جميل قادم.', checkoutDisabled:'إعداد دفع Stripe التجريبي قيد الإكمال', awaitingApproval:'بانتظار اعتماد المكونات', piece:'قطعة',
    displayCurrency:'عرض السعر بعملة', conversionLoading:'جارٍ تحميل السعر التقريبي…', conversionError:'تحويل العملة غير متاح مؤقتاً. يبقى سعر الدينار الكويتي دون تغيير.',
    conversionNote:'سعر تقريبي للاسترشاد فقط. يتم الدفع بالدينار الكويتي.', rateSources:'مصادر الأسعار وتواريخها',
    rateUpdated:'تحديث بيانات الصرف', rateLabel:'سعر الصرف التقريبي', originalKwd:'المبلغ الأصلي بالدينار',
  },
} as const;


function AppShell() {
  const [lang,setLang] = useState<Lang>(() => localStorage.getItem('amore-lang') === 'ar' ? 'ar' : 'en');
  const [mobileOpen,setMobileOpen] = useState(false);
  const [signOutError,setSignOutError] = useState('');
  const [path] = useLocation();
  const {user,signOut}=useAuth();
  const storeQuery = useGetStore({ query:{ queryKey:getGetStoreQueryKey(), refetchInterval:60000 } });
  const store = storeQuery.data;
  const c = copy[lang];
  const rtl = lang === 'ar';
  const accountName=user?.displayName?.trim()||user?.email.split('@')[0]||c.account;
  const handleSignOut=async()=>{setSignOutError('');try{await signOut();setMobileOpen(false);}catch{setSignOutError(lang==='ar'?'تعذر تسجيل الخروج. حاولي مجدداً.':'Could not sign out. Please retry.');}};
  const toggleLang = () => setLang(v => { const next=v==='en'?'ar':'en'; localStorage.setItem('amore-lang',next); return next; });
  useEffect(()=>{document.documentElement.lang=lang;document.documentElement.dir=rtl?'rtl':'ltr';document.body.classList.toggle('font-ar',rtl)},[lang,rtl]);
  const settings = store?.settings;
  const nav = [
    ['/',c.home],['/products',c.products],['/about',c.about],['/baking',c.baking],['/wholesale',c.cafes],['/products',c.individuals],
  ];
  useEffect(() => {
    const title = nav.find(([href]) => href === path)?.[1] ?? ({
      '/cart': c.bag, '/checkout': c.checkout, '/tracking': c.tracking, '/admin': c.admin, '/policies': c.policies,
      '/user-portal':c.account,'/my-orders':c.myOrders,'/my-favorites':c.myFavorites,
    } as Record<string, string>)[path] ?? c.products;
    document.title = `${title} | Amore Cookies`;
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [path, lang]);
  return <div className="noise min-h-[100dvh] flex flex-col">
    {storeQuery.isError&&<div className="bg-[#fff1f3] px-4 py-2 text-center text-[10px] text-[#763246]" role="alert">{lang==='ar'?'تعذر تحميل إعدادات المتجر.':'Store details could not be loaded.'} <button className="underline ms-2 font-bold" onClick={()=>storeQuery.refetch()}>{c.retry}</button></div>}
    <header className="sticky top-0 z-20 bg-[#fffaf8]/95 backdrop-blur border-b border-[#f0e1e4]">
      <div className="container-wide h-[76px] flex items-center justify-between gap-5">
        <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-home"><img src={settings?.logoImage || images.logo} className="h-[56px] w-[64px] object-contain rounded-full" alt="Amore Cookies"/><span className="hidden sm:block text-[#5B0D1E] font-display italic text-[21px]">Amore <span className="not-italic text-[9px] tracking-[.26em] font-sans">COOKIES</span></span></Link>
        <nav className="hidden lg:flex items-center gap-7">{nav.map(([href,label],i)=><Link key={`${href}-${i}`} href={href} className={`text-[10px] tracking-[.11em] uppercase font-semibold transition-colors hover:text-[#a35168] ${path===href?'text-[#5B0D1E]':'text-[#795963]'}`}>{label}</Link>)}</nav>
        <div className="flex items-center gap-3">
          <button className="text-[10px] tracking-widest font-bold text-[#5B0D1E] px-2 py-2" onClick={toggleLang} data-testid="button-toggle-language">{rtl?'EN':'عربي'}</button>
           <Link href={user?'/user-portal':'/sign-in'} className="text-[9px] sm:text-[10px] font-semibold text-[#5B0D1E] max-w-[92px] sm:max-w-36 truncate" data-testid="link-account">{user?accountName:(rtl?'دخول':'Sign in')}</Link>
           {user&&<button type="button" onClick={()=>void handleSignOut()} className="hidden lg:inline-flex items-center gap-1 text-[10px] font-semibold text-[#795963] hover:text-[#5B0D1E]" data-testid="button-navbar-sign-out"><LogOut size={13}/>{c.logout}</button>}
          <Link href="/cart" className="relative inline-flex items-center gap-2 rounded-full border border-[#e9d2d8] px-4 py-2.5 text-[10px] font-bold text-[#5B0D1E]" data-testid="link-cart"><ShoppingBag size={15}/><span className="hidden sm:inline">{c.bag}</span></Link>
          <button className="lg:hidden p-2 text-[#5B0D1E]" onClick={()=>setMobileOpen(!mobileOpen)} aria-label="Toggle navigation">{mobileOpen?<X/>:<Menu/>}</button>
        </div>
      </div>
      {signOutError&&<div role="alert" className="border-t border-[#f0e1e4] px-5 py-2 text-center text-[10px] text-red-700">{signOutError}</div>}
      {mobileOpen&&<nav className="lg:hidden border-t border-[#f0e1e4] bg-[#fffaf8] px-5 py-3 grid grid-cols-2 gap-1">
        {nav.map(([href,label],i)=><Link key={`${href}-${i}`} href={href} onClick={()=>setMobileOpen(false)} className="py-3 text-xs text-[#5B0D1E]">{label}</Link>)}
        {user&&<><Link href="/user-portal" onClick={()=>setMobileOpen(false)} className="py-3 text-xs font-semibold text-[#5B0D1E]">{accountName}</Link><Link href="/my-orders" onClick={()=>setMobileOpen(false)} className="py-3 text-xs text-[#5B0D1E]">{c.myOrders}</Link><Link href="/my-favorites" onClick={()=>setMobileOpen(false)} className="py-3 text-xs text-[#5B0D1E]">{c.myFavorites}</Link><button type="button" onClick={()=>void handleSignOut()} className="py-3 text-start text-xs text-[#5B0D1E]">{c.logout}</button></>}
      </nav>}
    </header>
    <main className="flex-1">
      <Switch>
        <Route path="/"><HomePage lang={lang} settings={settings} store={store}/></Route>
        <Route path="/products"><ProductsPage lang={lang}/></Route>
        <Route path="/products/:handle"><ProductDetail lang={lang} settings={settings}/></Route>
        <Route path="/about"><AboutPage lang={lang} settings={settings}/></Route>
        <Route path="/baking"><BakingPage lang={lang} settings={settings}/></Route>
        <Route path="/wholesale"><WholesalePage lang={lang}/></Route>
        <Route path="/cart"><CartPage lang={lang}/></Route>
        <Route path="/checkout"><CheckoutPage lang={lang}/></Route>
        <Route path="/payment/:result"><PaymentResult lang={lang}/></Route>
        <Route path="/tracking"><TrackingPage lang={lang}/></Route>
        <Route path="/user-portal"><UserPortalPage lang={lang}/></Route>
        <Route path="/my-orders"><MyOrdersPage lang={lang}/></Route>
        <Route path="/my-favorites"><MyFavoritesPage lang={lang}/></Route>
        <Route path="/policies"><PoliciesPage lang={lang} settings={settings}/></Route>
        <Route path="/admin"><AdminPage lang={lang}/></Route>
        <Route component={NotFound}/>
      </Switch>
    </main>
    <Footer lang={lang} settings={settings}/>
    {!path.startsWith('/admin') && <SafeAssistantWidget lang={lang} floating={!['/cart','/checkout'].includes(path)}/>}
    {settings?.whatsapp&&<a className="fixed bottom-5 end-5 z-20 bg-[#5B0D1E] text-white rounded-full px-5 py-3 shadow-lg text-xs font-semibold transition-transform hover:-translate-y-1" href={`https://wa.me/${settings.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" data-testid="link-whatsapp">WhatsApp <ArrowUpRight size={14} className="inline ms-1"/></a>}
  </div>;
}

function Picture({src,alt,className=''}:{src:string;alt:string;className?:string}) { return <img src={src} alt={alt} loading="lazy" className={className}/>; }
function ProductCard({product,lang,index=0,isFavorite=false}:{product:Product;lang:Lang;index?:number;isFavorite?:boolean}) {
  const c=copy[lang], title=lang==='ar'?(product.titleAr||product.title):product.title;
  const [,navigate]=useLocation();
  const add=useUpdateCart({mutation:{onSuccess:cart=>{
    queryClient.setQueryData(getGetCartQueryKey(),cart);
    navigate('/checkout');
  }}});
  const sold=!product.available || product.stock<=0;
   return <article className={`group reveal delay-${Math.min(index+1,3)}`}>
     <div className="relative overflow-hidden rounded-[24px] bg-[#f8e8ec] aspect-[.94]">
       <Link href={`/products/${product.handle}`} className="block h-full w-full relative" data-testid={`link-product-${product.id}`}>
         <Picture src={product.imageUrl||images.cookie} alt={title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"/>
         <span className="absolute top-4 start-4 rounded-full bg-[#fffaf8]/90 backdrop-blur px-3 py-1.5 text-[9px] font-bold text-[#5B0D1E] tracking-wide">{sold?c.sold:c.frozen}</span>
       </Link>
       <FavoriteButton productId={product.id} isFavorite={isFavorite} lang={lang} compact className="absolute top-3 end-3 z-10 shadow-sm"/>
     </div>
    <div className="pt-4 flex justify-between gap-3 items-start">
      <div><Link href={`/products/${product.handle}`} className="font-display text-[22px] leading-tight text-[#5B0D1E] hover:text-[#9d5367]">{title}</Link><p className="mt-1 text-[11px] text-[#896a71]">{product.pieces} {lang==='ar'?'قطعة':'pieces'} · {c.frozen}</p><p className="mt-3 font-semibold text-sm text-[#5B0D1E]">{product.currency||'KWD'} {product.price.toFixed(3)}</p></div>
      <button disabled={sold||add.isPending} onClick={()=>product.variantId&&add.mutate({data:{action:'add',variantId:product.variantId,quantity:1}})} aria-label={sold?c.sold:c.add} className="mt-1 h-10 w-10 rounded-full bg-[#FFD6E5] text-[#5B0D1E] grid place-items-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#f7b9d0] transition-colors" data-testid={`button-add-${product.id}`}><Plus size={17}/></button>
    </div>
    {add.isError && <p role="alert" className="mt-3 text-xs text-red-700">{lang==='ar'?'تعذرت الإضافة. تحققي من التوفر وحاولي مجدداً.':'Could not add this item. Check availability and retry.'}</p>}
    {add.isSuccess && <p role="status" className="mt-3 text-xs text-[#5B0D1E]">{lang==='ar'?'تمت الإضافة إلى السلة.':'Added to your bag.'}</p>}
  </article>;
}
function ProductGrid({lang,products}:{lang:Lang;products:Product[]}) {
  const {user,loading}=useAuth();
  const favorites=useListAccountFavorites({query:{queryKey:getListAccountFavoritesQueryKey(),enabled:Boolean(user&&!loading)}});
  const favoriteIds=new Set((favorites.data??[]).map(item=>item.productId));
  return <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-7 gap-y-10">{products.map((p,i)=><ProductCard product={p} lang={lang} key={p.id} index={i} isFavorite={favoriteIds.has(p.id)}/>)}</div>;
}
function LoadingBlock({lang}:{lang:Lang}) { return <div className="container-wide py-24"><div className="animate-pulse grid md:grid-cols-3 gap-6">{[0,1,2].map(i=><div key={i} className="h-[360px] rounded-3xl bg-[#f3e4e8]"/> )}</div><p className="text-center text-xs text-[#896a71] mt-6">{copy[lang].loading}</p></div>; }
function ErrorNotice({onRetry,lang}:{onRetry:()=>void;lang:Lang}) { return <div className="card-surface max-w-xl mx-auto p-8 text-center"><CircleHelp className="mx-auto text-[#9d5367] mb-4"/><p className="text-sm text-[#5B0D1E]">{lang==='ar'?'تعذر تحميل المحتوى.':'We couldn’t load this just now.'}</p><button onClick={onRetry} className="btn-outline mt-4"><RefreshCw size={14}/>{copy[lang].retry}</button></div>; }

function HomePage({lang,settings,store}:{lang:Lang;settings?:StoreSettings;store?:{checkoutReady:boolean;launchMessage:string;shopCurrency:string}}) {
  const c=copy[lang], products=useListProducts({query:{queryKey:getListProductsQueryKey(),refetchInterval:60000}});
  const shown=products.data?.slice(0,2)||[];
  return <>
    <section className="relative overflow-hidden bg-[#f8e8ec]">
      <div className="container-wide min-h-[600px] lg:min-h-[680px] grid lg:grid-cols-[1fr_.94fr] items-center gap-8 py-14 lg:py-16">
        <div className="relative z-10 max-w-[590px]">
          <div className="eyebrow mb-5 reveal">{c.frozen}</div>
          <h1 className="serif text-[clamp(48px,7vw,88px)] leading-[.99] tracking-[-.045em] text-[#5B0D1E] reveal delay-1">{lang==='ar'?(settings?.heroTitleAr||c.hero):(settings?.heroTitleEn||c.hero)}</h1>
          <p className="mt-6 max-w-[440px] text-[14px] leading-7 text-[#76525c] reveal delay-2">{lang==='ar'?(settings?.heroTextAr||c.heroText):(settings?.heroTextEn||c.heroText)}</p>
          <div className="mt-8 flex flex-wrap gap-3 reveal delay-3"><Link href="/products" className="btn-primary">{c.shop}<ArrowRight size={15}/></Link><Link href="/baking" className="btn-outline">{c.learn}<ArrowUpRight size={14}/></Link></div>
          <div className="mt-10 flex items-center gap-3 text-[10px] font-semibold tracking-wide text-[#8e6871]"><Snowflake size={15} className="text-[#a35168]"/>{c.pieces}</div>
        </div>
        <div className="relative min-h-[400px] lg:min-h-[525px] flex items-center justify-center">
          <div className="absolute w-[min(90vw,460px)] aspect-square rounded-full bg-[#FFD6E5] opacity-70"/>
          <div className="absolute top-[5%] end-[5%] text-[#bb7889] opacity-70 rotate-12"><Sparkles size={34}/></div>
          <Picture src={settings?.packageImage||images.package} alt="Amore Cookies frozen dough package" className="relative z-[1] w-[72%] max-w-[420px] drop-shadow-[0_26px_24px_rgba(91,13,30,.18)] -rotate-3 reveal delay-1"/>
          <Picture src={settings?.bakerImage||images.mascot} alt="Amore baker mascot" className="absolute z-[2] bottom-0 end-[0%] w-[35%] max-w-[190px] rounded-full mix-blend-multiply reveal delay-3"/>
          <div className="absolute bottom-[11%] start-[1%] rotate-[-7deg] z-[2] bg-[#fffaf8] px-5 py-4 rounded-[20px] soft-shadow"><div className="font-display italic text-[#5B0D1E] text-[22px]">Amore</div><div className="text-[8px] tracking-[.26em] text-[#a35168] mt-1">A SMALL BAKERY FEELING</div></div>
        </div>
      </div>
    </section>
    <section className="section-pad container-wide">
      <div className="flex items-end justify-between gap-5 mb-9"><div><span className="eyebrow">{c.products}</span><h2 className="serif text-4xl md:text-5xl text-[#5B0D1E] mt-3">{c.seeAll}</h2></div><Link href="/products" className="btn-outline hidden sm:inline-flex">{c.all}<ArrowRight size={14}/></Link></div>
      {products.isLoading?<LoadingBlock lang={lang}/>:products.isError?<ErrorNotice lang={lang} onRetry={()=>products.refetch()}/>:shown.length?<ProductGrid lang={lang} products={shown}/>:<EmptyState text={c.noProducts}/>}
      <Link href="/products" className="btn-outline sm:hidden mt-8">{c.all}<ArrowRight size={14}/></Link>
    </section>
    <section className="bg-[#5B0D1E] text-[#fff6f3] overflow-hidden">
      <div className="container-wide py-20 grid md:grid-cols-[1fr_.7fr] gap-12 items-center">
        <div><span className="eyebrow text-[#f4b8cb]">{c.about}</span><h2 className="serif md:text-6xl mt-4 max-w-[610px] pl-[10px] pr-[10px] pt-[10px] pb-[10px] text-[38px]">{lang==='ar'?(settings?.aboutAr||c.storyTitle):(settings?.aboutEn||c.storyTitle)}</h2><p className="mt-6 max-w-[500px] text-sm leading-7 text-[#f0cdd5]">{lang==='ar'?(settings?.aboutAr||c.story):(settings?.aboutEn||c.story)}</p><Link href="/about" className="inline-flex items-center gap-2 mt-7 text-xs font-bold border-b border-[#f4b8cb] pb-2 text-[#fff6f3]">{c.about}<ArrowRight size={14}/></Link></div>
        <div className="relative"><div className="absolute inset-4 rounded-[50%] bg-[#8f3048] rotate-6"/><Picture src={settings?.cookieImage||images.cookie} alt="Amore cookie" className="relative rounded-[44%_56%_48%_52%/48%_44%_56%_52%] w-full aspect-square object-cover border-[10px] border-[#6d1930] rotate-2"/></div>
      </div>
    </section>
    <section className="section-pad container-wide grid lg:grid-cols-[.7fr_1.3fr] gap-12 items-center">
      <div><span className="eyebrow">{c.baking}</span><h2 className="serif text-5xl text-[#5B0D1E] mt-3">{c.ritual}</h2><p className="mt-5 text-sm leading-7 text-[#795963]">{c.ritualText}</p><Link href="/baking" className="btn-primary mt-7">{c.learn}<ArrowRight size={15}/></Link></div>
      <BakingSteps lang={lang} settings={settings}/>
    </section>
    <section className="bg-[#FFD6E5]">
      <div className="container-wide py-16 flex flex-col md:flex-row items-center justify-between gap-8">
        <div><span className="eyebrow">{c.cafes}</span><h2 className="serif text-4xl md:text-5xl text-[#5B0D1E] mt-3">{c.wholesale}</h2><p className="mt-4 max-w-xl text-sm leading-7 text-[#76525c]">{c.wholesaleText}</p></div>
        <Link href="/wholesale" className="btn-primary shrink-0">{c.inquiry}<ArrowUpRight size={15}/></Link>
      </div>
    </section>
    <section className="container-wide py-12 flex flex-wrap gap-3 justify-center text-[10px] tracking-wide text-[#87666e]"><span className="rounded-full bg-[#f7eaed] px-4 py-2">Frozen cookie dough</span><span className="rounded-full bg-[#f7eaed] px-4 py-2">Ready to bake</span><span className="rounded-full bg-[#f7eaed] px-4 py-2">12 pieces per bag</span></section>
  </>;
}
function EmptyState({text}:{text:string}) {return <div className="card-surface p-12 text-center text-sm text-[#8b6870]"><Cookie className="mx-auto mb-4 text-[#bc8794]"/>{text}</div>}
function BakingSteps({lang,settings}:{lang:Lang;settings?:StoreSettings}) {
  const c=copy[lang];const defaults=[{titleEn:c.step1,titleAr:c.step1,title:c.step1,textEn:c.step1t,textAr:c.step1t,text:c.step1t},{titleEn:c.step2,titleAr:c.step2,title:c.step2,textEn:c.step2t,textAr:c.step2t,text:c.step2t},{titleEn:c.step3,titleAr:c.step3,title:c.step3,textEn:c.step3t,textAr:c.step3t,text:c.step3t}];
  const steps=settings?.bakingSteps?.length?settings.bakingSteps:defaults;
  return <div className="grid gap-3">{steps.map((s,i)=><div key={i} className="flex gap-5 items-center bg-[#fffdfa] border border-[#f0e1e4] p-5 rounded-2xl"><div className="w-12 h-12 shrink-0 rounded-full bg-[#FFD6E5] text-[#5B0D1E] grid place-items-center font-display text-xl">{String(i+1).padStart(2,'0')}</div><div><h3 className="font-semibold text-sm text-[#5B0D1E]">{lang==='ar'?s.titleAr:s.titleEn}</h3><p className="text-xs text-[#896a71] mt-1 leading-5">{lang==='ar'?s.textAr:s.textEn}</p></div><Flame className="ms-auto text-[#c8786a] shrink-0" size={17}/></div>)}</div>;
}
function ProductsPage({lang}:{lang:Lang}) {const q=useListProducts({query:{queryKey:getListProductsQueryKey(),refetchInterval:60000}});const c=copy[lang];return <PageIntro eyebrow={c.products} title={c.all}>{q.isLoading?<LoadingBlock lang={lang}/>:q.isError?<ErrorNotice lang={lang} onRetry={()=>q.refetch()}/>:q.data?.length?<ProductGrid lang={lang} products={q.data}/>:<EmptyState text={c.noProducts}/>}</PageIntro>}
function PageIntro({eyebrow,title,children}:{eyebrow:string;title:string;children:ReactNode}) {return <div className="container-wide py-14 md:py-20"><div className="mb-10"><span className="eyebrow">{eyebrow}</span><h1 className="serif text-5xl md:text-6xl text-[#5B0D1E] mt-3">{title}</h1></div>{children}</div>}
function ProductDetail({lang,settings}:{lang:Lang;settings?:StoreSettings}) {
  const [,params]=useRoute('/products/:handle');const handle=params?.handle||'';const q=useGetProduct(handle,{query:{queryKey:getGetProductQueryKey(handle),enabled:!!handle,refetchInterval:60000}});const p=q.data;const c=copy[lang];
  const [,navigate]=useLocation();
  const {user,loading:authLoading}=useAuth();
  const favorites=useListAccountFavorites({query:{queryKey:getListAccountFavoritesQueryKey(),enabled:Boolean(user&&!authLoading)}});
  const [quantity,setQuantity]=useState('1');
  const [displayCurrency,setDisplayCurrency]=useState<GetCurrencyConversionParams['currency']|'KWD'>('KWD');
  const conversionCurrency: GetCurrencyConversionParams['currency']=displayCurrency==='KWD'?'USD':displayCurrency;
  const conversion=useGetCurrencyConversion({amount:p?Math.round(p.price*1000)/1000:0.001,currency:conversionCurrency},{query:{
    enabled:Boolean(p&&displayCurrency!=='KWD'&&p.currency==='KWD'),
    staleTime:24*60*60*1000,
    gcTime:25*60*60*1000,
  }});
  const add=useUpdateCart({mutation:{onSuccess:cart=>{
    queryClient.setQueryData(getGetCartQueryKey(),cart);
    navigate('/checkout');
  }}});
  useEffect(()=>{setQuantity('1');setDisplayCurrency('KWD');add.reset();},[handle]);
  if(q.isLoading)return <LoadingBlock lang={lang}/>;if(q.isError)return <div className="container-wide py-20"><ErrorNotice lang={lang} onRetry={()=>q.refetch()}/></div>;
  if(!p)return <div className="container-wide py-20"><EmptyState text={c.noProducts}/></div>;
  const sold=!p.available||p.stock<=0;
  const priceCurrency=p.currency||'KWD';
  const selectedQuantity=Number(quantity);
  const maxQuantity=Math.min(p.stock,1000);
  const validQuantity=Number.isInteger(selectedQuantity)&&selectedQuantity>=1&&selectedQuantity<=maxQuantity;
  const englishIngredients=p.ingredients.trim();
  const arabicIngredients=p.ingredientsAr.trim();
  const ingredientsText=lang==='ar'?(arabicIngredients||englishIngredients):(englishIngredients||arabicIngredients);
  const isFavorite=Boolean(favorites.data?.some(item=>item.productId===p.id));
  return <div className="container-wide py-12 md:py-20"><Link href="/products" className="text-xs text-[#8b6870] inline-flex gap-2 items-center mb-8"><ArrowLeft size={14}/>{c.browse}</Link><div className="grid md:grid-cols-2 gap-10 lg:gap-20 items-center">
    <div className="rounded-[28px] overflow-hidden bg-[#f8e8ec] aspect-square"><Picture src={p.imageUrl||images.cookie} alt={lang==='ar'?p.titleAr:p.title} className="w-full h-full object-cover"/></div>
     <div><span className="eyebrow">{c.frozen}</span><h1 className="serif text-5xl md:text-6xl text-[#5B0D1E] mt-3">{lang==='ar'?(p.titleAr||p.title):p.title}</h1><FavoriteButton productId={p.id} isFavorite={isFavorite} lang={lang} className="mt-4"/><p className="mt-5 leading-7 text-sm text-[#795963]">{lang==='ar'?(p.descriptionAr||p.description):(p.description||p.descriptionAr)}</p><div className="flex gap-5 mt-6 text-[11px] text-[#8b6870]"><span>{p.pieces} {c.piece}</span><span>{lang==='ar'?'مجمدة · جاهزة للخبز':'Frozen · Ready to bake'}</span></div>
    {priceCurrency==='KWD'?<div className="mt-7 rounded-2xl border border-[#efdee2] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className="font-semibold text-xl text-[#5B0D1E]" dir="ltr" data-testid="product-display-price">{displayCurrency==='KWD'?`${p.price.toFixed(3)} KWD`:conversion.data&&!conversion.isError?`${conversion.data.amount.toFixed(2)} ${displayCurrency}`:`— ${displayCurrency}`}</strong>
        <label htmlFor="product-display-currency" className="text-xs font-medium text-[#795963]">{c.displayCurrency}</label>
        <select id="product-display-currency" className="field w-auto min-w-24 py-2" value={displayCurrency} onChange={event=>setDisplayCurrency(event.target.value as GetCurrencyConversionParams['currency']|'KWD')}>
          {(['KWD','USD','EUR','GBP','SAR'] as const).map(currency=><option key={currency} value={currency}>{currency}</option>)}
        </select>
      </div>
      {displayCurrency!=='KWD'&&<div className="mt-3 text-[11px] leading-5 text-[#896a71]">
        {conversion.isLoading&&<p role="status">{c.conversionLoading}</p>}
        {conversion.isError&&<p role="alert" className="text-red-700">{c.conversionError}</p>}
        {conversion.data&&<p id="currency-conversion-note">{c.conversionNote}</p>}
      </div>}
    </div>:<div className="mt-7 font-semibold text-xl text-[#5B0D1E]">{priceCurrency} {p.price.toFixed(3)}</div>}
    <div className="mt-5 p-4 rounded-xl bg-[#f8e8ec] text-[11px] text-[#7b4d5a] flex gap-3"><Snowflake size={17}/>{lang==='ar'?(settings?.storageAr||c.storage):(settings?.storageEn||c.storage)}</div>
    <form className="mt-5" onSubmit={event=>{
      event.preventDefault();
      if(sold||add.isPending||!validQuantity||!p.variantId)return;
      add.mutate({data:{action:'add',variantId:p.variantId,quantity:selectedQuantity}});
    }}>
      <label htmlFor="product-quantity" className="field-label">{lang==='ar'?'الكمية (عدد الأكياس)':'Quantity (bags)'}</label>
      <div className="flex flex-wrap items-center gap-4 mt-2">
        <div className="inline-flex items-center rounded-full border border-[#e9d2d8] overflow-hidden">
          <button type="button" aria-label={lang==='ar'?'تقليل الكمية':'Decrease quantity'} disabled={sold||add.isPending||!validQuantity||selectedQuantity<=1} onClick={()=>setQuantity(String(selectedQuantity-1))} className="h-11 w-11 grid place-items-center text-[#5B0D1E] disabled:opacity-30"><Minus size={16}/></button>
          <input id="product-quantity" name="quantity" type="number" inputMode="numeric" min={1} max={Math.max(1,maxQuantity)} step={1} required value={quantity} onChange={event=>setQuantity(event.target.value)} disabled={sold||add.isPending} aria-describedby="product-quantity-help" aria-invalid={!sold&&!validQuantity} className="w-16 h-11 bg-transparent text-center text-sm text-[#5B0D1E] outline-none focus:ring-2 focus:ring-inset focus:ring-[#a35168]" data-testid="input-product-quantity"/>
          <button type="button" aria-label={lang==='ar'?'زيادة الكمية':'Increase quantity'} disabled={sold||add.isPending||!validQuantity||selectedQuantity>=maxQuantity} onClick={()=>setQuantity(String(selectedQuantity+1))} className="h-11 w-11 grid place-items-center text-[#5B0D1E] disabled:opacity-30"><Plus size={16}/></button>
        </div>
        <p id="product-quantity-help" className="text-xs text-[#896a71]">{lang==='ar'?`المتوفر: ${p.stock} كيس`:`${p.stock} bags available`}</p>
      </div>
      {!sold&&!validQuantity&&<p role="alert" className="mt-2 text-xs text-red-700">{lang==='ar'?`اختاري عدداً صحيحاً من 1 إلى ${maxQuantity}.`:`Choose a whole number from 1 to ${maxQuantity}.`}</p>}
      <div className="mt-4 flex flex-wrap gap-3"><button type="submit" className="btn-primary flex-1 disabled:opacity-50" disabled={sold||add.isPending||!validQuantity} data-testid="button-add-product">{sold?c.sold:add.isPending?c.loading:c.add}<Plus size={15}/></button><Link href="/cart" className="btn-outline">{c.bag}<ShoppingBag size={15}/></Link></div>
      {add.isError&&<p role="alert" className="mt-3 text-xs text-red-700">{lang==='ar'?'تعذرت الإضافة. تحققي من الكمية المتوفرة وما أضفتِه مسبقاً للسلة، ثم حاولي مجدداً.':'Could not add this quantity. Check available stock and items already in your bag, then retry.'}</p>}
    </form>
    {ingredientsText&&<div className="mt-8 border-t border-[#efdee2] pt-6"><h2 className="font-semibold text-sm text-[#5B0D1E]">{c.ingredients}</h2><p className="mt-2 text-xs leading-6 text-[#795963]">{ingredientsText}</p></div>}
    <div className="mt-6"><h2 className="font-semibold text-sm text-[#5B0D1E]">{c.storage}</h2><BakingSteps lang={lang} settings={settings}/></div>
    </div></div></div>;
}
function AboutPage({lang,settings}:{lang:Lang;settings?:StoreSettings}) {const c=copy[lang];return <div className="container-wide py-14 md:py-24"><div className="grid md:grid-cols-[1fr_.8fr] gap-10 items-center"><div><span className="eyebrow">{c.about}</span><h1 className="serif md:text-7xl text-[#5B0D1E] mt-4 pl-[10px] pr-[10px] pt-[10px] pb-[10px] text-right font-light text-[38px]">{lang==='ar'?(settings?.aboutAr||c.storyTitle):(settings?.aboutEn||c.storyTitle)}</h1><p className="mt-7 text-sm leading-8 text-[#795963]">{lang==='ar'?(settings?.aboutAr||c.story):(settings?.aboutEn||c.story)}</p></div><div className="relative rounded-[48%_52%_45%_55%] overflow-hidden bg-[#FFD6E5] p-8"><Picture src={settings?.bakerImage||images.mascot} alt="Amore baker" className="w-full rounded-full mix-blend-multiply"/></div></div><div className="mt-20 grid sm:grid-cols-3 gap-4">{[['01',c.frozen],['02',c.pieces],['03',c.ritual]].map(x=><div key={x[0]} className="p-6 bg-[#f8e8ec] rounded-2xl"><div className="font-display text-3xl text-[#a35168]">{x[0]}</div><p className="text-sm mt-3 text-[#5B0D1E]">{x[1]}</p></div>)}</div></div>}
function BakingPage({lang,settings}:{lang:Lang;settings?:StoreSettings}) {return <PageIntro eyebrow={copy[lang].baking} title={copy[lang].ritual}><p className="max-w-2xl text-sm leading-7 text-[#795963] mb-10">{copy[lang].ritualText}</p><BakingSteps lang={lang} settings={settings}/><div className="mt-12 grid md:grid-cols-2 gap-8 items-center"><Picture src={settings?.cookieImage||images.cookie} alt="Amore cookie" className="w-full max-h-[420px] object-cover rounded-[28px]"/><div className="card-surface p-8"><Snowflake className="text-[#a35168]"/><h2 className="serif text-3xl text-[#5B0D1E] mt-4">{copy[lang].frozen}</h2><p className="text-sm leading-7 text-[#795963] mt-3">{lang==='ar'?(settings?.storageAr||''):(settings?.storageEn||'')}</p></div></div></PageIntro>}
function Footer({lang,settings}:{lang:Lang;settings?:StoreSettings}) {
  const c=copy[lang];
  return <footer className="bg-[#4a0b19] text-[#fae9ed]">
    <div className="container-wide py-12 grid md:grid-cols-[1fr_auto] gap-8 items-end">
      <div><div className="font-display italic text-4xl">Amore Cookies</div><p className="text-xs text-[#e9bdc8] mt-3">{c.made}</p></div>
      <div className="flex flex-wrap gap-x-6 gap-y-3 text-[10px] text-[#f5d9df]">
        <Link href="/products">{c.products}</Link><Link href="/wholesale">{c.cafes}</Link>
        <Link href="/tracking">{c.tracking}</Link><Link href="/policies">{c.policies}</Link><Link href="/admin">{c.admin}</Link>
      </div>
      {(settings?.email || settings?.phone) && <div className="md:col-span-2 flex flex-wrap gap-5 text-xs">
        {settings.email && <a href={`mailto:${settings.email}`}>{settings.email}</a>}
        {settings.phone && <a dir="ltr" href={`tel:${settings.phone.replace(/[^\d+]/g,'')}`}>{settings.phone}</a>}
      </div>}
      <div className="md:col-span-2 border-t border-[#763246] pt-5 flex justify-between text-[9px] tracking-wide text-[#d8aab6]">
        <span>{lang==='ar'?'أموري كوكيز · الكويت':'Amore Cookies · Kuwait'}</span>
        <span>{lang==='ar'?settings?.hoursAr:settings?.hoursEn}</span>
      </div>
    </div>
  </footer>;
}

function CartConvertedAmount({amount,currency,lang,testId}:{amount:number;currency:GetCurrencyConversionParams['currency'];lang:Lang;testId:string}) {
  const c=copy[lang], safeAmount=Math.max(0.001,Math.round(amount*1000)/1000);
  const conversion=useGetCurrencyConversion({amount:safeAmount,currency},{query:{
    enabled:amount>0,retry:false,staleTime:86_400_000,
  }});
  if(amount<=0)return <span data-testid={testId}>0.00 {currency}</span>;
  if(conversion.isError)return <span data-testid={testId} title={c.conversionError}>— {currency}</span>;
  if(!conversion.data)return <span data-testid={testId}>… {currency}</span>;
  return <span data-testid={testId}>{conversion.data.amount.toFixed(2)} {currency}</span>;
}

function CurrencyRateDetails({currency,lang,testId}:{currency:GetCurrencyConversionParams['currency'];lang:Lang;testId:string}) {
  const c=copy[lang];
  const rate=useGetCurrencyConversion({amount:1,currency},{query:{
    retry:false,staleTime:86_400_000,
  }});
  if(rate.isError)return <p role="alert" className="text-red-700">{c.conversionError}</p>;
  if(!rate.data)return <p role="status">{c.conversionLoading}</p>;
  const updatedDates=[...new Set(rate.data.sources.map(source=>source.date))].join(' · ');
  return <>
    <p data-testid={`${testId}-rate`}>{c.rateLabel}: 1 KWD ≈ {rate.data.amount.toFixed(2)} {currency}</p>
    <p data-testid={`${testId}-rate-updated`}>{c.rateUpdated}: {updatedDates}</p>
    <p data-testid={`${testId}-rate-sources`}>{c.rateSources}: {rate.data.sources.map(source=>source.name).join(' · ')}</p>
  </>;
}

function CartPage({lang}:{lang:Lang}) {
  const c=copy[lang], q=useGetCart({query:{queryKey:getGetCartQueryKey(),refetchInterval:45000}}), cart=q.data;
  const mutation=useUpdateCart({mutation:{onSuccess:data=>queryClient.setQueryData(getGetCartQueryKey(),data)}});
  const [discountCode,setDiscountCode]=useState('');
  const [displayCurrency,setDisplayCurrency]=useDisplayCurrency();
  const paymentNotice=new URLSearchParams(window.location.search).get('payment');
  const conversionCurrency: GetCurrencyConversionParams['currency']=displayCurrency==='KWD'?'USD':displayCurrency;
  const conversion=useGetCurrencyConversion({
    amount:Math.max(0.001,Math.round((cart?.total??0)*1000)/1000),currency:conversionCurrency,
  },{query:{enabled:Boolean(cart&&displayCurrency!=='KWD'&&cart.total>0),retry:false,staleTime:86_400_000}});
  const update=(lineId:string,quantity:number)=>mutation.mutate({data:{action:quantity<=0?'remove':'update',lineId,quantity:Math.max(1,quantity)}});
  if(q.isLoading)return <LoadingBlock lang={lang}/>;
  if(q.isError)return <div className="container-wide py-20"><ErrorNotice lang={lang} onRetry={()=>q.refetch()}/></div>;
  if(!cart?.lines.length)return <div className="container-wide py-24 text-center"><div className="mx-auto w-24 h-24 bg-[#FFD6E5] rounded-full grid place-items-center text-[#5B0D1E]"><ShoppingBag size={30}/></div><h1 className="serif text-4xl text-[#5B0D1E] mt-6">{c.empty}</h1><Link href="/products" className="btn-primary mt-6">{c.continue}<ArrowRight size={15}/></Link></div>;
   return <div className="container-wide py-14 md:py-20"><span className="eyebrow">{c.bag}</span><h1 className="serif text-5xl text-[#5B0D1E] mt-3">{c.review}</h1>
       {(paymentNotice==='cancelled'||paymentNotice==='failed')&&<p className="mt-5 rounded-xl bg-[#fff1f3] border border-[#ead5da] p-4 text-sm leading-6 text-[#763246]" role="status" data-testid="stripe-payment-notice">{lang==='ar'?'لم يكتمل الدفع، وتم الاحتفاظ بمنتجاتك في السلة. يمكنك المحاولة مرة أخرى.':'Payment was not completed. Your items are still in your cart; you can try again.'}</p>}
      <div className="mt-6 rounded-2xl bg-[#f8e8ec] border border-[#ead5da] p-5 flex flex-wrap items-center justify-between gap-4 text-[#5B0D1E]" role="status" aria-live="polite" aria-atomic="true" data-testid="cart-total-summary">
        <span className="font-semibold text-sm">{c.total}</span>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label htmlFor="cart-display-currency" className="text-xs font-medium text-[#795963]">{c.displayCurrency}</label>
           <select id="cart-display-currency" data-testid="cart-display-currency" className="field w-auto min-w-24 py-2" value={displayCurrency} onChange={event=>setDisplayCurrency(event.target.value as DisplayCurrency)}>
             {DISPLAY_CURRENCIES.map(currency=><option key={currency} value={currency}>{currency}</option>)}
          </select>
          <strong className="text-2xl font-semibold tabular-nums" dir="ltr" data-testid="cart-total-display-price">
            {displayCurrency==='KWD'?`${cart.total.toFixed(3)} KWD`:cart.total<=0?`0.00 ${displayCurrency}`:!conversion.data?`${cart.total.toFixed(3)} KWD`:`${conversion.data.amount.toFixed(2)} ${displayCurrency}`}
          </strong>
           {displayCurrency!=='KWD'&&<span className="text-xs text-[#795963]" dir="ltr" data-testid="cart-total-original-kwd">{cart.total.toFixed(3)} KWD</span>}
        </div>
      </div>
      {displayCurrency!=='KWD'&&<div className="mt-2 text-[11px] leading-5 text-[#896a71]">
        {conversion.isLoading&&<p role="status">{c.conversionLoading}</p>}
        {conversion.isError&&<p role="alert" className="text-red-700">{c.conversionError}</p>}
        <p>{c.conversionNote}</p>
        <p>{c.originalKwd}: {cart.total.toFixed(3)} KWD</p>
          {conversion.data&&<CurrencyRateDetails currency={conversionCurrency} lang={lang} testId="cart"/>}
      </div>}
     <p className="mt-3 text-[11px] text-[#896a71]">{c.shipping}</p>
     <p className="mt-4 text-xs text-[#896a71] max-w-2xl">{c.checkoutNote}</p>
     <div className="grid lg:grid-cols-[1.3fr_.7fr] gap-9 mt-10 items-start"><div className="grid gap-3">{cart.lines.map(line=>{
       const lineTotal=line.price*line.quantity;
       return <div key={line.id} className="card-surface p-4 flex gap-4 items-center"><Link href={`/products/${line.handle}`} className="w-24 h-24 rounded-xl bg-[#f8e8ec] overflow-hidden shrink-0"><Picture src={line.imageUrl||images.cookie} alt={line.title} className="w-full h-full object-cover"/></Link><div className="min-w-0 flex-1"><Link href={`/products/${line.handle}`} className="font-display text-lg text-[#5B0D1E]">{line.title}</Link><p className="text-[11px] text-[#896a71] mt-1">{line.price.toFixed(3)} KWD</p>{displayCurrency!=='KWD'&&<p className="text-[10px] text-[#896a71] mt-1"><CartConvertedAmount amount={line.price} currency={displayCurrency} lang={lang} testId="cart-line-unit-converted"/></p>}<div className="flex items-center gap-2 mt-3"><button aria-label={lang==='ar'?'تقليل الكمية':'Decrease quantity'} className="w-7 h-7 rounded-full border border-[#ead5da] grid place-items-center" onClick={()=>update(line.id,line.quantity-1)}><Minus size={12}/></button><span className="text-xs w-5 text-center">{line.quantity}</span><button aria-label={lang==='ar'?'زيادة الكمية':'Increase quantity'} className="w-7 h-7 rounded-full border border-[#ead5da] grid place-items-center" onClick={()=>update(line.id,line.quantity+1)}><Plus size={12}/></button></div></div><div className="text-end"><strong className="text-sm text-[#5B0D1E]">{lineTotal.toFixed(3)} KWD</strong>{displayCurrency!=='KWD'&&<p className="text-[10px] text-[#896a71] mt-1"><CartConvertedAmount amount={lineTotal} currency={displayCurrency} lang={lang} testId="cart-line-total-converted"/></p>}<button className="block ms-auto mt-3 text-[10px] text-[#9d5367] underline" onClick={()=>mutation.mutate({data:{action:'remove',lineId:line.id}})}>{lang==='ar'?'إزالة':'Remove'}</button></div></div>;
     })}</div>
      <aside className="card-surface p-6 sticky top-24"><h2 className="font-display text-2xl text-[#5B0D1E]">{c.total}</h2><form className="mt-5 flex gap-2" onSubmit={e=>{e.preventDefault();if(discountCode.trim())mutation.mutate({data:{action:'discount',code:discountCode.trim()}})}}><input aria-label={c.promo} className="field min-w-0" value={discountCode} onChange={e=>setDiscountCode(e.target.value)} placeholder={c.promo}/><button disabled={!discountCode.trim()||mutation.isPending} className="btn-outline px-4 shrink-0 disabled:opacity-50">{c.apply}</button></form>{cart.discountCodes.map(item=><p key={item.code} className={`mt-2 text-[10px] ${item.applicable?'text-[#557449]':'text-[#a34657]'}`}>{item.code} · {item.applicable?(lang==='ar'?'تم تطبيق الرمز':'Code applied'):(lang==='ar'?'الرمز غير قابل للتطبيق':'Code not applicable')}</p>)}{mutation.isError&&<p className="mt-2 text-[10px] text-red-700">{lang==='ar'?'تعذر تحديث السلة. حاولي مجدداً.':'The bag could not be updated. Please retry.'}</p>}<div className="flex justify-between mt-6 text-xs"><span>{c.subtotal}</span><span>{cart.subtotal.toFixed(3)} KWD</span></div><div className="flex justify-between mt-3 text-xs text-[#896a71]"><span>{c.discount}</span><span>{cart.discount.toFixed(3)} KWD</span></div><div className="border-t border-[#efdee2] mt-5 pt-5 flex justify-between font-semibold text-sm"><span>{c.total}</span><span>{cart.total.toFixed(3)} KWD</span></div>{displayCurrency!=='KWD'&&<p className="mt-2 text-xs text-[#795963]" data-testid="cart-aside-converted-total">{c.displayCurrency}: {conversion.isError?`— ${displayCurrency}`:conversion.data?`${conversion.data.amount.toFixed(2)} ${displayCurrency}`:c.conversionLoading}</p>}<p className="text-[10px] leading-5 mt-4 text-[#896a71]">{c.shipping}</p>{!cart.checkoutReady&&<p className="mt-4 rounded-xl bg-[#fff1f3] p-3 text-[10px] leading-5 text-[#763246]">{c.shopBlocked}</p>}<Link href="/checkout" className={`btn-primary w-full mt-5 ${!cart.checkoutReady?'opacity-60':''}`}>{c.reviewBefore}<ArrowRight size={14}/></Link></aside></div>
  </div>;
}
function isKuwaitCheckoutPhone(value: string) {
  const normalized = value.normalize('NFKC')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
  if (!/^\+?[\d ()-]+$/.test(normalized)) return false;
  const digits = normalized.replace(/\D/g, '').replace(/^00/, '');
  return digits.length === 8 || (digits.length === 11 && digits.startsWith('965'));
}

function CheckoutPage({lang}:{lang:Lang}) {
  const c=copy[lang], cartQ=useGetCart({query:{queryKey:getGetCartQueryKey()}}), cart=cartQ.data;
  const start=useStartCheckout();const [phone,setPhone]=useState(''),[note,setNote]=useState(''),[phoneError,setPhoneError]=useState('');
  const [displayCurrency,setDisplayCurrency]=useDisplayCurrency();
  const [address,setAddress]=useState({area:'',block:'',street:'',house:''});
  const [requestKey]=useState(()=>crypto.randomUUID());
  const availability=useGetPaymentAvailability({query:{refetchInterval:60000}});
  const stripeAvailable=availability.data?.stripeTestEnabled===true;
  const stripeReady=Boolean(stripeAvailable&&typeof availability.data?.shippingFils==='number'&&cart?.checkoutReady&&cart.lines.length);
   const ready=stripeReady;
  const subtotal=cart?.lines.reduce((sum,line)=>sum+Math.round(line.price*1000)*line.quantity,0)??0;
  const shipping=availability.data?.shippingFils;
  const checkoutTotalKwd=(subtotal+(shipping??0))/1000;
  const conversionCurrency:GetCurrencyConversionParams['currency']=displayCurrency==='KWD'?'USD':displayCurrency;
  const totalConversion=useGetCurrencyConversion({
    amount:Math.max(0.001,Math.round(checkoutTotalKwd*1000)/1000),currency:conversionCurrency,
  },{query:{enabled:Boolean(displayCurrency!=='KWD'&&checkoutTotalKwd>0),retry:false,staleTime:86_400_000}});
   return <div className="container-wide py-14 md:py-20"><span className="eyebrow">{c.checkout}</span><p className="mt-4 text-xs text-[#896a71] max-w-2xl">{lang==='ar'?'دفع تجريبي عبر صفحة Stripe الآمنة فقط؛ لن تُحصّل أموال حقيقية.':'Stripe hosted Test Mode checkout only. No real payments are processed.'}</p>
      {cartQ.isLoading?<LoadingBlock lang={lang}/>:cartQ.isError?<div className="mt-8"><ErrorNotice lang={lang} onRetry={()=>cartQ.refetch()}/></div>:!cart?.lines.length?<div className="mt-8"><EmptyState text={c.empty}/><Link href="/products" className="btn-primary mt-5">{c.continue}</Link></div>:<div className="grid lg:grid-cols-[1fr_.7fr] gap-8 mt-9"><form className="card-surface p-6 md:p-8 grid gap-5" onSubmit={e=>{e.preventDefault();if(!ready||Object.values(address).some(value=>!value.trim()))return;if(!isKuwaitCheckoutPhone(phone)){setPhoneError(lang==='ar'?'أدخلي رقم هاتف كويتي من 8 أرقام، أو أضيفي مفتاح الدولة +965.':'Enter an 8-digit Kuwait number, or include the +965 country code.');return;}setPhoneError('');start.mutate({data:{requestKey,lang,address:{area:address.area.trim(),block:address.block.trim(),street:address.street.trim(),house:address.house.trim()},phone:phone.trim(),note:note||undefined}},{onSuccess:r=>{window.location.assign(r.url)}})}}><h2 className="font-display text-2xl text-[#5B0D1E]">{c.checkout}</h2>
      <fieldset className="grid sm:grid-cols-2 gap-5">
        <legend className="field-label mb-3">{lang==='ar'?'عنوان التوصيل':'Delivery address'}</legend>
        {([
          ['area',lang==='ar'?'المنطقة':'Area'],
          ['block',lang==='ar'?'القطعة':'Block'],
          ['street',lang==='ar'?'الشارع':'Street'],
          ['house',lang==='ar'?'رقم المنزل':'House number'],
        ] as const).map(([field,label])=><label key={field}><span className="field-label">{label} *</span><input name={field} className="field" required maxLength={100} pattern=".*\S.*" value={address[field]} onChange={e=>setAddress(previous=>({...previous,[field]:e.target.value}))}/></label>)}
      </fieldset>
       <label><span className="field-label">{c.phone} *</span><input className="field" name="phone" type="tel" required minLength={8} maxLength={30} autoComplete="tel" value={phone} onChange={e=>{setPhone(e.target.value);setPhoneError('')}}/><span className="mt-1 block text-[11px] leading-5 text-[#896a71]">{lang==='ar'?'للتوصيل داخل الكويت: 8 أرقام، أو اكتبي +965 قبل الرقم.':'For Kuwait delivery: enter 8 digits or prefix the number with +965.'}</span></label>
      <label><span className="field-label">{c.note}</span><textarea className="field min-h-28" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
         <p role="status" className={`rounded-xl p-4 text-xs leading-6 ${ready?'bg-[#edf6ec] text-[#42643c]':'bg-[#fff1f3] text-[#763246]'}`}>{ready?(lang==='ar'?'الدفع التجريبي عبر Stripe متاح. لن تُحصّل أموال حقيقية.':'Stripe Test Mode checkout is available. No real payment will be collected.'):(lang==='ar'?'الدفع التجريبي غير جاهز بعد. يلزم إعداد مفاتيح Stripe التجريبية ورسوم التوصيل.':'Test checkout is not ready yet. Stripe test credentials and the delivery fee must be configured.')}</p>
       {(phoneError||start.isError)&&<p role="alert" className="text-xs text-red-700">{phoneError||(start.error?.message?.includes('Kuwait phone number')?(lang==='ar'?'أدخلي رقم هاتف كويتي من 8 أرقام، أو أضيفي مفتاح الدولة +965.':'Enter an 8-digit Kuwait number, or include the +965 country code.'):start.error?.message)|| (lang==='ar'?'تعذر بدء الدفع. لا تعيدي الدفع إذا كانت هناك عملية قيد التحقق.':'Checkout could not be started. Do not pay again while a payment is being verified.')}</p>}
        <button disabled={!ready||start.isPending} className="btn-primary w-full disabled:opacity-50">{start.isPending?c.loading:(lang==='ar'?'الدفع التجريبي عبر Stripe':'Pay with Stripe Test Mode')}<ExternalLink size={14}/></button>
      </form><aside className="card-surface p-6 h-fit"><h2 className="font-display text-2xl text-[#5B0D1E]">{c.bag}</h2>
      <label htmlFor="checkout-display-currency" className="mt-5 grid gap-2 text-xs font-medium text-[#795963]">{c.displayCurrency}
        <select id="checkout-display-currency" data-testid="checkout-display-currency" className="field w-full py-2" value={displayCurrency} onChange={event=>setDisplayCurrency(event.target.value as DisplayCurrency)}>
          {DISPLAY_CURRENCIES.map(currency=><option key={currency} value={currency}>{currency}</option>)}
        </select>
      </label>
      {cart.lines.map(line=><div key={line.id} className="py-4 border-b border-[#efdee2] text-xs"><div className="flex justify-between gap-4"><span>{line.title} × {line.quantity}</span><strong>{(line.price*line.quantity).toFixed(3)} KWD</strong></div>{displayCurrency!=='KWD'&&<p className="mt-2 text-end text-[#795963]" data-testid={`checkout-line-total-converted-${line.id}`}><CartConvertedAmount amount={line.price*line.quantity} currency={displayCurrency} lang={lang} testId={`checkout-line-total-value-${line.id}`}/></p>}</div>)}
       <div className="flex justify-between pt-5 text-sm"><span>{lang==='ar'?'التوصيل':'Delivery'}</span><span>{shipping==null?(lang==='ar'?'بانتظار الاعتماد':'Awaiting approval'):`${(shipping/1000).toFixed(3)} KWD`}</span></div>
      <div className="flex justify-between pt-5 font-semibold text-sm"><span>{c.total}</span><span data-testid="checkout-total">{checkoutTotalKwd.toFixed(3)} KWD</span></div>
      {displayCurrency!=='KWD'&&<div className="mt-3 rounded-xl bg-[#fff7f8] p-3 text-[11px] leading-5 text-[#795963]">
        {totalConversion.isLoading&&<p role="status">{c.conversionLoading}</p>}
        {totalConversion.isError&&<p role="alert" className="text-red-700">{c.conversionError}</p>}
        <p data-testid="checkout-converted-total">{totalConversion.isError?'—':totalConversion.data?`${totalConversion.data.amount.toFixed(2)} ${displayCurrency}`:c.conversionLoading}</p>
        <p>{c.originalKwd}: {checkoutTotalKwd.toFixed(3)} KWD</p>
        <p>{c.conversionNote}</p>
        {totalConversion.data&&<CurrencyRateDetails currency={conversionCurrency} lang={lang} testId="checkout"/>}
      </div>}
      {shipping==null&&<p className="mt-3 text-xs text-[#896a71]">{lang==='ar'?'المبلغ لا يشمل التوصيل حتى اعتماد رسومه.':'Delivery is excluded until its charge is approved.'}</p>}
      </aside></div>}
  </div>;
}
function WholesalePage({lang}:{lang:Lang}) {
  const c=copy[lang], create=useCreateInquiry();const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());const [saved,setSaved]=useState<number|null>(null);const [error,setError]=useState('');
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const formEl=e.currentTarget;const f=new FormData(formEl);const payload={cafeName:String(f.get('cafeName')||''),contactName:String(f.get('contactName')||''),phone:String(f.get('phone')||''),email:String(f.get('email')||''),area:String(f.get('area')||''),products:String(f.get('products')||''),notes:String(f.get('notes')||''),requestKey};if(!payload.cafeName||!payload.contactName||!payload.phone||!payload.area||!payload.products){setError(c.required);return;}setError('');create.mutate({data:payload},{onSuccess:r=>{setSaved(r.id);setRequestKey(crypto.randomUUID());formEl.reset();queryClient.invalidateQueries({queryKey:getListInquiriesQueryKey()});queryClient.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});},onError:()=>setError(lang==='ar'?'تعذر إرسال الاستفسار. يمكنك إعادة المحاولة.':'We could not send this inquiry. Please retry.')});};
  return <div className="container-wide py-14 md:py-20"><div className="grid lg:grid-cols-[.8fr_1.2fr] gap-12"><div><span className="eyebrow">{c.cafes}</span><h1 className="serif text-5xl md:text-6xl text-[#5B0D1E] mt-3">{c.wholesale}</h1><p className="mt-5 text-sm leading-7 text-[#795963]">{c.wholesaleText}</p><div className="mt-8 rounded-[26px] bg-[#FFD6E5] p-6 flex items-center gap-5"><Picture src={images.mascot} alt="Amore baker" className="w-24 h-24 rounded-full"/><p className="font-display italic text-xl text-[#5B0D1E]">{c.made}</p></div></div>
  <form onSubmit={submit} className="card-surface p-6 md:p-8 grid sm:grid-cols-2 gap-4"><label><span className="field-label">{c.cafeName} *</span><input name="cafeName" className="field" required maxLength={200}/></label><label><span className="field-label">{c.contact} *</span><input name="contactName" className="field" required maxLength={200}/></label><label><span className="field-label">{c.phone} *</span><input name="phone" className="field" type="tel" required minLength={8} maxLength={30}/></label><label><span className="field-label">{c.email}</span><input name="email" className="field" type="email" maxLength={200}/></label><label><span className="field-label">{c.area} *</span><input name="area" className="field" required maxLength={200}/></label><label className="sm:col-span-2"><span className="field-label">{c.requested} *</span><textarea name="products" className="field min-h-24" required maxLength={3000} placeholder={lang==='ar'?'المنتجات والكميات المطلوبة':'Products and quantities requested'}/></label><label className="sm:col-span-2"><span className="field-label">{c.notes}</span><textarea name="notes" className="field min-h-20" maxLength={3000}/></label><div className="sm:col-span-2">{error&&<p className="text-xs text-red-700 mb-3">{error}</p>}{saved&&<p className="text-sm text-[#5B0D1E] mb-3" role="status">{c.saved} · {c.reference}: {saved}</p>}{create.isError&&<button type="button" onClick={()=>setError(lang==='ar'?'تحققي من البيانات ثم أرسلي النموذج مجدداً.':'Please check the form and submit again.')} className="text-xs underline mb-3">{c.retry}</button>}<button disabled={create.isPending} className="btn-primary w-full disabled:opacity-50">{create.isPending?c.loading:c.send}<ArrowRight size={14}/></button></div></form></div></div>;
}
function TrackingPage({lang}:{lang:Lang}) {
  const c=copy[lang], track=useTrackOrder(), [result,setResult]=useState<TrackingResult|null>(null),[error,setError]=useState('');
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);setError('');setResult(null);track.mutate({data:{orderNumber:String(f.get('orderNumber')||''),phone:String(f.get('phone')||'')}},{onSuccess:setResult,onError:err=>setError((err as {status?:number}).status===429?(lang==='ar'?'محاولات كثيرة. يرجى الانتظار قبل إعادة المحاولة.':'Too many attempts. Please wait before retrying.'):c.trackingUnavailable)});};
  return <PageIntro eyebrow={c.tracking} title={c.trackingHelp}><form className="card-surface max-w-xl p-6 md:p-8 grid gap-5" onSubmit={submit} onChange={()=>{setResult(null);setError('');}}><p className="text-xs leading-6 text-[#795963]">{lang==='ar'?'تظهر حالة الطلبات التي أُنشئت عبر متجر أموري بعد مطابقة رقم الطلب وهاتف الشراء.':'This page looks up Amore website orders after matching the order number and checkout phone.'}</p><fieldset disabled={track.isPending} className="grid gap-5"><label><span className="field-label">{c.orderNumber}</span><input name="orderNumber" className="field" autoComplete="off" required maxLength={100}/></label><label><span className="field-label">{c.phone}</span><input name="phone" className="field" type="tel" autoComplete="off" required minLength={8} maxLength={30}/></label></fieldset>{error&&<p className="text-xs text-red-700" role="alert">{error}</p>}{result&&<div className="grid gap-4" role="status"><p className="text-xs leading-6">{result.message}</p>{result.available&&result.order&&<OrderDetails order={result.order} lang={lang}/>}</div>}<button disabled={track.isPending} className="btn-primary">{track.isPending?c.loading:c.track}<ArrowRight size={14}/></button></form></PageIntro>;
}
function PoliciesPage({lang,settings}:{lang:Lang;settings?:StoreSettings}) {const text=lang==='ar'?settings?.policiesAr:settings?.policiesEn;return <PageIntro eyebrow={copy[lang].policies} title={copy[lang].policies}><div className="prose prose-sm max-w-3xl whitespace-pre-wrap leading-8 text-[#795963]">{text?.trim()|| (lang==='ar'?'لا توجد سياسة معتمدة منشورة حالياً.':'No approved policy copy has been published yet.')}</div></PageIntro>}

function AdminPage({lang}:{lang:Lang}) {
  const c=copy[lang], {user,loading:authLoading,error:authError}=useAuth(),[section,setSection]=useState<'overview'|'products'|'orders'|'inquiries'|'settings'>('overview');
  const session=useGetAdminSession({query:{queryKey:getGetAdminSessionQueryKey(),enabled:!authLoading&&!!user}});
  if(authLoading||user&&session.isLoading)return <LoadingBlock lang={lang}/>;
  if(!user)return <div className="container-wide py-24 text-center"><img src={images.logo} className="w-24 h-24 object-contain mx-auto rounded-full" alt="Amore Cookies"/><h1 className="serif text-4xl text-[#5B0D1E] mt-5">{c.access}</h1>{authError&&<p className="mt-4 text-sm text-red-700" role="alert">{authError}</p>}<Link href="/sign-in" className="btn-primary mt-6">{lang==='ar'?'تسجيل الدخول':'Sign in'}</Link><p className="text-xs text-[#896a71] mt-4">{lang==='ar'?'إنشاء حساب لا يمنح صلاحية الإدارة.':'Signing up does not grant management access.'}</p></div>;
  if(session.isError)return <div className="container-wide py-20"><ErrorNotice lang={lang} onRetry={()=>session.refetch()}/></div>;
  if(session.data?.setupRequired||!session.data?.isAdmin)return <div className="container-wide py-24 max-w-2xl text-center"><div className="w-16 h-16 bg-[#FFD6E5] rounded-full grid place-items-center mx-auto text-[#5B0D1E]"><CircleHelp/></div><h1 className="serif text-4xl text-[#5B0D1E] mt-5">{c.admin}</h1><p className="mt-4 text-sm leading-7 text-[#795963]">{session.data?.setupRequired?c.pending:(lang==='ar'?'هذا الحساب لا يملك صلاحية إدارة المتجر.':'This account does not have permission to manage the shop.')}</p><Link href="/" className="btn-outline mt-6">{c.home}</Link></div>;
  return <AdminConsole lang={lang} section={section} setSection={setSection}/>;
}
function AdminConsole({lang,section,setSection}:{lang:Lang;section:'overview'|'products'|'orders'|'inquiries'|'settings';setSection:(s:'overview'|'products'|'orders'|'inquiries'|'settings')=>void}) {
  const c=copy[lang],summary=useGetAdminSummary({query:{queryKey:getGetAdminSummaryQueryKey(),refetchInterval:45000}}),adminProducts=useListAdminProducts({query:{queryKey:getListAdminProductsQueryKey(),refetchInterval:45000}}),inquiries=useListInquiries({query:{queryKey:getListInquiriesQueryKey(),refetchInterval:45000}});
  const {signOut}=useAuth();
  const tabs:[typeof section,string][]=[['overview',c.overview],['products',c.inventory],['orders',c.ordersLink],['inquiries',c.inquiries],['settings',c.settings]];
  return <div className="container-wide py-8 md:py-12"><div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8"><div><span className="eyebrow">{c.admin}</span><h1 className="serif text-4xl md:text-5xl text-[#5B0D1E] mt-2">{tabs.find(t=>t[0]===section)?.[1]}</h1></div><button className="btn-outline self-start" onClick={()=>void signOut()}>{lang==='ar'?'تسجيل الخروج':'Sign out'}</button></div>
    <div className="flex overflow-x-auto gap-2 border-b border-[#ead5da] mb-8 pb-2">{tabs.map(([key,label])=><button key={key} onClick={()=>setSection(key)} className={`whitespace-nowrap px-4 py-2 rounded-full text-[11px] font-semibold ${section===key?'bg-[#5B0D1E] text-white':'text-[#76525c] hover:bg-[#f8e8ec]'}`}>{label}</button>)}</div>
    {section==='overview'&&<AdminOverview lang={lang} data={summary.data} loading={summary.isLoading} error={summary.isError} retry={()=>summary.refetch()} onNavigate={setSection}/>}
    {section==='products'&&<AdminProducts lang={lang} products={adminProducts.data||[]} loading={adminProducts.isLoading} error={adminProducts.isError} retry={()=>adminProducts.refetch()}/>}
    {section==='inquiries'&&<AdminInquiries lang={lang} items={inquiries.data||[]} loading={inquiries.isLoading} error={inquiries.isError} retry={()=>inquiries.refetch()}/>}
    {section==='settings'&&<AdminSettings lang={lang}/>}
    {section==='orders'&&<LocalOrdersAdmin lang={lang}/>}
  </div>;
}
function AdminOverview({lang,data,loading,error,retry,onNavigate}:{lang:Lang;data?:{inquiryCount:number;newInquiryCount:number;lowStock:Product[];shopCurrency:string;checkoutEnabled:boolean;notices:string[]};loading:boolean;error:boolean;retry:()=>void;onNavigate:(s:'overview'|'products'|'orders'|'inquiries'|'settings')=>void}) {
  const c=copy[lang];if(loading)return <LoadingBlock lang={lang}/>;if(error)return <ErrorNotice lang={lang} onRetry={retry}/>;
  return <div className="grid lg:grid-cols-[1fr_.85fr] gap-6"><div className="grid sm:grid-cols-2 gap-4"><div className="card-surface p-6"><span className="eyebrow">{c.inquiries}</span><strong className="block font-display text-5xl text-[#5B0D1E] mt-4">{data?.inquiryCount??'—'}</strong><p className="text-xs text-[#896a71] mt-2">{c.new}: {data?.newInquiryCount??'—'}</p></div><div className="card-surface p-6"><span className="eyebrow">{lang==='ar'?'العملة':'Catalog currency'}</span><strong className="block font-display text-4xl text-[#5B0D1E] mt-4">{data?.shopCurrency||'KWD'}</strong><p className="text-xs text-[#896a71] mt-2">{c.noSales}</p></div><div className="sm:col-span-2 card-surface p-6"><div className="flex justify-between items-center"><h2 className="font-display text-2xl text-[#5B0D1E]">{c.inventory}</h2><button onClick={()=>onNavigate('products')} className="text-xs underline text-[#8b5363]">{c.edit}</button></div>{data?.lowStock?.length?data.lowStock.map(p=><div key={p.id} className="flex justify-between py-3 border-b border-[#f0e1e4] text-xs"><span>{p.title}</span><span>{p.stock} · {c.stock}</span></div>):<p className="text-xs text-[#896a71] mt-4">{lang==='ar'?'لا توجد تنبيهات مخزون مقدمة.':'No low-stock alerts are currently reported.'}</p>}</div></div><div className="grid gap-4 content-start"><div className="card-surface p-6"><h2 className="font-display text-2xl text-[#5B0D1E]">{c.ordersLink}</h2><p className="text-xs text-[#896a71] mt-2">{data?.checkoutEnabled? (lang==='ar'?'الدفع التجريبي متاح فقط؛ لن تُحصّل أموال حقيقية.':'Stripe Test Mode is available; no real payments are processed.') : (lang==='ar'?'الدفع التجريبي غير جاهز حالياً.':'Stripe Test Mode is not ready yet.')}</p><button onClick={()=>onNavigate('orders')} className="btn-outline mt-5">{c.ordersLink}<ArrowUpRight size={14}/></button></div><div className="card-surface p-6"><h2 className="font-display text-2xl text-[#5B0D1E]">{c.inquiries}</h2><p className="text-xs text-[#896a71] mt-2">{data?.newInquiryCount??0} {c.new}</p><button onClick={()=>onNavigate('inquiries')} className="btn-primary mt-5">{c.inquiries}<ArrowRight size={14}/></button></div>{Boolean(data?.notices?.length)&&<div className="rounded-2xl bg-[#fff1f3] p-5 text-xs leading-6 text-[#763246]">{data?.notices?.map((n,i)=><p key={i}>{n}</p>)}</div>}</div></div>;
}
function AdminProducts({lang,products,loading,error,retry}:{lang:Lang;products:Product[];loading:boolean;error:boolean;retry:()=>void}) {
  const c=copy[lang],save=useSaveProduct(),[editing,setEditing]=useState<Product|null>(null),[open,setOpen]=useState(false),[message,setMessage]=useState(''),[uploadingImage,setUploadingImage]=useState(false),[imageError,setImageError]=useState('');
  const empty:ProductInput={title:'',titleAr:'',description:'',descriptionAr:'',price:0,pieces:12,imageUrl:'',stock:0,lowStockThreshold:0,ingredients:'',ingredientsAr:''};
  const [form,setForm]=useState<ProductInput>(empty);
  const startEdit=(product?:Product)=>{setEditing(product||null);setForm(product?{id:product.id,title:product.title,titleAr:product.titleAr,description:product.description,descriptionAr:product.descriptionAr,price:product.price,pieces:product.pieces,imageUrl:product.imageUrl,stock:product.stock,lowStockThreshold:product.lowStockThreshold,ingredients:product.ingredients,ingredientsAr:product.ingredientsAr}:{...empty});setOpen(true);setMessage('');};
  const field=(key:keyof ProductInput,label:string,type='text')=><label key={key}><span className="field-label">{label}</span><input className="field" type={type} value={String(form[key]??'')} onChange={e=>setForm({...form,[key]:type==='number'?Number(e.target.value):e.target.value})}/></label>;
  if(loading)return <LoadingBlock lang={lang}/>;if(error)return <ErrorNotice lang={lang} onRetry={retry}/>;
  return <div><div className="flex justify-between items-center mb-5"><p className="text-xs text-[#896a71]">{lang==='ar'?'المنتجات والأسعار والمخزون محفوظة في Supabase.':'Products, prices, and inventory are stored in Supabase.'}</p><button onClick={()=>startEdit()} className="btn-primary"><Plus size={15}/>{c.create}</button></div>
     {open&&<form className="card-surface p-5 md:p-7 mb-6 grid md:grid-cols-2 gap-4" onSubmit={e=>{e.preventDefault();save.mutate({data:form},{onSuccess:()=>{queryClient.invalidateQueries({queryKey:getListAdminProductsQueryKey()});queryClient.invalidateQueries({queryKey:getListProductsQueryKey()});queryClient.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});setMessage(lang==='ar'?'تم حفظ المنتج':'Product saved');setOpen(false);}})}}><div className="md:col-span-2 flex justify-between"><h2 className="font-display text-2xl text-[#5B0D1E]">{editing?c.edit:c.create}</h2><button type="button" onClick={()=>setOpen(false)}><X size={18}/></button></div>{field('title',c.title)}{field('titleAr',c.titleAr)}{field('price',c.price,'number')}{field('pieces',c.piecesLabel,'number')}{field('stock',c.stock,'number')}{field('lowStockThreshold',c.threshold,'number')}{field('imageUrl',c.image)}<label><span className="field-label">{lang==='ar'?'رفع صورة المنتج':'Upload product image'}</span><input type="file" accept="image/jpeg,image/png,image/webp" className="field" disabled={uploadingImage} onChange={async e=>{const input=e.currentTarget;const file=input.files?.[0];if(!file)return;setImageError('');if(file.size>5*1024*1024){setImageError(lang==='ar'?'الحد الأقصى لحجم الصورة ٥ ميغابايت.':'Image must be 5 MB or smaller.');return;}setUploadingImage(true);try{const imageUrl=await uploadAdminProductImage(file);setForm(current=>({...current,imageUrl}));}catch(cause){setImageError(cause instanceof Error?cause.message:(lang==='ar'?'تعذر رفع الصورة.':'Image upload failed.'));}finally{setUploadingImage(false);input.value='';}}}/>{uploadingImage&&<span className="text-[11px] text-[#795963]">{lang==='ar'?'جارٍ رفع الصورة…':'Uploading image…'}</span>}{imageError&&<span className="block text-[11px] text-red-700" role="alert">{imageError}</span>}</label>{field('ingredients',c.ingredientsEn)}{field('ingredientsAr',c.ingredientsAr)}<label className="md:col-span-2"><span className="field-label">{c.description}</span><textarea className="field min-h-20" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><label className="md:col-span-2"><span className="field-label">{c.descriptionAr}</span><textarea className="field min-h-20" value={form.descriptionAr} onChange={e=>setForm({...form,descriptionAr:e.target.value})}/></label><div className="md:col-span-2 flex gap-3 items-center"><button disabled={save.isPending||uploadingImage} className="btn-primary">{save.isPending?c.loading:c.save}</button><button type="button" onClick={()=>setOpen(false)} className="btn-outline">{lang==='ar'?'إلغاء':'Cancel'}</button>{save.isError&&<span className="text-xs text-red-700">{lang==='ar'?'تعذر الحفظ':'Save failed'}</span>}</div></form>}
    {message&&<p className="mb-4 text-xs text-[#5B0D1E]" role="status">{message}</p>}
    <div className="grid gap-3">{products.map(p=><div key={p.id} className="card-surface p-4 flex gap-4 items-center"><Picture src={p.imageUrl||images.cookie} alt={p.title} className="w-16 h-16 rounded-xl object-cover"/><div className="flex-1 min-w-0"><h3 className="font-semibold text-sm text-[#5B0D1E] truncate">{p.title}</h3><p className="text-[10px] text-[#896a71] mt-1">{p.price.toFixed(3)} KWD · {p.stock} {c.stock} · {p.available?'Available':c.sold}</p></div><button className="btn-outline px-4 py-2" onClick={()=>startEdit(p)}>{c.edit}</button></div>)}</div>{products.length===0&&<EmptyState text={c.noProducts}/>}
  </div>;
}
function AdminInquiries({lang,items,loading,error,retry}:{lang:Lang;items:Inquiry[];loading:boolean;error:boolean;retry:()=>void}) {
  const c=copy[lang],update=useUpdateInquiry();
  if(loading)return <LoadingBlock lang={lang}/>;if(error)return <ErrorNotice lang={lang} onRetry={retry}/>;
  const statusText=(s:string)=>s==='new'?c.new:s==='contacted'?c.contacted:c.closed;
  const refresh=()=>{queryClient.invalidateQueries({queryKey:getListInquiriesQueryKey()});queryClient.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});};
  return <div className="grid gap-4">{items.map(i=><article key={i.id} className="card-surface p-5 md:p-6"><div className="flex flex-wrap justify-between gap-3"><div><span className={`inline-flex px-3 py-1 rounded-full text-[9px] font-bold ${i.status==='new'?'bg-[#FFD6E5] text-[#5B0D1E]':'bg-[#f2eaeb] text-[#795963]'}`}>{statusText(i.status)}</span><h2 className="font-display text-2xl text-[#5B0D1E] mt-3">{i.cafeName}</h2><p className="text-xs text-[#896a71] mt-1">{i.contactName} · {i.area}</p></div><div className="text-end text-xs text-[#896a71]">{new Date(i.createdAt).toLocaleDateString(lang==='ar'?'ar-KW':'en-GB')}<p className="mt-1">#{i.id}</p></div></div><div className="grid sm:grid-cols-2 gap-4 mt-5 text-xs"><div><span className="field-label">{c.phone}</span><a href={`tel:${i.phone}`} className="text-[#5B0D1E]">{i.phone}</a>{i.email&&<p className="mt-2">{i.email}</p>}</div><div><span className="field-label">{c.requested}</span><p className="whitespace-pre-wrap leading-5">{i.products}</p></div></div>{i.notes&&<p className="mt-4 text-xs leading-5 text-[#795963]">{i.notes}</p>}<div className="mt-5 flex gap-2">{i.status!=='contacted'&&<button disabled={update.isPending} onClick={()=>update.mutate({id:i.id,data:{status:'contacted'}},{onSuccess:refresh})} className="btn-outline px-4 py-2">{c.markContacted}</button>}{i.status!=='closed'&&<button disabled={update.isPending} onClick={()=>update.mutate({id:i.id,data:{status:'closed'}},{onSuccess:refresh})} className="btn-outline px-4 py-2">{c.markClosed}</button>}{i.status==='closed'&&<button disabled={update.isPending} onClick={()=>update.mutate({id:i.id,data:{status:'new'}},{onSuccess:refresh})} className="btn-outline px-4 py-2">{c.new}</button>}</div></article>)}{items.length===0&&<EmptyState text={lang==='ar'?'لا توجد استفسارات حتى الآن.':'No café inquiries yet.'}/>}</div>;
}
function AdminSettings({lang}:{lang:Lang}) {
  const c=copy[lang],q=useGetAdminSettings({query:{queryKey:getGetAdminSettingsQueryKey()}}),save=useSaveSettings(),[form,setForm]=useState<StoreSettings|null>(null),[message,setMessage]=useState('');
  useEffect(()=>{if(q.data)setForm(q.data)},[q.data]);
  if(q.isError)return <ErrorNotice lang={lang} onRetry={()=>q.refetch()}/>;if(q.isLoading||!form)return <LoadingBlock lang={lang}/>;
  const input=(key:keyof StoreSettings,label:string,area=false)=><label key={key} className={area?'md:col-span-2':''}><span className="field-label">{label}</span>{area?<textarea className="field min-h-24" value={String(form[key]??'')} onChange={e=>setForm({...form,[key]:e.target.value})}/>:<input className="field" value={String(form[key]??'')} onChange={e=>setForm({...form,[key]:e.target.value})}/>}</label>;
  return <form className="card-surface p-5 md:p-8" onSubmit={e=>{e.preventDefault();save.mutate({data:form},{onSuccess:()=>{queryClient.invalidateQueries({queryKey:getGetAdminSettingsQueryKey()});queryClient.invalidateQueries({queryKey:getGetStoreQueryKey()});setMessage(lang==='ar'?'تم حفظ الإعدادات':'Settings saved');}})}}>
    <div className="grid md:grid-cols-2 gap-4">{input('heroTitleEn',`${c.heroTitle} · EN`)}{input('heroTitleAr',`${c.heroTitle} · AR`)}{input('heroTextEn',`${c.heroTextLabel} · EN`,true)}{input('heroTextAr',`${c.heroTextLabel} · AR`,true)}{input('aboutEn',`${c.aboutLabel} · EN`,true)}{input('aboutAr',`${c.aboutLabel} · AR`,true)}{input('storageEn',`${c.storageLabel} · EN`,true)}{input('storageAr',`${c.storageLabel} · AR`,true)}{input('policiesEn',`${c.policyLabel} · EN`,true)}{input('policiesAr',`${c.policyLabel} · AR`,true)}{input('hoursEn',`${c.hours} · EN`)}{input('hoursAr',`${c.hours} · AR`)}{input('whatsapp',c.whatsapp)}{input('email',c.contactEmail)}{input('phone',c.contactPhone)}{input('logoImage','Logo image URL')}{input('bakerImage','Baker image URL')}{input('packageImage','Package image URL')}{input('cookieImage','Cookie image URL')}</div>
    <div className="mt-8 border-t border-[#efdee2] pt-6"><h2 className="font-display text-2xl text-[#5B0D1E]">{c.bakingSteps}</h2><div className="grid md:grid-cols-2 gap-4 mt-4">{form.bakingSteps.map((step,i)=><div key={i} className="rounded-xl bg-[#fff6f7] p-4 grid gap-3"><span className="eyebrow">Step {i+1}</span>{(['titleEn','titleAr','textEn','textAr'] as const).map(k=><label key={k}><span className="field-label">{k}</span><input className="field" value={step[k]} onChange={e=>{const steps=[...form.bakingSteps];steps[i]={...steps[i],[k]:e.target.value};setForm({...form,bakingSteps:steps})}}/></label>)}<button type="button" onClick={()=>setForm({...form,bakingSteps:form.bakingSteps.filter((_,j)=>j!==i)})} className="text-xs text-red-700 underline justify-self-start">{lang==='ar'?'حذف الخطوة':'Remove step'}</button></div>)}{form.bakingSteps.length<10&&<button type="button" className="btn-outline self-start" onClick={()=>setForm({...form,bakingSteps:[...form.bakingSteps,{titleEn:'',titleAr:'',textEn:'',textAr:''}]})}><Plus size={14}/>{lang==='ar'?'إضافة خطوة':'Add a step'}</button>}</div></div>
    <div className="mt-6 grid gap-2"><label htmlFor="admin-delivery-fee" className="field-label">{c.deliveryFee}</label><input id="admin-delivery-fee" className="field max-w-xs" type="number" min="0" step="0.001" inputMode="decimal" value={form.deliveryFeeFils==null?'':(form.deliveryFeeFils/1000).toFixed(3)} onChange={e=>setForm({...form,deliveryFeeFils:e.target.value===''?null:Math.round(Number(e.target.value)*1000)})}/><p className="text-[11px] leading-5 text-[#896a71]">{lang==='ar'?'الدفع متاح في وضع Stripe التجريبي فقط، ولا يقبل مفاتيح الدفع الحقيقية.':'Checkout accepts Stripe test mode only and rejects live keys.'}</p></div>
    <div className="mt-7 flex flex-wrap gap-3 items-center"><button disabled={save.isPending} className="btn-primary">{save.isPending?c.loading:c.saveSettings}<Check size={15}/></button>{message&&<span role="status" className="text-xs text-[#5B0D1E]">{message}</span>}{save.isError&&<span className="text-xs text-red-700">{lang==='ar'?'تعذر الحفظ':'Settings could not be saved. Retry.'}</span>}</div>
  </form>;
}
function AuthRoutes() {
  const [authLocation] = useLocation();
  const [authLang,setAuthLang]=useState<Lang>(()=>(localStorage.getItem('amore-lang') as Lang)||'en');
  const toggleAuthLang=()=>setAuthLang(current=>{const next=current==='en'?'ar':'en';localStorage.setItem('amore-lang',next);document.documentElement.lang=next;document.documentElement.dir=next==='ar'?'rtl':'ltr';return next;});
  const [recoveryLink,setRecoveryLink]=useState(()=>new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type')==='recovery');
  const previousLocation=useRef(authLocation);
  useEffect(()=>{
    if(previousLocation.current===authLocation)return;
    previousLocation.current=authLocation;
    setRecoveryLink(authLocation==='/sign-in'&&new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type')==='recovery');
  },[authLocation]);
  return <Switch>
    <Route path="/sign-in/*?">{recoveryLink
      ? <PasswordRecoveryPage mode="reset" lang={authLang} onToggleLanguage={toggleAuthLang}/>
      : <AuthPage mode="sign-in" lang={authLang} onToggleLanguage={toggleAuthLang}/>}</Route>
    <Route path="/sign-up/*?"><AuthPage mode="sign-up" lang={authLang} onToggleLanguage={toggleAuthLang}/></Route>
    <Route path="/forgot-password/*?"><PasswordRecoveryPage mode="request" lang={authLang} onToggleLanguage={toggleAuthLang}/></Route>
    <Route path="/resend-confirmation/*?"><PasswordRecoveryPage mode="resend" lang={authLang} onToggleLanguage={toggleAuthLang}/></Route>
    <Route path="/reset-password/*?"><PasswordRecoveryPage mode="reset" lang={authLang} onToggleLanguage={toggleAuthLang}/></Route>
    <Route><AppShell/></Route>
  </Switch>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><AuthProvider><ErrorBoundary><AuthRoutes/></ErrorBoundary></AuthProvider></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
