import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Heart,
  LogOut,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import {
  getGetCartQueryKey,
  getListAccountFavoritesQueryKey,
  getListAccountOrdersQueryKey,
  useListAccountFavorites,
  useListAccountOrders,
  useRemoveAccountFavorite,
  useUpdateCart,
} from "@workspace/api-client-react";
import type { AccountFavorite, AccountOrder, Product } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";

type Lang = "en" | "ar";

const words = {
  en: {
    account: "Your Amore account", hello: "A little home for your Amore things.",
    overview: "Overview", orders: "My orders", favorites: "My favorites",
    signInTitle: "Your Amore account", signInText: "Sign in to see your orders and keep the cookie dough you love close.",
    signIn: "Sign in", signUp: "Create an account", shop: "Back to the shop", retry: "Try again",
    loading: "Gathering your account…", loadError: "We couldn’t load this just now.",
    orderCount: "Orders placed", favoriteCount: "Saved favorites", viewOrders: "View order history",
    viewFavorites: "See saved cookies", signedOut: "You’ve been signed out.", signOut: "Sign out",
    orderHeading: "My orders", orderIntro: "Every batch, in one place.", noOrdersTitle: "No orders to show yet",
    noOrdersText: "Your first Amore order will find its place here.", browse: "Find your next favorite",
    order: "Order", payment: "Payment", fulfillment: "Fulfillment", total: "Total",
    moreItems: "and more", favoriteHeading: "My favorites", favoriteIntro: "The ones you’ve been thinking about.",
    noFavoritesTitle: "Nothing saved just yet", noFavoritesText: "Keep a cookie close by saving it from the collection.",
    remove: "Remove", addToBag: "Add to bag", added: "Added to your bag.",
    addFailed: "Could not add this item. Please try again.", removeFailed: "Could not remove this favorite. Please try again.",
    removed: "Removed from your favorites.", unavailable: "Currently unavailable",
    savedOn: "Saved", noImage: "Amore Cookies", item: "item",
  },
  ar: {
    account: "حساب أموري", hello: "مساحة صغيرة لأشيائك المفضلة من أموري.",
    overview: "نظرة عامة", orders: "طلباتي", favorites: "مفضلتي",
    signInTitle: "حساب أموري", signInText: "سجّلي الدخول لمتابعة طلباتك والاحتفاظ بعجينة الكوكيز التي تحبينها.",
    signIn: "تسجيل الدخول", signUp: "إنشاء حساب", shop: "العودة إلى المتجر", retry: "حاولي مجدداً",
    loading: "جارٍ تجهيز حسابك…", loadError: "تعذر تحميل الحساب الآن.",
    orderCount: "الطلبات", favoriteCount: "المفضلة المحفوظة", viewOrders: "عرض سجل الطلبات",
    viewFavorites: "عرض الكوكيز المحفوظ", signedOut: "تم تسجيل خروجك.", signOut: "تسجيل الخروج",
    orderHeading: "طلباتي", orderIntro: "كل دفعة في مكان واحد.", noOrdersTitle: "لا توجد طلبات بعد",
    noOrdersText: "سيظهر طلب أموري الأول هنا.", browse: "اكتشفي مفضلتك القادمة",
    order: "الطلب", payment: "الدفع", fulfillment: "التجهيز", total: "الإجمالي",
    moreItems: "وعناصر أخرى", favoriteHeading: "مفضلتي", favoriteIntro: "الكوكيز التي ما زالت في بالك.",
    noFavoritesTitle: "لم تحفظي شيئاً بعد", noFavoritesText: "احفظي الكوكيز من المجموعة لتبقى قريبة منك.",
    remove: "إزالة", addToBag: "أضيفي إلى السلة", added: "تمت الإضافة إلى السلة.",
    addFailed: "تعذرت إضافة المنتج. حاولي مجدداً.", removeFailed: "تعذرت إزالة المنتج. حاولي مجدداً.",
    removed: "تمت الإزالة من المفضلة.", unavailable: "غير متوفر حالياً",
    savedOn: "تاريخ الحفظ", noImage: "كوكيز أموري", item: "منتج",
  },
} as const;

