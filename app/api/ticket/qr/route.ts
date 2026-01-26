import { createClient } from "@/lib/supabase/server";
import { createHmac, timingSafeEqual } from "crypto";
import { applyCors, applySecurityHeaders, preflight } from "@/lib/api/http";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { zUuid } from "@/lib/api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_SECONDS = 30;
const VERSION = "v1";

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

function base64Url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sign(secret: string, payload: string) {
  const sig = createHmac("sha256", secret).update(payload).digest();
  return base64Url(sig);
}

function safeEq(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rl = await checkRateLimit(req, {
    keyPrefix: "api:ticket:qr",
    ip: { max: 20, windowMs: 60_000 },
    user: { max: 30, windowMs: 60_000 },
    userId: user?.id ?? null,
  });
  if (!rl.ok) return withHeaders(req, rateLimitResponse(rl.retryAfterSeconds));

  if (!user) return withHeaders(req, Response.json({ error: "unauthorized" }, { status: 401 }));

  const secret = process.env.QR_TOKEN_SECRET || "";
  if (!secret) return withHeaders(req, Response.json({ error: "server_not_configured" }, { status: 500 }));

  const { searchParams } = new URL(req.url);
  const eventId = String(searchParams.get("eventId") || "").trim();
  if (!eventId) return withHeaders(req, Response.json({ error: "missing_eventId" }, { status: 400 }));
  if (!zUuid.safeParse(eventId).success) {
    return withHeaders(req, Response.json({ error: "invalid_eventId" }, { status: 400 }));
  }

  const { data: attendance, error } = await supabase
    .from("attendees")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return withHeaders(req, Response.json({ error: "db_error", message: error.message }, { status: 500 }));
  if (!attendance?.id) return withHeaders(req, Response.json({ error: "not_attending" }, { status: 404 }));

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${VERSION}.${attendance.id}.${eventId}.${exp}`;
  const sig = sign(secret, payload);
  const token = `${payload}.${sig}`;

  // Self-check (defensive; should never fail).
  const verifySig = sign(secret, payload);
  if (!safeEq(sig, verifySig)) return withHeaders(req, Response.json({ error: "sign_failed" }, { status: 500 }));

  return withHeaders(req, Response.json({ token, expiresAt: exp }));
}
