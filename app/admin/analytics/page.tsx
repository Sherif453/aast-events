import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TrendingUp, Users, Calendar, CheckCircle } from "lucide-react";
import ConversionChart from "@/components/admin/ConversionChart";
import TimeHeatmap from "@/components/admin/TimeHeatmap";
import DemographicsChart from "@/components/admin/DemographicsChart";
import type React from "react";

type AnalyticsDemo = { major?: string | null; year?: number | null };

type AnalyticsRow = {
    event_id: number;
    title: string;
    start_time: string; // timestamptz => ISO string
    location: string;
    campus: string;
    organizer_name: string;
    created_by: string | null;
    club_id: string | null;
    club_name: string | null;

    total_rsvps: number | null;
    total_checked_in: number | null;
    conversion_rate: string | number | null;

    event_hour: number | null;
    event_day_of_week: number | null;

    attendee_demographics: AnalyticsDemo[] | null;
};

function logSupabaseError(tag: string, err: unknown) {
    if (!err) return;
    const obj = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : null;
    console.error(tag, {
        message: obj?.message,
        details: obj?.details,
        hint: obj?.hint,
        code: obj?.code,
    });
}

export default async function AnalyticsPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/auth/login");

    // Optional admin check (keeps behavior consistent with your current flow)
    const { data: adminData, error: adminErr } = await supabase
        .from("admin_users")
        .select("role, club_id")
        .eq("id", user.id)
        .maybeSingle();

    if (adminErr) logSupabaseError("[Analytics] admin_users lookup failed:", adminErr);
    if (!adminData) redirect("/");

    const { data: eventAnalyticsRaw, error: analyticsError } =
        await supabase.rpc("get_event_analytics_detailed_admin");

    if (analyticsError) {
        logSupabaseError("[Analytics] RPC failed:", analyticsError);
        return (
            <div className="min-h-screen bg-background">
                <div className="max-w-3xl mx-auto p-6">
                    <h1 className="text-2xl font-bold text-foreground">Event Analytics</h1>
                    <p className="text-muted-foreground mt-2">
                        Analytics is currently unavailable (permission or RPC error).
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                        Error: {analyticsError.message}
                    </p>
                    <Link href="/admin" className="inline-block mt-4">
                        <Button variant="outline">Back to Dashboard</Button>
                    </Link>
                </div>
            </div>
        );
    }

    const rows = (eventAnalyticsRaw ?? []) as AnalyticsRow[];

    // Sort ALL rows newest -> oldest
    const eventAnalytics = rows
        .slice()
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    // Overall stats (ALL events)
    const totalEvents = eventAnalytics.length;

    const totalRSVPs = eventAnalytics.reduce((sum, e) => sum + (e.total_rsvps ?? 0), 0);

    const totalCheckedIn = eventAnalytics.reduce((sum, e) => sum + (e.total_checked_in ?? 0), 0);

    const avgConversion =
        totalEvents > 0
            ? (
                eventAnalytics.reduce((sum, e) => {
                    const rate =
                        typeof e.conversion_rate === "number"
                            ? e.conversion_rate
                            : parseFloat(String(e.conversion_rate ?? "0"));
                    return sum + (Number.isFinite(rate) ? rate : 0);
                }, 0) / totalEvents
            ).toFixed(2)
            : "0.00";

    // Conversion chart data (ALL events)
    const conversionData = eventAnalytics.map((e) => ({
        name: (e.title || "").slice(0, 20),
        rsvps: e.total_rsvps ?? 0,
        checkedIn: e.total_checked_in ?? 0,
        rate:
            typeof e.conversion_rate === "number"
                ? e.conversion_rate
                : parseFloat(String(e.conversion_rate ?? "0")) || 0,
    }));

    // Time heatmap data (ALL events)
    const timeData: Record<string, number> = {};
    eventAnalytics.forEach((e) => {
        const hour = e.event_hour ?? 0;
        const day = e.event_day_of_week ?? 0;
        const key = `${day}-${hour}`;
        timeData[key] = (timeData[key] || 0) + 1;
    });

    // Demographics data (ALL events)
    const majorData: Record<string, number> = {};
    const yearData: Record<string, number> = {};

    eventAnalytics.forEach((e) => {
        const demos = Array.isArray(e.attendee_demographics) ? e.attendee_demographics : [];
        demos.forEach((demo) => {
            const major = demo.major ?? "";
            const year = demo.year;

            if (major) majorData[major] = (majorData[major] || 0) + 1;
            if (typeof year === "number") yearData[String(year)] = (yearData[String(year)] || 0) + 1;
        });
    });

    const majorChartData = Object.entries(majorData).map(([major, count]) => ({ major, count }));
    const yearChartData = Object.entries(yearData).map(([year, count]) => ({ year, count }));

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-7xl mx-auto p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground">Event Analytics</h1>
                            <p className="text-muted-foreground mt-1">Performance insights and trends</p>
                            <p className="text-xs text-muted-foreground mt-2">
                                Showing {totalEvents} events
                            </p>
                        </div>
                        <Link href="/admin">
                            <Button variant="outline">Back to Dashboard</Button>
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-6 space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Total Events" value={totalEvents} icon={<Calendar className="h-6 w-6" />} color="bg-blue-500" />
                    <StatCard title="Total RSVPs" value={totalRSVPs} icon={<Users className="h-6 w-6" />} color="bg-green-500" />
                    <StatCard title="Checked In" value={totalCheckedIn} icon={<CheckCircle className="h-6 w-6" />} color="bg-purple-500" />
                    <StatCard title="Avg Conversion" value={`${avgConversion}%`} icon={<TrendingUp className="h-6 w-6" />} color="bg-orange-500" />
                </div>

                {/* Conversion Chart */}
                {conversionData.length > 0 && (
                    <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">Event Conversion Rates</h2>
                        <ConversionChart data={conversionData} />
                    </div>
                )}

                {/* Time Heatmap */}
                {Object.keys(timeData).length > 0 && (
                    <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4">
                            Event Time Distribution (Heatmap)
                        </h2>
                        <TimeHeatmap data={timeData} />
                    </div>
                )}

                {/* Demographics */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {majorChartData.length > 0 && (
                        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                            <h2 className="text-xl font-bold text-foreground mb-4">Attendance by Major</h2>
                            <DemographicsChart data={majorChartData} dataKey="major" />
                        </div>
                    )}

                    {yearChartData.length > 0 && (
                        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                            <h2 className="text-xl font-bold text-foreground mb-4">Attendance by Year</h2>
                            <DemographicsChart data={yearChartData} dataKey="year" />
                        </div>
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
    value: number | string;
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
