'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from './ui/button';
import { Bell, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';

const REMINDER_TYPES = ['1_day', '1_hour'] as const;

export default function EventReminderButton({
    eventId,
    initialUserId,
}: {
    eventId: string;
    eventTitle: string;
    startTime: string;
    initialUserId?: string | null;
}) {
    const [hasReminder, setHasReminder] = useState(false);
    const [userId, setUserId] = useState<string | null>(initialUserId ?? null);
    const [sessionChecked, setSessionChecked] = useState(initialUserId !== undefined);

    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);

    const checkReminder = useCallback(async (uid: string) => {
        try {
            const { data, error } = await supabase
                .from('event_reminders')
                .select('reminder_type, sent')
                .eq('user_id', uid)
                .eq('event_id', eventId)
                .in('reminder_type', Array.from(REMINDER_TYPES) as unknown as string[]);

            if (error) throw error;

            // Consider reminder "set" if any reminder row exists (sent or not).
            setHasReminder((data?.length ?? 0) > 0);
        } catch (e) {
            console.warn('[EventReminderButton] checkReminder failed (non-fatal):', e);
            setHasReminder(false);
        }
    }, [supabase, eventId]);

    useEffect(() => {
        let active = true;

        const init = async () => {
            // If the server already told us logged-in/logged-out, skip the loading state.
            if (initialUserId !== undefined) {
                if (initialUserId) void checkReminder(initialUserId);
                setSessionChecked(true);
                return;
            }

            const { data: sessionData } = await supabase.auth.getSession();
            if (!active) return;
            const sessionUserId = sessionData.session?.user?.id ?? null;
            if (sessionUserId) {
                setUserId(sessionUserId);
                void checkReminder(sessionUserId);
            }
            setSessionChecked(true);

            // Best-effort verification; do not treat failures as "logged out" (prevents flicker/random logout UI).
            void (async () => {
                try {
                    const { data: userData } = await supabase.auth.getUser();
                    if (!active) return;
                    if (userData.user?.id) {
                        setUserId(userData.user.id);
                        void checkReminder(userData.user.id);
                    }
                } catch {
                    // ignore
                }
            })();
        };

        void init();

        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
            const nextUserId = session?.user?.id ?? null;
            if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && nextUserId) {
                setSessionChecked(true);
                setUserId(nextUserId);
                void checkReminder(nextUserId);
            }

            if (event === 'SIGNED_OUT') {
                setSessionChecked(true);
                setUserId(null);
                setHasReminder(false);
            }
        });

        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, [supabase, checkReminder, initialUserId]);

    const toggleReminder = async () => {
        if (!userId) {
            const next = `/event/${eventId}`;
            router.push(`/auth/login?next=${encodeURIComponent(next)}`);
            return;
        }

        try {
            if (hasReminder) {
                // Remove reminder
                const { error } = await supabase
                    .from('event_reminders')
                    .delete()
                    .eq('user_id', userId)
                    .eq('event_id', eventId)
                    .in('reminder_type', Array.from(REMINDER_TYPES) as unknown as string[]);

                if (error) throw error;

                setHasReminder(false);
            } else {
                // Add reminders (1 day + 1 hour)
                const rows = REMINDER_TYPES.map((reminder_type) => ({
                    user_id: userId,
                    event_id: eventId,
                    reminder_type,
                }));

                const { error } = await supabase
                    .from('event_reminders')
                    .upsert(rows, { onConflict: 'user_id,event_id,reminder_type' });

                if (error) throw error;

                setHasReminder(true);

                // Request notification permission if not granted
                if ('Notification' in window && Notification.permission === 'default') {
                    await Notification.requestPermission();
                }
            }
        } catch (error: unknown) {
            console.error('Reminder error:', error);
            alert('Failed to set reminder');
        }
    };

    return (
        <Button
            onClick={toggleReminder}
            variant={hasReminder ? "default" : "outline"}
            size="sm"
            disabled={!sessionChecked}
        >
            {!sessionChecked ? (
                <>
                    <Bell className="h-4 w-4 mr-2" />
                    Loading...
                </>
            ) : !userId ? (
                <>
                    <Bell className="h-4 w-4 mr-2" />
                    Login to set reminders
                </>
            ) : hasReminder ? (
                <>
                    <BellOff className="h-4 w-4 mr-2" />
                    Reminder Set
                </>
            ) : (
                <>
                    <Bell className="h-4 w-4 mr-2" />
                    Remind Me (1d + 1h)
                </>
            )}
        </Button>
    );
}
