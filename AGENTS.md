---

# AAST Events — Engineering Notes (Next.js App Router + Supabase)

This project is developed and run inside **WSL (Ubuntu)** via VS Code Remote
(WSL). Assume the toolchain (including Deno/Supabase functions) runs in that WSL
environment.

Main goal: add features/fixes without breaking SSR, hydration, routing, Supabase
auth persistence, or causing random logouts.

---

## 0) Project rules and guardrails

### Next.js conventions

- App Router only (`app/`). No Pages Router.
- Don’t introduce `_app.tsx`, `_document.tsx`, or Pages Router patterns.
- Server Components by default. Add `"use client"` only when required.
- Avoid nested anchors/links (causes hydration issues):
  - `<Link><Link/></Link>`, `<a><a/></a>`, `<Link><a/></Link>`
- Avoid nesting interactive elements inside links (a11y/hydration/click issues):
  - `<Link><button/></Link>`, `<Link><span role="button"/></Link>`
  - Preferred patterns: `Button` with `asChild` + `Link`, or a row container with a sibling “overlay” `Link` and separate buttons.
- Public browsing must remain stable: `/event/[id]` should render for logged-out
  users without server-side auth failures.

### Supabase client usage

- Server-only client: `lib/supabase/server.ts` (Server Components, Server
  Actions, Route Handlers)
- Client-only client: `lib/supabase/client.ts` (Client Components)
- Don’t use `cookies()` or server-only APIs inside Client Components.

### Auth persistence (prevent random logout UI)

- Users stay logged in until they explicitly log out.
- Don’t clear UI state on transient issues:
  - tab switch / focus changes
  - slow `getSession()` / `getUser()`
  - DB timeouts / fetch failures
- Only clear user state when Supabase auth event confirms `SIGNED_OUT`.

### Supabase “session user” warning

- `session.user` from `getSession()` / some auth events isn’t always verified.
- For server-side permission checks: prefer `supabase.auth.getUser()`
  (verified).
- For client-side UX: session can be used for quick UI, but verify best-effort
  with `getUser()` and do not set user to null unless the auth event is
  `SIGNED_OUT` (prevents “random logout” flicker).

### Redirect `next` support

- Logged-out protected actions (e.g., RSVP) redirect to:
  - `/auth/login?next=/event/<id>`
- After login:
  - redirect to `next` if present, otherwise `/`.

### Local dev URL (WSL)

- Don’t use `http://0.0.0.0:3000` as `NEXT_PUBLIC_SITE_URL` (0.0.0.0 is a bind
  address and breaks OAuth redirects in browsers).
- For local dev, use `NEXT_PUBLIC_SITE_URL=http://localhost:3000` (or your ngrok
  URL when tunneling).
- Supabase Auth settings must include the same Site URL + Redirect URLs used by
  OAuth (`/auth/callback`).

### Profile email source of truth

- `public.profiles.email` is the primary email display source (especially for
  phone-first users).
- Avoid “No email” flicker; prefer cached/known profile email until confirmed.
- Google email sync rules:
  - `app/auth/callback/route.ts` does **no DB writes** (exchange + cookies +
    redirect only).
  - Server sync endpoint: `POST /api/auth/sync-profile`
    (`app/api/auth/sync-profile/route.ts`)
    - upserts `profiles.email` only when a Google identity is linked.
  - Client sync runner: `components/AuthProfileSync.tsx`
    - mounted in `app/layout.tsx` to best-effort sync after sign-in/refresh
      (throttled).
  - Link UX: `app/profile/ProfileClient.tsx` triggers a sync right after
    `link_success=1` so email appears quickly.
- After auth/profile link/unlink/verify changes:
  - `window.dispatchEvent(new Event("aast-profile-changed"))`
  - Header/UI refreshes without full reload.

### Header behavior (sensitive area)

- Global `Header` is a Client Component in `app/layout.tsx`.
- Must never get stuck loading.
- Must not show “signed out” due to timeouts or slow network.
- Keep guarded refresh logic:
  - call `supabase.auth.getSession()` first
  - DB reads have timeouts
  - request-id guard to prevent overlapping refreshes
  - dropdown should not repeatedly refetch email
  - email shown should primarily come from `profiles.email`
