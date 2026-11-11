import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  LIVE_CURRENCY_CODES,
  parseLiveCurrencyRates,
  type LiveCurrencyCode,
  type LiveCurrencyRate,
} from "./live-currency-rates";

const FRANKFURTER_V2_URL =
  "https://api.frankfurter.dev/v2/rates?base=KWD&quotes=USD,EUR,GBP,SAR";

const text = {
  en: {
    subtitle: "Indicative daily reference rates, fetched directly from Frankfurter V2.",
    updated: "Rates updated",
    refreshed: "Last checked",
    refresh: "Refresh rates",
    refreshing: "Refreshing…",
    unavailable: "Unavailable",
    loading: "Loading live rates…",
    failed: "Live exchange rates could not be loaded. Please try again.",
    refreshFailed: "Refresh failed. Showing the last successfully loaded rates.",
    source: "Source: Frankfurter V2",
  },
  ar: {
    subtitle: "أسعار استرشادية يومية من واجهة Frankfurter V2 مباشرة.",
    updated: "تاريخ تحديث الأسعار",
    refreshed: "آخر تحقق",
    refresh: "تحديث الأسعار",
    refreshing: "جارٍ التحديث…",
    unavailable: "غير متاح",
    loading: "جارٍ تحميل الأسعار المباشرة…",
    failed: "تعذر تحميل أسعار الصرف المباشرة. يرجى المحاولة مجدداً.",
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
  const [rates, setRates] = useState<Partial<Record<LiveCurrencyCode, LiveCurrencyRate>>>({});
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(FRANKFURTER_V2_URL, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Frankfurter V2 returned HTTP ${response.status}.`);
      const parsed = parseLiveCurrencyRates(await response.json());
      if (controller.signal.aborted) return;
      setRates(parsed.rates);
      setLatestDate(parsed.latestDate);
      setLastChecked(new Date());
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => activeRequest.current?.abort();
  }, [refresh]);

  const hasRates = Object.keys(rates).length > 0;
  const dateLabel = latestDate ? formatDate(latestDate, lang) : null;

  return (
    <section
      aria-labelledby="live-currency-exchange-title"
      aria-busy={loading}
      className="container-wide py-10 md:py-14"
      data-testid="section-live-currency-exchange"
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
    >
      <div className="rounded-[26px] border border-[#efdee2] bg-[#fffdfa] p-5 shadow-[0_14px_40px_rgba(91,13,30,.06)] sm:p-7 md:p-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="eyebrow">{labels.source}</span>
            <h2 id="live-currency-exchange-title" className="serif mt-3 text-3xl text-[#5B0D1E] sm:text-4xl">
              Live Currency Exchange
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#795963]">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="btn-outline shrink-0 self-start disabled:cursor-wait disabled:opacity-60"
            data-testid="button-refresh-live-currency-rates"
            aria-label={labels.refresh}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {loading ? labels.refreshing : labels.refresh}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#896a71]" data-testid="live-currency-updated">
          <span>
            {labels.updated}:{" "}
            <strong className="font-semibold text-[#5B0D1E]">
              {dateLabel ?? (loading ? labels.loading : labels.unavailable)}
            </strong>
          </span>
          {lastChecked && <span>{labels.refreshed}: {formatTime(lastChecked, lang)}</span>}
        </div>

        {failed && (
          <p className="mt-4 rounded-xl border border-[#ead5da] bg-[#fff1f3] p-3 text-sm text-[#763246]" role="alert" data-testid="live-currency-error">
            {hasRates ? labels.refreshFailed : labels.failed}
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="live-currency-rates">
          {LIVE_CURRENCY_CODES.map((code) => {
            const item = rates[code];
            return (
              <article
                key={code}
                className="min-w-0 rounded-2xl border border-[#f0e1e4] bg-[#fff8f7] p-4 sm:p-5"
                data-testid={`live-currency-rate-${code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[#5B0D1E]">{formatCurrencyName(code, lang)}</h3>
                    <p className="mt-1 text-xs text-[#896a71]">{code}</p>
                  </div>
                  <strong className="shrink-0 text-end text-base text-[#5B0D1E]" dir="ltr">
                    {item ? `1 KWD = ${formatRate(item.rate, lang)} ${code}` : labels.unavailable}
                  </strong>
                </div>
                {item?.date && <p className="mt-3 text-[11px] text-[#896a71]">{labels.updated}: {formatDate(item.date, lang)}</p>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