const stageNames: Record<string, [string, string]> = {
  received: ["Received", "تم الاستلام"],
  confirmed: ["Confirmed", "مؤكد"],
  review: ["Under review", "قيد المراجعة"],
  preparing: ["Preparing", "قيد التجهيز"],
  partially_fulfilled: ["Partially fulfilled", "تم تجهيز جزء من الطلب"],
  shipped: ["Shipped", "تم الشحن"],
  out_for_delivery: ["Out for delivery", "خرج للتوصيل"],
  delivered: ["Delivered", "تم التوصيل"],
  cancelled: ["Cancelled", "ملغي"],
};

const statusNames: Record<string, [string, string]> = {
  paid: ["Paid", "مدفوع"],
  pending: ["Pending", "قيد الانتظار"],
  unpaid: ["Unpaid", "غير مدفوع"],
  creating: ["Payment starting", "جارٍ بدء الدفع"],
  review: ["Under review", "قيد المراجعة"],
  failed: ["Failed", "فشل"],
  cancelled: ["Cancelled", "ملغي"],
  partially_paid: ["Partially paid", "مدفوع جزئياً"],
  refunded: ["Refunded", "مسترد"],
  partially_refunded: ["Partially refunded", "مسترد جزئياً"],
  confirmed: ["Confirmed", "مؤكد"],
  received: ["Received", "تم الاستلام"],
  preparing: ["Preparing", "قيد التجهيز"],
  unfulfilled: ["Not yet fulfilled", "لم يتم التجهيز"],
  fulfilled: ["Fulfilled", "تم التجهيز"],
  partially_fulfilled: ["Partially fulfilled", "تم تجهيز جزء من الطلب"],
  shipped: ["Shipped", "تم الشحن"],
  out_for_delivery: ["Out for delivery", "خرج للتوصيل"],
  delivered: ["Delivered", "تم التوصيل"],
};

function AccountFrame({ lang, eyebrow, title, intro, children }: {
  lang: Lang; eyebrow: string; title: string; intro?: string; children: ReactNode;
}) {
  const ar = lang === "ar";
  const c = words[lang];
  const [path] = useLocation();
  const nav = [
    { href: "/user-portal", label: c.overview, icon: UserRound },
    { href: "/my-orders", label: c.orders, icon: PackageCheck },
    { href: "/my-favorites", label: c.favorites, icon: Heart },
  ];
  return <div dir={ar ? "rtl" : "ltr"} className="container-wide py-10 md:py-16">
    <div className="mb-9 border-b border-[#ead8dc] pb-7 md:mb-12 md:pb-9">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="serif mt-3 text-4xl leading-tight text-[#5B0D1E] md:text-6xl">{title}</h1>
          {intro && <p className="mt-3 max-w-xl text-sm leading-6 text-[#795963]">{intro}</p>}
        </div>
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-[#795963] transition-colors hover:text-[#5B0D1E]">
          {ar ? <ArrowRight size={15}/> : <ArrowLeft size={15}/>} {c.shop}
        </Link>
      </div>
    </div>
    <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12">
      <nav aria-label={ar ? "روابط الحساب" : "Account navigation"} className="flex gap-2 overflow-x-auto md:block md:space-y-2">
        {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href}
          aria-current={path === href ? "page" : undefined}
          className={`inline-flex shrink-0 items-center gap-3 rounded-full px-4 py-3 text-xs font-semibold transition-colors md:w-full md:rounded-xl ${path === href ? "bg-[#5B0D1E] text-[#fffaf8]" : "text-[#795963] hover:bg-[#f8e8ec] hover:text-[#5B0D1E]"}`}
          data-testid={`link-account-nav-${href.slice(1)}`}>
          <Icon size={16}/>{label}
        </Link>)}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  </div>;
}

