import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

type AdminRole = 'super_admin' | 'club_admin' | 'event_volunteer' | 'read_only_analytics';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const type = searchParams.get('type') || 'rsvps';

    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: adminData, error: adminErr } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .maybeSingle();

    if (adminErr || !adminData) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const role = adminData.role as AdminRole;
    const adminClubId = adminData.club_id ?? null;

    // ✅ Only these can export
    if (!['super_admin', 'club_admin', 'event_volunteer'].includes(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ✅ If eventId provided, check access to that event
    let allowedEventClubId: string | null = null;
    if (eventId) {
        const { data: eventRow, error: eventErr } = await supabase
            .from('events')
            .select('id, club_id')
            .eq('id', eventId)
            .maybeSingle();

        if (eventErr || !eventRow) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

        allowedEventClubId = eventRow.club_id ?? null;

        const allowed =
            role === 'super_admin' ||
            (allowedEventClubId && adminClubId && allowedEventClubId === adminClubId);

        if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        // ✅ base attendees query
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

        // ✅ If no eventId and not super_admin: restrict to their club by filtering events in that club
        if (!eventId && role !== 'super_admin') {
            if (!adminClubId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

            const { data: clubEvents, error: clubEventsErr } = await supabase
                .from('events')
                .select('id')
                .eq('club_id', adminClubId);

            if (clubEventsErr) throw clubEventsErr;

            const eventIds = (clubEvents || []).map((e) => e.id);
            if (eventIds.length === 0) {
                // empty csv
                const csv = ['Name,Email,Major,Year,RSVP Date,Checked In,Check-In Time'].join('\n');
                return new NextResponse(csv, {
                    headers: {
                        'Content-Type': 'text/csv',
                        'Content-Disposition': `attachment; filename="attendees-${type}-${Date.now()}.csv"`,
                    },
                });
            }

            query = query.in('event_id', eventIds);
        }

        const { data: attendees, error } = await query;
        if (error) throw error;

        const userIds = Array.from(new Set(attendees?.map((a) => a.user_id) || []));

        // ✅ service-role fetch private profiles
        const admin = createAdminClient();

        const { data: profiles, error: profilesErr } = userIds.length
            ? await admin.from('profiles').select('id, full_name, email, major, year').in('id', userIds)
            : { data: [], error: null };

        if (profilesErr) throw profilesErr;

        const map = new Map<string, any>();
        (profiles || []).forEach((p: any) => map.set(p.id, p));

        const headers = ['Name', 'Email', 'Major', 'Year', 'RSVP Date', 'Checked In', 'Check-In Time'];

        const rows =
            attendees?.map((a) => {
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

        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="attendees-${type}-${Date.now()}.csv"`,
            },
        });
    } catch (err: any) {
        console.error('CSV Export Error:', err);
        return NextResponse.json({ error: err?.message || 'Export failed' }, { status: 500 });
    }
}