import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import EventFeed from '@/components/EventFeed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function EventsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-foreground">All Events</h1>
          <p className="text-muted-foreground mt-2">Browse events and discover what’s trending.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-10">
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          <EventFeedServer />
        </Suspense>
      </div>
    </div>
  );
}

async function EventFeedServer() {
  const supabase = await createClient();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const { data: events, error } = await supabase
    .from('events')
    .select(
      `
        *,
        clubs (
          id,
          name
        )
      `
    )
    .gte('start_time', thirtyDaysAgo.toISOString())
    .order('start_time', { ascending: true })
    .limit(200);

  if (error) {
    console.error('Error fetching events:', error);
    return <EventFeed events={[]} />;
  }

  const eventIds = (events || []).map((e: any) => String(e.id)).filter(Boolean);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { data: recentRsvps } = eventIds.length
    ? await supabase
        .from('attendees')
        .select('event_id')
        .in('event_id', eventIds)
        .gte('created_at', since24h.toISOString())
    : { data: [] as any[] };

  const rsvpsLast24hByEventId = new Map<string, number>();
  for (const row of (recentRsvps as any[]) ?? []) {
    const id = String((row as any).event_id ?? '');
    if (!id) continue;
    rsvpsLast24hByEventId.set(id, (rsvpsLast24hByEventId.get(id) ?? 0) + 1);
  }

  const eventsWithCounts = (events || []).map((event: any) => ({
    ...event,
    attendee_count: event.attendee_count ?? 0,
    checked_in_count: event.checked_in_count ?? 0,
    rsvps_last_24h: rsvpsLast24hByEventId.get(String(event.id)) ?? 0,
    club_name: event.clubs?.name || null,
    club_id: event.clubs?.id || event.club_id || null,
  }));

  return <EventFeed events={eventsWithCounts as any} />;
}