function AccountGate({ lang }: { lang: Lang }) {
  const { user, loading, error, refresh } = useAuth();
  const ar = lang === "ar";
  const c = words[lang];
  if (loading) return <div className="container-wide max-w-2xl py-20" aria-busy="true">
    <div className="h-8 w-48 animate-pulse rounded-full bg-[#f1dfe4]"/>
    <div className="mt-5 h-4 w-72 max-w-full animate-pulse rounded-full bg-[#f1dfe4]"/>
    <div className="mt-10 h-40 animate-pulse rounded-[24px] bg-[#f7e9ec]"/>
    <p className="mt-5 text-center text-xs text-[#896a71]">{c.loading}</p>
  </div>;
  if (error) return <div className="container-wide max-w-2xl py-20">
    <div className="card-surface p-8 text-center">
      <p className="text-sm leading-6 text-[#795963]" role="alert">{error}</p>
      <button type="button" onClick={() => void refresh()} className="btn-outline mt-5" data-testid="button-account-retry">
        <RefreshCw size={14}/>{c.retry}
      </button>
    </div>
  </div>;
  if (!user) return <div dir={ar ? "rtl" : "ltr"} className="container-wide max-w-2xl py-16 md:py-24">
    <section className="card-surface relative overflow-hidden p-7 text-center sm:p-12">
      <div className="absolute -end-10 -top-16 h-44 w-44 rounded-full bg-[#f8e8ec]"/>
      <div className="relative">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f8e8ec] text-[#5B0D1E]"><UserRound size={25}/></div>
        <h1 className="serif mt-5 text-4xl text-[#5B0D1E]">{c.signInTitle}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#795963]">{c.signInText}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/sign-in" className="btn-primary">{c.signIn}<ArrowUpRight size={14}/></Link>
          <Link href="/sign-up" className="btn-outline">{c.signUp}</Link>
        </div>
        <Link href="/" className="mt-6 inline-block text-xs text-[#795963] underline">{c.shop}</Link>
      </div>
    </section>
  </div>;
  return null;
}

