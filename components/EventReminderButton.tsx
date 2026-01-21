'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from './ui/button';
import { Bell, BellOff } from 'lucide-react';

export default function EventReminderButton({ eventId, eventTitle, startTime }: {
    eventId: number;
    eventTitle: string;
    startTime: string;
}) {
    const [hasReminder, setHasReminder] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    const supabase = createClient();

    useEffect(() => {
        checkReminder();
    }, [eventId]);

    const checkReminder = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        setUserId(user.id);

        const { data } = await supabase
            .from('event_reminders')
            .select('id')
            .eq('user_id', user.id)
            .eq('event_id', eventId)
            .eq('reminder_type', '1_hour')
            .maybeSingle();

        setHasReminder(!!data);
    };

    const toggleReminder = async () => {
        if (!userId) {
            alert('Please log in to set reminders');
            return;
        }

        try {
            if (hasReminder) {
                // Remove reminder
                await supabase
                    .from('event_reminders')
                    .delete()
                    .eq('user_id', userId)
                    .eq('event_id', eventId);

                setHasReminder(false);
            } else {
                // Add reminder
                await supabase
                    .from('event_reminders')
                    .insert([{
                        user_id: userId,
                        event_id: eventId,
                        reminder_type: '1_hour'
                    }]);

                setHasReminder(true);

                // Request notification permission if not granted
                if ('Notification' in window && Notification.permission === 'default') {
                    await Notification.requestPermission();
                }
            }
        } catch (error: any) {
            console.error('Reminder error:', error);
            alert('Failed to set reminder');
        }
    };

    if (!userId) return null;

    return (
        <Button
            onClick={toggleReminder}
            variant={hasReminder ? "default" : "outline"}
            size="sm"
        >
            {hasReminder ? (
                <>
                    <BellOff className="h-4 w-4 mr-2" />
                    Reminder Set
                </>
            ) : (
                <>
                    <Bell className="h-4 w-4 mr-2" />
                    Remind Me
                </>
            )}
        </Button>
    );
}