import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Check, Coins, Lightbulb, LoaderCircle, Plus, RefreshCw, Send, Sparkles, Users,
} from "lucide-react";
import type {
  AdminFlavorRewards,
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
  label, value, onChange, multiline = false, maxLength, required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength: number;
  required?: boolean;
}) {
  const className = "mt-1 w-full rounded-xl border border-[#ead6dc] bg-white/80 px-3.5 py-3 text-sm text-[#5B0D1E] outline-none transition focus:border-[#5B0D1E] focus:ring-2 focus:ring-[#FFD6E5]";
  return <label className="block text-xs font-semibold text-[#795963]">
    {label}
    {multiline
      ? <textarea required={required} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} className={`${className} min-h-24 resize-y`} />
      : <input required={required} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} className={className} />}
  </label>;
}

export function FlavorRewardsPage({ lang }: { lang: Lang }) {
  const { user } = useAuth();
  const [publicIdeas, setPublicIdeas] = useState<PublicFlavorIdea[]>([]);
  const [wallet, setWallet] = useState<CreatorFlavorRewards | null>(null);
  const [loading, setLoading] = useState(true);
  const [publicError, setPublicError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [busyInterest, setBusyInterest] = useState("");
  const [busySave, setBusySave] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutRequestKey, setPayoutRequestKey] = useState(() => crypto.randomUUID());
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

  const registerInterest = async (id: string) => {
    if (!user) return;
    setBusyInterest(id);
    setFormError("");
    try {
      await api<{ interestCount: number; alreadyInterested: boolean; rewardUnlocked: boolean }>(
        `/api/flavor-rewards/${id}/interest`, "POST", {},
      );
      await refresh();
    } catch (error) {
      setFormError(errorText(error, lang));
    } finally {
      setBusyInterest("");
    }
  };

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

  const requestPayout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(payoutAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setPayoutBusy(true);
    setAccountError("");
    try {
      await api("/api/account/flavor-rewards/payout-requests", "POST", {
        amountFils: Math.round(amount * 1000),
        requestKey: payoutRequestKey,
      });
      setPayoutRequestKey(crypto.randomUUID());
      setPayoutAmount("");
      await refresh();
    } catch (error) {
      setAccountError(errorText(error, lang));
    } finally {
      setPayoutBusy(false);
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
            ? "ابتكري نكهة كوكيز وشاركيها مع مجتمع أموري. عند وصول فكرتك إلى 100 تسجيل اهتمام مؤكد، تُضاف مكافأة 200 د.ك إلى رصيدك الداخلي."
            : "Create a cookie flavor and share it with the Amore community. A flavor that reaches 100 confirmed interests earns a 200 KWD internal reward."}
        </p>
        <p className="mt-3 text-[11px] leading-5 text-[#896a71]">
          {ar
            ? "المكافآت والأرباح تُراجع من فريق المتجر، وتُحفظ كرصيد داخلي. لا يتم تحويل أموال تلقائياً."
            : "Rewards and eligible sales are reviewed by the store team and recorded in an internal balance. No money is transferred automatically."}
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
              {publicIdeas.map(item => <PublicIdeaCard
                key={item.id} idea={item} lang={lang} signedIn={Boolean(user)}
                busy={busyInterest === item.id} onInterest={() => void registerInterest(item.id)}
              />)}
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
            : <form className="mt-5 grid gap-4" onSubmit={saveDraft}>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField required label={ar ? "اسم النكهة بالإنجليزية" : "Flavor name"} value={draft.title} onChange={value => setDraft(current => ({ ...current, title: value }))} maxLength={120}/>
                <TextField label={ar ? "اسم النكهة بالعربية" : "Arabic flavor name"} value={draft.titleAr} onChange={value => setDraft(current => ({ ...current, titleAr: value }))} maxLength={120}/>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField multiline label={ar ? "وصف مختصر بالإنجليزية" : "Short description"} value={draft.description} onChange={value => setDraft(current => ({ ...current, description: value }))} maxLength={1200}/>
                <TextField multiline label={ar ? "وصف مختصر بالعربية" : "Arabic description"} value={draft.descriptionAr} onChange={value => setDraft(current => ({ ...current, descriptionAr: value }))} maxLength={1200}/>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField multiline label={ar ? "المكونات المقترحة بالإنجليزية" : "Suggested ingredients"} value={draft.ingredients} onChange={value => setDraft(current => ({ ...current, ingredients: value }))} maxLength={1200}/>
                <TextField multiline label={ar ? "المكونات المقترحة بالعربية" : "Suggested ingredients in Arabic"} value={draft.ingredientsAr} onChange={value => setDraft(current => ({ ...current, ingredientsAr: value }))} maxLength={1200}/>
              </div>
              {message && <p role="status" className="text-xs text-[#5B0D1E]">{message}</p>}
              {formError && <p role="alert" className="text-xs text-red-700">{formError}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={busySave} className="btn-primary disabled:opacity-50">
                  {busySave ? <LoaderCircle size={14} className="animate-spin"/> : <Check size={14}/>}
                  {editingId ? (ar ? "حفظ التعديلات" : "Save changes") : (ar ? "حفظ كمسودة" : "Save draft")}
                </button>
                {editingId && <button type="button" disabled={busySave} onClick={() => { setEditingId(null); setDraft(emptyDraft()); }} className="btn-outline">
                  {ar ? "فكرة جديدة" : "New idea"}<Plus size={14}/>
                </button>}
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
      {wallet && <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <WalletMetric title={ar ? "إجمالي المكافآت" : "Earned"} amount={wallet.earnedFils} icon={<Coins size={18}/>} />
          <WalletMetric title={ar ? "قيد الحجز أو الصرف" : "Reserved or paid"} amount={wallet.reservedFils} icon={<Users size={18}/>} />
          <WalletMetric title={ar ? "الرصيد المتاح" : "Available"} amount={wallet.availableFils} icon={<Sparkles size={18}/>} />
          <form onSubmit={requestPayout} className="card-surface p-5">
            <h3 className="font-display text-xl text-[#5B0D1E]">{ar ? "طلب مراجعة صرف" : "Request payout review"}</h3>
            <p className="mt-2 text-[11px] leading-5 text-[#896a71]">{ar ? "الطلب للمراجعة اليدوية فقط؛ لا يتم تحويل الأموال تلقائياً." : "Requests are reviewed manually; no money is transferred automatically."}</p>
            <label className="mt-4 block text-xs font-semibold text-[#795963]">{ar ? "المبلغ بالدينار الكويتي" : "Amount in KWD"}
              <input type="number" min="0.001" max={(wallet.availableFils / 1000).toFixed(3)} step="0.001" required value={payoutAmount} onChange={event => setPayoutAmount(event.target.value)} className="field mt-1"/>
            </label>
            <button disabled={payoutBusy || wallet.availableFils <= 0} className="btn-primary mt-4 w-full disabled:opacity-50">
              {payoutBusy ? <LoaderCircle size={14} className="animate-spin"/> : <ArrowRight size={14}/>}
              {ar ? "إرسال الطلب" : "Submit request"}
            </button>
          </form>
        </div>
        <div className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-2">
            {wallet.ideas.map(item => <article key={item.id} className="card-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div><span className="text-[9px] font-bold uppercase tracking-wider text-[#9b6676]">{item.status}</span>
                  <h3 className="mt-1 font-display text-xl text-[#5B0D1E]">{ar && item.titleAr ? item.titleAr : item.title}</h3>
                </div>
                <span className="rounded-full bg-[#fff3f6] px-2.5 py-1 text-[9px] text-[#795963]">{item.confirmedInterestCount}/100</span>
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
                  ? (ar ? "مكافأة 100 اهتمام مؤكد" : "100-interest milestone")
                  : (ar ? "عمولة مبيعات صافية مؤهلة" : "Eligible net-sales commission")}</span>
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
      </div>}
    </section>}
  </div>;
}

function PublicIdeaCard({
  idea, lang, signedIn, busy, onInterest,
}: {
  idea: PublicFlavorIdea;
  lang: Lang;
  signedIn: boolean;
  busy: boolean;
  onInterest: () => void;
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
      <div className="mb-2 flex justify-between text-[10px] text-[#896a71]"><span>{idea.confirmedInterestCount}/100 {ar ? "اهتمام" : "interests"}</span><span>{dateLabel(idea.publishedAt, lang)}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#f5e7eb]"><div className="h-full rounded-full bg-[#a05c70]" style={{ width: `${Math.min(100, idea.confirmedInterestCount)}%` }}/></div>
      {signedIn
        ? <button type="button" onClick={onInterest} disabled={busy} className="btn-outline mt-4 w-full justify-center disabled:opacity-50">
          {busy ? <LoaderCircle size={13} className="animate-spin"/> : <Check size={13}/>}
          {ar ? "أنا مهتمة بهذه النكهة" : "I'm interested"}
        </button>
        : <Link href="/sign-in" className="btn-outline mt-4 w-full justify-center">{ar ? "سجّلي الدخول لإبداء اهتمامك" : "Sign in to register interest"}<ArrowRight size={13}/></Link>}
    </div>
  </article>;
}

function WalletMetric({ title, amount, icon }: { title: string; amount: number; icon: ReactNode }) {
  return <div className="card-surface flex items-center justify-between gap-3 p-5">
    <div><p className="text-[10px] text-[#896a71]">{title}</p><strong className="mt-1 block font-display text-2xl text-[#5B0D1E]">{kwd(amount, "en")}</strong></div>
    <span className="grid h-10 w-10 place-items-center rounded-full bg-[#fff0f5] text-[#6b1d32]">{icon}</span>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [saleForms, setSaleForms] = useState<Record<string, { reference: string; amount: string; notes: string }>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [payoutRefs, setPayoutRefs] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api<AdminFlavorRewards>("/api/admin/flavor-rewards"));
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

  const recordSale = async (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault();
    const form = saleForms[id] ?? { reference: "", amount: "", notes: "" };
    const amountFils = Math.round(Number(form.amount) * 1000);
    if (!Number.isSafeInteger(amountFils) || amountFils < 1) {
      setError(ar ? "أدخلي صافي المبيعات بالدينار الكويتي." : "Enter eligible net sales in KWD.");
      return;
    }
    await submit(id, `/api/admin/flavor-rewards/${id}/sales`, "POST", {
      sourceReference: form.reference,
      netSalesFils: amountFils,
      notes: form.notes,
    });
  };

  if (loading && !data) return <div className="card-surface p-8 text-center text-sm text-[#896a71]"><LoaderCircle className="mx-auto mb-3 animate-spin" size={20}/>{ar ? "جارٍ تحميل مكافآت النكهات…" : "Loading Flavor Rewards…"}</div>;
  if (error && !data) return <div className="rounded-2xl bg-[#fff1f3] p-5 text-sm text-[#763246]" role="alert">{error}<button type="button" onClick={() => void refresh()} className="ms-3 underline">{ar ? "إعادة المحاولة" : "Retry"}</button></div>;

  return <div className="grid gap-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><span className="eyebrow">{ar ? "لوحة المتجر" : "Store management"}</span>
        <h2 className="mt-1 font-display text-3xl text-[#5B0D1E]">{ar ? "مراجعة النكهات والمكافآت" : "Flavor and reward review"}</h2>
        <p className="mt-2 max-w-2xl text-xs leading-6 text-[#795963]">{ar ? "تسجّل هذه اللوحة قرارات المراجعة والمبيعات المؤهلة وطلبات الصرف فقط. لا تنفّذ تحويلات مالية." : "This panel records review decisions, eligible sales, and payout requests only. It does not transfer funds."}</p>
      </div>
      <button type="button" onClick={() => void refresh()} className="btn-outline"><RefreshCw size={14}/>{ar ? "تحديث" : "Refresh"}</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-[#fff1f3] p-4 text-xs text-[#763246]">{error}</p>}
    {success && <p role="status" className="rounded-xl bg-[#eef7ee] p-4 text-xs text-[#36583d]">{success}</p>}

    <section>
      <h3 className="mb-3 font-display text-2xl text-[#5B0D1E]">{ar ? "أفكار النكهات" : "Flavor ideas"}</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.ideas ?? []).map(item => <article key={item.id} className="card-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><span className="text-[9px] uppercase tracking-wider text-[#896a71]">{item.status} · {item.commercialStatus}</span>
              <h4 className="mt-1 font-display text-xl text-[#5B0D1E]">{ar && item.titleAr ? item.titleAr : item.title}</h4>
            </div>
            <span className="rounded-full bg-[#fff2f6] px-3 py-1 text-[10px] text-[#795963]">{item.confirmedInterestCount}/100</span>
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
          {item.status === "published" && item.commercialStatus === "approved" && <form onSubmit={event => void recordSale(event, item.id)} className="mt-4 grid gap-2 rounded-xl bg-[#fff7f8] p-4 sm:grid-cols-2">
            <label className="text-[10px] text-[#795963]">{ar ? "مرجع البيع" : "Sale reference"}
              <input required maxLength={120} value={saleForms[item.id]?.reference ?? ""} onChange={event => setSaleForms(current => ({ ...current, [item.id]: { ...(current[item.id] ?? { reference: "", amount: "", notes: "" }), reference: event.target.value } }))} className="field mt-1"/>
            </label>
            <label className="text-[10px] text-[#795963]">{ar ? "صافي البيع (د.ك)" : "Net sales (KWD)"}
              <input required type="number" min="0.001" step="0.001" value={saleForms[item.id]?.amount ?? ""} onChange={event => setSaleForms(current => ({ ...current, [item.id]: { ...(current[item.id] ?? { reference: "", amount: "", notes: "" }), amount: event.target.value } }))} className="field mt-1"/>
            </label>
            <button disabled={busyId === item.id} className="btn-outline sm:col-span-2">{ar ? "تسجيل البيع واحتساب 15%" : "Record sale and calculate 15%"}</button>
          </form>}
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
          <div className="flex flex-wrap items-center gap-2">
            {item.status === "pending" && <>
              <button type="button" disabled={busyId === item.id} onClick={() => void submit(item.id, `/api/admin/flavor-rewards/payout-requests/${item.id}`, "PATCH", { status: "approved" })} className="btn-outline px-3 py-2 text-[10px]">{ar ? "موافقة" : "Approve"}</button>
              <button type="button" disabled={busyId === item.id} onClick={() => void submit(item.id, `/api/admin/flavor-rewards/payout-requests/${item.id}`, "PATCH", { status: "rejected" })} className="btn-outline px-3 py-2 text-[10px]">{ar ? "رفض" : "Reject"}</button>
            </>}
            {item.status === "approved" && <>
              <input maxLength={200} placeholder={ar ? "مرجع التحويل اليدوي" : "Manual payout reference"} value={payoutRefs[item.id] ?? ""} onChange={event => setPayoutRefs(current => ({ ...current, [item.id]: event.target.value }))} className="field max-w-56"/>
              <button type="button" disabled={busyId === item.id} onClick={() => void submit(item.id, `/api/admin/flavor-rewards/payout-requests/${item.id}`, "PATCH", { status: "paid", payoutReference: payoutRefs[item.id] ?? "" })} className="btn-primary px-3 py-2 text-[10px]">{ar ? "تسجيل الصرف" : "Record paid"}<Check size={12}/></button>
              <button type="button" disabled={busyId === item.id} onClick={() => void submit(item.id, `/api/admin/flavor-rewards/payout-requests/${item.id}`, "PATCH", { status: "rejected" })} className="btn-outline px-3 py-2 text-[10px]">{ar ? "رفض" : "Reject"}</button>
            </>}
          </div>
        </article>)}
        {(data?.payoutRequests.length ?? 0) === 0 && <p className="card-surface p-6 text-xs text-[#896a71]">{ar ? "لا توجد طلبات صرف للمراجعة." : "No payout requests to review."}</p>}
      </div>
    </section>

    <section>
      <h3 className="mb-3 font-display text-2xl text-[#5B0D1E]">{ar ? "المبيعات المؤهلة المسجلة" : "Recorded eligible sales"}</h3>
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
