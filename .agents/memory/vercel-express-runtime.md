---
name: Amore Vercel Express runtime
description: Runtime boundary and maintenance cadence when the Amore API is hosted on Vercel.
---

Export the same Express app to Vercel without starting Replit's listener or process timers. Keep the Replit server path intact. Vercel's Hobby Cron runs only once daily, so it cannot reproduce the existing minute-level cleanup/reconciliation cadence.

**Why:** Amore relies on Supabase for durable state, but its existing API also has recurring process work; serverless requests must not depend on a process staying alive.

**How to apply:** Keep customer and checkout behavior request-driven, protect maintenance routes with `CRON_SECRET`, and explain that delayed abandoned-payment cleanup on Hobby is a launch constraint. Do not claim the full minute-level worker behavior is preserved on Vercel Hobby.
