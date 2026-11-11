import "./_group.css";
import { RefreshCw } from "lucide-react";

const rates = [
  { code: "USD", name: "US Dollar", value: "3.233" },
  { code: "EUR", name: "Euro", value: "2.8848" },
  { code: "GBP", name: "British Pound", value: "2.4098" },
  { code: "SAR", name: "Saudi Riyal", value: "12.1238" },
];

export function Current() {
  return (
    <main className="min-h-screen bg-[#fffaf8] py-2">
      <section className="container-wide py-10 md:py-14" dir="ltr">
        <div className="rounded-[26px] border border-[#efdee2] bg-[#fffdfa] p-5 shadow-[0_14px_40px_rgba(91,13,30,.06)] sm:p-7 md:p-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <span className="eyebrow">Source: Frankfurter V2</span>
              <h2 className="serif mt-3 text-3xl text-[#5B0D1E] sm:text-4xl">Live Currency Exchange</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#795963]">Indicative daily reference rates, fetched directly from Frankfurter V2.</p>
            </div>
            <button type="button" className="btn-outline shrink-0 self-start" aria-label="Refresh rates">
              <RefreshCw size={15}/>Refresh rates
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#896a71]">
            <span>Rates updated: <strong className="font-semibold text-[#5B0D1E]">November 11, 2026</strong></span>
            <span>Last checked: 6:55 AM</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rates.map(rate => (
              <article key={rate.code} className="min-w-0 rounded-2xl border border-[#f0e1e4] bg-[#fff8f7] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[#5B0D1E]">{rate.name}</h3>
                    <p className="mt-1 text-xs text-[#896a71]">{rate.code}</p>
                  </div>
                  <strong className="shrink-0 text-end text-base text-[#5B0D1E]" dir="ltr">1 KWD = {rate.value} {rate.code}</strong>
                </div>
                <p className="mt-3 text-[11px] text-[#896a71]">Rates updated: November 11, 2026</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
