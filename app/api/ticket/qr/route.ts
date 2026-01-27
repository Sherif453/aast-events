import { createClient } from "@/lib/supabase/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { applyCors, applySecurityHeaders, preflight } from "@/lib/api/http";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseQuery, z, zIdString } from "@/lib/api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_TOKEN_TTL_SECONDS = 30;
const LIVE_VERSION = "v1";
const DOWNLOAD_VERSION = "v2dl";

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

  if (!user) return withHeaders(req, Response.json({ error: "unauthorized" }, { status: 401 }));

  const secret = process.env.QR_TOKEN_SECRET || "";
  if (!secret) return withHeaders(req, Response.json({ error: "server_not_configured" }, { status: 500 }));

  const querySchema = z
    .object({
      eventId: zIdString,
      mode: z.enum(["live", "download"]).optional(),
    })
    .strict();
  let eventId: string;
  let mode: "live" | "download" = "live";
  try {
    const parsed = parseQuery(req, querySchema);
    eventId = parsed.eventId;
    mode = parsed.mode ?? "live";
  } catch {
    const { searchParams } = new URL(req.url);
    const raw = String(searchParams.get("eventId") || "").trim();
    return withHeaders(req, Response.json({ error: raw ? "invalid_eventId" : "missing_eventId" }, { status: 400 }));
  }

  const rl = await checkRateLimit(req, {
    keyPrefix: mode === "download" ? "api:ticket:download" : "api:ticket:qr",
    ip: { max: 20, windowMs: 60_000 },
    user: { max: 30, windowMs: 60_000 },
    userId: user?.id ?? null,
  });
  if (!rl.ok) return withHeaders(req, rateLimitResponse(rl.retryAfterSeconds));

  const { data: attendance, error } = await supabase
    .from("attendees")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return withHeaders(req, Response.json({ error: "db_error", message: error.message }, { status: 500 }));
  if (!attendance?.id) return withHeaders(req, Response.json({ error: "not_attending" }, { status: 404 }));

  const nowSec = Math.floor(Date.now() / 1000);

  // Live QR: short-lived rotating token (no iat/jti to keep payload small).
  if (mode === "live") {
    const exp = nowSec + LIVE_TOKEN_TTL_SECONDS;
    const payload = `${LIVE_VERSION}.${attendance.id}.${eventId}.${exp}`;
    const sig = sign(secret, payload);
    const token = `${payload}.${sig}`;

    const verifySig = sign(secret, payload);
    if (!safeEq(sig, verifySig)) return withHeaders(req, Response.json({ error: "sign_failed" }, { status: 500 }));

    return withHeaders(req, Response.json({ token, expiresAt: exp }));
  }

  // Download QR: longer-lived offline-friendly token with iat + jti.
  // Expiry policy: event start + 24h (no end_time stored).
  const { data: eventRow } = await supabase
    .from("events")
    .select("start_time")
    .eq("id", eventId)
    .maybeSingle();

  const startMs = eventRow?.start_time ? new Date(String(eventRow.start_time)).getTime() : Number.NaN;
  if (!Number.isFinite(startMs)) {
    return withHeaders(req, Response.json({ error: "event_time_missing" }, { status: 500 }));
  }

  const startSec = Math.floor(startMs / 1000);
  const exp = startSec + 60 * 60 * 24;
  if (exp <= nowSec) {
    return withHeaders(req, Response.json({ error: "ticket_expired" }, { status: 400 }));
  }

  const iat = nowSec;
  const jti = randomBytes(16).toString("hex");
  const payload = `${DOWNLOAD_VERSION}.${attendance.id}.${eventId}.${iat}.${exp}.${jti}`;
  const sig = sign(secret, payload);
  const token = `${payload}.${sig}`;

  // Self-check (defensive; should never fail).
  const verifySig = sign(secret, payload);
  if (!safeEq(sig, verifySig)) return withHeaders(req, Response.json({ error: "sign_failed" }, { status: 500 }));

  return withHeaders(req, Response.json({ token, expiresAt: exp }));
}
