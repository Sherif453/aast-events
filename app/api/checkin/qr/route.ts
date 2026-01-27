import { createClient } from "@/lib/supabase/server";
import { createHmac, timingSafeEqual } from "crypto";
import { applyCors, applySecurityHeaders, preflight } from "@/lib/api/http";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody, z, zIdString } from "@/lib/api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminRole = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";

type AdminUserRow = { role: AdminRole; club_id: string | null };
type EventRow = { id: string | number; club_id: string | null };
type AttendeeRow = { id: string | number; user_id: string; checked_in: boolean };
type PublicProfileRow = { full_name: string | null };

const VERSIONS = new Set(["v1", "v1dl", "v2dl"]);

const cors = { methods: ["POST", "OPTIONS"], headers: ["Content-Type", "Authorization"] };

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

function parseToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 5 && parts.length !== 7) return null;

  // v1 / v1dl: ver.attendeeId.eventId.exp.sig
  if (parts.length === 5) {
    const [ver, attendeeId, eventId, expStr, sig] = parts;
    if (!VERSIONS.has(ver)) return null;
    if (!zIdString.safeParse(attendeeId).success) return null;
    if (!zIdString.safeParse(eventId).success) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    return { attendeeId, eventId, exp, sig, payload: `${ver}.${attendeeId}.${eventId}.${exp}` };
  }

  // v2dl: ver.attendeeId.eventId.iat.exp.jti.sig
  const [ver, attendeeId, eventId, iatStr, expStr, jti, sig] = parts;
  if (!VERSIONS.has(ver)) return null;
  if (!zIdString.safeParse(attendeeId).success) return null;
  if (!zIdString.safeParse(eventId).success) return null;
  const iat = Number(iatStr);
  const exp = Number(expStr);
  if (!Number.isFinite(iat) || iat <= 0) return null;
  if (!Number.isFinite(exp) || exp <= 0) return null;
  if (exp <= iat) return null;
  if (typeof jti !== "string" || jti.length < 8 || jti.length > 128) return null;
  return { attendeeId, eventId, exp, sig, payload: `${ver}.${attendeeId}.${eventId}.${iat}.${exp}.${jti}` };
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rl = await checkRateLimit(req, {
    keyPrefix: "api:checkin:qr",
    ip: { max: 20, windowMs: 60_000 },
    user: { max: 30, windowMs: 60_000 },
    userId: user?.id ?? null,
  });
  if (!rl.ok) return withHeaders(req, rateLimitResponse(rl.retryAfterSeconds));

  if (!user) return withHeaders(req, Response.json({ error: "unauthorized" }, { status: 401 }));

  const secret = process.env.QR_TOKEN_SECRET || "";
  if (!secret) return withHeaders(req, Response.json({ error: "server_not_configured" }, { status: 500 }));

  let token: string;
  try {
    const bodySchema = z.object({ token: z.string().trim().min(1).max(4096) }).strict();
    const body = await parseJsonBody(req, bodySchema);
    token = body.token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid_body";
    if (msg === "invalid_json") return withHeaders(req, Response.json({ error: "invalid_json" }, { status: 400 }));
    return withHeaders(req, Response.json({ error: "missing_token" }, { status: 400 }));
  }

  const parsed = parseToken(token);
  if (!parsed) return withHeaders(req, Response.json({ error: "invalid_token" }, { status: 400 }));

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp < now - 3) return withHeaders(req, Response.json({ error: "token_expired" }, { status: 400 }));

  const expectedSig = sign(secret, parsed.payload);
  if (!safeEq(parsed.sig, expectedSig)) {
    return withHeaders(req, Response.json({ error: "invalid_signature" }, { status: 400 }));
  }

  // Authorization: must be an admin/volunteer for the event's club.
  const { data: adminRow, error: adminErr } = await supabase
    .from("admin_users")
    .select("role, club_id")
    .eq("id", user.id)
    .maybeSingle();

  if (adminErr) return withHeaders(req, Response.json({ error: "admin_lookup_failed" }, { status: 500 }));
  if (!adminRow) return withHeaders(req, Response.json({ error: "forbidden" }, { status: 403 }));

  const admin = adminRow as unknown as AdminUserRow;
  const adminRole = admin.role;
  const adminClubId = admin.club_id ?? null;

  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, club_id")
    .eq("id", parsed.eventId)
    .maybeSingle();

  if (eventErr) return withHeaders(req, Response.json({ error: "event_lookup_failed" }, { status: 500 }));
  if (!eventRow) return withHeaders(req, Response.json({ error: "event_not_found" }, { status: 404 }));

  const event = eventRow as unknown as EventRow;
  const eventClubId = event.club_id ?? null;
  const allowed =
    adminRole === "super_admin" ||
    (eventClubId &&
      (adminRole === "club_admin" || adminRole === "event_volunteer") &&
      adminClubId &&
      adminClubId === eventClubId);

  if (!allowed) return withHeaders(req, Response.json({ error: "forbidden" }, { status: 403 }));

  const { data: attendeeRow, error: attErr } = await supabase
    .from("attendees")
    .select("id, user_id, checked_in")
    .eq("id", parsed.attendeeId)
    .eq("event_id", parsed.eventId)
    .maybeSingle();

  if (attErr) return withHeaders(req, Response.json({ error: "attendee_lookup_failed" }, { status: 500 }));
  if (!attendeeRow) return withHeaders(req, Response.json({ error: "attendee_not_found" }, { status: 404 }));

  const attendee = attendeeRow as unknown as AttendeeRow;

  if (attendee.checked_in) {
    const { data: profile } = await supabase
      .from("profiles_public")
      .select("full_name")
      .eq("id", attendee.user_id)
      .maybeSingle();

    const pubProfile = profile as unknown as PublicProfileRow | null;
    return withHeaders(
      req,
      Response.json({
        ok: false,
        error: "already_checked_in",
        attendeeId: attendee.id,
        attendeeName: pubProfile?.full_name ?? "Unknown User",
      })
    );
  }

  const checkedInAt = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("attendees")
    .update({ checked_in: true, checked_in_at: checkedInAt, checked_in_by: user.id })
    .eq("id", attendee.id)
    .eq("checked_in", false)
    .select("id")
    .maybeSingle();

  if (updErr) {
    return withHeaders(req, Response.json({ error: "checkin_failed", message: updErr.message }, { status: 500 }));
  }
  if (!updated) return withHeaders(req, Response.json({ error: "already_checked_in" }, { status: 409 }));

  const { data: profile } = await supabase
    .from("profiles_public")
    .select("full_name")
    .eq("id", attendee.user_id)
    .maybeSingle();

  const pubProfile = profile as unknown as PublicProfileRow | null;
  return withHeaders(
    req,
    Response.json({
      ok: true,
      attendeeId: attendee.id,
      checkedInAt,
      attendeeName: pubProfile?.full_name ?? "Unknown User",
    })
  );
}
