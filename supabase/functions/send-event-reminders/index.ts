import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: any) => {
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Get events happening in 1 hour
        const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
        const oneHourAgo = new Date(Date.now() + 59 * 60 * 1000);

        const { data: events } = await supabase
            .from('events')
            .select('id, title, start_time, location')
            .gte('start_time', oneHourAgo.toISOString())
            .lte('start_time', oneHourFromNow.toISOString());

        for (const event of events || []) {
            // Get users with reminders for this event
            const { data: reminders } = await supabase
                .from('event_reminders')
                .select('user_id, users:profiles(email)')
                .eq('event_id', event.id)
                .eq('reminder_type', '1_hour')
                .eq('sent', false);

            for (const reminder of reminders || []) {
                // Create notification
                await supabase.rpc('create_event_reminder_notification', {
                    p_user_id: reminder.user_id,
                    p_event_id: event.id,
                    p_event_title: event.title,
                    p_start_time: event.start_time
                });

                // Mark reminder as sent
                await supabase
                    .from('event_reminders')
                    .update({ sent: true, sent_at: new Date().toISOString() })
                    .eq('user_id', reminder.user_id)
                    .eq('event_id', event.id)
                    .eq('reminder_type', '1_hour');

                // Send email using Supabase Auth
                // Note: This requires Supabase email service configuration
                // Alternative: Use Resend, SendGrid, or other email service
            }
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});