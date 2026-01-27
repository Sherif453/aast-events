import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyCors, applySecurityHeaders, preflight } from "@/lib/api/http";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseQuery, z, zIdString } from "@/lib/api/validation";

type AdminRole = 'super_admin' | 'club_admin' | 'event_volunteer' | 'read_only_analytics';

type AttendeeRow = {
    user_id: string;
    checked_in: boolean;
    checked_in_at: string | null;
    created_at: string;
    event_id: string;
};

type ProfileRow = {
    id: string;
    full_name: string | null;
    email: string | null;
    major: string | null;
    year: number | null;
};

export async function GET(request: Request) {
    const cors = { methods: ["GET", "OPTIONS"], headers: ["Content-Type", "Authorization"] };
    const withHeaders = (res: Response) => {
        res.headers.set("Cache-Control", "no-store, must-revalidate");
        res.headers.set("Pragma", "no-cache");
        applyCors(request, res.headers, cors);
        applySecurityHeaders(res.headers);
        return res;
    };

    const querySchema = z
        .object({
            eventId: zIdString.optional(),
            type: z.enum(["rsvps", "checked-in"]).optional(),
        })
        .strict();

    let eventId: string | null = null;
    let type: "rsvps" | "checked-in" = "rsvps";
    try {
        const q = parseQuery(request, querySchema);
        eventId = q.eventId ?? null;
        type = q.type ?? "rsvps";
    } catch {
        return withHeaders(NextResponse.json({ error: "Invalid query" }, { status: 400 }));
    }

    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    const rl = await checkRateLimit(request, {
        keyPrefix: "api:admin:export-csv",
        ip: { max: 60, windowMs: 60_000 },
        user: { max: 120, windowMs: 60_000 },
        userId: user?.id ?? null,
    });
    if (!rl.ok) return withHeaders(rateLimitResponse(rl.retryAfterSeconds));

    if (!user) return withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const { data: adminData, error: adminErr } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .maybeSingle();

    if (adminErr || !adminData) return withHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const role = adminData.role as AdminRole;
    const adminClubId = adminData.club_id ?? null;

    //  Only these can export
    if (!['super_admin', 'club_admin', 'event_volunteer'].includes(role)) {
        return withHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }

    //  If eventId provided, check access to that event
    let allowedEventClubId: string | null = null;
    if (eventId) {
        const { data: eventRow, error: eventErr } = await supabase
            .from('events')
            .select('id, club_id')
            .eq('id', eventId)
            .maybeSingle();

        if (eventErr || !eventRow) return withHeaders(NextResponse.json({ error: 'Event not found' }, { status: 404 }));

        allowedEventClubId = eventRow.club_id ?? null;

        const allowed =
            role === 'super_admin' ||
            (allowedEventClubId && adminClubId && allowedEventClubId === adminClubId);

        if (!allowed) return withHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }

    try {
        //  base attendees query
        let query = supabase
            .from('attendees')
            .select('user_id, checked_in, checked_in_at, created_at, event_id')
            .order('created_at', { ascending: false });

        if (eventId) {
            query = query.eq('event_id', eventId);
        }

        if (type === 'checked-in') {
            query = query.eq('checked_in', true);
        }

        //  If no eventId and not super_admin: restrict to their club by filtering events in that club
        if (!eventId && role !== 'super_admin') {
            if (!adminClubId) return withHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

            const { data: clubEvents, error: clubEventsErr } = await supabase
                .from('events')
                .select('id')
                .eq('club_id', adminClubId);

            if (clubEventsErr) throw clubEventsErr;

            const eventIds = (clubEvents || []).map((e) => e.id);
            if (eventIds.length === 0) {
                // empty csv
                const csv = ['Name,Email,Major,Year,RSVP Date,Checked In,Check-In Time'].join('\n');
                return withHeaders(new NextResponse(csv, {
                    headers: {
                        'Content-Type': 'text/csv',
                        'Content-Disposition': `attachment; filename="attendees-${type}-${Date.now()}.csv"`,
                    },
                }));
            }

            query = query.in('event_id', eventIds);
        }

        const { data: attendees, error } = await query;
        if (error) throw error;

        const attendeeRows = ((attendees ?? []) as unknown as AttendeeRow[]);
        const userIds = Array.from(new Set(attendeeRows.map((a) => a.user_id)));

        // Prefer the caller's cookie-based client (keeps RLS in effect).
        // If RLS blocks it, fall back to service role *after* we’ve verified admin scope.
        let profiles: unknown[] = [];
        if (userIds.length) {
            const { data: profilesData, error: profilesErr } = await supabase
                .from('profiles')
                .select('id, full_name, email, major, year')
                .in('id', userIds);

            if (!profilesErr) {
                profiles = (profilesData as unknown[]) ?? [];
            } else {
                console.error('profiles export lookup failed (rls?):', profilesErr);

                const canUseServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
                if (canUseServiceRole) {
                    const admin = createAdminClient();
                    const { data: adminProfiles, error: adminProfilesErr } = await admin
                        .from('profiles')
                        .select('id, full_name, email, major, year')
                        .in('id', userIds);
                    if (adminProfilesErr) {
                        console.error('profiles export lookup (service role) failed:', adminProfilesErr);
                    } else {
                        profiles = (adminProfiles as unknown[]) ?? [];
                    }
                }
            }
        }

        const profileRows = ((profiles ?? []) as unknown as ProfileRow[]);
        const map = new Map<string, ProfileRow>();
        profileRows.forEach((p) => map.set(p.id, p));

        const headers = ['Name', 'Email', 'Major', 'Year', 'RSVP Date', 'Checked In', 'Check-In Time'];

        const rows =
            attendeeRows.map((a) => {
                const profile = map.get(a.user_id);
                return [
                    profile?.full_name || 'N/A',
                    profile?.email || 'N/A',
                    profile?.major || 'N/A',
                    profile?.year ?? 'N/A',
                    new Date(a.created_at).toLocaleString(),
                    a.checked_in ? 'Yes' : 'No',
                    a.checked_in_at ? new Date(a.checked_in_at).toLocaleString() : 'N/A',
                ]
                    .map((field) => `"${String(field).replace(/"/g, '""')}"`)
                    .join(',');
            }) || [];

        const csv = [headers.join(','), ...rows].join('\n');

        return withHeaders(new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="attendees-${type}-${Date.now()}.csv"`,
            },
        }));
    } catch (err: unknown) {
        console.error('CSV Export Error:', err);
        const message = err instanceof Error ? err.message : 'Export failed';
        return withHeaders(NextResponse.json({ error: message || 'Export failed' }, { status: 500 }));
    }
}

export function OPTIONS(request: Request) {
    return preflight(request, { methods: ["GET", "OPTIONS"], headers: ["Content-Type", "Authorization"] });
}
