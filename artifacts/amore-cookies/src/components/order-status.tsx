import type { OrderStatus } from "@workspace/api-client-react";

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
const payments: Record<string, [string, string]> = {
  PAID: ["Paid", "مدفوع"],
  PENDING: ["Pending", "قيد التحقق"],
  CREATING: ["Preparing checkout", "جارٍ تجهيز الدفع"],
  FAILED: ["Failed", "لم ينجح"],
  CANCELLED: ["Cancelled", "ملغي"],
  REFUNDED: ["Refunded", "مسترد"],
  PARTIALLY_REFUNDED: ["Partially refunded", "مسترد جزئياً"],
  REVIEW: ["Needs review", "بحاجة إلى مراجعة"],
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
      <div><dt className="inline">{ar ? "الدفع: " : "Payment: "}</dt><dd className="inline">{payments[order.financialStatus]?.[ar ? 1 : 0] ?? order.financialStatus}</dd></div>
      <div><dt className="inline">{ar ? "تنفيذ الطلب: " : "Fulfillment: "}</dt><dd className="inline" dir="ltr">{order.fulfillmentStatus}</dd></div>
    </dl>
    <ul className="mt-4 grid gap-2">{order.items.map((item, i) => <li key={i} className="flex justify-between gap-4 text-xs"><span>{item.title}</span><span>× {item.quantity}</span></li>)}</ul>
    <p className="mt-4 font-semibold" dir="ltr">{order.total} {order.currency}</p>
    <p className="mt-3 text-[11px] leading-5 text-[#795963]">{ar ? "المصدر: متجر أموري. تظهر الحالة المسجلة فقط؛ الشحن لا يعني اكتمال التوصيل." : "Source: Amore Cookies. Only the recorded status is shown; shipped does not mean delivered."}</p>
  </article>;
}
