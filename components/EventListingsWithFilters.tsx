'use client';

import { useState } from 'react';
import { EventCard, EventProps } from './EventCard';
import { Button } from './ui/button';
import { Calendar, History, MapPin } from 'lucide-react';

interface EventListingsProps {
    events: (EventProps & { attendee_count: number })[];
}

export default function EventListingsWithFilters({ events }: EventListingsProps) {
    const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming');
    const [campusFilter, setCampusFilter] = useState<string>('all');

    const now = new Date();

    // Filter by time
    const timeFiltered = events.filter((event) => {
        const eventDate = new Date(event.start_time);
        return filter === 'upcoming' ? eventDate >= now : eventDate < now;
    });

    // Filter by campus
    const filtered = campusFilter === 'all'
        ? timeFiltered
        : timeFiltered.filter((e) => e.campus === campusFilter);

    // Get unique campuses
    const campuses = ['all', ...Array.from(new Set(events.map((e) => e.campus)))];

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                    {/* Time Filter */}
                    <div className="flex gap-2">
                        <Button
                            onClick={() => setFilter('upcoming')}
                            variant={filter === 'upcoming' ? 'default' : 'outline'}
                            size="sm"
                            className={filter === 'upcoming' ? 'bg-[#00386C]' : ''}
                        >
                            <Calendar className="h-4 w-4 mr-2" />
                            Upcoming
                        </Button>
                        <Button
                            onClick={() => setFilter('past')}
                            variant={filter === 'past' ? 'default' : 'outline'}
                            size="sm"
                            className={filter === 'past' ? 'bg-[#00386C]' : ''}
                        >
                            <History className="h-4 w-4 mr-2" />
                            Past
                        </Button>
                    </div>

                    {/* Campus Filter */}
                    <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-500" />
                        <select
                            value={campusFilter}
                            onChange={(e) => setCampusFilter(e.target.value)}
                            className="h-10 px-3 rounded-md border border-gray-300 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {campuses.map((campus) => (
                                <option key={campus} value={campus}>
                                    {campus === 'all' ? 'All Campuses' : campus}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Results Count */}
            <p className="text-sm text-muted-foreground">
                Showing {filtered.length} {filter} event{filtered.length !== 1 ? 's' : ''}
                {campusFilter !== 'all' && ` at ${campusFilter}`}
            </p>

            {/* Events Grid */}
            {filtered.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-xl border border-border">
                    <p className="text-gray-500 text-lg">No events found</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filtered.map((event) => (
                        <EventCard key={event.id} event={event} />
                    ))}
                </div>
            )}
        </div>
    );
}