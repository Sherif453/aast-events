# Security Notes (AAST Events)

This repo uses Next.js App Router + Supabase Auth (cookie-based). The goal is to keep SSR/hydration + auth persistence stable while tightening server-side input handling.

## API hardening (app/api/**)

- **Rate limiting**: All `app/api/**` route handlers are rate limited by **IP** and (when authenticated) **user id**, applying the stricter limit.
  - Defaults: **60 req/min/IP**, **120 req/min/user**
  - Auth-sensitive endpoints: **20 req/min/IP**, **30 req/min/user**
  - `OPTIONS` preflight is **never rate-limited**.
- **Input validation**: Query params and JSON bodies are validated with strict schemas; unknown fields are rejected.
- **AuthZ**: No API route trusts `user_id` from the client; server derives identity from `supabase.auth.getUser()`.
- **Service role**: Avoid using Supabase service role keys in any route reachable by browsers; keep RLS in effect for all user/admin routes.
  - Exception: admin-only exports may fall back to service role **only after** `getUser()` + role/scope checks succeed, to prevent regressions if RLS is too strict for private profile fields.

## Required / supported environment variables

### Rate limiting (optional but recommended)

- `UPSTASH_REDIS_REST_URL` (server-only): Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN` (server-only): Upstash Redis REST token

If unset, the app falls back to a **best-effort in-memory limiter** (fine for dev, not a durable production backend).

### CORS

- `NEXT_PUBLIC_SITE_URL` (public): Used to derive the default allowed origin.
- `CORS_ALLOWED_ORIGINS` (server-only): Optional comma-separated extra allowed origins (origins only, e.g. `https://example.com`).

### Existing secrets you should keep server-only

- `SUPABASE_SERVICE_ROLE_KEY` (server-only): Only for trusted backend jobs/functions (not browser-reachable routes).
- `QR_TOKEN_SECRET` (server-only): Signs short-lived QR tokens for check-in flows.
- Supabase Edge Functions env:
  - `CRON_SECRET`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`

## Key rotation checklist (quick)

1. **Supabase service role key**
   - Rotate in Supabase dashboard.
   - Update `SUPABASE_SERVICE_ROLE_KEY` everywhere it is used (server jobs / Edge Functions).
   - Confirm no browser-reachable route uses service role after rotation.
2. **QR token secret**
   - Rotate `QR_TOKEN_SECRET`.
   - Validate both ticket generation and check-in still work end-to-end.
3. **Cron/webhook secrets**
   - Rotate `CRON_SECRET` (and any other webhook secrets).
   - Update callers (cron provider, scheduler, etc.) to send the new secret header.
4. **Resend**
   - Rotate `RESEND_API_KEY`.
   - Send a test reminder email.
