import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Award, Check, Lightbulb, LoaderCircle, RefreshCw, Send, Sparkles,
} from "lucide-react";
import type {
  AdminFlavorRewards,
  AdminFlavorPaymentReviews,
  CreatorFlavorRewards,
  FlavorIdea,
  PublicFlavorIdea,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";

type Lang = "ar" | "en";
type DraftFields = {
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  ingredients: string;
  ingredientsAr: string;
};
type ChatMessage = { role: "user" | "assistant"; content: string };

const emptyDraft = (): DraftFields => ({
  title: "", titleAr: "", description: "", descriptionAr: "", ingredients: "", ingredientsAr: "",
});

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      && typeof payload.error === "string" ? payload.error : "The Flavor Rewards service is unavailable.";
    throw new Error(message);
  }
  return payload as T;
}

function errorText(error: unknown, lang: Lang) {
  return error instanceof Error && error.message
    ? error.message
    : lang === "ar" ? "تعذر إكمال الطلب. حاولي مرة أخرى." : "The request could not be completed. Please retry.";
}

function kwd(fils: number, lang: Lang) {
  return `${(fils / 1000).toFixed(3)} KWD`;
}

function dateLabel(value: string, lang: Lang) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(lang === "ar" ? "ar-KW" : "en-GB");
}

function TextField({
  label, value, onChange, multiline = false, maxLength, required = false, minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength: number;
  required?: boolean;
  minLength?: number;
}) {
  const className = "mt-1 w-full rounded-xl border border-[#ead6dc] bg-white/80 px-3.5 py-3 text-sm text-[#5B0D1E] outline-none transition focus:border-[#5B0D1E] focus:ring-2 focus:ring-[#FFD6E5]";
  return <label className="block text-xs font-semibold text-[#795963]">
    {label}
    {multiline
      ? <textarea required={required} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} className={`${className} min-h-24 resize-y`} />
      : <input required={required} minLength={minLength} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} className={className} />}
  </label>;
}

