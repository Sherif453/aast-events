import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import EventFeed from '@/components/EventFeed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* HERO — always blue */}
      <div className="bg-[#00386C] text-white py-16">
        <div className="max-w-7xl mx-auto px-4 flex flex-col gap-4">
          <h1 className="text-4xl md:text-5xl font-bold">
            Discover Events at AAST
          </h1>
          <p className="text-blue-100 text-lg max-w-2xl">
            Explore workshops, competitions, and social events happening across campus.
          </p>
        </div>
      </div>

      {/* Page body */}
      <div className="max-w-7xl mx-auto px-4 py-10">
        <Suspense fallback={<EventFeedSkeleton />}>
          <EventFeedServer />
        </Suspense>
      </div>
    </div>
  );
}

async function EventFeedServer() {
  const supabase = await createClient();

  // ✅ Past filter should only show last 30 days — we fetch only events >= (now - 30 days)
  // Upcoming events are still included because they are >= now anyway.
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
    .limit(100);

  if (error) {
    console.error('Error fetching events:', error);
    return <EventFeed events={[]} />;
  }

  // ✅ Counts are already maintained in DB via triggers:
  // attendee_count = RSVP count
  // checked_in_count = checked-in count
  const eventsWithCounts = (events || []).map((event: any) => ({
    ...event,
    attendee_count: event.attendee_count ?? 0,
    checked_in_count: event.checked_in_count ?? 0,
    club_name: event.clubs?.name || null,
    club_id: event.clubs?.id || event.club_id || null,
  }));

  return <EventFeed events={eventsWithCounts as any} />;
}

function EventFeedSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="bg-card rounded-2xl shadow-sm border border-border p-6 animate-pulse"
        >
          <div className="h-48 bg-muted rounded-lg mb-4"></div>
          <div className="h-6 bg-muted rounded mb-2"></div>
          <div className="h-4 bg-muted rounded w-2/3 mb-2"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
        </div>
      ))}
    </div>
  );
}
