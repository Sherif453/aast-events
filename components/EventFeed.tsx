'use client';

import React, { useMemo, useState } from 'react';
import { EventCard, EventProps } from '@/components/EventCard';
import { Button } from '@/components/ui/button';
import { Calendar, History, MapPin, Grid3x3, List, Users, TrendingUp } from 'lucide-react';

interface EventFeedProps {
    events: (EventProps & { checked_in_count?: number; rsvps_last_24h?: number })[];
    clubs?: { id: string; name: string }[];
}

export default function EventFeed({ events, clubs }: EventFeedProps) {
    const [filter, setFilter] = useState<'upcoming' | 'past' | 'trending'>('upcoming');
    const [campusFilter, setCampusFilter] = useState<string>('all');
    const [clubFilter, setClubFilter] = useState<string>('all');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Filter by time (Past = only last 30 days)
    const timeFiltered = events.filter((event) => {
        const eventDate = new Date(event.start_time);
        if (filter === 'upcoming') return eventDate >= now;
        if (filter === 'past') return eventDate < now && eventDate >= thirtyDaysAgo;
        // trending is for upcoming events only
        return eventDate >= now;
    });

    // Filter by campus
    const campusFiltered =
        campusFilter === 'all'
            ? timeFiltered
            : timeFiltered.filter((e) => e.campus === campusFilter);

    // Filter by club
    const filtered =
        clubFilter === 'all'
            ? campusFiltered
            : clubFilter === 'no_club'
                ? campusFiltered.filter((e) => !e.club_id)
                : campusFiltered.filter((e) => e.club_id === clubFilter);

    const displayEvents = useMemo(() => {
        if (filter !== 'trending') return filtered;

        type FeedEvent = EventFeedProps["events"][number];
        const score = (e: FeedEvent) => {
            const recent = Number(e.rsvps_last_24h ?? 0);
            const total = Number(e.attendee_count ?? 0);
            // Growth rate (smoothed): favors fast-growing events, not just raw size.
            return recent / Math.max(1, total);
        };

        return filtered
            .slice()
            .sort((a: FeedEvent, b: FeedEvent) => {
                const s = score(b) - score(a);
                if (s !== 0) return s;
                const r = Number(b.rsvps_last_24h ?? 0) - Number(a.rsvps_last_24h ?? 0);
                if (r !== 0) return r;
                return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
            });
    }, [filtered, filter]);

    // Get unique campuses
    const campuses = ['all', ...Array.from(new Set(events.map((e) => e.campus)))];

    // Get club options (include all clubs, even those with 0 events in current window).
    // Still include "No Club" only if we actually have events with no club.
    const clubOptions = useMemo(() => {
        const options: { value: string; label: string }[] = [{ value: 'all', label: 'All Clubs' }];

        const hasNoClub = events.some((e) => !e.club_id);
        if (hasNoClub) options.push({ value: 'no_club', label: 'No Club' });

        if (clubs && clubs.length > 0) {
            clubs
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((c) => options.push({ value: c.id, label: c.name }));
            return options;
        }

        // Fallback: derive only from events (older behavior).
        const map = new Map<string, string>();
        for (const e of events) {
            if (e.club_id && e.club_name) map.set(e.club_id, e.club_name);
        }
        Array.from(map.entries())
            .sort((a, b) => a[1].localeCompare(b[1]))
            .forEach(([id, name]) => options.push({ value: id, label: name }));

        return options;
    }, [events, clubs]);

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
                    {/* Time Filter */}
                    <div className="flex gap-2">
                        <Button
                            onClick={() => setFilter('upcoming')}
                            variant={filter === 'upcoming' ? 'default' : 'outline'}
                            size="sm"
                            className={filter === 'upcoming' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                        >
                            <Calendar className="h-4 w-4 mr-2" />
                            Upcoming
                        </Button>
                        <Button
                            onClick={() => setFilter('past')}
                            variant={filter === 'past' ? 'default' : 'outline'}
                            size="sm"
                            className={filter === 'past' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                        >
                            <History className="h-4 w-4 mr-2" />
                            Past
                        </Button>
                        <Button
                            onClick={() => setFilter('trending')}
                            variant={filter === 'trending' ? 'default' : 'outline'}
                            size="sm"
                            className={filter === 'trending' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                            title="Based on RSVP growth rate in the last 24 hours"
                        >
                            <TrendingUp className="h-4 w-4 mr-2" />
                            Trending
                        </Button>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Campus Filter */}
                        <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <select
                                value={campusFilter}
                                onChange={(e) => setCampusFilter(e.target.value)}
                                className="h-10 px-3 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                                {campuses.map((campus) => (
                                    <option key={campus} value={campus}>
                                        {campus === 'all' ? 'All Campuses' : campus}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Club Filter */}
                        <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <select
                                value={clubFilter}
                                onChange={(e) => setClubFilter(e.target.value)}
                                className="h-10 px-3 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                                {clubOptions.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* View Mode Toggle */}
                        <div className="flex gap-1 border border-border rounded-md p-1 bg-card">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded transition ${viewMode === 'grid'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                    : 'text-muted-foreground hover:bg-accent'
                                    }`}
                                title="Grid View"
                            >
                                <Grid3x3 className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded transition ${viewMode === 'list'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                    : 'text-muted-foreground hover:bg-accent'
                                    }`}
                                title="List View"
                            >
                                <List className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Results Count */}
            <p className="text-sm text-muted-foreground">
                Showing {displayEvents.length} {filter} event{displayEvents.length !== 1 ? 's' : ''}
                {campusFilter !== 'all' && ` at ${campusFilter}`}
            </p>

            {/* Events Display */}
            {displayEvents.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-xl border border-border">
                    <Calendar className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-foreground text-lg font-semibold">No events found</p>
                    <p className="text-muted-foreground text-sm mt-2">
                        {filter === 'past'
                            ? 'No past events to display'
                            : filter === 'trending'
                                ? 'No trending events right now'
                                : 'Check back later for new events'}
                    </p>
                </div>
            ) : (
                <div
                    className={
                        viewMode === 'grid'
                            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
                            : 'flex flex-col gap-4 max-w-md mx-auto'
                    }
                >
                    {displayEvents.map((event) => (
                        <div key={event.id} className={viewMode === 'list' ? 'w-full' : ''}>
                            <EventCard event={event} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
