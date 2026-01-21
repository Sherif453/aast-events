# AGENTS.md — AAST Events (Next.js App Router + Supabase)
**Top Priority:** Add features/fixes without breaking SSR, hydration, routing, Supabase auth persistence, or causing random logouts.

This file is the source of truth for how the agent must work in this codebase.

---

## 0) Non-Negotiables (must follow)
### Next.js (App Router only)
- Use **App Router** conventions ONLY (`app/` directory). No Pages Router.
- Do NOT suggest or introduce `_app.tsx`, `_document.tsx`, or Pages Router patterns.
- **Server Components by default**. Add `"use client"` ONLY when needed.
- Never introduce nested anchors:
  - ❌ `<Link><Link/></Link>` or `<a><a/></a>` or `<Link><a/></Link>` nesting that causes hydration issues.
- Keep public browsing stable: `/event/[id]` must render for logged-out users without server-side auth failures.

### Supabase client separation (strict)
- Server side ONLY: `lib/supabase/server.ts` for Server Components / Server Actions / Route Handlers.
- Client side ONLY: `lib/supabase/client.ts` for Client Components.
- ❌ Never use `cookies()` or any server-only APIs inside Client Components.

### Auth persistence / no random logout (critical)
- Users must stay logged in until they explicitly log out.
- Do NOT clear UI state on transient failures:
  - tab switch / focus changes
  - slow `getSession()` / `getUser()`
  - DB timeouts / fetch failures
- Only clear user state when Supabase auth event confirms: `SIGNED_OUT`.

### Redirect “next” support
- Logged-out protected actions (e.g., RSVP) must redirect to:
  - `/auth/login?next=/event/<id>`
- After successful login:
  - Redirect to `next` if present, else fallback to `/`.

### Profile/email source of truth
- `public.profiles.email` is the primary email display source (especially for phone-first users).
- Avoid “No email” flicker; prefer cached/known profile email until confirmed updates.
- After auth/profile link/unlink/verify changes:
  - Dispatch: `window.dispatchEvent(new Event("aast-profile-changed"))`
  - So the Header/UI refreshes instantly without full reload.

### Header behavior (global and fragile)
- Global `Header` is a Client Component in `app/layout.tsx`.
- Must never get stuck loading.
- Must not trigger random “signed out” UI due to timeouts.
- Must keep guarded refresh logic:
  - Prefer `supabase.auth.getSession()` first.
  - DB reads must have timeouts.
  - Use request-id guard to prevent overlapping refreshes.
  - Dropdown should NOT repeatedly refetch email.
  - Email shown should primarily come from `profiles.email`.
- Header refresh sources:
  - focus/visibility changes
  - Supabase auth events
  - `aast-profile-changed` custom event

### Public data rules (security)
- For logged-out/public pages: use **public tables/views** like `profiles_public`.
- Do NOT leak `profiles` sensitive fields to public contexts.
- `profiles_public` is public by design and safe for attendee names/avatars.

---

## 1) Project context (what exists)
### Tech stack (pinned)
- Next.js **16.0.10** + React 19 + TypeScript
- Tailwind + tailwindcss-animate
- shadcn/ui style components in `components/ui/*`
- Supabase: Google OAuth + Phone OTP, Postgres + RLS, Edge function reminders:
  - `supabase/functions/send-event-reminders/index.ts`
- Libraries in use: lucide-react, recharts, react-big-calendar, html5-qrcode, jszip, qrcode, sonner
- Do NOT casually upgrade dependencies or change pinned versions.

### Core routes (partial)
- `app/layout.tsx` (Header + ThemeProvider)
- `app/auth/login/page.tsx`
- `app/auth/callback/route.ts`
- `app/event/[id]/page.tsx` (public browsing)
- `app/event/[id]/checkin/page.tsx` (admins/volunteers)
- `app/clubs/*`
- `app/profile/*`
- `app/admin/*`
- `app/api/admin/export-csv/route.ts`

---

## 2) How to work (required workflow)
### Always do this first
1) Read relevant files and explain:
   - what is Server vs Client
   - which Supabase client will be used and why
   - SSR/hydration/auth risks and how they’re avoided
2) Implement changes as **small, reviewable patches**.
3) After changes, report:
   - exact files changed
   - why SSR/hydration/auth persistence stays safe
   - how public browsing stays safe (if relevant)

### Never do these
- Don’t restructure auth/session plumbing unless explicitly required.
- Don’t add middleware/proxy renames blindly (Next 16 warnings exist; keep correct export naming).
- Don’t add nested links/anchors.
- Don’t switch Server Components into Client Components without a reason.

---

## 3) Commands to run after meaningful changes
Use lockfile installs for stability:
- Install: `npm ci`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck` (or `npm run check` if that’s what exists)
- Build: `npm run build`
- Tests (if present): `npm test`

If a script is missing, suggest adding it WITHOUT changing dependency versions.

---

## 4) Acceptance checklist (feature is "done" only if)
- No hydration warnings (especially nested links/anchors).
- Public pages render logged-out (e.g., `/event/[id]`).
- No random logout behavior introduced.
- Header never stuck loading; no repeated email refetch loops.
- Correct Supabase client used in each component context.
- “next” redirect works: login returns user to the intended route.
- Profile/email updates propagate via `aast-profile-changed` event.

---

## 5) Notes for RSVP UX (current behavior to preserve)
- If logged out and user clicks RSVP:
  - redirect to `/auth/login?next=/event/<id>`
- RSVP UI must update immediately after login:
  - listen to `supabase.auth.onAuthStateChange`
  - on sign-in: refetch attendance row and call `router.refresh()` to update server-rendered counts
