// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

type Body = {
  phone_e164?: string;
};

const COOLDOWN_SECONDS = 60;

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "missing_authorization" });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const phone = String(body.phone_e164 || "").trim();
  if (!phone) return json(400, { error: "missing_phone" });

  // Client as USER (keeps phone_change OTP behavior exactly)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Client as SERVICE ROLE (for rate limit + audit)
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Identify user
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "invalid_session" });

  const userId = userData.user.id;

  // 2) Check rate limit
  const { data: rlRow, error: rlErr } = await adminClient
    .from("auth_rate_limits")
    .select("last_sent_at, window_start, window_count")
    .eq("user_id", userId)
    .eq("action", "phone_change")
    .maybeSingle();

  if (rlErr) {
    // Fail closed? No. We fail open but still log error for debugging.
    await adminClient.from("auth_audit_logs").insert({
      user_id: userId,
      action: "otp_rate_limit_check_failed",
      meta: { message: rlErr.message },
    });
  } else if (rlRow?.last_sent_at) {
    const last = new Date(rlRow.last_sent_at).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - last) / 1000);
    const remaining = COOLDOWN_SECONDS - elapsed;

    if (remaining > 0) {
      await adminClient.from("auth_audit_logs").insert({
        user_id: userId,
        action: "otp_blocked_rate_limit",
        meta: { remaining_seconds: remaining },
      });

      return json(429, {
        error: "rate_limited",
        remaining_seconds: remaining,
        cooldown_seconds: COOLDOWN_SECONDS,
      });
    }
  }

  // 3) Send OTP via phone_change flow (as user)
  const { error: updErr } = await userClient.auth.updateUser({ phone });

  if (updErr) {
    await adminClient.from("auth_audit_logs").insert({
      user_id: userId,
      action: "otp_send_failed",
      meta: { message: updErr.message },
    });
    return json(400, { error: "otp_send_failed", message: updErr.message });
  }

  // 4) Record rate limit
  const nowIso = new Date().toISOString();
  await adminClient.from("auth_rate_limits").upsert(
    {
      user_id: userId,
      action: "phone_change",
      last_sent_at: nowIso,
      window_start: nowIso,
      window_count: 1,
    },
    { onConflict: "user_id,action" }
  );

  // 5) Audit
  await adminClient.from("auth_audit_logs").insert({
    user_id: userId,
    action: "otp_sent_phone_change",
    meta: { phone_e164: phone },
  });

  return json(200, { ok: true, cooldown_seconds: COOLDOWN_SECONDS });
});