export function FlavorRewardsPage({ lang }: { lang: Lang }) {
  const { user } = useAuth();
  const [publicIdeas, setPublicIdeas] = useState<PublicFlavorIdea[]>([]);
  const [wallet, setWallet] = useState<CreatorFlavorRewards | null>(null);
  const [loading, setLoading] = useState(true);
  const [publicError, setPublicError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [busySave, setBusySave] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([]);
  const [assistantModel, setAssistantModel] = useState("");
  const ar = lang === "ar";

  const refresh = useCallback(async () => {
    setLoading(true);
    setPublicError("");
    setAccountError("");
    try {
      const items = await api<PublicFlavorIdea[]>("/api/flavor-rewards");
      setPublicIdeas(items);
    } catch (error) {
      setPublicError(errorText(error, lang));
    }
    if (user) {
      try {
        const currentWallet = await api<CreatorFlavorRewards>("/api/account/flavor-rewards");
        setWallet(currentWallet);
      } catch (error) {
        setAccountError(errorText(error, lang));
        setWallet(null);
      }
    } else {
      setWallet(null);
    }
    setLoading(false);
  }, [lang, user]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, user]);

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusySave(true);
    setFormError("");
    setMessage("");
    try {
      const payload = {
        title: draft.title,
        titleAr: draft.titleAr,
        description: draft.description,
        descriptionAr: draft.descriptionAr,
        ingredients: draft.ingredients,
        ingredientsAr: draft.ingredientsAr,
      };
      let saved: FlavorIdea;
      if (editingId) {
        saved = await api<FlavorIdea>(`/api/flavor-rewards/drafts/${editingId}`, "PATCH", payload);
      } else {
        saved = await api<FlavorIdea>("/api/flavor-rewards/drafts", "POST", { ...payload, requestKey });
        setRequestKey(crypto.randomUUID());
        setEditingId(saved.id);
      }
      setMessage(ar ? "تم حفظ المسودة في حسابك." : "Draft saved to your account.");
      await refresh();
    } catch (error) {
      setFormError(errorText(error, lang));
    } finally {
      setBusySave(false);
    }
  };

  const publish = async (id: string) => {
    setBusySave(true);
    setFormError("");
    try {
      await api<FlavorIdea>(`/api/flavor-rewards/drafts/${id}/publish`, "POST", {});
      setMessage(ar ? "أصبحت الفكرة منشورة للمهتمين." : "Your flavor idea is now published.");
      await refresh();
    } catch (error) {
      setFormError(errorText(error, lang));
    } finally {
      setBusySave(false);
    }
  };

  const editIdea = (item: FlavorIdea) => {
    setEditingId(item.id);
    setDraft({
      title: item.title, titleAr: item.titleAr, description: item.description,
      descriptionAr: item.descriptionAr, ingredients: item.ingredients, ingredientsAr: item.ingredientsAr,
    });
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const askAssistant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || assistantBusy) return;
    setAssistantBusy(true);
    setAssistantError("");
    const nextMessages: ChatMessage[] = [...assistantMessages, { role: "user", content }];
    try {
      const result = await api<{ reply: string; model: string; zeroCostVerified: boolean }>(
        "/api/flavor-rewards/assistant", "POST", { language: lang, messages: nextMessages },
      );
      setAssistantMessages([...nextMessages, { role: "assistant", content: result.reply }]);
      setAssistantModel(result.model);
      setPrompt("");
    } catch (error) {
      setAssistantError(errorText(error, lang));
    } finally {
      setAssistantBusy(false);
    }
  };

  return <div className="container-wide py-10 md:py-16" dir={ar ? "rtl" : "ltr"}>
    <section className="relative overflow-hidden rounded-[30px] border border-[#f0dce2] bg-gradient-to-br from-[#fffaf8] via-white to-[#fff0f5] px-6 py-9 md:px-12 md:py-12">
      <div className="pointer-events-none absolute -end-10 -top-12 h-48 w-48 rounded-full bg-[#FFD6E5]/50 blur-3xl" />
      <div className="relative max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full bg-[#FFD6E5]/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-[#5B0D1E]">
          <Sparkles size={13} /> {ar ? "من مجتمع أموري" : "From the Amore community"}
        </span>
        <h1 className="mt-4 font-display text-4xl text-[#5B0D1E] md:text-6xl">{ar ? "مكافآت النكهات" : "Flavor Rewards"}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[#795963] md:text-base">
          {ar
            ? "ابتكري نكهة وشاركيها مع مجتمع أموري. تُحتسب المكافأة بعد 100 طلب مدفوع ومؤكد مؤهل، وليس من تسجيلات الاهتمام. لا تُحتسب أي مكافآت حتى ربط سجل الدفع الموثق."
            : "Create a flavor and share it with the Amore community. The bonus is based on 100 verified eligible paid orders, never on interest registrations. Rewards stay paused until verified payment records are connected."}
        </p>
        <p className="mt-3 text-[11px] leading-5 text-[#896a71]">
          {ar
            ? "تُحتسب عمولة 15٪ ابتداءً من الطلب المؤهل رقم 101. تسجيلات الاهتمام للعرض فقط، ولا تُنشئ رصيداً أو مكافأة."
            : "A 15% commission applies only from eligible order 101 onward. Interest registrations are informational and do not create rewards or balances."}
        </p>
      </div>
    </section>

    <div className="mt-10 grid items-start gap-8 xl:grid-cols-[1.1fr_.9fr]">
      <section aria-labelledby="community-flavors-heading">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <span className="eyebrow">{ar ? "أفكار المجتمع" : "Community ideas"}</span>
            <h2 id="community-flavors-heading" className="mt-1 font-display text-3xl text-[#5B0D1E]">
              {ar ? "نكهات اقترحها محبو أموري" : "Flavors imagined by Amore"}
            </h2>
          </div>
          <button type="button" onClick={() => void refresh()} className="btn-outline shrink-0 px-3 py-2" aria-label={ar ? "تحديث الأفكار" : "Refresh ideas"}>
            <RefreshCw size={14} /> <span className="hidden sm:inline">{ar ? "تحديث" : "Refresh"}</span>
          </button>
        </div>
        {publicError && <p role="alert" className="mb-4 rounded-xl bg-[#fff1f3] p-4 text-xs leading-6 text-[#763246]">{publicError}</p>}
        {loading && publicIdeas.length === 0
          ? <div className="card-surface p-8 text-center text-sm text-[#896a71]"><LoaderCircle className="mx-auto mb-3 animate-spin" size={20}/>{ar ? "جارٍ تحميل الأفكار…" : "Loading ideas…"}</div>
          : publicIdeas.length === 0
            ? <div className="card-surface p-8 text-center">
              <Lightbulb size={24} className="mx-auto text-[#9d6877]"/>
              <p className="mt-3 text-sm text-[#795963]">{ar ? "لا توجد أفكار منشورة بعد. كوني أول من يقترح نكهة." : "No published ideas yet. Be the first to suggest a flavor."}</p>
            </div>
            : <div className="grid gap-4 md:grid-cols-2">
              {publicIdeas.map(item => <PublicIdeaCard key={item.id} idea={item} lang={lang}/>)}
            </div>}
        {formError && <p role="alert" className="mt-4 text-xs leading-5 text-red-700">{formError}</p>}
      </section>

      <div className="grid gap-6">
        <section className="card-surface p-5 md:p-7">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FFD6E5] text-[#5B0D1E]"><Lightbulb size={18}/></span>
            <div><span className="eyebrow">{ar ? "صمّمي اقتراحك" : "Create a suggestion"}</span>
              <h2 className="mt-1 font-display text-2xl text-[#5B0D1E]">{ar ? "نكهتك تبدأ من هنا" : "Start with your flavor"}</h2>
            </div>
          </div>
          {!user
            ? <div className="mt-5 rounded-2xl bg-[#fff5f7] p-5">
              <p className="text-sm leading-6 text-[#795963]">{ar ? "سجّلي الدخول لحفظ فكرتك والمشاركة في مكافآت النكهات." : "Sign in to save an idea and take part in Flavor Rewards."}</p>
              <Link href="/sign-in" className="btn-primary mt-4">{ar ? "تسجيل الدخول" : "Sign in"}<ArrowRight size={14}/></Link>
            </div>
            : loading && !wallet
              ? <p className="mt-5 rounded-xl bg-[#fff6f8] p-4 text-xs leading-5 text-[#795963]" role="status">
                {ar ? "جارٍ التحقق من فكرتك الحالية…" : "Checking your existing idea…"}
              </p>
              : !wallet
                ? <p className="mt-5 rounded-xl bg-[#fff1f3] p-4 text-xs leading-5 text-[#763246]" role="alert">
                  {accountError || (ar ? "تعذر التحقق من فكرتك. حدّثي الصفحة قبل إنشاء أي فكرة." : "Your idea could not be checked. Refresh before creating an idea.")}
                </p>
                : wallet.ideas.length > 0 && !editingId
                  ? <div className="mt-5 rounded-2xl bg-[#fff5f7] p-5">
                    <p className="text-sm leading-6 text-[#795963]">
                      {ar ? "استخدمتِ بالفعل فرصة إنشاء فكرة واحدة لهذا الحساب. يمكنك تعديل مسودتك الحالية من مساحة المبدعة أدناه." : "This account has already used its one idea. You can edit your existing draft in Creator space below."}
                    </p>
                  </div>
                  : <form className="mt-5 grid gap-4" onSubmit={saveDraft}>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField required label={ar ? "اسم النكهة بالإنجليزية" : "Flavor name"} value={draft.title} onChange={value => setDraft(current => ({ ...current, title: value }))} maxLength={120}/>
                <TextField required minLength={2} label={ar ? "اسم النكهة بالعربية" : "Arabic flavor name"} value={draft.titleAr} onChange={value => setDraft(current => ({ ...current, titleAr: value }))} maxLength={120}/>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField multiline label={ar ? "وصف مختصر بالإنجليزية" : "Short description"} value={draft.description} onChange={value => setDraft(current => ({ ...current, description: value }))} maxLength={1200}/>
                <TextField multiline label={ar ? "وصف مختصر بالعربية" : "Arabic description"} value={draft.descriptionAr} onChange={value => setDraft(current => ({ ...current, descriptionAr: value }))} maxLength={1200}/>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField multiline label={ar ? "المكونات المقترحة بالإنجليزية" : "Suggested ingredients"} value={draft.ingredients} onChange={value => setDraft(current => ({ ...current, ingredients: value }))} maxLength={1200}/>
                <TextField multiline label={ar ? "المكونات المقترحة بالعربية" : "Suggested ingredients in Arabic"} value={draft.ingredientsAr} onChange={value => setDraft(current => ({ ...current, ingredientsAr: value }))} maxLength={1200}/>
              </div>
              <article className="rounded-2xl border border-[#ead6dc] bg-[#fffaf8] p-4" aria-live="polite" aria-label={ar ? "معاينة الفكرة" : "Idea preview"}>
                <span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#9a6776]">{ar ? "معاينة مسودتك" : "Draft preview"}</span>
                <h3 className="mt-1 font-display text-xl text-[#5B0D1E]">
                  {ar ? draft.titleAr || "اسم النكهة" : draft.title || "Flavor name"}
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#795963]">
                  {ar ? draft.descriptionAr || "سيظهر وصف النكهة هنا." : draft.description || "Your flavor description will appear here."}
                </p>
                {(draft.ingredients || draft.ingredientsAr) && <p className="mt-2 whitespace-pre-wrap text-[10px] leading-5 text-[#896a71]">
                  <strong>{ar ? "المكونات: " : "Ingredients: "}</strong>{ar ? draft.ingredientsAr || draft.ingredients : draft.ingredients || draft.ingredientsAr}
                </p>}
              </article>
              {message && <p role="status" className="text-xs text-[#5B0D1E]">{message}</p>}
              {formError && <p role="alert" className="text-xs text-red-700">{formError}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={busySave} className="btn-primary disabled:opacity-50">
                  {busySave ? <LoaderCircle size={14} className="animate-spin"/> : <Check size={14}/>}
                  {editingId ? (ar ? "حفظ التعديلات" : "Save changes") : (ar ? "حفظ كمسودة" : "Save draft")}
                </button>
              </div>
            </form>}
        </section>

        {user && <FlavorAssistant
          lang={lang} messages={assistantMessages} prompt={prompt} busy={assistantBusy}
          error={assistantError} model={assistantModel}
          setPrompt={setPrompt} onAsk={askAssistant}
          onUseSuggestion={content => setDraft(current => ({
            ...current,
            description: lang === "en" ? content : current.description,
            descriptionAr: lang === "ar" ? content : current.descriptionAr,
          }))}
        />}
      </div>
    </div>

    {user && <section className="mt-10" aria-labelledby="creator-wallet-heading">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div><span className="eyebrow">{ar ? "مساحة المبدعة" : "Creator space"}</span>
          <h2 id="creator-wallet-heading" className="mt-1 font-display text-3xl text-[#5B0D1E]">{ar ? "أفكارك ورصيدك" : "Your ideas & rewards"}</h2>
        </div>
        <button type="button" onClick={() => void refresh()} className="text-xs font-semibold text-[#795963] underline">{ar ? "تحديث" : "Refresh"}</button>
      </div>
      {accountError && <p role="alert" className="mb-4 rounded-xl bg-[#fff1f3] p-4 text-xs text-[#763246]">{accountError}</p>}
      {wallet && <div className="grid gap-5">
        <section aria-label={ar ? "أداء النكهة الموثق" : "Verified flavor performance"} className="grid gap-4">
          {wallet.performanceStatus === "migration_required"
            ? <div className="rounded-2xl border border-[#ead6dc] bg-[#fffaf8] p-5 text-sm leading-6 text-[#795963]" role="status">
              {ar
                ? "لوحة الأداء الموثق بانتظار اعتماد وإتاحة جداول سجل المدفوعات. لن نعرض أرصدة تقديرية أو عمليات شراء تجريبية."
                : "The verified performance dashboard is waiting for the approved payment-ledger tables. No estimated balances or simulated purchases are shown."}
            </div>
            : wallet.performanceFlavors.length === 0
              ? <div className="rounded-2xl border border-[#ead6dc] bg-[#fffaf8] p-5 text-sm leading-6 text-[#795963]">
                {ar ? "لا توجد نكهة منشورة لعرض أداء الطلبات حتى الآن." : "There is no published flavor with performance to display yet."}
              </div>
              : <div className="grid gap-4 xl:grid-cols-2">
                {wallet.performanceFlavors.map(performance =>
                  <CreatorPerformanceCard key={performance.flavorId} performance={performance} lang={lang}/>)}
              </div>}
          <p className="rounded-xl bg-[#fff6f8] px-4 py-3 text-[11px] leading-5 text-[#795963]" role="note">
            {ar
              ? "يُحدّث الأداء تلقائياً كل دقيقة أثناء فتح الصفحة. تُعرض المكافآت من سجل موثق فقط؛ المدفوعات غير المؤكدة مستبعدة، والصرف متوقف."
              : "Performance refreshes every minute while this page is open. Earnings come only from the verified ledger; unconfirmed payments are excluded and payouts remain disabled."}
          </p>
        </section>

        <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <div className="card-surface p-5 text-xs leading-6 text-[#795963]" role="status">
            {ar
              ? "السجلات المالية القديمة معروضة منفصلة أدناه ولا تدخل في أرباح المحفظة الموثقة. طلبات الصرف متوقفة."
              : "Legacy financial records are listed separately below and are excluded from verified wallet earnings. Payouts are paused."}
          </div>
          <div className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-2">
            {wallet.ideas.map(item => <article key={item.id} className="card-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div><span className="text-[9px] font-bold uppercase tracking-wider text-[#9b6676]">{item.status}</span>
                  <h3 className="mt-1 font-display text-xl text-[#5B0D1E]">{ar && item.titleAr ? item.titleAr : item.title}</h3>
                </div>
                 <span className="rounded-full bg-[#fff3f6] px-2.5 py-1 text-[9px] text-[#795963]">{item.confirmedInterestCount} {ar ? "اهتمام" : "interests"}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#795963]">{ar && item.descriptionAr ? item.descriptionAr : item.description}</p>
              <p className="mt-3 text-[10px] text-[#896a71]">{ar ? "الحالة التجارية:" : "Commercial review:"} {item.commercialStatus}</p>
              {item.status === "draft" && <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => editIdea(item)} className="btn-outline px-3 py-2 text-[10px]">{ar ? "تعديل" : "Edit"}</button>
                <button type="button" disabled={busySave} onClick={() => void publish(item.id)} className="btn-primary px-3 py-2 text-[10px] disabled:opacity-50">{ar ? "نشر" : "Publish"}<ArrowRight size={12}/></button>
              </div>}
            </article>)}
            {wallet.ideas.length === 0 && <div className="card-surface p-6 text-sm text-[#896a71]">{ar ? "احفظي فكرتك الأولى لتظهر هنا." : "Save your first idea to see it here."}</div>}
          </div>
          <div className="card-surface p-5">
            <h3 className="font-display text-xl text-[#5B0D1E]">{ar ? "سجل المكافآت" : "Reward ledger"}</h3>
            <div className="mt-3 divide-y divide-[#f2e4e8]">
              {wallet.ledger.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                <span className="text-[#795963]">{entry.entryType === "interest_milestone"
                  ? (ar ? "مكافأة اهتمام تاريخية — غير مؤهلة للصرف" : "Legacy interest reward — not payout-eligible")
                  : (ar ? "عمولة تاريخية غير مرتبطة بدفع موثق" : "Legacy commission — not payment-verified")}</span>
                <strong className="text-[#5B0D1E]">{kwd(entry.amountFils, lang)}</strong>
                <time className="text-[10px] text-[#896a71]">{dateLabel(entry.createdAt, lang)}</time>
              </div>)}
              {wallet.ledger.length === 0 && <p className="py-3 text-xs text-[#896a71]">{ar ? "لا توجد مكافآت مسجلة بعد." : "No rewards have been recorded yet."}</p>}
            </div>
            {wallet.payoutRequests.length > 0 && <div className="mt-3 border-t border-[#f2e4e8] pt-3">
              <h4 className="text-xs font-semibold text-[#5B0D1E]">{ar ? "طلبات المراجعة" : "Payout review requests"}</h4>
              {wallet.payoutRequests.map(item => <p key={item.id} className="mt-2 flex justify-between text-[11px] text-[#795963]">
                <span>{kwd(item.amountFils, lang)} · {item.status}</span><time>{dateLabel(item.createdAt, lang)}</time>
              </p>)}
            </div>}
          </div>
        </div>
        </div>
      </div>}
    </section>}
  </div>;
}

