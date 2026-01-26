// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ReminderType = "1_day" | "1_hour";
type DbClient = SupabaseClient<any, "public", any>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const REMINDER_FROM_EMAIL = Deno.env.get("REMINDER_FROM_EMAIL") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SITE_URL_ENV = Deno.env.get("SITE_URL") ?? "";
const DISPLAY_TIME_ZONE = Deno.env.get("DISPLAY_TIME_ZONE") ?? "Africa/Cairo";

// strict time budgets
const HARD_DEADLINE_MS = 4700; // stop work before 5s hard limit
const WINDOW_MS = 5 * 60 * 1000; // ±5 minutes around target
const BATCH_PER_TYPE = 10;

// keep low for 5s runtime (especially with network)
const MAX_TOTAL_SEND = 8;

// network budgets
const RESEND_TIMEOUT_MS = 1100;

// DB budgets (PostgREST)
const DB_TIMEOUT_MS = 550;

// concurrency
const CONCURRENCY = 3;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeSiteUrl(raw: string) {
  const fallback = "http://localhost:3000";
  return (raw || fallback).trim().replace(/\/+$/, "");
}

function formatWhen(startTimeIso: string) {
  const d = new Date(startTimeIso);
  const base = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  } as const;

  try {
    return d.toLocaleString("en-US", { ...base, timeZone: DISPLAY_TIME_ZONE });
  } catch {
    return d.toLocaleString("en-US", base);
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  const locationLine = args.location
    ? `<p style="margin:0 0 12px;">Location: <b>${escapeHtml(args.location)}</b></p>`
    : "";

  return `
  <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; line-height:1.5; color:#0f172a;">
    <div style="max-width:560px; margin:0 auto; padding:24px;">
      <div style="background:#00386C; color:white; padding:16px 18px; border-radius:14px;">
        <div style="font-size:12px; opacity:.9;">AAST Events</div>
        <div style="font-size:18px; font-weight:800; margin-top:6px;">Event Reminder</div>
      </div>

      <div style="padding:18px 4px 0;">
        <p style="margin:0 0 10px;"><b>${lead}:</b> ${escapeHtml(args.eventTitle)}</p>
        <p style="margin:0 0 12px;">Starts: <b>${escapeHtml(when)}</b></p>
        ${locationLine}
        <a href="${args.eventUrl}"
           style="display:inline-block; background:#2563eb; color:white; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:700;">
          View event
        </a>
        <p style="margin:14px 0 0; font-size:12px; color:#64748b;">
          You’re receiving this because you tapped “Remind Me (1d + 1h)” on AAST Events.
        </p>
      </div>
    </div>
  </div>`;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function sendEmail(opts: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY || !REMINDER_FROM_EMAIL) {
    return { ok: false as const, skipped: true as const, error: "missing_email_env" };
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://api.resend.com/emails",
      {
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
      },
      RESEND_TIMEOUT_MS,
    );
  } catch (e: any) {
    if (String(e?.name || "") === "AbortError") {
      return { ok: false as const, skipped: false as const, error: "resend_timeout" };
    }
    return { ok: false as const, skipped: false as const, error: `resend_fetch_failed:${String(e?.message ?? e)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false as const, skipped: false as const, error: `resend_failed:${res.status}:${body}` };
  }

  return { ok: true as const };
}

function windowForOffset(offsetMs: number) {
  const now = Date.now();
  const target = now + offsetMs;
  const start = new Date(target - WINDOW_MS);
  const end = new Date(target + WINDOW_MS);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function claimBatch(supabase: DbClient, reminderType: ReminderType, batch: number) {
  const offsetMs = reminderType === "1_hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const { startIso, endIso } = windowForOffset(offsetMs);

  const { data, error } = await supabase.rpc("claim_due_event_reminders", {
    _reminder_type: reminderType,
    _start_time: startIso,
    _end_time: endIso,
    _batch: batch,
  });

  if (error) throw error;

  return (data ?? []) as Array<{
    id: string;
    user_id: string;
    event_id: number; // used for URL only
    reminder_type: ReminderType;
    email: string;
    title: string;
    start_time: string;
    location: string | null;
  }>;
}

// Supabase PostgREST builders are *thenables* but not typed as Promise in TS,
// so wrap them in Promise.resolve(builder) before Promise.race.
async function postgrestWithTimeout<T>(builder: any, ms: number): Promise<{ data: T; error: any }> {
  const timeoutP = new Promise<{ data: T; error: any }>((resolve) =>
    setTimeout(() => resolve({ data: null as any, error: new Error("db_timeout") }), ms),
  );

  // Promise.resolve converts the builder to a real Promise for TS + runtime
  return await Promise.race([Promise.resolve(builder) as Promise<{ data: T; error: any }>, timeoutP]);
}

async function markSent(supabase: DbClient, id: string) {
  const nowIso = new Date().toISOString();
  const builder = supabase
    .from("event_reminders")
    .update({ sent: true, sent_at: nowIso, processing_at: null, last_error: null })
    .eq("id", id);

  const { error } = await postgrestWithTimeout<null>(builder, DB_TIMEOUT_MS);
  if (error) throw error;
}

async function setLastErrorOnly(supabase: DbClient, id: string, message: string) {
  const builder = supabase.from("event_reminders").update({ last_error: message }).eq("id", id);
  const { error } = await postgrestWithTimeout<null>(builder, DB_TIMEOUT_MS);
  if (error) throw error;
}

// “15-minute late tradeoff” behavior: DO NOT clear processing_at on failure.
// Keep processing_at as-is, only write last_error.
async function failKeepLocked(supabase: DbClient, id: string, message: string) {
  await setLastErrorOnly(supabase, id, message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" });

  // Cron secret gate
  if (CRON_SECRET) {
    const got = req.headers.get("x-cron-secret") || "";
    if (got !== CRON_SECRET) return json(401, { error: "unauthorized" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: "missing_supabase_env" });
  }

  const startedAt = Date.now();
  const deadlineAt = startedAt + HARD_DEADLINE_MS;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }) as DbClient;

  const siteUrl = normalizeSiteUrl(SITE_URL_ENV);

  try {
    // Claim batches
    const oneHour = await claimBatch(supabase, "1_hour", BATCH_PER_TYPE);
    const oneDay = await claimBatch(supabase, "1_day", BATCH_PER_TYPE);

    const all = [...oneHour, ...oneDay].slice(0, MAX_TOTAL_SEND);

    let sentCount = 0;
    let skippedNonGmail = 0;
    let failedCount = 0;
    let timedOutEarly = false;

    // concurrency-limited worker pool
    const queue = all.slice();

    const worker = async () => {
      while (queue.length > 0) {
        if (Date.now() > deadlineAt) {
          timedOutEarly = true;
          return;
        }

        const row = queue.shift();
        if (!row) return;

        const email = (row.email || "").trim().toLowerCase();

        // Gmail-only
        if (!email.endsWith("@gmail.com")) {
          skippedNonGmail += 1;
          try {
            await failKeepLocked(supabase, row.id, "skipped_non_gmail");
          } catch {
            // OK: stale reclaim will pick it up later
          }
          continue;
        }

        const lead = row.reminder_type === "1_day" ? "Tomorrow" : "In 1 hour";
        const eventUrl = `${siteUrl}/event/${row.event_id}`;

        const res = await sendEmail({
          to: email,
          subject: `${lead}: ${row.title ?? "Event"}`,
          html: buildEmailHtml({
            reminderType: row.reminder_type,
            eventTitle: String(row.title ?? "Event"),
            startTimeIso: String(row.start_time),
            location: row.location ?? null,
            eventUrl,
          }),
        });

        if (res.ok) {
          try {
            await markSent(supabase, row.id);
            sentCount += 1;
          } catch (e: any) {
            failedCount += 1;
            const msg = `mark_sent_failed:${String(e?.message ?? e)}`.slice(0, 500);
            try {
              await failKeepLocked(supabase, row.id, msg);
            } catch {
              // ignore
            }
          }
        } else {
          failedCount += 1;
          const err = res.skipped ? "missing_email_env" : String(res.error ?? "email_failed");
          try {
            await failKeepLocked(supabase, row.id, err.slice(0, 500));
          } catch {
            // ignore
          }
        }
      }
    };

    const workerCount = Math.max(1, CONCURRENCY);
    const workers = Array.from({ length: workerCount }, () => worker());

    await Promise.race([
      Promise.all(workers),
      new Promise<void>((resolve) => {
        const msLeft = Math.max(0, deadlineAt - Date.now());
        setTimeout(() => {
          timedOutEarly = true;
          resolve();
        }, msLeft);
      }),
    ]);

    return json(200, {
      ok: true,
      siteUrl,
      claimed: { "1_hour": oneHour.length, "1_day": oneDay.length },
      processed: { sent: sentCount, skipped_non_gmail: skippedNonGmail, failed: failedCount },
      timed_out_early: timedOutEarly,
      runtime_ms: Date.now() - startedAt,
      config: {
        HARD_DEADLINE_MS,
        MAX_TOTAL_SEND,
        CONCURRENCY,
        RESEND_TIMEOUT_MS,
        DB_TIMEOUT_MS,
        WINDOW_MS,
        BATCH_PER_TYPE,
        DISPLAY_TIME_ZONE,
      },
    });
  } catch (e: any) {
    console.error("[send-event-reminders] failed:", e?.message ?? e);
    return json(500, { error: "internal_error", message: String(e?.message ?? e) });
  }
});