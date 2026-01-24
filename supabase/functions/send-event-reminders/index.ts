import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReminderType = "1_day" | "1_hour";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const REMINDER_FROM_EMAIL = Deno.env.get("REMINDER_FROM_EMAIL") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const WINDOW_MS = 5 * 60 * 1000; // scheduler cadence window (±5 minutes)

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatWhen(startTimeIso: string) {
  const d = new Date(startTimeIso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function sendEmail(opts: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY || !REMINDER_FROM_EMAIL) {
    return { ok: false as const, skipped: true as const, error: "missing_email_env" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: REMINDER_FROM_EMAIL,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false as const, skipped: false as const, error: `resend_failed:${res.status}:${body}` };
  }

  return { ok: true as const };
}

function buildEmailHtml(args: {
  reminderType: ReminderType;
  eventTitle: string;
  startTimeIso: string;
  location?: string | null;
  eventUrl: string;
}) {
  const when = formatWhen(args.startTimeIso);
  const lead = args.reminderType === "1_day" ? "Tomorrow" : "In 1 hour";
  const locationLine = args.location ? `<p style="margin:0 0 12px;">Location: <b>${args.location}</b></p>` : "";

  return `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; line-height:1.5; color:#0f172a;">
    <div style="max-width:560px; margin:0 auto; padding:24px;">
      <div style="background:#00386C; color:white; padding:16px 18px; border-radius:14px;">
        <div style="font-size:12px; opacity:.9;">AAST Events</div>
        <div style="font-size:18px; font-weight:800; margin-top:6px;">Event Reminder</div>
      </div>

      <div style="padding:18px 4px 0;">
        <p style="margin:0 0 10px;"><b>${lead}:</b> ${args.eventTitle}</p>
        <p style="margin:0 0 12px;">Starts: <b>${when}</b></p>
        ${locationLine}
        <a href="${args.eventUrl}" style="display:inline-block; background:#2563eb; color:white; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:700;">
          View event
        </a>
        <p style="margin:14px 0 0; font-size:12px; color:#64748b;">
          You’re receiving this because you tapped “Remind Me (1d + 1h)” on AAST Events.
        </p>
      </div>
    </div>
  </div>`;
}

async function createInAppNotification(supabase: ReturnType<typeof createClient>, args: {
  userId: string;
  eventId: string | number;
  reminderType: ReminderType;
  eventTitle: string;
  startTimeIso: string;
}) {
  const when = formatWhen(args.startTimeIso);
  const lead = args.reminderType === "1_day" ? "Event is tomorrow" : "Event starts in 1 hour";

  await supabase.from("notifications").insert({
    user_id: args.userId,
    title: `${lead}: ${args.eventTitle}`,
    message: `Starts ${when}.`,
    type: "event_reminder",
    related_id: String(args.eventId),
    read: false,
  });
}

async function processRemindersForOffset(opts: {
  supabase: ReturnType<typeof createClient>;
  reminderType: ReminderType;
  offsetMs: number;
  siteUrl: string;
}) {
  const now = Date.now();
  const target = now + opts.offsetMs;
  const start = new Date(target - WINDOW_MS);
  const end = new Date(target + WINDOW_MS);

  const { data: events, error: eventsErr } = await opts.supabase
    .from("events")
    .select("id, title, start_time, location")
    .gte("start_time", start.toISOString())
    .lte("start_time", end.toISOString());

  if (eventsErr) throw eventsErr;

  for (const event of events || []) {
    const { data: reminders, error: remErr } = await opts.supabase
      .from("event_reminders")
      .select("user_id")
      .eq("event_id", event.id)
      .eq("reminder_type", opts.reminderType)
      .eq("sent", false);

    if (remErr) throw remErr;

    const userIds = Array.from(new Set((reminders || []).map((r: any) => r.user_id).filter(Boolean)));

    const { data: profiles, error: profErr } = userIds.length
      ? await opts.supabase.from("profiles").select("id, email").in("id", userIds)
      : { data: [], error: null };

    if (profErr) throw profErr;

    const emailByUserId = new Map<string, string | null>();
    for (const p of profiles || []) emailByUserId.set(String((p as any).id), (p as any).email ?? null);

    for (const reminder of reminders || []) {
      const nowIso = new Date().toISOString();
      const eventUrl = `${opts.siteUrl.replace(/\\/+$/, "")}/event/${event.id}`;

      // 1) In-app notification (best effort; do not block emails on transient insert failures)
      try {
        await createInAppNotification(opts.supabase, {
          userId: reminder.user_id,
          eventId: event.id,
          reminderType: opts.reminderType,
          eventTitle: event.title,
          startTimeIso: event.start_time,
        });
      } catch (e) {
        console.warn("[send-event-reminders] notification insert failed:", e);
      }

      // 2) Email (best effort; skips if no email or env not configured)
      const email = emailByUserId.get(String(reminder.user_id)) ?? null;
      if (email) {
        const lead = opts.reminderType === "1_day" ? "Tomorrow" : "In 1 hour";
        await sendEmail({
          to: email,
          subject: `${lead}: ${event.title}`,
          html: buildEmailHtml({
            reminderType: opts.reminderType,
            eventTitle: event.title,
            startTimeIso: event.start_time,
            location: event.location,
            eventUrl,
          }),
        });
      }

      // 3) Mark reminder as sent (keeps function idempotent on next runs)
      const { error: updErr } = await opts.supabase
        .from("event_reminders")
        .update({ sent: true, sent_at: nowIso })
        .eq("user_id", reminder.user_id)
        .eq("event_id", event.id)
        .eq("reminder_type", opts.reminderType);

      if (updErr) throw updErr;
    }
  }
}

Deno.serve(async (req) => {
  // Intended to be called by a scheduler / cron; keep it simple.
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" });

  if (CRON_SECRET) {
    const got = req.headers.get("x-cron-secret") || "";
    if (got !== CRON_SECRET) return json(401, { error: "unauthorized" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:3000";

  try {
    await processRemindersForOffset({
      supabase,
      reminderType: "1_hour",
      offsetMs: 60 * 60 * 1000,
      siteUrl,
    });

    await processRemindersForOffset({
      supabase,
      reminderType: "1_day",
      offsetMs: 24 * 60 * 60 * 1000,
      siteUrl,
    });

    return json(200, { ok: true });
  } catch (e: any) {
    console.error("[send-event-reminders] failed:", { message: e?.message });
    return json(500, { error: "internal_error", message: String(e?.message || e) });
  }
});
