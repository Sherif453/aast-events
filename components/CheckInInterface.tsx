'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, X, Search, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRScanner from './QRScanner';

interface Attendee {
    id: string;
    user_id: string;
    checked_in: boolean;
    checked_in_at: string | null;
    profiles: {
        full_name: string;
        email: string | null; // ✅ allow null
        avatar_url: string | null; // ✅ allow null
    };
}

interface CheckInInterfaceProps {
    eventId: string;
    eventTitle: string;
    eventStartTime: string;
    attendees: Attendee[];
    adminId: string;
}

export default function CheckInInterface({
    eventId,
    eventTitle,
    eventStartTime,
    attendees: initialAttendees,
    adminId,
}: CheckInInterfaceProps) {
    const [attendees, setAttendees] = useState(initialAttendees);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState<string | null>(null);
    const supabase = createClient();
    const router = useRouter();

    // ✅ Check-in lock: block check-in actions 24 hours after start time
    const isCheckInLocked = useMemo(() => {
        const start = new Date(eventStartTime).getTime();
        const lockAt = start + 24 * 60 * 60 * 1000;
        return Date.now() >= lockAt;
    }, [eventStartTime]);

    const handleCheckIn = async (attendeeId: string, currentStatus: boolean) => {
        if (isCheckInLocked) {
            alert('Check-in is closed for this event.');
            return;
        }

        setLoading(attendeeId);

        const checkedInAt = !currentStatus ? new Date().toISOString() : null;

        const { error } = await supabase
            .from('attendees')
            .update({
                checked_in: !currentStatus,
                checked_in_at: checkedInAt,
                checked_in_by: !currentStatus ? adminId : null,
            })
            .eq('id', attendeeId);

        if (!error) {
            setAttendees((prev) =>
                prev.map((a) =>
                    a.id === attendeeId
                        ? { ...a, checked_in: !currentStatus, checked_in_at: checkedInAt }
                        : a
                )
            );
        }

        setLoading(null);
        router.refresh();
    };

    const filteredAttendees = attendees.filter((a) => {
        const name = (a.profiles.full_name || '').toLowerCase();
        const email = (a.profiles.email || '').toLowerCase();
        const q = search.toLowerCase();
        return name.includes(q) || email.includes(q);
    });

    const checkedInCount = attendees.filter((a) => a.checked_in).length;
    const totalCount = attendees.length;

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map((n) => n.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-4">
                    <Link
                        href={`/event/${eventId}`}
                        className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-2"
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Back to Event
                    </Link>
                    <h1 className="text-2xl font-bold text-foreground">{eventTitle}</h1>
                    <p className="text-sm text-muted-foreground mt-1">Check-In Dashboard</p>

                    <div className="flex gap-4 mt-4">
                        <div className="bg-green-500/10 dark:bg-green-500/20 px-4 py-2 rounded-lg border border-green-500/30">
                            <p className="text-sm text-muted-foreground">Checked In</p>
                            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{checkedInCount}</p>
                        </div>
                        <div className="bg-muted px-4 py-2 rounded-lg border border-border">
                            <p className="text-sm text-muted-foreground">Total RSVPs</p>
                            <p className="text-2xl font-bold text-foreground">{totalCount}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* QR SCANNER SECTION */}
            <div className="max-w-4xl mx-auto p-4">
                <div className="bg-card rounded-xl shadow-sm border border-border p-6 mb-4">
                    <h2 className="text-lg font-bold text-foreground mb-4">QR Code Scanner</h2>
                    <QRScanner
                        eventId={eventId}
                        adminId={adminId}
                        onCheckInSuccess={(attendeeId, checkedInAt) => {
                            setAttendees((prev) =>
                                prev.map((a) =>
                                    a.id === attendeeId ? { ...a, checked_in: true, checked_in_at: checkedInAt } : a
                                )
                            );
                            router.refresh();
                        }}
                        disabled={isCheckInLocked}
                    />
                </div>
            </div>

            {/* Search */}
            <div className="max-w-4xl mx-auto p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Search by name or email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 bg-card"
                    />
                </div>
            </div>

            {/* Attendees List */}
            <div className="max-w-4xl mx-auto p-4">
                <div className="bg-card rounded-xl shadow-sm border border-border divide-y divide-border">
                    {filteredAttendees.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            {search ? 'No attendees match your search' : 'No RSVPs yet'}
                        </div>
                    ) : (
                        filteredAttendees.map((attendee) => (
                            <div
                                key={attendee.id}
                                className={`p-4 flex items-center gap-4 ${attendee.checked_in ? 'bg-green-50 dark:bg-green-950/20' : ''
                                    }`}
                            >
                                <Avatar className="h-12 w-12 ring-2 ring-blue-100">
                                    <AvatarImage
                                        src={attendee.profiles.avatar_url || ''}
                                        alt={attendee.profiles.full_name}
                                    />
                                    <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                                        {getInitials(attendee.profiles.full_name)}
                                    </AvatarFallback>
                                </Avatar>

                                <div className="flex-1">
                                    <p className="font-semibold text-foreground">{attendee.profiles.full_name}</p>
                                    <p className="text-sm text-gray-500">{attendee.profiles.email || '—'}</p>
                                    {attendee.checked_in && attendee.checked_in_at && (
                                        <p className="text-xs text-green-600 mt-1">
                                            ✓ Checked in at {new Date(attendee.checked_in_at).toLocaleTimeString()}
                                        </p>
                                    )}
                                </div>

                                <Button
                                    onClick={() => handleCheckIn(attendee.id, attendee.checked_in)}
                                    disabled={loading === attendee.id || isCheckInLocked}
                                    variant={attendee.checked_in ? 'outline' : 'default'}
                                    className={
                                        attendee.checked_in
                                            ? 'border-red-300 text-red-600 hover:bg-red-50'
                                            : 'bg-green-600 hover:bg-green-700 text-white'
                                    }
                                >
                                    {loading === attendee.id ? (
                                        'Loading...'
                                    ) : attendee.checked_in ? (
                                        <>
                                            <X className="h-4 w-4 mr-2" />
                                            Undo
                                        </>
                                    ) : (
                                        <>
                                            <Check className="h-4 w-4 mr-2" />
                                            Check In
                                        </>
                                    )}
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
