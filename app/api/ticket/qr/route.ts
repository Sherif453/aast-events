import { createClient } from "@/lib/supabase/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_SECONDS = 30;
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

export async function GET(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const secret = process.env.QR_TOKEN_SECRET || "";
  if (!secret) return Response.json({ error: "server_not_configured" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const eventId = String(searchParams.get("eventId") || "").trim();
  if (!eventId) return Response.json({ error: "missing_eventId" }, { status: 400 });

  const { data: attendance, error } = await supabase
    .from("attendees")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return Response.json({ error: "db_error", message: error.message }, { status: 500 });
  if (!attendance?.id) return Response.json({ error: "not_attending" }, { status: 404 });

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${VERSION}.${attendance.id}.${eventId}.${exp}`;
  const sig = sign(secret, payload);
  const token = `${payload}.${sig}`;

  // Self-check (defensive; should never fail).
  const verifySig = sign(secret, payload);
  if (!safeEq(sig, verifySig)) return Response.json({ error: "sign_failed" }, { status: 500 });

  return Response.json({ token, expiresAt: exp });
}