export function UserPortalPage({ lang }: { lang: Lang }) {
  const { user, loading, error, refresh, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const c = words[lang];
  const orders = useListAccountOrders({
    query: { queryKey: getListAccountOrdersQueryKey(), enabled: Boolean(user && !loading && !error) },
  });
  const favorites = useListAccountFavorites({
    query: { queryKey: getListAccountFavoritesQueryKey(), enabled: Boolean(user && !loading && !error) },
  });

  if (loading || error || !user) return <AccountGate lang={lang}/>;
  const orderCount = orders.data?.length;
  const favoriteCount = favorites.data?.length;

  return <AccountFrame lang={lang} eyebrow="AMORE / ACCOUNT" title={c.account} intro={c.hello}>
    <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <section className="card-surface p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f8e8ec] text-[#5B0D1E]"><UserRound size={22}/></div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl text-[#5B0D1E]">{user.displayName || c.account}</h2>
            <p className="mt-1 break-all text-xs text-[#795963]" dir="ltr" data-testid="text-account-email">{user.email}</p>
          </div>
        </div>
        {signOutError && <p className="mt-5 text-xs text-red-700" role="alert">{signOutError}</p>}
        {signedOut && <p className="mt-5 text-xs text-[#5B0D1E]" role="status">{c.signedOut}</p>}
        <button type="button" className="btn-outline mt-6" data-testid="button-account-sign-out" onClick={async () => {
          setSignOutError("");
          setSignedOut(false);
          try { await signOut(); setSignedOut(true); }
          catch { setSignOutError(lang === "ar" ? "تعذر تسجيل الخروج. حاولي مجدداً." : "Sign out failed. Please try again."); }
        }}><LogOut size={14}/>{c.signOut}</button>
      </section>
      <div className="grid gap-5">
        <CountPanel icon={<PackageCheck size={19}/>} title={c.orderCount} value={orders.isLoading ? "—" : orders.isError ? "–" : String(orderCount ?? 0)} href="/my-orders" action={c.viewOrders}/>
        <CountPanel icon={<Heart size={19}/>} title={c.favoriteCount} value={favorites.isLoading ? "—" : favorites.isError ? "–" : String(favoriteCount ?? 0)} href="/my-favorites" action={c.viewFavorites}/>
      </div>
    </div>
    {(orders.isError || favorites.isError) && <div className="mt-5 rounded-2xl border border-[#ead8dc] bg-[#fffaf8] p-4 text-xs text-[#795963]" role="alert">
      {words[lang].loadError}
      <button className="ms-3 font-bold underline" type="button" onClick={() => { if (orders.isError) void orders.refetch(); if (favorites.isError) void favorites.refetch(); }}>{c.retry}</button>
    </div>}
  </AccountFrame>;
}

function CountPanel({ icon, title, value, href, action }: { icon: ReactNode; title: string; value: string; href: string; action: string }) {
  return <Link href={href} className="card-surface group flex items-center justify-between gap-4 p-5 transition-colors hover:bg-[#fff8f8]" data-testid={`link-account-summary-${href.slice(1)}`}>
    <div className="flex items-center gap-4">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-[#f8e8ec] text-[#5B0D1E]">{icon}</div>
      <div><p className="text-xs text-[#795963]">{title}</p><p className="mt-1 font-display text-3xl text-[#5B0D1E]">{value}</p></div>
    </div>
    <div className="text-end text-[10px] font-semibold text-[#9d5367]">{action}<ArrowUpRight size={14} className="ms-1 inline transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"/></div>
  </Link>;
}

function QueryLoading({ lang }: { lang: Lang }) {
  return <div className="grid gap-4" aria-busy="true">
    {[0, 1, 2].map(item => <div key={item} className="h-40 animate-pulse rounded-[22px] border border-[#f0e1e4] bg-[#fffaf8]"/> )}
    <p className="text-center text-xs text-[#896a71]">{words[lang].loading}</p>
  </div>;
}

function QueryError({ lang, retry }: { lang: Lang; retry: () => void }) {
  const c = words[lang];
  return <div className="card-surface p-8 text-center" role="alert">
    <p className="text-sm text-[#795963]">{c.loadError}</p>
    <button type="button" className="btn-outline mt-5" onClick={retry} data-testid="button-account-query-retry">
      <RefreshCw size={14}/>{c.retry}
    </button>
  </div>;
}

function EmptyAccount({ lang, title, text }: { lang: Lang; title: string; text: string }) {
  return <div className="card-surface px-6 py-12 text-center sm:px-10">
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f8e8ec] text-[#9d5367]"><ShoppingBag size={22}/></div>
    <h2 className="serif mt-5 text-3xl text-[#5B0D1E]">{title}</h2>
    <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#795963]">{text}</p>
    <Link href="/products" className="btn-primary mt-6">{words[lang].browse}<ArrowUpRight size={14}/></Link>
  </div>;
}

export function MyOrdersPage({ lang }: { lang: Lang }) {
  const { user, loading, error, refresh } = useAuth();
  const c = words[lang];
  const query = useListAccountOrders({
    query: { queryKey: getListAccountOrdersQueryKey(), enabled: Boolean(user && !loading && !error) },
  });
  if (loading || error || !user) return <AccountGate lang={lang}/>;
  return <AccountFrame lang={lang} eyebrow="AMORE / ORDERS" title={c.orderHeading} intro={c.orderIntro}>
    {query.isLoading ? <QueryLoading lang={lang}/> : query.isError ? <QueryError lang={lang} retry={() => void query.refetch()}/> :
      query.data?.length ? <div className="grid gap-4">{query.data.map(order => <OrderCard key={order.id} order={order} lang={lang}/>)}</div> :
        <EmptyAccount lang={lang} title={c.noOrdersTitle} text={c.noOrdersText}/>}
  </AccountFrame>;
}

function OrderCard({ order, lang }: { order: AccountOrder; lang: Lang }) {
  const c = words[lang];
  const ar = lang === "ar";
  const date = new Date(order.createdAt);
  const dateText = Number.isNaN(date.getTime()) ? order.createdAt : date.toLocaleDateString(ar ? "ar-KW" : "en-KW", { day: "numeric", month: "short", year: "numeric" });
  const stage = stageNames[order.stage]?.[ar ? 1 : 0] ?? order.stage.replaceAll("_", " ");
  return <article className="card-surface p-5 sm:p-7" data-testid={`card-account-order-${order.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#f0e1e4] pb-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#9d5367]">{c.order}</p>
        <p className="mt-1 font-display text-2xl text-[#5B0D1E]" dir="ltr" data-testid={`text-order-number-${order.id}`}>{order.number}</p>
        <p className="mt-1 text-xs text-[#795963]">{dateText}</p>
      </div>
      <span className="rounded-full bg-[#f8e8ec] px-3 py-1.5 text-[10px] font-semibold text-[#5B0D1E]">{stage}</span>
    </div>
    <div className="grid gap-3 py-5 sm:grid-cols-2">
       <StatusLine label={c.payment} value={order.financialStatus} lang={lang}/>
       <StatusLine label={c.fulfillment} value={order.fulfillmentStatus} lang={lang}/>
    </div>
    <ul className="grid gap-2 border-t border-[#f0e1e4] pt-4">
      {order.items.map((item, i) => <li key={`${item.title}-${i}`} className="flex justify-between gap-4 text-xs text-[#795963]">
        <span>{item.title}</span><span className="shrink-0 text-[#5B0D1E]" dir="ltr">× {item.quantity}</span>
      </li>)}
      {order.hasMoreItems && <li className="text-xs text-[#9d5367]">{c.moreItems}</li>}
    </ul>
    <div className="mt-5 flex items-center justify-between border-t border-[#f0e1e4] pt-4">
      <span className="text-xs text-[#795963]">{c.total}</span>
      <strong className="text-sm text-[#5B0D1E]" dir="ltr">{formatKwd(order.total, order.currency)}</strong>
    </div>
  </article>;
}

function StatusLine({ label, value, lang }: { label: string; value: string; lang: Lang }) {
  const normalized = value.toLowerCase().replaceAll(" ", "_");
  const status = statusNames[normalized];
  const displayValue = status ? status[lang === "ar" ? 1 : 0] : value.replaceAll("_", " ");
  return <div className="flex justify-between gap-3 rounded-xl bg-[#fff8f8] px-3 py-2 text-xs">
    <span className="text-[#795963]">{label}</span><span className="font-semibold text-[#5B0D1E]" dir="auto">{displayValue}</span>
  </div>;
}

function formatKwd(value: number | string, currency: string) {
  const amount = typeof value === "number" ? value.toFixed(3) : value;
  return `${amount} ${currency || "KWD"}`;
}

export function MyFavoritesPage({ lang }: { lang: Lang }) {
  const { user, loading, error, refresh } = useAuth();
  const c = words[lang];
  const queryClient = useQueryClient();
  const query = useListAccountFavorites({
    query: { queryKey: getListAccountFavoritesQueryKey(), enabled: Boolean(user && !loading && !error) },
  });
  const remove = useRemoveAccountFavorite();
  const [feedback, setFeedback] = useState<Record<string, FavoriteStatus>>({});
  const [notice, setNotice] = useState("");
  const cartAdd = useUpdateCart({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      },
    },
  });

  if (loading || error || !user) return <AccountGate lang={lang}/>;

  const removeItem = async (productId: string) => {
    setNotice("");
    setFeedback(current => ({ ...current, [productId]: undefined }));
    try {
      await remove.mutateAsync({ data: { productId } });
      await queryClient.invalidateQueries({ queryKey: getListAccountFavoritesQueryKey() });
      setFeedback(current => ({ ...current, [productId]: "removed" }));
      setNotice(c.removed);
    } catch {
      setFeedback(current => ({ ...current, [productId]: "removeError" }));
      setNotice(c.removeFailed);
    }
  };

  const addToCart = async (product: Product) => {
    setFeedback(current => ({ ...current, [product.id]: undefined }));
    if (!product.variantId || !product.available || product.stock <= 0) {
      setFeedback(current => ({ ...current, [product.id]: "addError" }));
      return;
    }
    try {
      await cartAdd.mutateAsync({ data: { action: "add", variantId: product.variantId, quantity: 1 } });
      setFeedback(current => ({ ...current, [product.id]: "added" }));
    } catch {
      setFeedback(current => ({ ...current, [product.id]: "addError" }));
    }
  };

  return <AccountFrame lang={lang} eyebrow="AMORE / SAVED" title={c.favoriteHeading} intro={c.favoriteIntro}>
    {notice && <p className="mb-4 rounded-xl bg-[#f8e8ec] px-4 py-3 text-xs text-[#5B0D1E]" role="status">{notice}</p>}
    {query.isLoading ? <QueryLoading lang={lang}/> : query.isError ? <QueryError lang={lang} retry={() => void query.refetch()}/> :
      query.data?.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {query.data.map(favorite => <FavoriteCard
          key={favorite.productId}
          favorite={favorite}
          lang={lang}
          status={feedback[favorite.productId]}
          removePending={remove.isPending && remove.variables?.data.productId === favorite.productId}
          cartPending={cartAdd.isPending && cartAdd.variables?.data.variantId === favorite.product.variantId}
          onRemove={() => void removeItem(favorite.productId)}
          onAdd={() => void addToCart(favorite.product)}
        />)}
      </div> : <EmptyAccount lang={lang} title={c.noFavoritesTitle} text={c.noFavoritesText}/>}
  </AccountFrame>;
}

type FavoriteStatus = "removed" | "removeError" | "added" | "addError" | undefined;

function FavoriteCard({ favorite, lang, status, removePending, cartPending, onRemove, onAdd }: {
  favorite: AccountFavorite; lang: Lang; status: FavoriteStatus; removePending: boolean;
  cartPending: boolean; onRemove: () => void; onAdd: () => void;
}) {
  const ar = lang === "ar";
  const c = words[lang];
  const product = favorite.product;
  const title = ar ? (product.titleAr || product.title) : product.title;
  const available = product.available && product.stock > 0 && Boolean(product.variantId);
  const savedDate = new Date(favorite.addedAt);
  const dateText = Number.isNaN(savedDate.getTime()) ? "" : savedDate.toLocaleDateString(ar ? "ar-KW" : "en-KW", { day: "numeric", month: "short", year: "numeric" });
  const message = status === "added" ? c.added
    : status === "addError" ? c.addFailed
      : status === "removed" ? c.removed
        : status === "removeError" ? c.removeFailed : "";

  return <article className="card-surface overflow-hidden" data-testid={`card-favorite-${favorite.productId}`}>
    <Link href={`/products/${product.handle}`} className="group relative block aspect-[1.08] overflow-hidden bg-[#f8e8ec]" data-testid={`link-favorite-product-${favorite.productId}`}>
      {product.imageUrl ? <img src={product.imageUrl} alt={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"/> :
        <div className="grid h-full place-items-center text-center font-display text-2xl text-[#9d5367]">{c.noImage}</div>}
      <span className="absolute bottom-3 start-3 rounded-full bg-[#fffaf8]/90 px-3 py-1.5 text-[9px] font-bold text-[#795963]">
        {c.savedOn}{dateText ? ` · ${dateText}` : ""}
      </span>
    </Link>
    <div className="p-4 sm:p-5">
      <Link href={`/products/${product.handle}`} className="font-display text-xl leading-tight text-[#5B0D1E] hover:text-[#9d5367]">{title}</Link>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[#5B0D1E]" dir="ltr">{formatKwd(product.price, product.currency)}</span>
        {!available && <span className="text-[10px] text-[#9d5367]">{c.unavailable}</span>}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" disabled={!available || cartPending} onClick={onAdd} className="btn-primary min-h-10 px-3 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-50" data-testid={`button-favorite-add-${favorite.productId}`}>
          {cartPending ? <span className="animate-pulse">…</span> : <ShoppingBag size={14}/>}
          {c.addToBag}
        </button>
        <button type="button" disabled={removePending} onClick={onRemove} aria-label={`${c.remove}: ${title}`} className="grid h-10 w-10 place-items-center rounded-full border border-[#e9d2d8] text-[#5B0D1E] transition-colors hover:bg-[#f8e8ec] disabled:opacity-50" data-testid={`button-favorite-remove-${favorite.productId}`}>
          {removePending ? <span className="h-3 w-3 animate-pulse rounded-full bg-[#9d5367]"/> : <Heart size={16} fill="currentColor"/>}
        </button>
      </div>
      {message && <p className={`mt-3 text-[11px] leading-5 ${status === "addError" || status === "removeError" ? "text-red-700" : "text-[#5B0D1E]"}`} role={status === "addError" || status === "removeError" ? "alert" : "status"}>{message}</p>}
    </div>
  </article>;
}
