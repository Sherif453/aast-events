import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCors, applySecurityHeaders, preflight } from "@/lib/api/http";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const cors = { methods: ["GET", "OPTIONS"], headers: ["Content-Type", "Authorization"] };

function withHeaders(req: Request, res: Response) {
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  applyCors(req, res.headers, cors);
  applySecurityHeaders(res.headers);
  return res;
}

export function OPTIONS(req: Request) {
  return preflight(req, cors);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rl = await checkRateLimit(req, {
    keyPrefix: "api:admin:users",
    ip: { max: 60, windowMs: 60_000 },
    user: { max: 120, windowMs: 60_000 },
    userId: user?.id ?? null,
  });
  if (!rl.ok) return withHeaders(req, rateLimitResponse(rl.retryAfterSeconds));

  if (!user) return withHeaders(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: adminRow, error: adminErr } = await supabase
    .from("admin_users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (adminErr) {
    return withHeaders(req, NextResponse.json({ error: adminErr.message }, { status: 500 }));
  }

  if (adminRow?.role !== "super_admin") {
    return withHeaders(req, NextResponse.json({ error: "Forbidden" }, { status: 403 }));
  }

  // Prefer cookie-based access (RLS). Fall back to service role if RLS blocks super_admin reads.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, phone, full_name, major, year, updated_at")
    .order("updated_at", { ascending: false });

  if (!error) return withHeaders(req, NextResponse.json({ data }));

  const canUseServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!canUseServiceRole) return withHeaders(req, NextResponse.json({ error: error.message }, { status: 500 }));

  const admin = createAdminClient();
  const { data: adminData, error: adminErr2 } = await admin
    .from("profiles")
    .select("id, email, phone, full_name, major, year, updated_at")
    .order("updated_at", { ascending: false });

  if (adminErr2) return withHeaders(req, NextResponse.json({ error: adminErr2.message }, { status: 500 }));

  return withHeaders(req, NextResponse.json({ data: adminData }));
}
