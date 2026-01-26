import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { applySecurityHeaders } from "@/lib/api/http";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  //  preserve next
  const nextParamRaw = url.searchParams.get("next") || "/";
  const nextPath = nextParamRaw.startsWith("/") ? nextParamRaw : "/";

  //  Canonical origin (prevents 0.0.0.0 / weird hosts from being used in redirects)
  const envSite = process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/+$/, "");
  let baseOrigin = url.origin;
  if (envSite) {
    try {
      const u = new URL(envSite);
      if (u.hostname && u.hostname !== "0.0.0.0") baseOrigin = u.origin;
    } catch {
      // ignore invalid env values
    }
  }

  // Helper: no-cache redirect 
  const redirectNoCache = (to: URL) => {
    const res = NextResponse.redirect(to);
    res.headers.set("Cache-Control", "no-store, must-revalidate");
    res.headers.set("Pragma", "no-cache");
    applySecurityHeaders(res.headers);
    return res;
  };

  // Handle OAuth errors (keep your existing mapping) 
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

    const redirectUrl = new URL("/profile", baseOrigin);
    redirectUrl.searchParams.set("link_provider", "google");
    redirectUrl.searchParams.set("link_error", reason);
    return redirectNoCache(redirectUrl);
  }

  if (!code) {
    return redirectNoCache(new URL("/", baseOrigin));
  }

  //  Create redirect response FIRST we will attach auth cookies to it
  //  go to next after successful OAuth
  const redirectUrl = new URL(nextPath, baseOrigin);
  const response = redirectNoCache(redirectUrl);

  try {
    //  Server client that writes cookies onto THIS response
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

      const failUrl = new URL("/profile", baseOrigin);
      failUrl.searchParams.set("link_provider", "google");
      failUrl.searchParams.set("link_error", "exchange_failed");
      return redirectNoCache(failUrl);
    }

    //   return the SAME response that contains auth cookies set above
    return response;
  } catch (err) {
    console.error("Auth callback error:", err);

    const failUrl = new URL("/profile", baseOrigin);
    failUrl.searchParams.set("link_provider", "google");
    failUrl.searchParams.set("link_error", "callback_exception");
    return redirectNoCache(failUrl);
  }
}
