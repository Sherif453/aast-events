import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { applyCors, applySecurityHeaders, preflight } from "@/lib/api/http";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { normalizeEmail } from "@/lib/api/validation";

const cors = { methods: ["POST", "OPTIONS"], headers: ["Content-Type", "Authorization"] };

function withHeaders(req: NextRequest, res: Response) {
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  applyCors(req, res.headers, cors);
  applySecurityHeaders(res.headers);
  return res;
}

export function OPTIONS(req: NextRequest) {
  return preflight(req, cors);
}

export async function POST(request: NextRequest) {
  // Use a "cookie carrier" response so Supabase can set refreshed auth cookies,
  // then copy them onto the final JSON response we return.
  const cookieCarrier = NextResponse.next();
  const supabase = createRouteHandlerClient(request, cookieCarrier);

  // Must be signed in (verified user).
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const rl = await checkRateLimit(request, {
    keyPrefix: "api:auth:sync-profile",
    ip: { max: 20, windowMs: 60_000 },
    user: { max: 30, windowMs: 60_000 },
    userId: userData?.user?.id ?? null,
  });
  if (!rl.ok) return withHeaders(request, rateLimitResponse(rl.retryAfterSeconds));

  const respond = (payload: unknown, init?: number) => {
    const status = typeof init === "number" ? init : 200;
    const res = NextResponse.json(payload, { status });
    for (const c of cookieCarrier.cookies.getAll()) res.cookies.set(c);
    return withHeaders(request, res);
  };

  if (userErr || !userData?.user) {
    return respond({ ok: false, reason: "not_signed_in" }, 401);
  }

  const user = userData.user;

  // Read identities to detect Google and get email safely.
  const { data: idsData, error: idsErr } = await supabase.auth.getUserIdentities();
  if (idsErr) {
    return respond({ ok: false, reason: "identities_failed" }, 200);
  }

  const identities = (idsData?.identities ?? []) as any[];
  const googleIdentity = identities.find((i) => i?.provider === "google");

  // Only write profiles.email if Google is linked (avoids stale email for phone-only users).
  const googleEmail =
    (googleIdentity?.identity_data?.email as string | undefined) || (user.email as string | null) || null;

  const email = googleEmail ? normalizeEmail(googleEmail) : null;

  if (googleIdentity && email) {
    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert({ id: user.id, email, updated_at: new Date().toISOString() }, { onConflict: "id" });

    // Best-effort audit: never break the flow even if table/policy isn't present.
    void (async () => {
      try {
        await supabase.from("auth_audit_logs").insert({
          user_id: user.id,
          action: "sync_profiles_email_after_auth",
          meta: { wrote_email: true },
        });
      } catch {
        // ignore
      }
    })();

    if (upsertErr) {
      return respond({ ok: false, reason: "profiles_upsert_failed", googleLinked: true, email, wrote: false }, 200);
    }

    return respond({ ok: true, googleLinked: true, email, wrote: true }, 200);
  }

  return respond({ ok: true, googleLinked: Boolean(googleIdentity), email: null, wrote: false }, 200);
}
