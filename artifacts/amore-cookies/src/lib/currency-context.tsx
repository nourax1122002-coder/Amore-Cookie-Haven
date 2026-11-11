import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LIVE_CURRENCY_CODES,
  parseLiveCurrencyRates,
  type LiveCurrencyRate,
} from "@/components/live-currency-rates";

export type DisplayCurrency = "KWD" | (typeof LIVE_CURRENCY_CODES)[number];
export type CurrencyLanguage = "en" | "ar";

const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = [
  "KWD",
  ...LIVE_CURRENCY_CODES,
];
const DISPLAY_CURRENCY_STORAGE_KEY = "amore-display-currency";
const FRANKFURTER_RATES_URL =
  "https://api.frankfurter.dev/v2/rates?base=KWD&quotes=USD,EUR,GBP,SAR";

type CurrencyContextValue = {
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
  rates: Partial<Record<(typeof LIVE_CURRENCY_CODES)[number], LiveCurrencyRate>>;
  latestDate: string | null;
  lastChecked: Date | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  formatAmount: (
    amount: number | string,
    sourceCurrency: string,
    lang: CurrencyLanguage,
  ) => string;
  rateFor: (currency: DisplayCurrency) => number | null;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

function isDisplayCurrency(value: string | null): value is DisplayCurrency {
  return value !== null && DISPLAY_CURRENCIES.includes(value as DisplayCurrency);
}

export function formatCurrencyAmount(
  amount: number,
  currency: string,
  lang: CurrencyLanguage,
) {
  if (!Number.isFinite(amount)) return `— ${currency}`;
  const digits = currency === "KWD" ? 3 : 2;
  const locale = lang === "ar" ? "ar-KW" : "en-KW";
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  return `${currency} ${formatted}`;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>(() => {
    try {
      if (typeof window === "undefined") return "KWD";
      const stored = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
      return isDisplayCurrency(stored) ? stored : "KWD";
    } catch {
      return "KWD";
    }
  });
  const [rates, setRates] = useState<
    Partial<Record<(typeof LIVE_CURRENCY_CODES)[number], LiveCurrencyRate>>
  >({});
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const setCurrency = useCallback((next: DisplayCurrency) => {
    setCurrencyState(next);
    try {
      window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory selection usable when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const syncCurrency = (event: StorageEvent) => {
      if (event.key !== DISPLAY_CURRENCY_STORAGE_KEY) return;
      setCurrencyState(isDisplayCurrency(event.newValue) ? event.newValue : "KWD");
    };
    window.addEventListener("storage", syncCurrency);
    return () => window.removeEventListener("storage", syncCurrency);
  }, []);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(FRANKFURTER_RATES_URL, {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Frankfurter returned HTTP ${response.status}`);
      }
      const parsed = parseLiveCurrencyRates(await response.json());
      setRates(parsed.rates);
      setLatestDate(parsed.latestDate);
      setLastChecked(new Date());
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(true);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  const rateFor = useCallback(
    (target: DisplayCurrency) => {
      if (target === "KWD") return 1;
      const rate = rates[target]?.rate;
      return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
    },
    [rates],
  );

  const formatAmount = useCallback(
    (rawAmount: number | string, sourceCurrency: string, lang: CurrencyLanguage) => {
      const amount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
      if (!Number.isFinite(amount)) return `— ${sourceCurrency}`;
      if (sourceCurrency !== "KWD" || currency === "KWD") {
        return formatCurrencyAmount(amount, sourceCurrency, lang);
      }
      const rate = rateFor(currency);
      return rate === null
        ? formatCurrencyAmount(amount, "KWD", lang)
        : formatCurrencyAmount(amount * rate, currency, lang);
    },
    [currency, rateFor],
  );

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        latestDate,
        lastChecked,
        loading,
        error,
        refresh,
        formatAmount,
        rateFor,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used inside CurrencyProvider.");
  }
  return context;
}
