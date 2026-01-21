import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus, Calendar, Edit, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DeleteEventButton from '@/components/admin/DeleteEventButton';

export default async function ManageEventsPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect('/auth/login');
    }

    const { data: adminData } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .single();

    if (!adminData || !['super_admin', 'club_admin', 'event_volunteer'].includes(adminData.role)) {
        redirect('/');
    }

    // Fetch all events with analytics (RPC; safe for super_admin/club_admin/volunteer)
    const { data: eventsRaw, error: eventsError } = await supabase
        .rpc('get_event_analytics_summary_admin');

    if (eventsError) {
        console.error('[ManageEvents] analytics RPC failed:', eventsError);
    }

    const events = (eventsRaw ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    // With RPC, club_id is always included
    const clubIdByEventId = new Map<number, string | null>();
    for (const e of events || []) {
        clubIdByEventId.set(Number((e as any).event_id), (e as any).club_id ?? null);
    }

    const isSuperAdmin = adminData.role === 'super_admin';
    const isClubAdmin = adminData.role === 'club_admin';
    const myClubId = adminData.club_id || null;

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-7xl mx-auto p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground">Manage Events</h1>
                            <p className="text-muted-foreground mt-1">View, edit, and delete events</p>
                        </div>
                        <div className="flex gap-3">
                            <Link href="/admin">
                                <Button variant="outline">Back to Dashboard</Button>
                            </Link>
                            <Link href="/admin/events/create">
                                <Button className="bg-blue-600 hover:bg-blue-700">
                                    <Plus className="h-4 w-4 mr-2" />
                                    Create Event
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-6">
                {!events || events.length === 0 ? (
                    <div className="bg-card rounded-xl shadow-sm border border-border p-12 text-center">
                        <Calendar className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">No events yet</h3>
                        <p className="text-muted-foreground mb-6">Create your first event to get started</p>
                        <Link href="/admin/events/create">
                            <Button className="bg-blue-600 hover:bg-blue-700">
                                <Plus className="h-4 w-4 mr-2" />
                                Create Event
                            </Button>
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {events.map((event: any) => {
                            const eventId = Number(event.event_id);
                            const eventClubId = clubIdByEventId.get(eventId) ?? null;

                            const canDeleteThisEvent =
                                isSuperAdmin || (isClubAdmin && !!myClubId && !!eventClubId && eventClubId === myClubId);

                            return (
                                <div
                                    key={event.event_id}
                                    className="bg-card rounded-xl shadow-sm border border-border p-6 hover:shadow-md transition"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="text-xl font-bold text-foreground">{event.title}</h3>
                                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                                                <span>📅 {new Date(event.start_time).toLocaleDateString()}</span>
                                                <span>📍 {event.location}</span>
                                                <span>🏫 {event.campus}</span>
                                                {event.club_name && (
                                                    <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">
                                                        {event.club_name}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-6 mt-4">
                                                <div>
                                                    <span className="text-2xl font-bold text-blue-600">
                                                        {event.total_rsvps || 0}
                                                    </span>
                                                    <span className="text-sm text-muted-foreground ml-1">RSVPs</span>
                                                </div>
                                                <div>
                                                    <span className="text-2xl font-bold text-green-600">
                                                        {event.total_checked_in || 0}
                                                    </span>
                                                    <span className="text-sm text-muted-foreground ml-1">Checked In</span>
                                                </div>
                                                <div>
                                                    <span className="text-2xl font-bold text-purple-600">
                                                        {event.conversion_rate || 0}%
                                                    </span>
                                                    <span className="text-sm text-muted-foreground ml-1">Conversion</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex gap-2">
                                            <Link href={`/event/${event.event_id}`}>
                                                <Button variant="outline" size="sm">
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                            </Link>
                                            <Link href={`/admin/events/edit/${event.event_id}`}>
                                                <Button variant="outline" size="sm">
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </Link>

                                            <DeleteEventButton
                                                eventId={event.event_id.toString()}
                                                eventTitle={event.title}
                                                enabled={canDeleteThisEvent}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
