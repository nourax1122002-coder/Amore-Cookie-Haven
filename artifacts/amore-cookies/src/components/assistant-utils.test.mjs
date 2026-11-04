import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, readAssistantError, formatWait } from './assistant-utils.ts';
test('history is bounded, alternating and contains no unanswered duplicate on retry', () => {
  const history = Array.from({ length: 5 }, (_, i) => [
    { id: `q${i}`, role: 'user', content: `سؤال${i}` },
    { id: `a${i}`, role: 'assistant', content: 'أ'.repeat(1500) },
  ]).flat();
  history.push({ id: 'failed', role: 'user', content: 'سؤال متعذر' });
  const payload = buildPayload(history, 'سؤال جديد');
  assert.ok('messages' in payload);
  assert.ok(payload.messages.length <= 7);
  assert.equal(payload.messages.at(-1).content, 'سؤال جديد');
  assert.ok(payload.messages.every(m => m.content.length <= 1200));
  assert.ok(payload.messages.every((m, i) => m.role === (i % 2 ? 'assistant' : 'user')));
  assert.ok(payload.messages.reduce((n,m) => n+m.content.length,0) <= 6000);
  assert.ok(!payload.messages.some(m => m.content === 'سؤال متعذر'));
  assert.ok('error' in buildPayload([], ' '));
  assert.ok('error' in buildPayload([], 'س'.repeat(1201)));
});
test('429 numeric/date Retry-After countdown and daily limits remain bounded', () => {
  assert.equal(readAssistantError({ status: 429, data: { retryAfterSeconds: 17 } }).retryAfter, 17);
  assert.equal(readAssistantError({ status: 429, headers: new Headers({ 'Retry-After': '12' }) }).retryAfter, 12);
  const date = new Date(Date.now() + 12_000).toUTCString();
  assert.ok(readAssistantError({ status: 429, headers: new Headers({ 'Retry-After': date }) }).retryAfter <= 12);
  assert.equal(readAssistantError({ status: 429 }).retryAfter, 60);
  assert.equal(readAssistantError({ status: 429, data: { retryAfterSeconds: -5 } }).retryAfter, 60);
  assert.equal(readAssistantError({ status: 429, data: { retryAfterSeconds: Infinity } }).retryAfter, 60);
  assert.equal(readAssistantError({ name: 'AbortError' }).aborted, true);
  assert.match(readAssistantError(new Error('fixture-secret network')).message, /تعذر/);
  assert.ok(!readAssistantError(new Error('fixture-secret')).message.includes('fixture-secret'));
  assert.match(formatWait(7200), /ساعة/);
});
