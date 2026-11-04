import { useEffect } from "react";
import { Link } from "wouter";
import {
  useGetPaymentOrder, useListLocalOrders, useReconcileLocalOrder, useUpdateLocalOrder,
  getGetCartQueryKey, getListLocalOrdersQueryKey, type LocalOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { OrderDetails } from "./order-status";

type Lang = "ar" | "en";
export function PaymentResult({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  const params = new URLSearchParams(window.location.search);
  const id = params.get("order") ?? "", token = params.get("token") ?? "";
  const valid = /^[a-f0-9-]{36}$/.test(id) && /^[a-f0-9]{64}$/.test(token);
  const qc = useQueryClient();
  const q = useGetPaymentOrder({ id, token }, { query: {
    enabled: valid, retry: false, refetchInterval: query =>
      query.state.data?.financialStatus === "PAID" ? false : 10000,
  } });
  const status = q.data?.financialStatus;
  useEffect(() => {
    document.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex, nofollow");
    const oldTitle = document.title;
    document.title = ar ? "حالة الدفع | أموري كوكيز" : "Payment status | Amore Cookies";
    return () => { document.title = oldTitle; document.querySelector('meta[name="robots"]')?.setAttribute("content", "index, follow"); };
  }, [ar]);
  useEffect(() => { if (status === "PAID") qc.invalidateQueries({ queryKey: getGetCartQueryKey() }); }, [status, qc]);
  const title = !valid || q.isError ? (ar ? "تعذر التحقق من الطلب" : "Unable to verify this order")
    : q.isLoading ? (ar ? "جارٍ التحقق من الدفع" : "Checking payment")
    : status === "PAID" ? (ar ? "تم الدفع بنجاح" : "Payment confirmed")
    : status === "FAILED" ? (ar ? "لم تنجح محاولة الدفع" : "Payment attempt failed")
    : status === "CANCELLED" ? (ar ? "تم إلغاء محاولة الدفع" : "Payment attempt cancelled")
    : (ar ? "الدفع قيد التحقق" : "Payment verification pending");
  return <section className="container-wide py-16 max-w-3xl">
    <span className="eyebrow">Amore Cookies</span><h1 className="serif text-4xl text-[#5B0D1E] mt-4" role="status">{title}</h1>
    <p className="mt-5 text-sm leading-7 text-[#795963]">{status === "PAID"
      ? (ar ? "تأكدنا من عملية الدفع لدى ماي فاتورة. احتفظي برقم الطلب للمتابعة." : "Your payment was verified with MyFatoorah. Keep your order number for tracking.")
      : (ar ? "لا تُعتبر زيارة هذه الصفحة إثباتاً للدفع. نعتمد فقط الحالة المؤكدة من مزود الدفع. لا تعيدي الدفع إذا كانت العملية قيد التحقق." : "Opening this page is not proof of payment. Only the provider-verified status counts. Do not pay again while verification is pending.")}</p>
    {q.data&&<div className="mt-7"><OrderDetails order={q.data} lang={lang}/></div>}
    {valid&&<button className="btn-outline mt-6" disabled={q.isFetching} onClick={()=>q.refetch()}>{ar?'تحديث الحالة':'Refresh status'}</button>}
    <Link href="/tracking" className="btn-primary mt-6 ms-3">{ar?'تتبع الطلب':'Track order'}</Link>
  </section>;
}
function LocalOrderCard({ order, lang, refresh }: { order: LocalOrder; lang: Lang; refresh: () => void }) {
  const ar = lang === "ar";
  const update = useUpdateLocalOrder(), reconcile = useReconcileLocalOrder();
  const next: Record<string, string> = { confirmed: "preparing", preparing: "out_for_delivery", out_for_delivery: "delivered" };
  const stage = next[order.stage];
  const label: Record<string, string> = ar ? { preparing: "بدء التجهيز", out_for_delivery: "خرج للتوصيل", delivered: "تم التوصيل" }
    : { preparing: "Start preparing", out_for_delivery: "Out for delivery", delivered: "Delivered" };
  return <article className="grid gap-3 card-surface p-4">
    <OrderDetails order={order} lang={lang}/>
    <p className="text-xs" dir="ltr">{order.phone}</p>
    <p className="text-xs leading-6">{ar?'العنوان':'Address'}: {order.address.area} · {ar?'قطعة':'Block'} {order.address.block} · {ar?'شارع':'Street'} {order.address.street} · {ar?'منزل':'House'} {order.address.house}</p>
    {order.note&&<p className="text-xs">{order.note}</p>}
    <p className="text-xs text-[#795963]">{ar?'التوصيل':'Delivery'}: {order.shipping} KWD · {ar?'حالة المخزون':'Inventory'}: {order.stockStatus}</p>
    <div className="flex flex-wrap gap-3">
      {order.financialStatus==='PAID'&&order.stockStatus==='reserved'&&stage&&<button className="btn-primary" disabled={update.isPending} onClick={()=>update.mutate({id:order.id,data:{stage:stage as 'preparing'|'out_for_delivery'|'delivered'}},{onSuccess:refresh})}>{label[stage]}</button>}
      {order.financialStatus!=='PAID'&&<button className="btn-outline" disabled={reconcile.isPending} onClick={()=>reconcile.mutate({id:order.id},{onSuccess:refresh})}>{ar?'التحقق من الدفع':'Recheck payment'}</button>}
    </div>
    {(update.isError||reconcile.isError)&&<p role="alert" className="text-xs text-red-700">{update.error?.message||reconcile.error?.message}</p>}
  </article>;
}
export function LocalOrdersAdmin({ lang }: { lang: Lang }) {
  const ar = lang === "ar", qc = useQueryClient();
  const q = useListLocalOrders({ query: { refetchInterval: 30000 } });
  const refresh = () => { qc.invalidateQueries({ queryKey: getListLocalOrdersQueryKey() }); };
  return <section className="grid gap-5">
    <div className="flex justify-between gap-4 items-center"><h2 className="font-display text-2xl text-[#5B0D1E]">{ar?'طلبات أموري ومدفوعات ماي فاتورة':'Amore orders & MyFatoorah payments'}</h2><button className="btn-outline" onClick={()=>q.refetch()}>{ar?'تحديث':'Refresh'}</button></div>
    <p className="text-xs leading-6 text-[#795963]">{ar?'الطلبات الجديدة تُدار هنا. تأكيد الدفع آلي بعد التحقق من ماي فاتورة ولا يمكن تحديده يدوياً.':'New orders are managed here. Payment is confirmed automatically through MyFatoorah verification and cannot be set manually.'}</p>
    {q.isLoading&&<p>{ar?'جارٍ التحميل…':'Loading…'}</p>}
    {q.isError&&<p role="alert">{ar?'تعذر تحميل الطلبات.':'Orders could not be loaded.'}</p>}
    {q.data?.length===0&&<p className="card-surface p-6 text-sm">{ar?'لا توجد طلبات محلية بعد.':'No local orders yet.'}</p>}
    {q.data?.map(order=><LocalOrderCard key={order.id} order={order} lang={lang} refresh={refresh}/>)}
  </section>;
}
