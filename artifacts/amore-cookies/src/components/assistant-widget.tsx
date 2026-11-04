import { Component, type ErrorInfo, type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getGetAssistantStatusQueryKey, sendAssistantMessage, useGetAssistantStatus } from '@workspace/api-client-react';
import { MessageCircleQuestion, RefreshCw, Send, Square, X } from 'lucide-react';
import { buildPayload, formatWait, MAX_MESSAGE, readAssistantError, type ChatTurn } from './assistant-utils';
import { assistantText } from './assistant-translations';

type Lang = 'en' | 'ar';
type Failure = { message: string; retryAfter: number; question: string; until: number };

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function AssistantPanel({ onClose, lang }: { onClose: () => void; lang: Lang }) {
  const t = assistantText[lang];
  const status = useGetAssistantStatus({ query: { queryKey: getGetAssistantStatusQueryKey(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false } });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const ctrl = useRef<AbortController | null>(null);
  const reqId = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { panelRef.current?.focus(); return () => { reqId.current++; ctrl.current?.abort(); }; }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, pending, failure]);
  const waiting = failure ? Math.max(0, Math.ceil((failure.until - now) / 1000)) : 0;
  useEffect(() => {
    if (!failure || failure.until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [failure]);

  const enabled = status.data?.enabled === true;
  useEffect(() => { if (enabled) inputRef.current?.focus(); }, [enabled]);
  const blocked = pending || waiting > 0 || !enabled;

  const send = useCallback(async (question: string, history: ChatTurn[], isRetry: boolean) => {
    if (ctrl.current) return;
    const built = buildPayload(history, question, lang);
    if ('error' in built) { setNote(built.error); return; }
    setNote('');
    setFailure(null);
    if (!isRetry) { setTurns([...history, { id: uid(), role: 'user', content: question.trim() }]); setDraft(''); }
    const my = ++reqId.current;
    const ac = new AbortController();
    ctrl.current = ac;
    setPending(true);
    try {
      const res = await sendAssistantMessage({ ...built, language: lang }, { signal: ac.signal });
      if (my !== reqId.current) return;
      const reply = typeof res?.reply === 'string' ? res.reply.trim() : '';
      if (!reply) throw new Error('empty');
      setTurns((t) => [...t, { id: uid(), role: 'assistant', content: reply }]);
    } catch (err) {
      if (my !== reqId.current) return;
      const info = readAssistantError(err, lang);
      if (info.aborted) { setNote(t.cancelled); setFailure({ message: '', retryAfter: 0, question: question.trim(), until: 0 }); }
      else { setNow(Date.now()); setFailure({ message: info.message, retryAfter: info.retryAfter, question: question.trim(), until: Date.now() + info.retryAfter * 1000 }); }
    } finally {
      if (my === reqId.current) { setPending(false); ctrl.current = null; }
    }
  }, [lang, t.cancelled]);

  const submit = (e?: FormEvent) => { e?.preventDefault(); if (blocked || !draft.trim()) return; void send(draft, turns, false); };
  const retry = () => {
    if (!failure || blocked) return;
    // the failed question is already the last user turn; history excludes it
    const last = turns[turns.length - 1];
    const history = last?.role === 'user' ? turns.slice(0, -1) : turns;
    void send(failure.question, history, true);
  };
  const cancel = () => {
    reqId.current++; ctrl.current?.abort(); ctrl.current = null; setPending(false);
    setNote(t.cancelled);
    const question = turns.at(-1)?.role === 'user' ? turns.at(-1)!.content : '';
    setFailure({ message: '', retryAfter: 0, question, until: 0 });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const f = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const over = draft.length > MAX_MESSAGE;

  return (
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="amore-assistant-title" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} onKeyDown={onKey}
      className="assistant-panel fixed z-40 inset-x-3 bottom-3 top-[max(12px,env(safe-area-inset-top))] sm:top-auto sm:inset-x-auto sm:start-5 sm:bottom-24 sm:w-[400px] sm:h-[min(620px,calc(100dvh-140px))] flex flex-col overflow-hidden rounded-[26px] bg-[#fffaf8] border border-[#efdee2] shadow-[0_30px_70px_rgba(91,13,30,.22)]"
      style={{ fontFamily: "'Alexandria',sans-serif" }}>
      <header className="flex items-start gap-3 px-5 pt-5 pb-4 bg-[#5B0D1E] text-[#fff6f3]">
        <div className="h-10 w-10 shrink-0 rounded-full bg-[#FFD6E5] text-[#5B0D1E] grid place-items-center"><MessageCircleQuestion size={19}/></div>
        <div className="flex-1 min-w-0">
          <h2 id="amore-assistant-title" className="text-[15px] font-semibold">{t.title}</h2>
          <p className="text-[10.5px] leading-5 text-[#f0cdd5]">{t.description}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t.close} className="h-9 w-9 rounded-full grid place-items-center hover:bg-white/10" data-testid="button-assistant-close"><X size={18}/></button>
      </header>
      <div ref={logRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3" aria-live="polite" aria-busy={pending}>
        {status.isLoading && <div className="space-y-2 animate-pulse"><div className="h-4 w-2/3 rounded-full bg-[#f3e4e8]"/><div className="h-4 w-1/2 rounded-full bg-[#f3e4e8]"/></div>}
        {status.isError && <div role="alert" className="card-surface p-4 text-[12px] text-[#5B0D1E]">{t.statusError}
          <button type="button" onClick={() => status.refetch()} className="btn-outline !py-2 !px-4 mt-3 flex"><RefreshCw size={13}/>{t.retry}</button></div>}
        {status.data && !enabled && <div role="status" className="card-surface p-4 text-[12px] leading-6 text-[#5B0D1E]">{t.unavailable}</div>}
        {enabled && !turns.length && !pending && <div className="text-center pt-8 px-4 text-[#8b6870]">
          <p className="font-display text-[22px] text-[#5B0D1E]" style={{ fontFamily: "'Alexandria',sans-serif" }}>{t.ask}</p>
          <p className="text-[11px] leading-6 mt-2">{t.example}</p>
        </div>}
        {turns.map((t) => <div key={t.id} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[86%] whitespace-pre-wrap break-words rounded-[18px] px-4 py-2.5 text-[12.5px] leading-6 ${t.role === 'user' ? 'bg-[#5B0D1E] text-[#fff6f3] rounded-ss-[6px]' : 'bg-[#fffdfa] border border-[#efdee2] text-[#45101d] rounded-se-[6px]'}`}>{t.content}</div>
        </div>)}
        {pending && <div className="flex justify-end" role="status"><div className="rounded-[18px] bg-[#fffdfa] border border-[#efdee2] px-4 py-3 flex items-center gap-3 text-[11px] text-[#8b6870]">
          <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-[#a35168] animate-bounce" style={{ animationDelay: `${i * .15}s` }}/>)}</span>{t.thinking}
        </div></div>}
        {failure && failure.message && <div role="alert" className="rounded-2xl bg-[#fff0f3] border border-[#ead5da] p-3.5 text-[11.5px] leading-6 text-[#763246]">
          {failure.message}
          {waiting > 0 && <span className="block mt-1 font-semibold">{t.wait} {formatWait(waiting, lang)}.</span>}
          <button type="button" onClick={retry} disabled={blocked} className="btn-outline !py-2 !px-4 mt-2.5 disabled:opacity-50 disabled:cursor-not-allowed" data-testid="button-assistant-retry"><RefreshCw size={13}/>{waiting > 0 ? `${t.retry} (${waiting})` : t.retry}</button>
        </div>}
        {note && <div role="status" className="text-[10.5px] text-[#8b6870] text-center">{note}
          {failure && !failure.message && <button type="button" onClick={retry} disabled={blocked} className="underline font-semibold ms-2 text-[#5B0D1E] disabled:opacity-50">{t.resend}</button>}
        </div>}
      </div>
      <form onSubmit={submit} className="border-t border-[#f0e1e4] p-3 bg-[#fffdfa] pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <label htmlFor="amore-assistant-input" className="sr-only">{t.question}</label>
          <textarea id="amore-assistant-input" ref={inputRef} value={draft} rows={2} maxLength={MAX_MESSAGE + 200}
            onChange={(e) => setDraft(e.target.value)} disabled={!enabled}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={enabled ? t.placeholder : t.disabled}
            className="field !py-2.5 resize-none max-h-32 text-[16px] sm:text-[13px]" aria-invalid={over} data-testid="input-assistant"/>
          {pending
            ? <button type="button" onClick={cancel} aria-label={t.cancel} className="h-11 w-11 shrink-0 rounded-full border border-[#cfa8b1] text-[#5B0D1E] grid place-items-center" data-testid="button-assistant-cancel"><Square size={14}/></button>
            : <button type="submit" disabled={blocked || !draft.trim() || over} aria-label={t.send} className="h-11 w-11 shrink-0 rounded-full bg-[#5B0D1E] text-[#fff8f7] grid place-items-center disabled:opacity-40" data-testid="button-assistant-send"><Send size={16} className={lang === 'ar' ? '-scale-x-100' : ''}/></button>}
        </div>
        <div className={`mt-1.5 text-[10px] ${over ? 'text-[#b4233b]' : 'text-[#a8878f]'}`}>{draft.length} / {MAX_MESSAGE}</div>
      </form>
    </div>
  );
}

export function AssistantWidget({ lang, floating = true }: { lang: Lang; floating?: boolean }) {
  const [open, setOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('assistant') === 'open'; } catch { return false; }
  });
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById('root');
    const wasInert = root?.hasAttribute('inert');
    const previousOverflow = document.body.style.overflow;
    root?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    return () => {
      if (!wasInert) root?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  const close = useCallback(() => { setOpen(false); window.setTimeout(() => openerRef.current?.focus(), 0); }, []);
  const label = lang === 'ar' ? 'اسألي أموري' : 'Ask Amore';
  return <>
    {!open && <button ref={openerRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
      className={`${floating ? 'fixed bottom-5 start-5 z-20' : 'relative m-5'} inline-flex items-center gap-2 rounded-full bg-[#FFD6E5] text-[#5B0D1E] border border-[#f1b9cb] px-4 py-3 text-xs font-semibold shadow-lg transition-transform hover:-translate-y-1`}
      data-testid="button-assistant-open"><MessageCircleQuestion size={16}/>{label}</button>}
    {open && createPortal(<><div className="fixed inset-0 z-30 bg-[#45101d]/20 sm:bg-transparent" onClick={close} aria-hidden="true"/><AssistantPanel onClose={close} lang={lang}/></>, document.body)}
  </>;
}

type BoundaryState = { failed: boolean; key: number };
export class AssistantBoundary extends Component<{ children: ReactNode; lang?: Lang }, BoundaryState> {
  state: BoundaryState = { failed: false, key: 0 };
  static getDerivedStateFromError(): Partial<BoundaryState> { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { console.error('Assistant UI unavailable'); }
  reset = () => this.setState((s) => ({ failed: false, key: s.key + 1 }));
  hide = () => this.setState({ failed: true, key: -1 });
  render() {
    const lang = this.props.lang ?? 'ar';
    const t = assistantText[lang];
    if (this.state.key === -1) return null;
    if (this.state.failed) return <div role="alert" dir={lang === 'ar' ? 'rtl' : 'ltr'} className="fixed bottom-5 start-5 z-20 max-w-[260px] rounded-2xl bg-[#fffaf8] border border-[#ead5da] shadow-lg p-3.5 text-[11px] leading-5 text-[#5B0D1E]" style={{ fontFamily: "'Alexandria',sans-serif" }}>
      {t.failed}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={this.reset} className="btn-outline !py-1.5 !px-3 !text-[11px]"><RefreshCw size={12}/>{t.restart}</button>
        <button type="button" onClick={this.hide} className="underline text-[11px]">{t.hide}</button>
      </div>
    </div>;
    return <div key={this.state.key} style={{ display: 'contents' }}>{this.props.children}</div>;
  }
}

export function SafeAssistantWidget({ lang, floating = true }: { lang: Lang; floating?: boolean }) {
  return <AssistantBoundary lang={lang}><AssistantWidget lang={lang} floating={floating}/></AssistantBoundary>;
}

export default SafeAssistantWidget;
