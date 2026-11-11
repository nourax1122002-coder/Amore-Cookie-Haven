import { useRef } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { LIVE_CURRENCY_CODES } from "@/components/live-currency-rates";
import {
  type CurrencyLanguage,
  type DisplayCurrency,
  useCurrency,
} from "@/lib/currency-context";

const currencies: readonly DisplayCurrency[] = ["KWD", ...LIVE_CURRENCY_CODES];
const ratesUrl =
  "https://api.frankfurter.dev/v2/rates?base=KWD&quotes=USD,EUR,GBP,SAR";

export function CurrencySelector({ lang }: { lang: CurrencyLanguage }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const {
    currency,
    setCurrency,
    rates,
    rateFor,
    latestDate,
    loading,
    error,
    refresh,
  } = useCurrency();
  const ar = lang === "ar";
  const dateLabel = latestDate
    ? new Intl.DateTimeFormat(ar ? "ar-KW" : "en-KW", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${latestDate}T00:00:00Z`))
    : ar
      ? "غير متاح"
      : "Unavailable";
  const statusMessage = loading
    ? ar
      ? "جارٍ تحديث الأسعار…"
      : "Updating live rates…"
    : error
      ? Object.keys(rates).length > 0
        ? ar
          ? "تعذر التحديث؛ تُستخدم آخر أسعار متاحة."
          : "Refresh failed; using the last available rates."
        : ar
          ? "الأسعار المباشرة غير متاحة؛ تُعرض الأسعار بالدينار."
          : "Live rates are unavailable; prices remain in KWD."
      : currency !== "KWD" && rateFor(currency) === null
        ? ar
          ? "سعر هذه العملة غير متاح؛ تبقى الأسعار بالدينار."
          : "This currency pair is unavailable; prices remain in KWD."
        : null;

  return (
    <details
      ref={menuRef}
      className="relative shrink-0"
      data-testid="navbar-currency-menu"
    >
      <summary
        className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-[#e9d2d8] bg-[#fffdfb] px-2.5 py-2 text-[10px] font-semibold text-[#5B0D1E] transition-colors hover:bg-[#fff1f3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B0D1E] sm:px-3"
        aria-label={`${ar ? "العملة" : "Currency"}: ${currency}`}
        data-testid="button-navbar-currency"
      >
        <span className="hidden sm:inline">{ar ? "العملة" : "Currency"}</span>
        <span dir="ltr">{currency}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div
        className="absolute end-0 top-full z-50 mt-2 w-56 rounded-2xl border border-[#ead5da] bg-[#fffdfa] p-3 text-[#5B0D1E] shadow-[0_12px_35px_rgba(91,13,30,.14)]"
        dir={ar ? "rtl" : "ltr"}
      >
        <p className="mb-2 text-[11px] font-semibold">
          {ar ? "عملة العرض" : "Display currency"}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {currencies.map((code) => {
            const active = currency === code;
            const supported = rateFor(code) !== null;
            return (
              <button
                key={code}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCurrency(code);
                  if (menuRef.current) menuRef.current.open = false;
                }}
                className={`rounded-xl border px-3 py-2 text-start text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5B0D1E] ${
                  active
                    ? "border-[#5B0D1E] bg-[#5B0D1E] font-semibold text-white"
                    : "border-[#f0e1e4] bg-white text-[#5B0D1E] hover:bg-[#fff1f3]"
                }`}
                data-testid={`button-select-currency-${code}`}
              >
                <span dir="ltr">{code}</span>
                {code !== "KWD" && !supported && (
                  <span className="ms-1 text-[9px] opacity-70">—</span>
                )}
              </button>
            );
          })}
        </div>
        {statusMessage && (
          <p
            className={`mt-2 text-[10px] leading-4 ${
              error ? "text-[#9b3d4c]" : "text-[#795963]"
            }`}
            role={error ? "alert" : "status"}
            data-testid="currency-rate-status"
          >
            {statusMessage}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f0e1e4] pt-2 text-[9px] leading-4 text-[#896a71]">
          <span data-testid="currency-last-updated">{ar ? "آخر تحديث" : "Updated"}: {dateLabel}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={ar ? "تحديث أسعار الصرف" : "Refresh exchange rates"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#ead5da] text-[#5B0D1E] transition-colors hover:bg-[#FFD6E5] disabled:opacity-50"
            data-testid="button-refresh-currency-rates"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <a
          className="mt-1 inline-block text-[9px] text-[#896a71] underline decoration-[#d8bfc5] underline-offset-2 hover:text-[#5B0D1E]"
          href={ratesUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="link-currency-rate-source"
        >
          Frankfurter V2
        </a>
      </div>
    </details>
  );
}
