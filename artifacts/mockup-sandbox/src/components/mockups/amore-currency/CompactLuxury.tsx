import "./_group.css";
import { RefreshCw } from "lucide-react";

const rates = [
  { code: "USD", name: "US Dollar", value: "3.233" },
  { code: "EUR", name: "Euro", value: "2.8848" },
  { code: "GBP", name: "British Pound", value: "2.4098" },
  { code: "SAR", name: "Saudi Riyal", value: "12.1238" },
];

export function CompactLuxury() {
  return (
    <main className="min-h-screen bg-[#fffaf8] py-2">
      <section className="container-wide py-4 sm:py-5" dir="ltr">
        <div className="rounded-2xl border border-[#ead8dd] bg-[#fffdfa] px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[.2em] text-[#9d5367]">Frankfurter V2 · Live rates</p>
              <h2 className="font-display mt-1 text-xl leading-tight text-[#5B0D1E] sm:text-2xl">Live Currency Exchange</h2>
            </div>
            <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#e6ccd3] bg-[#fff8fa] text-[#5B0D1E] transition-colors hover:bg-[#FFD6E5]" aria-label="Refresh live rates" title="Refresh rates">
              <RefreshCw size={13}/>
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {rates.map(rate => (
              <article key={rate.code} className="min-w-0 rounded-xl border border-[#f0dfe3] bg-[#fff9f8] px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-bold tracking-[.08em] text-[#5B0D1E]">{rate.code}</span>
                  <span className="truncate text-[9px] text-[#98737c]">{rate.name}</span>
                </div>
                <p className="mt-2 whitespace-nowrap text-[11px] font-semibold text-[#5B0D1E]" dir="ltr">1 KWD = {rate.value} {rate.code}</p>
              </article>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#9a7a81]">
            <span>Rates updated November 11, 2026</span>
            <span aria-hidden="true" className="text-[#d3abb5]">•</span>
            <span>Last checked 6:55 AM</span>
            <span aria-hidden="true" className="text-[#d3abb5]">•</span>
            <a href="https://api.frankfurter.dev/v2/rates?base=KWD&amp;quotes=USD,EUR,GBP,SAR" target="_blank" rel="noreferrer" className="underline decoration-[#e4cbd1] underline-offset-2 hover:text-[#5B0D1E]">Frankfurter V2 source</a>
          </div>
        </div>
      </section>
    </main>
  );
}
