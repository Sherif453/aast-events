import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import ExportButtons from '@/components/admin/ExportButtons';
import { FileDown, ChevronLeft } from 'lucide-react';

type AdminRole = 'super_admin' | 'club_admin' | 'event_volunteer' | 'read_only_analytics';

export default async function ExportPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect('/auth/login');

    const { data: adminData, error: adminErr } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .maybeSingle();

    if (adminErr || !adminData) redirect('/');

    const role = adminData.role as AdminRole;
    const clubId = adminData.club_id ?? null;

    if (!['super_admin', 'club_admin', 'event_volunteer'].includes(role)) {
        redirect('/admin');
    }

    // Fetch events for export options (scoped)
    let eventsQuery = supabase
        .from('events')
        .select('id, title, start_time, club_id')
        .order('start_time', { ascending: false });

    if (role !== 'super_admin') {
        if (!clubId) redirect('/admin');
        eventsQuery = eventsQuery.eq('club_id', clubId);
    }

    const { data: events, error: eventsErr } = await eventsQuery;

    if (eventsErr) {
        console.error('Export events fetch error:', eventsErr);
    }

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-6">
                    <div className="flex items-center gap-4 mb-4">
                        <Link href="/admin">
                            <Button variant="outline" size="sm">
                                <ChevronLeft className="h-4 w-4 mr-2" />
                                Back
                            </Button>
                        </Link>
                    </div>
                    <h1 className="text-3xl font-bold text-foreground">Export Data</h1>
                    <p className="text-muted-foreground mt-1">Download CSV reports</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6 space-y-6">
                {/* Export All Data */}
                <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <h2 className="text-xl font-bold text-foreground mb-2">Export Attendees</h2>
                            <p className="text-sm text-muted-foreground">
                                {role === 'super_admin'
                                    ? 'Download complete list of all attendees across all events'
                                    : 'Download attendees for events in your club only'}
                            </p>
                        </div>
                        <FileDown className="h-8 w-8 text-blue-600" />
                    </div>
                    <ExportButtons eventId={null} />
                </div>

                {/* Export by Event */}
                <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                    <h2 className="text-xl font-bold text-foreground mb-4">Export by Event</h2>
                    <div className="space-y-4">
                        {events && events.length > 0 ? (
                            events.map((event) => (
                                <div key={event.id} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                                    <div>
                                        <h3 className="font-semibold text-foreground">{event.title}</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {event.start_time ? new Date(event.start_time).toLocaleDateString() : ''}
                                        </p>
                                    </div>
                                    <ExportButtons eventId={event.id.toString()} />
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-gray-500 py-8">No events found</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}