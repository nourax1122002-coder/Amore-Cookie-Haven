import {
  AssistantError,
  buildAssistantSystemMessage,
  retrySeconds,
  tomorrowSeconds,
  type ChatMessage,
  type FreeReply,
} from "./openrouter";

const BASE = "https://api.groq.com/openai/v1";
export const GROQ_FREE_MODEL = "openai/gpt-oss-120b";

export function createGroqGateway(
  fetcher: typeof fetch = fetch,
  generationTimeoutMs = 20_000,
) {
  return {
    async chat(
      key: string,
      messages: ChatMessage[],
      context: string,
      signal: AbortSignal,
      language: "ar" | "en" = "ar",
    ): Promise<FreeReply> {
      if (!key) throw new AssistantError("configuration");
      let response: Response;
      const timeout = AbortSignal.timeout(generationTimeoutMs);
      try {
        response = await fetcher(`${BASE}/chat/completions`, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: GROQ_FREE_MODEL,
            messages: [{ role: "system", content: buildAssistantSystemMessage(context, language) }, ...messages],
            max_completion_tokens: 600,
            temperature: 0.25,
            reasoning_effort: "low",
            stream: false,
          }),
          signal: AbortSignal.any([signal, timeout]),
        });
      } catch {
        if (signal.aborted) throw new AssistantError("cancelled", 499);
        if (timeout.aborted) throw new AssistantError("timeout", 504);
        throw new AssistantError("network");
      }

      let data: any;
      try {
        data = await response.json();
      } catch {
        if (response.ok) throw new AssistantError("invalid_response");
        data = {};
      }

      if (!response.ok || data?.error) {
        const status = response.ok ? Number(data?.error?.code) || 502 : response.status;
        if ([401, 403].includes(status)) throw new AssistantError("configuration");
        if (status === 429) {
          const message = String(data?.error?.message ?? "");
          const daily = /\bday\b|daily|per.day|requests per day/i.test(message);
          const error = new AssistantError(
            daily ? "daily_limit" : "rate_limit",
            429,
            daily
              ? tomorrowSeconds()
              : retrySeconds(response.headers.get("retry-after")),
          );
          error.stage = "generation";
          throw error;
        }
        throw new AssistantError(
          status === 400 || status === 404 ? "unavailable" : "network",
          503,
        );
      }

      const reply = data?.choices?.[0]?.message?.content;
      if (
        data?.model !== GROQ_FREE_MODEL
        || typeof reply !== "string"
        || !reply.trim()
        || reply.length > 6500
        || !(language === "en" ? /[a-zA-Z]/ : /[\u0600-\u06ff]/).test(reply)
      ) {
        const error = new AssistantError("invalid_response");
        error.stage = "generation";
        throw error;
      }

      return { reply: reply.trim(), model: GROQ_FREE_MODEL, zeroCostVerified: true };
    },
  };
}