- Header refresh sources:
  - focus/visibility changes
  - Supabase auth events
  - `aast-profile-changed` event

### Public data rules

- Logged-out/public pages should use public tables/views such as
  `profiles_public`.
- Don’t expose `profiles` sensitive fields to public contexts.
- `profiles_public` is public by design and safe for attendee names/avatars.

### Upload safety

- Prefer raster image uploads (PNG/JPG/WebP) for user-provided logos/images unless SVG is sanitized end-to-end.
- Keep `<input accept=...>` and runtime validation in sync to avoid allowing risky formats accidentally.

---

## 1) What’s in the project

### Tech stack (pinned)

- Next.js **16.0.10** + React 19 + TypeScript
- Tailwind + tailwindcss-animate
- shadcn/ui components in `components/ui/*`
- Supabase: Google OAuth + Phone OTP, Postgres + RLS, Edge function reminders:
  - `supabase/functions/send-event-reminders/index.ts`
- Libraries in use: lucide-react, recharts, react-big-calendar, html5-qrcode,
  jszip, qrcode, sonner
- Avoid casual dependency upgrades or changing pinned versions.

### Auth / login system

- Enabled auth methods:
  - Google OAuth
  - Phone OTP
  - No email/password
  - No magic link
- Phone-first users may have `auth.users.email = null`; email display relies on:
  - `public.profiles.email` (nullable)
- Client UX rules:
  - prefer `auth.user.email`
  - if missing, fallback to `profiles.email`
  - avoid stale email: only show `profiles.email` when Google identity is linked
    (when applicable in UI logic)
- Profiles upsert logic:
  - `public.profiles` is upserted only after email OR phone confirmation
  - `public.profiles.phone` exists (nullable)
  - trigger copies from `auth.users` after confirmation:
    `email / phone / full_name / avatar_url`
- Google identity link/unlink safety:
  - allow unlink only if it won’t lock the user out (verified phone or another
    non-google identity)
  - when unlinking Google for phone-first users: clear `profiles.email` to avoid
    stale display
  - optional auditing to `auth_audit_logs` exists/was considered (best effort)
- OAuth callback rule:
  - keep `app/auth/callback/route.ts` minimal and reliable:
    `exchangeCodeForSession` + redirect with cookies
  - any post-auth profile updates happen outside the callback (server endpoint /
    client sync runner)

### Header + session reliability notes

- Client init should call `supabase.auth.getSession()` first (fast/local) to
  avoid `AuthSessionMissingError`.
- Don’t call `.catch()` on Postgrest builders (they are not Promises); await the
  query result or wrap in async before passing to timeout helpers.
- DB calls should have timeouts (~5s) so UI doesn’t hang.
- Global event for instant refresh after auth/profile changes:
  - `window.dispatchEvent(new Event("aast-profile-changed"))`
  - Header listens and refreshes user/profile/admin without full reload
- Email flicker mitigation:
  - don’t blank email to “No email” while fetching; keep last known email or
    show “Loading…”

### Core features (high level)

- Events:
  - create/edit/view events (events belong to clubs via `club_id`)
  - grid + list views (hydration-safe)
  - event detail includes RSVP + reminders
  - check-in dashboard for admins/volunteers
- Clubs:
  - public listing + club detail pages with events
  - admin club management (create/edit/delete)
  - club news feature (per-club create flow exists)
- UI/UX:
  - global Header + dark mode
  - admin actions hidden unless allowed (super_admin / club_admin)
  - `NotificationCenter` exists
  - privacy preferences: switches disabled for admin accounts; privacy applies
    to non-admins
  - badges: icon + label pills; leaderboard shows user’s top badge next to their
    name
- Club chat:
  - followers can read/reply in chat threads (unless blocked)
  - only `super_admin` and club’s `club_admin` can create/delete threads, create
    polls, and block users
  - RLS hardening migration:
    `supabase/migrations/20260124_0004_chat_admin_threads.sql`

### Routes (expanded)

- Root:
  - `app/layout.tsx` (Header + ThemeProvider)
  - `app/page.tsx`
- Auth:
  - `app/auth/login/page.tsx`
  - `app/auth/callback/route.ts`
- Events:
  - `app/event/[id]/page.tsx` (public)
  - `app/event/[id]/checkin/page.tsx` (admins/volunteers)
