import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  response.headers.set("Pragma", "no-cache");

  const supabase = createRouteHandlerClient(request, response);

  // Must be signed in (verified user).
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, reason: "not_signed_in" }, { status: 401 });
  }

  const user = userData.user;

  // Read identities to detect Google and get email safely.
  const { data: idsData, error: idsErr } = await supabase.auth.getUserIdentities();
  if (idsErr) {
    return NextResponse.json({ ok: false, reason: "identities_failed" }, { status: 200 });
  }

  const identities = (idsData?.identities ?? []) as any[];
  const googleIdentity = identities.find((i) => i?.provider === "google");

  // Only write profiles.email if Google is linked (avoids stale email for phone-only users).
  const googleEmail =
    (googleIdentity?.identity_data?.email as string | undefined) || (user.email as string | null) || null;

  if (googleIdentity && googleEmail) {
    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert({ id: user.id, email: googleEmail, updated_at: new Date().toISOString() }, { onConflict: "id" });

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
      return NextResponse.json(
        { ok: false, reason: "profiles_upsert_failed", googleLinked: true, email: googleEmail, wrote: false },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, googleLinked: true, email: googleEmail, wrote: true }, { status: 200 });
  }

  return NextResponse.json({ ok: true, googleLinked: false, email: null, wrote: false }, { status: 200 });
}
