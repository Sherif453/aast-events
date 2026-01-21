import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
    const url = new URL(request.url);

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // ✅ NEW: preserve next
    const nextParamRaw = url.searchParams.get("next") || "/";
    const nextPath = nextParamRaw.startsWith("/") ? nextParamRaw : "/";

    // --- Helper: no-cache redirect ---
    const redirectNoCache = (to: URL) => {
        const res = NextResponse.redirect(to);
        res.headers.set("Cache-Control", "no-store, must-revalidate");
        res.headers.set("Pragma", "no-cache");
        return res;
    };

    // --- Handle OAuth errors (keep your existing mapping) ---
    if (error || errorDescription) {
        const msg = (errorDescription || error || "").toLowerCase();

        let reason = "oauth";
        if (msg.includes("manual linking is disabled") || msg.includes("linking is disabled")) {
            reason = "manual_linking_disabled";
        } else if (
            msg.includes("identity already exists") ||
            msg.includes("already linked") ||
            msg.includes("already registered") ||
            msg.includes("account already exists") ||
            msg.includes("user already registered")
        ) {
            reason = "provider_already_linked";
        }

        const redirectUrl = new URL("/profile", url.origin);
        redirectUrl.searchParams.set("link_provider", "google");
        redirectUrl.searchParams.set("link_error", reason);
        return redirectNoCache(redirectUrl);
    }

    if (!code) {
        return redirectNoCache(new URL(url.origin));
    }

    // ✅ Create redirect response FIRST — we will attach auth cookies to it
    // ✅ NEW: go to next after successful OAuth
    const redirectUrl = new URL(nextPath, url.origin);
    const response = redirectNoCache(redirectUrl);

    try {
        // ✅ Server client that writes cookies onto THIS response
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name) {
                        return request.cookies.get(name)?.value;
                    },
                    set(name, value, options) {
                        response.cookies.set({ name, value, ...options });
                    },
                    remove(name, options) {
                        response.cookies.set({ name, value: "", ...options, maxAge: 0 });
                    },
                },
            }
        );

        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);

        if (exchErr) {
            console.error("Error exchanging code for session:", exchErr);

            const failUrl = new URL("/profile", url.origin);
            failUrl.searchParams.set("link_provider", "google");
            failUrl.searchParams.set("link_error", "exchange_failed");
            return redirectNoCache(failUrl);
        }

        const { data: userData } = await supabase.auth.getUser();
        const user = userData?.user ?? null;

        if (user) {
            // Get identities and pick Google identity email
            const { data: idsData } = await supabase.auth.getUserIdentities();
            const identities = (idsData?.identities ?? []) as any[];

            const googleIdentity = identities.find((i) => i?.provider === "google");
            const googleEmail =
                (googleIdentity?.identity_data?.email as string | undefined) ||
                (user.email as string | null) ||
                null;

            // Store email in profiles only (do NOT touch full_name/avatar_url)
            if (googleEmail) {
                const { error: upsertErr } = await supabase
                    .from("profiles")
                    .upsert(
                        {
                            id: user.id,
                            email: googleEmail,
                            updated_at: new Date().toISOString(),
                        },
                        { onConflict: "id" }
                    );

                if (upsertErr) {
                    console.error("profiles email upsert after oauth callback failed:", upsertErr);
                }
            }

            // Audit (best effort; never break flow)
            void (async () => {
                try {
                    await supabase.from("auth_audit_logs").insert({
                        user_id: user.id,
                        action: "link_google_success",
                        meta: { email_written_to_profiles: !!googleEmail },
                    });
                } catch {
                    // ignore
                }
            })();
        }

        // ✅ IMPORTANT: return the SAME response that contains auth cookies set above
        return response;
    } catch (err) {
        console.error("Auth callback error:", err);

        const failUrl = new URL("/profile", url.origin);
        failUrl.searchParams.set("link_provider", "google");
        failUrl.searchParams.set("link_error", "callback_exception");
        return redirectNoCache(failUrl);
    }
}