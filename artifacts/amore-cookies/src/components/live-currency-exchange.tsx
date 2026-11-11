import { RefreshCw } from "lucide-react";
import { LIVE_CURRENCY_CODES, type LiveCurrencyCode } from "./live-currency-rates";
import { useCurrency } from "@/lib/currency-context";

const FRANKFURTER_V2_URL =
  "https://api.frankfurter.dev/v2/rates?base=KWD&quotes=USD,EUR,GBP,SAR";

const text = {
  en: {
    updated: "Rates updated",
    refreshed: "Last checked",
    refresh: "Refresh rates",
    refreshing: "Refreshing…",
    unavailable: "Unavailable",
    loading: "Loading live rates…",
    failed: "Live exchange rates could not be loaded. Prices remain in KWD.",
    refreshFailed: "Refresh failed. Showing the last successfully loaded rates.",
    source: "Source: Frankfurter V2",
  },
  ar: {
    updated: "تاريخ تحديث الأسعار",
    refreshed: "آخر تحقق",
    refresh: "تحديث الأسعار",
    refreshing: "جارٍ التحديث…",
    unavailable: "غير متاح",
    loading: "جارٍ تحميل الأسعار المباشرة…",
    failed: "تعذر تحميل أسعار الصرف المباشرة. تبقى الأسعار بالدينار.",
    refreshFailed: "تعذر التحديث. تظهر آخر أسعار تم تحميلها بنجاح.",
    source: "المصدر: Frankfurter V2",
  },
} as const;

function formatCurrencyName(code: LiveCurrencyCode, lang: "en" | "ar") {
  return new Intl.DisplayNames([lang === "ar" ? "ar-KW" : "en"], { type: "currency" }).of(code) ?? code;
}

function formatRate(rate: number, lang: "en" | "ar") {
  return new Intl.NumberFormat(lang === "ar" ? "ar-KW" : "en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
  }).format(rate);
}

function formatDate(date: string, lang: "en" | "ar") {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatTime(date: Date, lang: "en" | "ar") {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function LiveCurrencyExchange({ lang }: { lang: "en" | "ar" }) {
  const labels = text[lang];
  const { rates, latestDate, lastChecked, loading, error: failed, refresh } = useCurrency();

  const hasRates = Object.keys(rates).length > 0;
  const dateLabel = latestDate ? formatDate(latestDate, lang) : null;

  return (
    <section
      id="live-currency-exchange"
      aria-labelledby="live-currency-exchange-title"
      aria-busy={loading}
      className="container-wide py-4 sm:py-5"
      data-testid="section-live-currency-exchange"
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
    >
      <div className="rounded-2xl border border-[#ead8dd] bg-[#fffdfa] px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="live-currency-exchange-title" className="font-display text-xl leading-tight text-[#5B0D1E] sm:text-2xl">
              Live Currency Exchange
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title={loading ? labels.refreshing : labels.refresh}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#e6ccd3] bg-[#fff8fa] text-[#5B0D1E] transition-colors hover:bg-[#FFD6E5] disabled:cursor-wait disabled:opacity-60"
            data-testid="button-refresh-live-currency-rates"
            aria-label={loading ? labels.refreshing : labels.refresh}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {failed && (
          <p className="mt-3 rounded-lg border border-[#ead5da] bg-[#fff1f3] px-3 py-2 text-xs leading-5 text-[#763246]" role="alert" data-testid="live-currency-error">
            {hasRates ? labels.refreshFailed : labels.failed}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="live-currency-rates">
          {LIVE_CURRENCY_CODES.map((code) => {
            const item = rates[code];
            return (
              <article
                key={code}
                className="min-w-0 rounded-xl border border-[#f0dfe3] bg-[#fff9f8] px-3 py-2.5"
                data-testid={`live-currency-rate-${code.toLowerCase()}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[11px] font-bold tracking-[.08em] text-[#5B0D1E]">{code}</h3>
                  <span className="truncate text-[9px] text-[#98737c]">{formatCurrencyName(code, lang)}</span>
                </div>
                <p className="mt-2 whitespace-nowrap text-[11px] font-semibold text-[#5B0D1E]" dir="ltr">
                  {item ? `1 KWD = ${formatRate(item.rate, lang)} ${code}` : loading ? <span aria-label={labels.loading}>…</span> : labels.unavailable}
                </p>
              </article>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#9a7a81]" data-testid="live-currency-updated">
          <span>{labels.updated}: <strong className="font-medium text-[#77535a]">{dateLabel ?? (loading ? labels.loading : labels.unavailable)}</strong></span>
          {lastChecked && <span>{labels.refreshed}: {formatTime(lastChecked, lang)}</span>}
          <span aria-hidden="true" className="text-[#d3abb5]">•</span>
          <a
            href={FRANKFURTER_V2_URL}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-[#e4cbd1] underline-offset-2 hover:text-[#5B0D1E]"
          >
            {labels.source}
          </a>
        </div>
      </div>
    </section>
  );
}
