# Arabic assistant: direct, free-only OpenRouter

The backend calls the official `https://openrouter.ai/api/v1` API with the
owner's `OPENROUTER_API_KEY` from Replit Secrets. The Replit AI proxy is **not**
used. Missing credentials disable the UI without affecting the shop. Never
create a `VITE_` key, print credentials, enable paid fallback, buy credits or
enable top-ups to fix availability.

Models are discovered from the live official catalogue, cached for at most
one minute, and restricted to reviewed multilingual instruction families.
Only `:free` IDs with zero values for **every** catalogue pricing field and
text input/output are eligible. Each generation sets `allow_fallbacks: false`,
`data_collection: deny`, `require_parameters: true` and zero max prompt,
completion, request and image prices. No plugins, tools, purchases, alternate
paid models or model-list fallbacks are sent. Provider privacy filtering is
never relaxed to obtain a response. No eligible route means unavailable,
not a canned answer. Arabic-only nonempty replies and cost metadata are
validated; a nonzero reported cost fails closed.

Sources reviewed for this implementation:
- https://openrouter.ai/docs/api-reference/limits
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/api/v1/models

## Shared allowance

OpenRouter's currently documented no-purchase free allowance is **20 requests
per minute and 50 per UTC day for the account**, not per visitor. Other apps
using this account share the upstream allowance. The official `/key` account
counter is checked before each generation. This app does not raise its own
50/day ceiling if the owner has previously purchased credits.

PostgreSQL security counters in distinct `assistant_*` scopes enforce:
- 3 accepted attempts/minute and 10/day per hashed client IP;
- 20/minute and 50/day for the application across replicas;
- two concurrent requests across replicas, with expiring ownership leases;
- shared cooldown after upstream 429, with Retry-After or daily UTC reset.

IPv6 clients use subnet grouping. Only HMAC identifiers, counts, lease tokens
and expiry timestamps are stored—not prompts, replies, raw IPs or API keys.
Store failure fails closed, never to per-process unlimited counters. Invalid,
cancelled and failed requests can still consume attempts; they are not refunded
because the provider may have counted them. A bounded metadata GET may retry
once with jitter; generation POSTs are **never** automatically retried.

## Privacy and scope

The model receives the user's bounded chat plus selected public product
names/descriptions/pieces and public baking/storage instructions. It receives
no cart, order, customer identity, phone, address, location, receipt or payment
context. Obvious sensitive input patterns are rejected before a provider call;
this is a safeguard, not a comprehensive personal-data detector. The UI asks
customers not to enter personal data and explains third-party processing.
Do not add automatic checkout/order context.

The system forbids invented price/stock/delivery/allergy/payment claims and
directs uncertain customers to the relevant store page or staff. Model
responses can still be wrong: the UI warns customers to verify important
information. There are no tools or privileged actions. Replies are rendered
as plain text, not HTML. Conversations are kept only in mounted UI memory.
Closing/clearing cancels work and discards the conversation.

Requests are bounded by 8 messages, 1200 characters per message, 6000 total,
600 output tokens, a 4MB upstream body cap and an overall 45-second deadline.
Cancellation propagates upstream; already-started provider work may count.
The assistant has its own React boundary; checkout remains outside it.

## Checks

`pnpm run validate` includes the assistant's unit/contract, shared PostgreSQL
quota, failure-injection and frontend payload/countdown tests. Test children
do not inherit real OpenRouter keys. Mock replies exist only in tests.

A genuine zero-price Arabic response must also be checked with the owner key.
Published-version verification belongs to the dependent release task; local
checks are not evidence that production has been updated.
