import type { AssistantMessage } from '@workspace/api-client-react';

export const MAX_MESSAGE = 1200;
export const MAX_TOTAL = 6000;
export const MAX_HISTORY_PAIRS = 3;

export type ChatTurn = { id: string; role: 'user' | 'assistant'; content: string };

/** Build the payload: up to last 3 complete user/assistant pairs + the new user message. */
export function buildPayload(history: ChatTurn[], next: string): { messages: AssistantMessage[] } | { error: string } {
  const question = next.trim();
  if (!question) return { error: 'اكتبي سؤالك أولاً.' };
  if (question.length > MAX_MESSAGE) return { error: `السؤال أطول من ${MAX_MESSAGE} حرف. يرجى اختصاره.` };
  const pairs: AssistantMessage[][] = [];
  for (let i = 0; i + 1 < history.length; i++) {
    const a = history[i], b = history[i + 1];
    if (a.role === 'user' && b.role === 'assistant') {
      pairs.push([
        { role: 'user', content: a.content.slice(0, MAX_MESSAGE) },
        { role: 'assistant', content: b.content.slice(0, MAX_MESSAGE) },
      ]);
      i++;
    }
  }
  let kept = pairs.slice(-MAX_HISTORY_PAIRS);
  const total = (list: AssistantMessage[][]) => list.flat().reduce((n, m) => n + m.content.length, 0) + question.length;
  while (kept.length && total(kept) > MAX_TOTAL) kept = kept.slice(1);
  const messages = [...kept.flat().filter((m) => m.content.length > 0), { role: 'user' as const, content: question }];
  return { messages };
}

export type AssistantErrorInfo = { message: string; code: string; retryAfter: number; aborted: boolean };

export function readAssistantError(err: unknown): AssistantErrorInfo {
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError')
    return { message: '', code: 'aborted', retryAfter: 0, aborted: true };
  const e = err as { status?: number; data?: unknown; headers?: Headers } | null;
  const data = (e?.data && typeof e.data === 'object' ? e.data : {}) as { error?: unknown; code?: unknown; retryAfterSeconds?: unknown };
  let retryAfter = typeof data.retryAfterSeconds === 'number' && Number.isFinite(data.retryAfterSeconds) && data.retryAfterSeconds > 0 ? data.retryAfterSeconds : 0;
  if (!retryAfter && e?.headers && typeof e.headers.get === 'function') {
    const raw = e.headers.get('Retry-After');
    const h = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 0;
    if (Number.isFinite(h) && h > 0) retryAfter = h;
  }
  if (!retryAfter && e?.status === 429) retryAfter = 60;
  const message = typeof data.error === 'string' && data.error.trim()
    ? data.error.trim()
    : e?.status === 429 ? 'تم بلوغ حد الاستخدام. يرجى المحاولة لاحقاً.'
    : e?.status ? 'تعذر الحصول على رد الآن. يرجى المحاولة مجدداً.'
    : 'تعذر الاتصال. تحققي من الشبكة وحاولي مجدداً.';
  return { message, code: typeof data.code === 'string' ? data.code : String(e?.status ?? 'network'), retryAfter: Math.max(0, Math.min(86400, Math.ceil(retryAfter))), aborted: false };
}

export function formatWait(s: number) {
  if (s >= 3600) return `${Math.ceil(s / 3600)} ساعة`;
  if (s >= 60) return `${Math.ceil(s / 60)} دقيقة`;
  return `${s} ثانية`;
}