function PublicIdeaCard({ idea, lang }: {
  idea: PublicFlavorIdea;
  lang: Lang;
}) {
  const ar = lang === "ar";
  return <article className="card-surface flex min-h-[215px] flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md">
    <div className="flex items-start justify-between gap-3">
      <div>
        <span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#9a6776]">{ar ? "اقتراح مجتمع" : "Community idea"}</span>
        <h3 className="mt-1 font-display text-xl leading-snug text-[#5B0D1E]">{ar && idea.titleAr ? idea.titleAr : idea.title}</h3>
      </div>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fff0f5] text-[#8b5363]"><Sparkles size={16}/></span>
    </div>
    <p className="mt-3 text-xs leading-6 text-[#795963]">{ar && idea.descriptionAr ? idea.descriptionAr : idea.description}</p>
    {Boolean(ar ? idea.ingredientsAr || idea.ingredients : idea.ingredients) && <p className="mt-2 text-[10px] leading-5 text-[#896a71]">
      <strong>{ar ? "مكونات مقترحة: " : "Suggested ingredients: "}</strong>{ar && idea.ingredientsAr ? idea.ingredientsAr : idea.ingredients}
    </p>}
    <div className="mt-auto pt-5">
      <div className="flex justify-between text-[10px] text-[#896a71]">
        <span>{idea.confirmedInterestCount} {ar ? "تسجيل اهتمام" : "interest registrations"}</span>
        <span>{dateLabel(idea.publishedAt, lang)}</span>
      </div>
      {idea.checkoutProduct?.available && <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[#5B0D1E]">{kwd(idea.checkoutProduct.priceFils, lang)}</span>
        <Link href={`/checkout?flavorId=${encodeURIComponent(idea.id)}`} className="btn-primary px-3 py-2 text-[10px]">
          {ar ? "اطلبي هذه النكهة" : "Order this flavor"}<ArrowRight size={12}/>
        </Link>
      </div>}
      <p className="mt-3 text-[10px] leading-5 text-[#896a71]">
        {ar ? "تسجيلات الاهتمام للعرض فقط ولا تُحتسب مكافآت منها." : "Interest registrations are informational and never count toward rewards."}
      </p>
    </div>
  </article>;
}

type CreatorPerformance = CreatorFlavorRewards["performanceFlavors"][number];

function CreatorPerformanceCard({ performance, lang }: { performance: CreatorPerformance; lang: Lang }) {
  const ar = lang === "ar";
  const title = ar && performance.flavorTitleAr ? performance.flavorTitleAr : performance.flavorTitle;
  const milestoneLabel = performance.milestoneStatus === "awarded"
    ? (ar ? "ممنوحة نهائياً" : "Awarded permanently")
    : performance.milestoneStatus === "achieved"
      ? (ar ? "تحقق العدد؛ ننتظر تسجيل المكافأة" : "Threshold reached; award not in ledger yet")
      : (ar ? "مقفلة" : "Locked");
  const metrics = [
    {
      label: ar ? "طلبات مدفوعة موثقة" : "Verified paid orders",
      value: String(performance.verifiedPaidOrderCount),
    },
    {
      label: ar ? "المتبقي للمئوية" : "Orders to milestone",
      value: String(performance.ordersRemainingToMilestone),
    },
    {
      label: ar ? "عمولة موثقة صافية" : "Net verified commission",
      value: kwd(performance.commissionEarnedFils, lang),
    },
    {
      label: ar ? "أرباح موثقة مؤكدة" : "Confirmed verified earnings",
      value: kwd(performance.confirmedEarningsFils, lang),
    },
    {
      label: ar ? "مبالغ مكافآت معلّقة" : "Pending reward amounts",
      value: performance.pendingEarningsFils === null
        ? (ar ? "غير مسجّلة" : "Not tracked")
        : kwd(performance.pendingEarningsFils, lang),
    },
  ];

  return <article className="card-surface min-w-0 overflow-hidden">
    <div className="flex items-start justify-between gap-3 bg-gradient-to-r from-[#fff6f8] to-[#fffaf8] p-5">
      <div className="min-w-0">
        <span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#9a6776]">
          {ar ? "أداء النكهة المنشورة" : "Published flavor performance"}
        </span>
        <h3 className="mt-1 break-words font-display text-xl text-[#5B0D1E]">{title}</h3>
      </div>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#FFD6E5] text-[#5B0D1E]" aria-hidden="true">
        <Award size={19}/>
      </span>
    </div>
    <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3">
      {metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-xl border border-[#f0e1e5] bg-[#fffdfc] p-3">
        <p className="min-h-8 text-[10px] leading-4 text-[#896a71]">{metric.label}</p>
        <strong className="mt-1 block break-words font-display text-lg leading-6 text-[#5B0D1E]">{metric.value}</strong>
      </div>)}
    </div>
    <div className="px-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="font-semibold text-[#5B0D1E]">
          {ar ? "مكافأة 200 د.ك عند الطلب 100" : "200 KWD bonus at order 100"}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          performance.milestoneStatus === "awarded"
            ? "bg-[#edf7ef] text-[#356744]"
            : performance.milestoneStatus === "achieved"
              ? "bg-[#fff3df] text-[#815b24]"
              : "bg-[#fff0f5] text-[#795963]"
        }`}>
          {milestoneLabel}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#f4e8eb]"
          role="progressbar"
          aria-label={ar ? "التقدم نحو 100 طلب" : "Progress toward 100 verified orders"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={performance.progressPercent}
        >
          <div className="h-full rounded-full bg-[#5B0D1E] transition-[width]" style={{ width: `${performance.progressPercent}%` }}/>
        </div>
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[#795963]">{performance.progressPercent}/100</span>
      </div>
      <p className="mt-2 text-[10px] leading-5 text-[#896a71]">
        {ar
          ? "تستمر عمولة 15٪ على صافي مبيعات المنتج المؤهل من الطلب 101 فصاعداً، ولا تشمل التوصيل. لا تُسحب المكافأة بعد منحها."
          : "The 15% commission continues on net eligible product sales from order 101 onward, excluding delivery. An awarded milestone is never reversed."}
      </p>
    </div>
    <div className="border-t border-[#f0e1e5] p-4">
      <h4 className="font-display text-lg text-[#5B0D1E]">{ar ? "سجل الطلبات الموثقة" : "Verified order history"}</h4>
      {performance.transactions.length === 0
        ? <p className="mt-3 rounded-xl bg-[#fffaf8] p-4 text-xs text-[#896a71]">
          {ar ? "لا توجد طلبات مدفوعة موثقة لهذه النكهة بعد." : "No verified paid orders for this flavor yet."}
        </p>
        : <>
          <div className="mt-3 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[760px] border-collapse text-start text-[10px]">
              <thead><tr className="border-b border-[#f0e1e5] text-[#896a71]">
                <th className="px-2 py-2 font-medium">{ar ? "الطلب / التاريخ" : "Order / date"}</th>
                <th className="px-2 py-2 font-medium">{ar ? "المنتج المؤهل" : "Eligible product"}</th>
                <th className="px-2 py-2 font-medium">{ar ? "العمولة" : "Commission"}</th>
                <th className="px-2 py-2 font-medium">{ar ? "استرداد المنتج" : "Product refunds"}</th>
                <th className="px-2 py-2 font-medium">{ar ? "النزاع" : "Disputes"}</th>
                <th className="px-2 py-2 font-medium">{ar ? "تعديل العمولة" : "Commission adjustment"}</th>
                <th className="px-2 py-2 font-medium">{ar ? "مكافأة" : "Bonus"}</th>
              </tr></thead>
              <tbody>{performance.transactions.map(transaction => <tr key={transaction.orderReference} className="border-b border-[#f6edf0] align-top text-[#795963]">
                <td className="px-2 py-2">
                  <span className="block max-w-28 break-all font-medium text-[#5B0D1E]">{transaction.orderReference}</span>
                  <time className="mt-1 block whitespace-nowrap">{dateLabel(transaction.paidAt, lang)}</time>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{kwd(transaction.eligibleProductAmountFils, lang)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{kwd(transaction.netCommissionFils, lang)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{kwd(transaction.productRefundedFils, lang)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{kwd(transaction.productDisputedFils, lang)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{kwd(transaction.commissionAdjustmentFils, lang)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{transaction.milestoneBonusFils ? kwd(transaction.milestoneBonusFils, lang) : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <ol className="mt-3 grid gap-3 lg:hidden">
            {performance.transactions.map(transaction => <li key={transaction.orderReference} className="min-w-0 rounded-xl border border-[#f0e1e5] bg-[#fffdfc] p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-all text-[10px] font-semibold text-[#5B0D1E]">{transaction.orderReference}</span>
                <time className="shrink-0 text-[9px] text-[#896a71]">{dateLabel(transaction.paidAt, lang)}</time>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
                <WalletDetail label={ar ? "المنتج المؤهل" : "Eligible product"} value={kwd(transaction.eligibleProductAmountFils, lang)}/>
                <WalletDetail label={ar ? "العمولة الصافية" : "Net commission"} value={kwd(transaction.netCommissionFils, lang)}/>
                <WalletDetail label={ar ? "استرداد المنتج" : "Product refund"} value={kwd(transaction.productRefundedFils, lang)}/>
                <WalletDetail label={ar ? "النزاع" : "Dispute"} value={kwd(transaction.productDisputedFils, lang)}/>
                <WalletDetail label={ar ? "تعديل العمولة" : "Commission adjustment"} value={kwd(transaction.commissionAdjustmentFils, lang)}/>
                <WalletDetail label={ar ? "المكافأة" : "Milestone bonus"} value={transaction.milestoneBonusFils ? kwd(transaction.milestoneBonusFils, lang) : "—"}/>
              </dl>
            </li>)}
          </ol>
        </>}
    </div>
  </article>;
}

function WalletDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0">
    <dt className="text-[#896a71]">{label}</dt>
    <dd className="mt-0.5 break-words font-semibold text-[#5B0D1E]">{value}</dd>
  </div>;
}

function FlavorAssistant({
  lang, messages, prompt, busy, error, model, setPrompt, onAsk, onUseSuggestion,
}: {
  lang: Lang;
  messages: ChatMessage[];
  prompt: string;
  busy: boolean;
  error: string;
  model: string;
  setPrompt: (value: string) => void;
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onUseSuggestion: (content: string) => void;
}) {
  const ar = lang === "ar";
  return <section className="card-surface overflow-hidden">
    <div className="flex items-center gap-3 bg-[#5B0D1E] px-5 py-4 text-white">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15"><Sparkles size={17}/></span>
      <div><h2 className="font-display text-xl">{ar ? "مساعدة اقتراح النكهات" : "Flavor idea assistant"}</h2>
        <p className="mt-0.5 text-[10px] text-white/70">{ar ? "اقتراحات مجانية عبر مزودي الذكاء الحاليين" : "Free suggestions using the store's existing AI providers"}</p>
      </div>
    </div>
    <div className="grid gap-3 p-4">
      {messages.length === 0 && <p className="rounded-xl bg-[#fff6f8] p-4 text-xs leading-6 text-[#795963]">{ar ? "اكتبي نكهة أو مكونات تحبينها، وسأساعدك على تطوير الفكرة. الاقتراح لا يعني اعتماد المنتج." : "Describe a flavor or ingredients you like. I can help develop the idea; a suggestion is not product approval."}</p>}
      {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`rounded-xl p-3 text-xs leading-6 ${message.role === "assistant" ? "bg-[#fff6f8] text-[#5B0D1E]" : "bg-[#f7f0f2] text-[#795963]"}`}>
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.role === "assistant" && <button type="button" onClick={() => onUseSuggestion(message.content)} className="mt-2 text-[10px] font-semibold underline underline-offset-2">{ar ? "استخدمي الاقتراح في الوصف" : "Use this in the description"}</button>}
      </div>)}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {model && <p className="text-[9px] text-[#9a7b83]">{ar ? "النموذج:" : "Model:"} {model}</p>}
      <form onSubmit={onAsk} className="flex items-end gap-2">
        <label className="flex-1 text-[10px] text-[#896a71]">
          <span>{ar ? "سؤالك" : "Your prompt"}</span>
          <textarea required maxLength={1200} value={prompt} onChange={event => setPrompt(event.target.value)} className="mt-1 min-h-20 w-full resize-y rounded-xl border border-[#ead6dc] bg-white px-3 py-2.5 text-sm text-[#5B0D1E] outline-none focus:border-[#5B0D1E]"/>
        </label>
        <button type="submit" disabled={busy || !prompt.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#5B0D1E] text-white disabled:opacity-50" aria-label={ar ? "إرسال" : "Send"}>
          {busy ? <LoaderCircle size={16} className="animate-spin"/> : <Send size={16}/>}
        </button>
      </form>
    </div>
  </section>;
}

export function AdminFlavorRewardsPanel({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  const [data, setData] = useState<AdminFlavorRewards | null>(null);
  const [paymentReviews, setPaymentReviews] = useState<AdminFlavorPaymentReviews | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentReviewError, setPaymentReviewError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [paymentReviewNotes, setPaymentReviewNotes] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api<AdminFlavorRewards>("/api/admin/flavor-rewards"));
      try {
        setPaymentReviews(await api<AdminFlavorPaymentReviews>("/api/admin/flavor-rewards/payment-reviews"));
        setPaymentReviewError("");
      } catch (cause) {
        setPaymentReviews(null);
        setPaymentReviewError(errorText(cause, lang));
      }
    } catch (cause) {
      setError(errorText(cause, lang));
    } finally {
      setLoading(false);
    }
  }, [lang]);
  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (id: string, route: string, method: string, body: unknown) => {
    setBusyId(id);
    setError("");
    setSuccess("");
    try {
      await api(route, method, body);
      setSuccess(ar ? "تم حفظ التحديث." : "Update saved.");
      await refresh();
    } catch (cause) {
      setError(errorText(cause, lang));
    } finally {
      setBusyId("");
    }
  };
  const resolvePaymentReview = (eventId: string, decision: "reviewed" | "dismissed") => {
    const note = paymentReviewNotes[eventId]?.trim() ?? "";
    if (note.length < 5) {
      setPaymentReviewError(ar ? "أضيفي ملاحظة مراجعة من 5 أحرف على الأقل." : "Add a review note of at least 5 characters.");
      return;
    }
    void submit(
      eventId,
      `/api/admin/flavor-rewards/payment-reviews/${encodeURIComponent(eventId)}`,
      "PATCH",
      { decision, note },
    );
  };

  if (loading && !data) return <div className="card-surface p-8 text-center text-sm text-[#896a71]"><LoaderCircle className="mx-auto mb-3 animate-spin" size={20}/>{ar ? "جارٍ تحميل مكافآت النكهات…" : "Loading Flavor Rewards…"}</div>;
  if (error && !data) return <div className="rounded-2xl bg-[#fff1f3] p-5 text-sm text-[#763246]" role="alert">{error}<button type="button" onClick={() => void refresh()} className="ms-3 underline">{ar ? "إعادة المحاولة" : "Retry"}</button></div>;

  return <div className="grid gap-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><span className="eyebrow">{ar ? "لوحة المتجر" : "Store management"}</span>
        <h2 className="mt-1 font-display text-3xl text-[#5B0D1E]">{ar ? "مراجعة النكهات والمكافآت" : "Flavor and reward review"}</h2>
        <p className="mt-2 max-w-2xl text-xs leading-6 text-[#795963]">{ar ? "المراجعة التجارية متاحة، أما المبيعات والمكافآت وطلبات الصرف فمتوقفة حتى ربطها بطلبات مدفوعة موثقة." : "Commercial review remains available. Sales, rewards, and payouts are paused until linked to verified paid orders."}</p>
      </div>
      <button type="button" onClick={() => void refresh()} className="btn-outline"><RefreshCw size={14}/>{ar ? "تحديث" : "Refresh"}</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-[#fff1f3] p-4 text-xs text-[#763246]">{error}</p>}
    {success && <p role="status" className="rounded-xl bg-[#eef7ee] p-4 text-xs text-[#36583d]">{success}</p>}

    <section>
      <h3 className="mb-2 font-display text-2xl text-[#5B0D1E]">{ar ? "مراجعة استردادات ونزاعات Stripe" : "Stripe refund and dispute reviews"}</h3>
      <p className="mb-3 text-[10px] leading-5 text-[#896a71]">
        {ar
          ? "تسجيل قرار المراجعة لا يغيّر عمولة أو مكافأة. لا تُعدّل السجلات المالية إلا بعد تحقق خادمي من توزيع المنتج."
          : "Recording a review decision does not change commissions or bonuses. Financial entries change only after server verification of the product allocation."}
      </p>
      {paymentReviewError && <p role="alert" className="mb-3 rounded-xl bg-[#fff1f3] p-3 text-xs text-[#763246]">{paymentReviewError}</p>}
      <div className="grid gap-3">
        {(paymentReviews?.reviews ?? []).map(item => <article key={item.stripe_event_id} className="card-surface p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <strong className="text-xs text-[#5B0D1E]">{item.event_type} · {item.review_status}</strong>
            <time className="text-[10px] text-[#896a71]">{dateLabel(item.event_created_at, lang)}</time>
          </div>
          <p className="mt-2 break-all text-[10px] text-[#795963]">
            {item.stripe_object_type}: {item.stripe_object_id} · {item.amount_minor / 100} USD · {item.reason_code}
          </p>
          <p className="mt-1 break-all text-[9px] text-[#896a71]">
            {ar ? "الطلب / الحدث:" : "Order / event:"} {item.customer_order_id} · {item.stripe_event_id}
          </p>
          {item.review_status === "pending" ? <div className="mt-3">
            <label className="block text-[10px] font-semibold text-[#795963]">{ar ? "سبب قرار المراجعة" : "Reason for review decision"}
              <textarea minLength={5} maxLength={2000} required value={paymentReviewNotes[item.stripe_event_id] ?? ""}
                onChange={event => setPaymentReviewNotes(current => ({ ...current, [item.stripe_event_id]: event.target.value }))}
                className="field mt-1 min-h-16"/>
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busyId === item.stripe_event_id}
                onClick={() => resolvePaymentReview(item.stripe_event_id, "reviewed")}
                className="btn-primary px-3 py-2 text-[10px] disabled:opacity-50">
                {ar ? "تمت المراجعة" : "Mark reviewed"}
              </button>
              <button type="button" disabled={busyId === item.stripe_event_id}
                onClick={() => resolvePaymentReview(item.stripe_event_id, "dismissed")}
                className="btn-outline px-3 py-2 text-[10px] disabled:opacity-50">
                {ar ? "استبعاد الحالة" : "Dismiss case"}
              </button>
            </div>
          </div> : <p className="mt-2 text-[10px] leading-5 text-[#795963]">
            {item.review_note} · {item.reviewed_by ?? "—"} · {item.reviewed_at ? dateLabel(item.reviewed_at, lang) : "—"}
          </p>}
        </article>)}
        {paymentReviews?.reviews.length === 0 && <p className="card-surface p-5 text-xs text-[#896a71]">{ar ? "لا توجد حالات مراجعة." : "No payment review cases."}</p>}
        {!paymentReviews && !paymentReviewError && <p className="card-surface p-5 text-xs text-[#896a71]">{ar ? "جارٍ تحميل حالات المراجعة…" : "Loading payment review cases…"}</p>}
      </div>
    </section>

    <section>
      <h3 className="mb-3 font-display text-2xl text-[#5B0D1E]">{ar ? "أفكار النكهات" : "Flavor ideas"}</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.ideas ?? []).map(item => <article key={item.id} className="card-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><span className="text-[9px] uppercase tracking-wider text-[#896a71]">{item.status} · {item.commercialStatus}</span>
              <h4 className="mt-1 font-display text-xl text-[#5B0D1E]">{ar && item.titleAr ? item.titleAr : item.title}</h4>
            </div>
            <span className="rounded-full bg-[#fff2f6] px-3 py-1 text-[10px] text-[#795963]">{item.confirmedInterestCount} {ar ? "تسجيل اهتمام" : "interest registrations"}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#795963]">{ar && item.descriptionAr ? item.descriptionAr : item.description}</p>
          <p className="mt-2 break-all text-[9px] text-[#9a7b83]">{ar ? "معرّف الحساب:" : "Creator account ID:"} {item.creatorUserId}</p>
          {item.commercialNotes && <p className="mt-2 rounded-lg bg-[#fff7f8] p-3 text-xs text-[#795963]">{item.commercialNotes}</p>}
          {item.status === "published" && item.commercialStatus === "not_reviewed" && <div className="mt-4">
            <label className="block text-[10px] font-semibold text-[#795963]">{ar ? "ملاحظة المراجعة" : "Review note"}
              <textarea maxLength={2000} value={reviewNotes[item.id] ?? ""} onChange={event => setReviewNotes(current => ({ ...current, [item.id]: event.target.value }))} className="field mt-1 min-h-16"/>
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busyId === item.id} onClick={() => void submit(item.id, `/api/admin/flavor-rewards/${item.id}/review`, "PATCH", { decision: "approved", notes: reviewNotes[item.id] ?? "" })} className="btn-primary px-3 py-2 text-[10px] disabled:opacity-50">{ar ? "اعتماد تجاري" : "Approve commercially"}<Check size={12}/></button>
              <button type="button" disabled={busyId === item.id} onClick={() => void submit(item.id, `/api/admin/flavor-rewards/${item.id}/review`, "PATCH", { decision: "rejected", notes: reviewNotes[item.id] ?? "" })} className="btn-outline px-3 py-2 text-[10px] disabled:opacity-50">{ar ? "رفض" : "Reject"}</button>
            </div>
          </div>}
          {item.status === "published" && item.commercialStatus === "approved" && <p className="mt-4 rounded-xl bg-[#fff7f8] p-4 text-[10px] leading-5 text-[#795963]" role="status">
            {ar ? "لن تُسجل عمولات يدوية. يجب أن تأتي المبيعات من تحقق دفع Stripe الموثق بعد اعتماد ربط قاعدة البيانات." : "Manual sales cannot earn commission. Sales must come from verified Stripe payments after the database integration is approved."}
          </p>}
        </article>)}
        {(data?.ideas.length ?? 0) === 0 && <p className="card-surface p-6 text-xs text-[#896a71]">{ar ? "لا توجد أفكار حتى الآن." : "No flavor ideas yet."}</p>}
      </div>
    </section>

    <section>
      <h3 className="mb-3 font-display text-2xl text-[#5B0D1E]">{ar ? "طلبات مراجعة الصرف" : "Payout review requests"}</h3>
      <div className="grid gap-3">
        {(data?.payoutRequests ?? []).map(item => <article key={item.id} className="card-surface flex flex-wrap items-center justify-between gap-4 p-4">
          <div><strong className="text-sm text-[#5B0D1E]">{kwd(item.amountFils, lang)}</strong>
            <p className="mt-1 text-[10px] text-[#896a71]">{item.status} · {dateLabel(item.createdAt, lang)}</p>
            {item.adminNote && <p className="mt-1 text-xs text-[#795963]">{item.adminNote}</p>}
          </div>
          <p className="max-w-sm text-[10px] leading-5 text-[#896a71]">
            {ar ? "تم إيقاف إجراءات الصرف مؤقتاً لحماية الأرصدة التاريخية حتى مراجعتها." : "Payout actions are paused while historical balances are reviewed."}
          </p>
        </article>)}
        {(data?.payoutRequests.length ?? 0) === 0 && <p className="card-surface p-6 text-xs text-[#896a71]">{ar ? "لا توجد طلبات صرف للمراجعة." : "No payout requests to review."}</p>}
      </div>
    </section>

    <section>
      <h3 className="mb-2 font-display text-2xl text-[#5B0D1E]">{ar ? "سجلات المبيعات التاريخية" : "Historical sales records"}</h3>
      <p className="mb-3 text-[10px] leading-5 text-[#896a71]">{ar ? "لا تُعد هذه السجلات دليلاً على الدفع ولا تُنشئ عمولات جديدة." : "These records are not proof of payment and cannot create new commissions."}</p>
      <div className="card-surface divide-y divide-[#f2e4e8] px-4">
        {(data?.sales ?? []).map(item => <div key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-xs">
          <span className="text-[#795963]">{item.sourceReference}</span>
          <strong className="text-[#5B0D1E]">{kwd(item.netSalesFils, lang)}</strong>
          <time className="text-[10px] text-[#896a71]">{dateLabel(item.recordedAt, lang)}</time>
        </div>)}
        {(data?.sales.length ?? 0) === 0 && <p className="py-4 text-xs text-[#896a71]">{ar ? "لم تُسجل مبيعات مؤهلة بعد." : "No eligible sales recorded yet."}</p>}
      </div>
    </section>
  </div>;
}
