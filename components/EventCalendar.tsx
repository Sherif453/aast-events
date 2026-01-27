'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Calendar as CalendarIcon, Download, List, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { Calendar, dateFnsLocalizer, View } from 'react-big-calendar';
import {
    format,
    parse,
    startOfWeek,
    getDay,
    addMonths,
    subMonths,
    addDays,
    subDays,
    addWeeks,
    subWeeks,
} from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useRouter } from 'next/navigation';
import JSZip from 'jszip';

const locales = {
    'en-US': enUS,
};

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

interface CalendarEvent {
    id: number;
    title: string;
    start_time: string;
    end_time: string | null;
    location: string;
    campus: string;
}

interface CalendarEventFormatted {
    id: number;
    title: string;
    start: Date;
    end: Date;
    location: string;
    campus: string;
}

export default function EventCalendar() {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [userId, setUserId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    const [calendarView, setCalendarView] = useState<View>('month');
    const [currentDate, setCurrentDate] = useState(new Date());

    const supabase = useMemo(() => createClient(), []);
    const router = useRouter();

    const loadEvents = useCallback(async () => {
        if (!userId) return;

        const { data: attendees } = await supabase
            .from('attendees')
            .select(`
                event_id,
                events!inner (
                    id,
                    title,
                    start_time,
                    end_time,
                    location,
                    campus
                )
            `)
            .eq('user_id', userId)
            .gte('events.start_time', new Date().toISOString())
            .order('event_id');

        const eventList = attendees?.map(a => a.events).filter(Boolean) || [];
        setEvents(eventList as unknown as CalendarEvent[]);
    }, [supabase, userId]);

    useEffect(() => {
        const init = async () => {
            const { data } = await supabase.auth.getUser();
            setUserId(data.user?.id ?? null);
        };
        init();

        const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUserId(session?.user?.id ?? null);
        });

        return () => {
            authSub.subscription.unsubscribe();
        };
    }, [supabase]);

    useEffect(() => {
        if (!userId) return;
        const id = setTimeout(() => {
            void loadEvents();
        }, 0);
        return () => clearTimeout(id);
    }, [userId, loadEvents]);

    const exportToGoogleCalendar = (event: CalendarEvent) => {
        const startDate = new Date(event.start_time);
        const endDate = event.end_time ? new Date(event.end_time) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

        const formatDate = (date: Date) => {
            return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        };

        const params = new URLSearchParams({
            action: 'TEMPLATE',
            text: event.title,
            dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
            details: `AAST Event at ${event.location}, ${event.campus}`,
            location: `${event.location}, ${event.campus}`,
        });

        window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank');
    };

    const createICSForEvent = (event: CalendarEvent): string => {
        const start = new Date(event.start_time);
        const end = event.end_time ? new Date(event.end_time) : new Date(start.getTime() + 2 * 60 * 60 * 1000);

        const formatICSDate = (date: Date) => {
            return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        };

        let icsContent = 'BEGIN:VCALENDAR\n';
        icsContent += 'VERSION:2.0\n';
        icsContent += 'PRODID:-//AAST Events//EN\n';
        icsContent += 'CALSCALE:GREGORIAN\n';
        icsContent += 'METHOD:PUBLISH\n';
        icsContent += 'BEGIN:VEVENT\n';
        icsContent += `UID:${event.id}@aast-events.com\n`;
        icsContent += `DTSTAMP:${formatICSDate(new Date())}\n`;
        icsContent += `DTSTART:${formatICSDate(start)}\n`;
        icsContent += `DTEND:${formatICSDate(end)}\n`;
        icsContent += `SUMMARY:${event.title}\n`;
        icsContent += `LOCATION:${event.location}, ${event.campus}\n`;
        icsContent += `DESCRIPTION:AAST Event\n`;
        icsContent += `STATUS:CONFIRMED\n`;
        icsContent += 'END:VEVENT\n';
        icsContent += 'END:VCALENDAR';

        return icsContent;
    };

    const exportAllToZIP = async () => {
        const zip = new JSZip();

        events.forEach(event => {
            const icsContent = createICSForEvent(event);
            const sanitizedTitle = event.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const fileName = `${sanitizedTitle}_${event.id}.ics`;
            zip.file(fileName, icsContent);
        });

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'aast-events.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const formattedEvents: CalendarEventFormatted[] = events.map(event => ({
        id: event.id,
        title: event.title,
        start: new Date(event.start_time),
        end: event.end_time ? new Date(event.end_time) : new Date(new Date(event.start_time).getTime() + 2 * 60 * 60 * 1000),
        location: event.location,
        campus: event.campus,
    }));

    const eventStyleGetter = () => {
        return {
            style: {
                backgroundColor: '#00386C',
                borderRadius: '5px',
                opacity: 0.9,
                color: 'white',
                border: '0px',
                display: 'block',
                cursor: 'pointer',
            }
        };
    };

    const handleSelectEvent = (event: CalendarEventFormatted) => {
        router.push(`/event/${event.id}`);
    };

    const handlePrevious = () => {
        if (calendarView === 'month') {
            setCurrentDate(subMonths(currentDate, 1));
        } else if (calendarView === 'week') {
            setCurrentDate(subWeeks(currentDate, 1));
        } else if (calendarView === 'day') {
            setCurrentDate(subDays(currentDate, 1));
        }
    };

    const handleNext = () => {
        if (calendarView === 'month') {
            setCurrentDate(addMonths(currentDate, 1));
        } else if (calendarView === 'week') {
            setCurrentDate(addWeeks(currentDate, 1));
        } else if (calendarView === 'day') {
            setCurrentDate(addDays(currentDate, 1));
        }
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const getDisplayText = () => {
        if (calendarView === 'month') {
            return format(currentDate, 'MMMM yyyy');
        } else if (calendarView === 'week') {
            const weekStart = startOfWeek(currentDate);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
        } else if (calendarView === 'day') {
            return format(currentDate, 'EEEE, MMMM d, yyyy');
        }
        return '';
    };

    if (!userId || events.length === 0) return null;

    return (
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <CalendarIcon className="h-5 w-5" />
                    My Event Calendar ({events.length})
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
                        variant="outline"
                        size="sm"
                    >
                        {viewMode === 'list' ? (
                            <>
                                <CalendarDays className="h-4 w-4 mr-2" />
                                Calendar View
                            </>
                        ) : (
                            <>
                                <List className="h-4 w-4 mr-2" />
                                List View
                            </>
                        )}
                    </Button>
                    <Button onClick={exportAllToZIP} variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Export (.zip)
                    </Button>
                </div>
            </div>

            {viewMode === 'list' && (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                    {events.map(event => (
                        <div
                            key={event.id}
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-muted rounded-lg hover:bg-muted/80 dark:hover:bg-muted/60 transition"
                        >
                            <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-foreground">{event.title}</h4>
                                <p className="text-sm text-muted-foreground mt-1">
                                    📍 {event.location}, {event.campus}
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    🕐 {new Date(event.start_time).toLocaleString('en-US', {
                                        weekday: 'short',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </p>
                            </div>
                            <Button
                                onClick={() => exportToGoogleCalendar(event)}
                                variant="outline"
                                size="sm"
                                className="flex-shrink-0 w-full sm:w-auto"
                            >
                                Add to Google
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {viewMode === 'calendar' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-center gap-2 pb-3">
                        <Button onClick={handlePrevious} variant="outline" size="sm">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="font-bold text-foreground text-base min-w-[220px] text-center">
                            {getDisplayText()}
                        </span>
                        <Button onClick={handleNext} variant="outline" size="sm">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex items-center justify-center gap-2 pb-4 border-b border-border flex-wrap">
                        <Button onClick={handleToday} variant="outline" size="sm">
                            Today
                        </Button>
                        <div className="h-6 w-px bg-border mx-1"></div>
                        <Button
                            onClick={() => setCalendarView('month')}
                            variant={calendarView === 'month' ? 'default' : 'outline'}
                            size="sm"
                        >
                            Month
                        </Button>
                        <Button
                            onClick={() => setCalendarView('week')}
                            variant={calendarView === 'week' ? 'default' : 'outline'}
                            size="sm"
                        >
                            Week
                        </Button>
                        <Button
                            onClick={() => setCalendarView('day')}
                            variant={calendarView === 'day' ? 'default' : 'outline'}
                            size="sm"
                        >
                            Day
                        </Button>
                    </div>

                    <div className="h-[600px] bg-card rounded-lg border border-border p-4 overflow-hidden">
                        <Calendar
                            localizer={localizer}
                            events={formattedEvents}
                            startAccessor="start"
                            endAccessor="end"
                            style={{ height: '100%' }}
                            view={calendarView}
                            onView={setCalendarView}
                            date={currentDate}
                            onNavigate={setCurrentDate}
                            eventPropGetter={eventStyleGetter}
                            onSelectEvent={handleSelectEvent}
                            popup
                            tooltipAccessor={(event) => `${event.title} - ${event.location}`}
                            toolbar={false}
                            views={['month', 'week', 'day']}
                            min={new Date(2024, 0, 1, 8, 0, 0)}
                            max={new Date(2024, 0, 1, 21, 0, 0)}
                            step={60}
                            timeslots={1}
                            showMultiDayTimes
                            formats={{
                                dayFormat: (date, culture, localizer) =>
                                    localizer?.format(date, 'EEE M/d', culture) ?? '',
                                weekdayFormat: (date, culture, localizer) =>
                                    localizer?.format(date, 'EEE', culture) ?? '',
                                dayHeaderFormat: (date, culture, localizer) =>
                                    localizer?.format(date, 'EEEE, MMMM d', culture) ?? '',
                                dayRangeHeaderFormat: ({ start, end }, culture, localizer) =>
                                    `${localizer?.format(start, 'MMM d', culture)} - ${localizer?.format(end, 'MMM d, yyyy', culture)}`,
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
