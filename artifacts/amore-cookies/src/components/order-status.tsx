import { useState } from "react";
import { useListAdminOrders, type OrderStatus } from "@workspace/api-client-react";

const stages: Record<string, [string, string]> = {
  received: ["Received", "تم الاستلام"],
  confirmed: ["Confirmed", "مؤكد"],
  review: ["Administrator review required", "بانتظار مراجعة الإدارة"],
  preparing: ["Preparing", "قيد التجهيز"],
  partially_fulfilled: ["Partially shipped", "تم شحن جزء من الطلب"],
  shipped: ["Shipped", "تم الشحن"],
  out_for_delivery: ["Out for delivery", "خرج للتوصيل"],
  delivered: ["Delivered", "تم التوصيل"],
  cancelled: ["Cancelled", "ملغي"],
};

export function OrderDetails({ order, lang }: { order: OrderStatus; lang: "en" | "ar" }) {
  const ar = lang === "ar";
  return <article className="card-surface p-5 text-sm">
    <div className="flex flex-wrap justify-between gap-3">
      <strong dir="ltr">{order.number}</strong>
      <span className="rounded-full bg-[#f8e8ec] px-3 py-1 text-xs">{stages[order.stage]?.[ar ? 1 : 0] ?? order.stage}</span>
    </div>
    <p className="mt-3 text-xs text-[#795963]">{new Date(order.createdAt).toLocaleString(ar ? "ar-KW" : "en-GB")}</p>
    <dl className="mt-4 grid gap-2 text-xs">
      <div><dt className="inline">{ar ? "الدفع: " : "Payment: "}</dt><dd className="inline" dir="ltr">{order.financialStatus}</dd></div>
      <div><dt className="inline">{ar ? "تنفيذ الطلب: " : "Fulfillment: "}</dt><dd className="inline" dir="ltr">{order.fulfillmentStatus}</dd></div>
    </dl>
    <ul className="mt-4 grid gap-2">{order.items.map((item, i) => <li key={i} className="flex justify-between gap-4 text-xs"><span>{item.title}</span><span>× {item.quantity}</span></li>)}</ul>
    {order.hasMoreItems && <p className="text-xs mt-3">{ar ? "تُعرض أول ٥٠ خانة فقط؛ التفاصيل الكاملة في تأكيد Shopify." : "Showing the first 50 line items; full details are in your Shopify confirmation."}</p>}
    <p className="mt-4 font-semibold" dir="ltr">{order.total} {order.currency}</p>
    <p className="mt-3 text-[11px] leading-5 text-[#795963]">{ar ? "المصدر: Shopify. تظهر الحالة المسجلة فقط؛ الشحن لا يعني اكتمال التوصيل." : "Source: Shopify. Only the recorded status is shown; shipped does not mean delivered."}</p>
  </article>;
}

export function AdminOrders({ lang, adminUrl }: { lang: "en" | "ar"; adminUrl?: string }) {
  const ar = lang === "ar", [after, setAfter] = useState<string>();
  const orders = useListAdminOrders(after ? { after } : undefined, { query: { staleTime: 0, gcTime: 0 } });
  return <section>
    <div className="flex flex-wrap gap-3 items-center justify-between mb-5">
      <p className="text-xs leading-6 text-[#795963]">{ar ? "طلبات Shopify الفعلية، الأحدث أولاً. التحديث والإلغاء داخل Shopify." : "Live Shopify orders, newest first. Update and cancel orders in Shopify."}</p>
      <button className="btn-outline" disabled={orders.isFetching} onClick={() => { if (after) setAfter(undefined); else void orders.refetch(); }}>{ar ? "تحديث والعودة للأحدث" : "Refresh latest"}</button>
      {adminUrl && <a className="btn-primary" href={`${adminUrl.replace(/\/$/, "")}/orders`} target="_blank" rel="noopener noreferrer">{ar ? "إدارة الطلبات في Shopify" : "Manage orders in Shopify"}</a>}
    </div>
    {orders.isPending ? <p role="status">{ar ? "جارٍ التحميل..." : "Loading…"}</p> : orders.isError ? <div role="alert"><p>{ar ? "تعذر قراءة الطلبات من Shopify. تحققي من الاتصال والصلاحيات." : "Could not read Shopify orders. Check connection and permissions."}</p><button className="btn-outline mt-3" onClick={() => void orders.refetch()}>{ar ? "إعادة المحاولة" : "Retry"}</button></div> : <>
      <p className="text-xs mb-4">{ar ? "آخر تحديث: " : "Last refreshed: "}{new Date(orders.data.refreshedAt).toLocaleString(ar ? "ar-KW" : "en-GB")}</p>
      {!orders.data.orders.length && <p className="card-surface p-6">{ar ? "لا توجد طلبات في هذه الصفحة." : "No orders on this page."}</p>}
      <div className="grid md:grid-cols-2 gap-4">{orders.data.orders.map(order => <OrderDetails key={order.number} order={order} lang={lang} />)}</div>
      {orders.data.hasNextPage && <button className="btn-outline mt-5" disabled={orders.isFetching} onClick={() => setAfter(orders.data.endCursor)}>{ar ? "طلبات أقدم" : "Older orders"}</button>}
    </>}
  </section>;
}
