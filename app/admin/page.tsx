import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BarChart3, Users, Calendar, Plus, FileDown, Shield, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";

type Role = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";

type DashboardCountsRow = {
    total_events: number | string | null;
    total_rsvps: number | string | null;
    total_checked_in: number | string | null;
};

function normalizeRole(value: unknown): Role | null {
    const r = String(value ?? "").trim();
    if (r === "super_admin" || r === "club_admin" || r === "event_volunteer" || r === "read_only_analytics") {
        return r;
    }
    return null;
}

function logSupabaseError(tag: string, err: any) {
    if (!err) return;
    console.error(tag, {
        message: err.message,
        details: err.details,
        hint: err.hint,
        code: err.code,
    });
}

export default async function AdminDashboardPage() {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/");

    const { data: adminRow, error: adminErr } = await supabase
        .from("admin_users")
        .select("role, club_id")
        .eq("id", user.id)
        .maybeSingle();

    if (adminErr) logSupabaseError("[AdminDashboard] admin_users lookup failed:", adminErr);
    if (!adminRow) redirect("/admin");

    const role = normalizeRole(adminRow.role);
    if (!role) {
        console.error("[AdminDashboard] Unexpected role value:", adminRow.role);
        redirect("/");
    }

    //  Show global Clubs/Users for super_admin + analytics viewer
    const canSeeGlobalCounts = role === "super_admin" || role === "read_only_analytics";

    const roleLabels: Record<Role, { name: string; color: string; bg: string }> = {
        super_admin: { name: "Super Admin", color: "text-purple-600", bg: "bg-purple-50" },
        club_admin: { name: "Club Admin", color: "text-blue-600", bg: "bg-blue-50" },
        event_volunteer: { name: "Event Volunteer", color: "text-green-600", bg: "bg-green-50" },
        read_only_analytics: { name: "Analytics Viewer", color: "text-muted-foreground", bg: "bg-muted" },
    };

    const roleInfo = roleLabels[role];

    const canManageEvents = role === "super_admin" || role === "club_admin" || role === "event_volunteer";
    const canManageClubs = role === "super_admin" || role === "club_admin";
    const canManageAdminUsers = role === "super_admin" || role === "club_admin";
    const canViewAnalytics = role === "super_admin" || role === "club_admin" || role === "read_only_analytics";
    const canViewAuditLog = role === "super_admin" || role === "club_admin";

    // ---------- STATS ----------
    // Always use RPC for scoped counts (super_admin/read_only_analytics => global; club_admin/volunteer => club scoped)
    let totalEvents = 0;
    let totalRSVPs = 0;
    let totalCheckedIn = 0;

    const { data: countsRow, error: countsErr } = await supabase
        .rpc("get_admin_dashboard_counts")
        .maybeSingle();

    if (countsErr) {
        logSupabaseError("[AdminDashboard] get_admin_dashboard_counts failed:", countsErr);
    } else if (countsRow) {
        const c = countsRow as DashboardCountsRow;
        totalEvents = Number(c.total_events ?? 0);
        totalRSVPs = Number(c.total_rsvps ?? 0);
        totalCheckedIn = Number(c.total_checked_in ?? 0);
    }

    // Clubs/users for super_admin + read_only_analytics (if you want them)
    let totalClubs = 0;
    let totalUsers = 0;

    if (canSeeGlobalCounts) {
        const [{ count: clubCount, error: clubErr }, { count: userCount, error: userErr }] = await Promise.all([
            supabase.from("clubs").select("id", { count: "exact", head: true }),
            supabase.from("profiles_public").select("id", { count: "exact", head: true }),
        ]);

        if (clubErr) logSupabaseError("[AdminDashboard] clubs count failed:", clubErr);
        if (userErr) logSupabaseError("[AdminDashboard] profiles_public count failed:", userErr);

        totalClubs = clubCount ?? 0;
        totalUsers = userCount ?? 0;
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-7xl mx-auto p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
                            <div className="flex items-center gap-2 mt-2">
                                <Shield className="h-4 w-4 text-muted-foreground" />
                                <span className={`text-sm font-semibold ${roleInfo.color}`}>{roleInfo.name}</span>
                            </div>
                        </div>

                        <Link href="/">
                            <Button variant="outline">Back to Events</Button>
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-6">
                {/* 3 cards for scoped roles, 5 cards for global roles */}
                <div className={`grid grid-cols-1 md:grid-cols-2 ${canSeeGlobalCounts ? "lg:grid-cols-5" : "lg:grid-cols-3"} gap-6 mb-8`}>
                    <StatCard title="Total Events" value={totalEvents} icon={<Calendar className="h-8 w-8" />} color="bg-blue-500" />

                    {canSeeGlobalCounts && (
                        <StatCard title="Total Clubs" value={totalClubs} icon={<Users className="h-8 w-8" />} color="bg-purple-500" />
                    )}

                    {canSeeGlobalCounts && (
                        <StatCard title="Total Users" value={totalUsers} icon={<Users className="h-8 w-8" />} color="bg-green-500" />
                    )}

                    <StatCard title="Total RSVPs" value={totalRSVPs} icon={<BarChart3 className="h-8 w-8" />} color="bg-orange-500" />
                    <StatCard title="Checked In" value={totalCheckedIn} icon={<BarChart3 className="h-8 w-8" />} color="bg-red-500" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {canManageEvents && (
                        <ActionCard title="Create Event" description="Add a new event" icon={<Plus className="h-6 w-6" />} href="/admin/events/create" color="bg-blue-600" />
                    )}

                    {canManageEvents && (
                        <ActionCard title="Manage Events" description="Edit or delete events" icon={<Calendar className="h-6 w-6" />} href="/admin/events" color="bg-green-600" />
                    )}

                    {role === "super_admin" && (
                        <ActionCard title="Create Club" description="Add a new student club" icon={<Plus className="h-6 w-6" />} href="/admin/clubs/create" color="bg-purple-600" />
                    )}

                    {canManageClubs && (
                        <ActionCard
                            title={role === "club_admin" ? "Manage Your Club" : "Manage Clubs"}
                            description={role === "club_admin" ? "Edit your club details" : "View and edit clubs"}
                            icon={<Users className="h-6 w-6" />}
                            href="/admin/clubs"
                            color="bg-indigo-600"
                        />
                    )}

                    {canViewAnalytics && (
                        <ActionCard title="Analytics" description="View event analytics" icon={<BarChart3 className="h-6 w-6" />} href="/admin/analytics" color="bg-cyan-600" />
                    )}

                    {canViewAuditLog && (
                        <ActionCard
                            title="Audit Log"
                            description="See who edited or deleted events"
                            icon={<ScrollText className="h-6 w-6" />}
                            href="/admin/audit"
                            color="bg-slate-700"
                        />
                    )}

                    {canManageEvents && (
                        <ActionCard title="Export Data" description="Download CSV reports" icon={<FileDown className="h-6 w-6" />} href="/admin/export" color="bg-orange-600" />
                    )}

                    {canManageAdminUsers && (
                        <ActionCard
                            title={role === "super_admin" ? "Manage Admins" : "Manage Volunteers"}
                            description={role === "super_admin" ? "Admin user management" : "Add/remove volunteers in your club"}
                            icon={<Shield className="h-6 w-6" />}
                            href="/admin/users"
                            color="bg-red-600"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({
    title,
    value,
    icon,
    color,
}: {
    title: string;
    value: number;
    icon: React.ReactNode;
    color: string;
}) {
    return (
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-muted-foreground font-medium">{title}</p>
                    <p className="text-3xl font-bold text-foreground mt-2">{value}</p>
                </div>
                <div className={`${color} p-3 rounded-lg text-white`}>{icon}</div>
            </div>
        </div>
    );
}

function ActionCard({
    title,
    description,
    icon,
    href,
    color,
}: {
    title: string;
    description: string;
    icon: React.ReactNode;
    href: string;
    color: string;
}) {
    return (
        <Link href={href}>
            <div className="bg-card rounded-xl shadow-sm border border-border p-6 hover:shadow-lg transition cursor-pointer h-full">
                <div className={`${color} p-3 rounded-lg text-white inline-block mb-4`}>{icon}</div>
                <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
        </Link>
    );
}
