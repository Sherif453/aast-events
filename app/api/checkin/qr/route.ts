import { createClient } from "@/lib/supabase/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminRole = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";

const VERSION = "v1";

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
  if (parts.length !== 5) return null;
  const [ver, attendeeId, eventId, expStr, sig] = parts;
  if (ver !== VERSION) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return { attendeeId, eventId, exp, sig, payload: `${ver}.${attendeeId}.${eventId}.${exp}` };
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const secret = process.env.QR_TOKEN_SECRET || "";
  if (!secret) return Response.json({ error: "server_not_configured" }, { status: 500 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = String(body?.token || "").trim();
  if (!token) return Response.json({ error: "missing_token" }, { status: 400 });

  const parsed = parseToken(token);
  if (!parsed) return Response.json({ error: "invalid_token" }, { status: 400 });

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp < now - 3) return Response.json({ error: "token_expired" }, { status: 400 });

  const expectedSig = sign(secret, parsed.payload);
  if (!safeEq(parsed.sig, expectedSig)) return Response.json({ error: "invalid_signature" }, { status: 400 });

  // Authorization: must be an admin/volunteer for the event's club.
  const { data: adminRow, error: adminErr } = await supabase
    .from("admin_users")
    .select("role, club_id")
    .eq("id", user.id)
    .maybeSingle();

  if (adminErr) return Response.json({ error: "admin_lookup_failed" }, { status: 500 });
  if (!adminRow) return Response.json({ error: "forbidden" }, { status: 403 });

  const adminRole = adminRow.role as AdminRole;
  const adminClubId = (adminRow as any).club_id ?? null;

  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, club_id")
    .eq("id", parsed.eventId)
    .maybeSingle();

  if (eventErr) return Response.json({ error: "event_lookup_failed" }, { status: 500 });
  if (!eventRow) return Response.json({ error: "event_not_found" }, { status: 404 });

  const eventClubId = (eventRow as any).club_id ?? null;
  const allowed =
    adminRole === "super_admin" ||
    (eventClubId &&
      (adminRole === "club_admin" || adminRole === "event_volunteer") &&
      adminClubId &&
      adminClubId === eventClubId);

  if (!allowed) return Response.json({ error: "forbidden" }, { status: 403 });

  const { data: attendeeRow, error: attErr } = await supabase
    .from("attendees")
    .select("id, user_id, checked_in")
    .eq("id", parsed.attendeeId)
    .eq("event_id", parsed.eventId)
    .maybeSingle();

  if (attErr) return Response.json({ error: "attendee_lookup_failed" }, { status: 500 });
  if (!attendeeRow) return Response.json({ error: "attendee_not_found" }, { status: 404 });

  if ((attendeeRow as any).checked_in) {
    const { data: profile } = await supabase
      .from("profiles_public")
      .select("full_name")
      .eq("id", (attendeeRow as any).user_id)
      .maybeSingle();

    return Response.json({
      ok: false,
      error: "already_checked_in",
      attendeeId: (attendeeRow as any).id,
      attendeeName: (profile as any)?.full_name ?? "Unknown User",
    });
  }

  const checkedInAt = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from("attendees")
    .update({ checked_in: true, checked_in_at: checkedInAt, checked_in_by: user.id })
    .eq("id", (attendeeRow as any).id)
    .eq("checked_in", false)
    .select("id")
    .maybeSingle();

  if (updErr) return Response.json({ error: "checkin_failed", message: updErr.message }, { status: 500 });
  if (!updated) return Response.json({ error: "already_checked_in" }, { status: 409 });

  const { data: profile } = await supabase
    .from("profiles_public")
    .select("full_name")
    .eq("id", (attendeeRow as any).user_id)
    .maybeSingle();

  return Response.json({
    ok: true,
    attendeeId: (attendeeRow as any).id,
    checkedInAt,
    attendeeName: (profile as any)?.full_name ?? "Unknown User",
  });
}

