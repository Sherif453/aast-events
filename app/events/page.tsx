import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import EventFeed from '@/components/EventFeed';
import type { EventProps } from '@/components/EventCard';

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

  const nowMs = new Date().getTime();
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);

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

  type ClubJoin = { id: string | number | null; name: string | null };
  type EventRow = EventProps & {
    id: string | number;
    attendee_count?: number | null;
    checked_in_count?: number | null;
    club_id?: string | number | null;
    clubs?: ClubJoin | null;
  };

  const eventRows = (events as unknown as EventRow[] | null) ?? [];
  const eventIds = eventRows.map((e) => String(e.id)).filter(Boolean);
  const since24h = new Date(nowMs - 24 * 60 * 60 * 1000);

  const { data: recentRsvps } = eventIds.length
    ? await supabase
        .from('attendees')
        .select('event_id')
        .in('event_id', eventIds)
        .gte('created_at', since24h.toISOString())
    : { data: [] as Array<{ event_id: string | number | null }> };

  const rsvpsLast24hByEventId = new Map<string, number>();
  const recentRows = (recentRsvps as unknown as Array<{ event_id: string | number | null }> | null) ?? [];
  for (const row of recentRows) {
    const id = String(row.event_id ?? '');
    if (!id) continue;
    rsvpsLast24hByEventId.set(id, (rsvpsLast24hByEventId.get(id) ?? 0) + 1);
  }

  const eventsWithCounts = eventRows.map((event) => {
    const id = String(event.id);
    return {
      ...event,
      id,
      attendee_count: Number(event.attendee_count ?? 0),
      checked_in_count: Number(event.checked_in_count ?? 0),
      rsvps_last_24h: rsvpsLast24hByEventId.get(id) ?? 0,
      club_name: event.clubs?.name ?? null,
      club_id: event.clubs?.id != null ? String(event.clubs.id) : event.club_id != null ? String(event.club_id) : null,
    };
  });

  return <EventFeed events={eventsWithCounts} />;
}
