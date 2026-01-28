import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Shield, ChevronLeft } from "lucide-react";

type Role = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";
type AuditAction = "created" | "updated" | "deleted";

function normalizeRole(value: unknown): Role | null {
  const r = String(value ?? "").trim();
  if (r === "super_admin" || r === "club_admin" || r === "event_volunteer" || r === "read_only_analytics") return r;
  return null;
}

function pickField(obj: unknown, keys: readonly string[]) {
  const rec = obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  if (!rec) return null;
  for (const k of keys) if (rec[k] != null) return rec[k];
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function stableJson(v: unknown): string {
  if (v == null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(rec[k])}`).join(",")}}`;
}

function toTitleCaseKey(key: string): string {
  if (key === "club_id") return "Club";
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatClubForDisplay(value: unknown, clubNameById: Map<string, string>): string {
  const id = value == null ? null : String(value);
  if (!id) return "No club linked";
  return clubNameById.get(id) ?? "Unknown club";
}

function formatValueForDisplay(key: string, value: unknown, clubNameById: Map<string, string>): string {
  if (key === "club_id") return formatClubForDisplay(value, clubNameById);
  if (value == null) return "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    const looksLikeDate = /_at$|_time$|time$/i.test(key) || /^\d{4}-\d{2}-\d{2}T/.test(trimmed);
    if (looksLikeDate) {
      const d = new Date(trimmed);
      if (Number.isFinite(d.getTime())) return d.toLocaleString();
    }
    if (trimmed.length > 120) return `${trimmed.slice(0, 117)}…`;
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const s = JSON.stringify(value);
    return s && s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return String(value);
  }
}

function normalizeActionsParam(v: unknown): Set<AuditAction> {
  const raw = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set<AuditAction>();
  for (const p of parts) {
    if (p === "created" || p === "updated" || p === "deleted") allowed.add(p);
  }
  if (allowed.size === 0) return new Set<AuditAction>(["created", "updated", "deleted"]);
  return allowed;
}

function parseBoolParam(v: unknown): boolean {
  const s = Array.isArray(v) ? v[0] : typeof v === "string" ? v : "";
  return s === "1" || s.toLowerCase() === "true" || s.toLowerCase() === "yes";
}

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  type AdminRow = { role: string; club_id: string | null };
  const { data: adminRowRaw } = await supabase.from("admin_users").select("role, club_id").eq("id", user.id).maybeSingle();
  const adminRow = (adminRowRaw as unknown as AdminRow | null) ?? null;
  const role = normalizeRole(adminRow?.role);

  if (!role) redirect("/");
  if (role !== "super_admin" && role !== "club_admin") redirect("/admin");

  const myClubId = adminRow?.club_id ?? null;
  if (role === "club_admin" && !myClubId) redirect("/admin");

  const sp = searchParams ? await searchParams : {};
  const actions = normalizeActionsParam(sp.actions);
  const showNoisy = parseBoolParam(sp.noisy);

  type EventRow = { id: string | number; title: string | null; club_id: string | null };
  type ProfileRow = { id: string | number; full_name: string | null; email: string | null };
  type ClubRow = { id: string | number; name: string | null };

  let clubEventRows: EventRow[] | null = null;
  let clubEventIds: Array<string | number> = [];
  if (role === "club_admin" && myClubId) {
    const { data: clubEventsData, error: clubEventsErr } = await supabase
      .from("events")
      .select("id, title, club_id")
      .eq("club_id", myClubId)
      .limit(2000);

    if (clubEventsErr) {
      return (
        <div className="min-h-screen bg-background">
          <div className="bg-card border-b border-border">
            <div className="max-w-7xl mx-auto p-6 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
                <p className="text-muted-foreground mt-1">Recent event changes</p>
              </div>
              <Button asChild variant="outline">
                <Link href="/admin">
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Link>
              </Button>
            </div>
          </div>

          <div className="max-w-7xl mx-auto p-6">
            <div className="bg-card rounded-xl border border-border p-6">
              <p className="text-sm text-muted-foreground">Audit log is unavailable.</p>
              <p className="text-xs text-muted-foreground mt-2">Error: {clubEventsErr.message}</p>
            </div>
          </div>
        </div>
      );
    }

    clubEventRows = (clubEventsData as unknown as EventRow[] | null) ?? [];
    clubEventIds = clubEventRows.map((e) => e.id);
  }

  const fetchAudits = async (action: AuditAction, limit: number) => {
    let q = supabase
      .from("event_audit_log")
      .select("*")
      .eq("action", action)
      .order("changed_at", { ascending: false })
      .limit(limit);

    const { data, error } = await q;
    return { data: (data as unknown[] | null) ?? null, error: (error as { message: string } | null) ?? null };
  };

  const queries: Array<Promise<{ data: unknown[] | null; error: { message: string } | null }>> = [];
  if (actions.has("updated")) queries.push(fetchAudits("updated", 180));
  if (actions.has("created")) queries.push(fetchAudits("created", 60));
  if (actions.has("deleted")) queries.push(fetchAudits("deleted", 60));

  const results = await Promise.all(queries);
  const firstErr = results.find((r) => r.error)?.error ?? null;
  const rawLogs = firstErr ? null : results.flatMap((r) => r.data ?? []);
  const logErr = firstErr;

  if (logErr) {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto p-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
              <p className="text-muted-foreground mt-1">Recent event changes</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/admin">
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back
              </Link>
            </Button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto p-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <p className="text-sm text-muted-foreground">Audit log is unavailable.</p>
            <p className="text-xs text-muted-foreground mt-2">Error: {logErr.message}</p>
          </div>
        </div>
      </div>
    );
  }

  type AuditLogRow = Record<string, unknown>;
  const logs = ((rawLogs as unknown as AuditLogRow[] | null) ?? []).slice();

  const tsKey = (row: AuditLogRow) =>
    (pickField(row, ["changed_at", "created_at", "performed_at", "timestamp", "inserted_at", "updated_at"]) as string | null);
  logs.sort((a, b) => {
    const ta = tsKey(a) ? new Date(tsKey(a) as string).getTime() : 0;
    const tb = tsKey(b) ? new Date(tsKey(b) as string).getTime() : 0;
    return tb - ta;
  });

  const eventIds = Array.from(
    new Set(
      logs
        .map((r) => pickField(r, ["event_id", "eventId", "event"]) as string | null)
        .filter(Boolean)
        .map((v) => String(v))
    )
  );

  const actorIds = Array.from(
    new Set(
      logs
        .map((r) => pickField(r, ["changed_by", "actor_id", "performed_by", "user_id", "admin_id"]) as string | null)
        .filter(Boolean)
        .map((v) => String(v))
    )
  );

  const [{ data: eventsData }, { data: profilesData }] = await Promise.all([
    role === "super_admin" && eventIds.length
      ? supabase.from("events").select("id, title, club_id").in("id", eventIds)
      : Promise.resolve({ data: [] as EventRow[] }),
    actorIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
      : Promise.resolve({ data: [] as ProfileRow[] }),
  ]);

  const eventMap = new Map<string, EventRow>();
  const eventRows =
    role === "club_admin" ? (clubEventRows ?? []) : ((eventsData as unknown as EventRow[] | null) ?? []);
  eventRows.forEach((e) => eventMap.set(String(e.id), e));

  const clubIdsSet = new Set<string>();
  for (const ev of eventRows) {
    const cid = ev.club_id == null ? null : String(ev.club_id);
    if (cid) clubIdsSet.add(cid);
  }
  for (const row of logs) {
    const oldRec = asRecord(pickField(row, ["old_data", "oldData"]));
    const newRec = asRecord(pickField(row, ["new_data", "newData"]));
    const oc = oldRec?.club_id == null ? null : String(oldRec.club_id);
    const nc = newRec?.club_id == null ? null : String(newRec.club_id);
    if (oc) clubIdsSet.add(oc);
    if (nc) clubIdsSet.add(nc);
  }

  const clubIds = Array.from(clubIdsSet);
  const { data: clubsData } = clubIds.length
    ? await supabase.from("clubs").select("id, name").in("id", clubIds)
    : { data: [] as ClubRow[] };
  const clubNameById = new Map<string, string>();
  const clubRows = (clubsData as unknown as ClubRow[] | null) ?? [];
  clubRows.forEach((c) => clubNameById.set(String(c.id), String(c.name ?? "")));

  const profileMap = new Map<string, ProfileRow>();
  const profileRows = (profilesData as unknown as ProfileRow[] | null) ?? [];
  profileRows.forEach((p) => profileMap.set(String(p.id), p));

  const actionLabel = (row: AuditLogRow) => {
    const raw = pickField(row, ["action", "event", "type", "operation"]) as string | null;
    const v = (raw ? String(raw) : "").trim().toLowerCase();
    if (v === "created" || v === "updated" || v === "deleted") return v;
    if (v === "insert") return "created";
    if (v === "update") return "updated";
    if (v === "delete") return "deleted";
    return raw ? String(raw) : "change";
  };

  const describeChanges = (row: AuditLogRow): { lines: string[] } => {
    const oldData = pickField(row, ["old_data", "oldData"]);
    const newData = pickField(row, ["new_data", "newData"]);
    const oldRec = asRecord(oldData);
    const newRec = asRecord(newData);

    const action = actionLabel(row);
    const ignoreKeys = new Set(["updated_at", "created_at"]);
    const preferredKeys = [
      "title",
      "description",
      "start_time",
      "end_time",
      "location",
      "campus",
      "organizer_name",
      "club_id",
      "registration_link",
      "image_url",
      "attendee_count",
      "checked_in_count",
    ];

    const keys = new Set<string>();
    if (oldRec) Object.keys(oldRec).forEach((k) => keys.add(k));
    if (newRec) Object.keys(newRec).forEach((k) => keys.add(k));

    const keyList = [
      ...preferredKeys.filter((k) => keys.has(k)),
      ...Array.from(keys).filter((k) => !preferredKeys.includes(k)).sort(),
    ].filter((k) => !ignoreKeys.has(k));

    const lines: string[] = [];

    if (action === "updated" && oldRec && newRec) {
      for (const k of keyList) {
        const a = oldRec[k];
        const b = newRec[k];
        if (stableJson(a) !== stableJson(b)) {
          lines.push(
            `${toTitleCaseKey(k)}: ${formatValueForDisplay(k, a, clubNameById)} → ${formatValueForDisplay(k, b, clubNameById)}`
          );
        }
      }
      if (lines.length === 0) lines.push("No meaningful field changes detected.");
    } else if (action === "created" && newRec) {
      const summaryKeys = ["title", "start_time", "location", "campus", "club_id"];
      for (const k of summaryKeys)
        if (k in newRec) lines.push(`${toTitleCaseKey(k)}: ${formatValueForDisplay(k, newRec[k], clubNameById)}`);
      if (lines.length === 0) lines.push("Created.");
    } else if (action === "deleted" && oldRec) {
      const summaryKeys = ["title", "start_time", "location", "campus", "club_id"];
      for (const k of summaryKeys)
        if (k in oldRec) lines.push(`${toTitleCaseKey(k)}: ${formatValueForDisplay(k, oldRec[k], clubNameById)}`);
      if (lines.length === 0) lines.push("Deleted.");
    } else {
      lines.push("Details unavailable.");
    }

    return { lines: lines.slice(0, 10) };
  };

  const isLowSignalUpdate = (row: AuditLogRow) => {
    const action = actionLabel(row);
    if (action !== "updated") return false;
    const { lines } = describeChanges(row);
    return lines.length === 1 && lines[0] === "No meaningful field changes detected.";
  };

  const visibleLogs = showNoisy ? logs : logs.filter((r) => !isLowSignalUpdate(r));

  const hrefFor = (nextActions: string, noisy: boolean) => {
    const params = new URLSearchParams();
    if (nextActions) params.set("actions", nextActions);
    if (noisy) params.set("noisy", "1");
    const qs = params.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto p-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              {role === "club_admin" ? "Changes for your club’s events" : "All event changes"}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/admin">
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant={actions.size === 3 ? "default" : "outline"} size="sm">
              <Link href={hrefFor("created,updated,deleted", showNoisy)}>All</Link>
            </Button>
            <Button asChild variant={actions.size === 1 && actions.has("created") ? "default" : "outline"} size="sm">
              <Link href={hrefFor("created", showNoisy)}>Created</Link>
            </Button>
            <Button asChild variant={actions.size === 1 && actions.has("updated") ? "default" : "outline"} size="sm">
              <Link href={hrefFor("updated", showNoisy)}>Updated</Link>
            </Button>
            <Button asChild variant={actions.size === 1 && actions.has("deleted") ? "default" : "outline"} size="sm">
              <Link href={hrefFor("deleted", showNoisy)}>Deleted</Link>
            </Button>
          </div>

          <Button asChild variant={showNoisy ? "default" : "outline"} size="sm">
            <Link href={hrefFor(Array.from(actions).join(","), !showNoisy)}>{showNoisy ? "Hide" : "Show"} noisy updates</Link>
          </Button>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {visibleLogs.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No audit entries yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {visibleLogs.slice(0, 200).map((row, idx: number) => {
                const eventId = String(pickField(row, ["event_id", "eventId", "event"]) ?? "");
                const ev = eventMap.get(eventId);

                const actorId = String(
                  pickField(row, ["changed_by", "actor_id", "performed_by", "user_id", "admin_id"]) ?? ""
                );
                const actor = profileMap.get(actorId);

                const when = tsKey(row);
                const action = actionLabel(row);
                const { lines } = describeChanges(row);
                const actionClass =
                  action === "created"
                    ? "text-green-600 dark:text-green-400"
                    : action === "deleted"
                      ? "text-red-600 dark:text-red-400"
                      : "text-blue-600 dark:text-blue-400";

                const oldRec = asRecord(pickField(row, ["old_data", "oldData"]));
                const newRec = asRecord(pickField(row, ["new_data", "newData"]));
                const fallbackTitle =
                  (action === "created" ? (newRec?.title as string | undefined) : undefined) ??
                  (action === "deleted" ? (oldRec?.title as string | undefined) : undefined) ??
                  (newRec?.title as string | undefined) ??
                  (oldRec?.title as string | undefined) ??
                  null;
                const title = ev?.title ?? fallbackTitle;

                return (
                  <div key={String(pickField(row, ["id"]) ?? idx)} className="p-4 hover:bg-muted/40 transition">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          <span className={actionClass}>{action}</span>{" "}
                          {title ? (
                            action === "deleted" ? (
                              <span>{title}</span>
                            ) : (
                              <Link href={`/event/${eventId}`} className="hover:underline">
                                {title}
                              </Link>
                            )
                          ) : (
                            <span className="text-muted-foreground">Event {eventId || "—"}</span>
                          )}
                        </p>

                        <p className="text-xs text-muted-foreground mt-1">
                          {actor?.full_name ? actor.full_name : "Unknown"} {actor?.email ? `• ${actor.email}` : ""}
                          {when ? ` • ${new Date(when).toLocaleString()}` : ""}
                        </p>

                        <div className="mt-3 text-xs text-muted-foreground">
                          <ul className="list-disc pl-5 space-y-1">
                            {lines.map((l, i) => (
                              <li key={i}>{l}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
