import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft, CheckCircle, Calendar, MapPin, Clock } from 'lucide-react';

export default async function AttendanceHistoryPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect('/auth/login');
    }

    // Fetch user's attended events (checked in only)
    const { data: rawAttendees } = await supabase
        .from('attendees')
        .select('event_id, checked_in, checked_in_at, created_at')
        .eq('user_id', user.id)
        .eq('checked_in', true)
        .order('checked_in_at', { ascending: false });

    // Fetch event details
    let attendedEvents: any[] = [];
    if (rawAttendees && rawAttendees.length > 0) {
        const eventIds = rawAttendees.map((a) => a.event_id);
        const { data: eventsData } = await supabase
            .from('events')
            .select('*')
            .in('id', eventIds);

        attendedEvents = rawAttendees.map((a) => {
            const event = eventsData?.find((e) => e.id === a.event_id);
            return {
                ...event,
                checked_in_at: a.checked_in_at,
            };
        });
    }

    return (
        <div className="min-h-screenbg-background">
            <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto flex items-center gap-4">
                    <Link href="/profile">
                        <Button variant="outline" size="sm">
                            <ChevronLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Attendance History</h1>
                        <p className="text-sm text-muted-foreground">{attendedEvents.length} events attended</p>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                {attendedEvents.length === 0 ? (
                    <div className="bg-card rounded-xl shadow-sm border border-border p-12 text-center">
                        <Calendar className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">No attended events yet</h3>
                        <p className="text-muted-foreground mb-6">RSVP to events and get checked in to build your history</p>
                        <Link href="/">
                            <Button className="bg-[#00386C] hover:bg-[#00509d]">Browse Events</Button>
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {attendedEvents.map((event) => (
                            <div
                                key={event.id}
                                className="bg-card rounded-xl shadow-sm border border-border p-6 hover:shadow-md transition"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <CheckCircle className="h-5 w-5 text-green-600" />
                                            <span className="text-xs font-semibold text-green-600">ATTENDED</span>
                                        </div>
                                        <h3 className="text-xl font-bold text-foreground mb-2">{event.title}</h3>
                                        <div className="space-y-1 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4" />
                                                {new Date(event.start_time).toLocaleDateString('en-US', {
                                                    weekday: 'long',
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric',
                                                })}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <MapPin className="h-4 w-4" />
                                                {event.location} ({event.campus})
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Clock className="h-4 w-4" />
                                                Checked in at {new Date(event.checked_in_at).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </div>
                                    <Link href={`/event/${event.id}`}>
                                        <Button variant="outline" size="sm">View Event</Button>
                                    </Link>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}