- Clubs:
  - `app/clubs/page.tsx`
  - `app/clubs/[id]/page.tsx`
- Leaderboard:
  - `app/leaderboard/page.tsx`
- Profile:
  - `app/profile/page.tsx`
  - `app/profile/attendance/page.tsx`
- Admin:
  - `app/admin/page.tsx`
  - `app/admin/analytics/page.tsx`
  - `app/admin/clubs/page.tsx`
  - `app/admin/clubs/create/page.tsx`
  - `app/admin/clubs/edit/[id]/page.tsx`
  - `app/admin/clubs/[id]/news/create/page.tsx`
  - `app/admin/events/page.tsx`
  - `app/admin/events/create/page.tsx`
  - `app/admin/events/edit/[id]/page.tsx`
  - `app/admin/export/page.tsx`
  - `app/admin/users/page.tsx`
- API:
  - `app/api/admin/export-csv/route.ts`

### Structure notes

- `components/` highlights:
  - `Header.tsx`, `NotificationCenter.tsx`, `DarkModeToggle.tsx`
  - Events: `EventCard.tsx`, `EventFeed.tsx`, `EventListingsWithFilters.tsx`,
    `EventReminderButton.tsx`, `RSVPButton.tsx`
  - Check-in: `CheckInInterface.tsx`, `QRCodeDisplay.tsx`, `QRScanner.tsx`,
    `AttendeesList.tsx`
  - Clubs: `ClubDetailClient.tsx`
  - Admin: `components/admin/*` (forms, role manager, charts, export)
  - shadcn/ui: `components/ui/*`
- `lib/`:
  - `lib/supabase/client.ts`
  - `lib/supabase/server.ts`
  - `lib/supabaseClient.ts`
  - `lib/utils.ts`
- `supabase/functions/`:
  - `send-event-reminders/index.ts`
  - other functions may exist (e.g., `phone-change-request`)
- Types:
  - `types/supabase.ts`

---

## 2) Change workflow

- Identify what’s server vs client.
- Use the correct Supabase client file for the context.
- Keep changes small and reviewable.
- After changes, note:
  - files touched
  - why SSR/hydration/auth persistence are still safe
  - whether public browsing is impacted

Avoid:

- restructuring auth/session plumbing unless required
- renaming middleware/proxy exports casually (Next 16 warnings exist; keep
  correct export naming)
- switching Server Components to Client Components without a reason

---

## 3) Commands

Use lockfile installs for stability:

- Install: `npm ci`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck` (or `npm run check` if that’s what exists)
- Build: `npm run build`
- Tests (if present): `npm test`

---

## 4) Done checklist

- No hydration warnings (especially nested links/anchors).
- Public pages work while logged out (e.g., `/event/[id]`).
- No random logout behavior introduced.
- Header never stuck loading; no repeated email refetch loops.
- Correct Supabase client used per component context.
- “next” redirect works: login returns user to intended route.
- Profile/email updates propagate via `aast-profile-changed`.

---

## 5) RSVP UX notes

- If logged out and user clicks RSVP:
  - redirect to `/auth/login?next=/event/[id]`
- RSVP UI updates immediately after login:
  - listen to `supabase.auth.onAuthStateChange`
  - on sign-in: refetch attendance row and call `router.refresh()` for
    server-rendered counts

---

## 6) Schema and policies (high level)

### Tables

- `public.admin_roles` (super_admin, club_admin, event_volunteer)
- `public.admin_users` (maps admin users to clubs)
- `public.attendees` (attendance + `checked_in`)
- `public.clubs`
- `public.club_news`
- `public.event_audit_log`
- `public.events`
- `public.profiles`
- `public.profiles_public`
- `public.push_subscriptions`

### Policies

- Admin roles:
  - `club_admin` manages their club’s events, volunteers, and news
  - `super_admin` manages all clubs/events/users
- Attendees:
  - users can delete/update their own attendance
  - event admins can update attendance for events they manage
- Event management:
  - create/update/delete by associated club admins or super admins
  - `events_select_public` exposes public event view; logged-in users see more
    details
- Notifications:
  - users receive notifications for reminders/news/updates
  - admins can insert notifications scoped to events/clubs

---
