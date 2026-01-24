import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Shield, ChevronLeft } from "lucide-react";

type Role = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";

function normalizeRole(value: unknown): Role | null {
  const r = String(value ?? "").trim();
  if (r === "super_admin" || r === "club_admin" || r === "event_volunteer" || r === "read_only_analytics") return r;
  return null;
}

function pickField(obj: any, keys: string[]) {
  for (const k of keys) if (obj && obj[k] != null) return obj[k];
  return null;
}

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: adminRow } = await supabase.from("admin_users").select("role, club_id").eq("id", user.id).maybeSingle();
  const role = normalizeRole(adminRow?.role);

  if (!role) redirect("/");
  if (role !== "super_admin" && role !== "club_admin") redirect("/admin");

  const myClubId = (adminRow as any)?.club_id ?? null;

  const { data: rawLogs, error: logErr } = await supabase.from("event_audit_log").select("*").limit(250);

  if (logErr) {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto p-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
              <p className="text-muted-foreground mt-1">Recent event changes</p>
            </div>
            <Link href="/admin">
              <Button variant="outline">
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
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

  const logs = ((rawLogs as any[]) ?? []).slice();

  const tsKey = (row: any) =>
    pickField(row, ["created_at", "performed_at", "timestamp", "inserted_at", "updated_at"]) as string | null;
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
    eventIds.length ? supabase.from("events").select("id, title, club_id").in("id", eventIds) : Promise.resolve({ data: [] as any[] }),
    actorIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const eventMap = new Map<string, any>();
  (eventsData ?? []).forEach((e: any) => eventMap.set(String(e.id), e));

  const profileMap = new Map<string, any>();
  (profilesData ?? []).forEach((p: any) => profileMap.set(String(p.id), p));

  const scopedLogs =
    role === "club_admin" && myClubId
      ? logs.filter((row) => {
          const eventId = String(pickField(row, ["event_id", "eventId", "event"]) ?? "");
          const ev = eventMap.get(eventId);
          return ev?.club_id === myClubId;
        })
      : logs;

  const actionLabel = (row: any) => {
    const v = pickField(row, ["action", "event", "type", "operation"]) as string | null;
    return v ? String(v) : "change";
  };

  const metaJson = (row: any) => {
    const v = pickField(row, ["meta", "metadata", "changes", "diff", "details"]) as any;
    if (v == null) return null;
    try {
      return typeof v === "string" ? v : JSON.stringify(v);
    } catch {
      return String(v);
    }
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
          <Link href="/admin">
            <Button variant="outline">
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {scopedLogs.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">No audit entries yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {scopedLogs.slice(0, 200).map((row: any, idx: number) => {
                const eventId = String(pickField(row, ["event_id", "eventId", "event"]) ?? "");
                const ev = eventMap.get(eventId);

                const actorId = String(
                  pickField(row, ["changed_by", "actor_id", "performed_by", "user_id", "admin_id"]) ?? ""
                );
                const actor = profileMap.get(actorId);

                const when = tsKey(row);
                const meta = metaJson(row);

                return (
                  <div key={String(pickField(row, ["id"]) ?? idx)} className="p-4 hover:bg-muted/40 transition">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          <span className="text-blue-600 dark:text-blue-400">{actionLabel(row)}</span>{" "}
                          {ev?.title ? (
                            <Link href={`/event/${eventId}`} className="hover:underline">
                              {ev.title}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">Event {eventId || "—"}</span>
                          )}
                        </p>

                        <p className="text-xs text-muted-foreground mt-1">
                          {actor?.full_name ? actor.full_name : "Unknown"} {actor?.email ? `• ${actor.email}` : ""}
                          {when ? ` • ${new Date(when).toLocaleString()}` : ""}
                        </p>

                        {meta && (
                          <pre className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded-lg p-3 border border-border overflow-x-auto">
                            {meta}
                          </pre>
                        )}
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

