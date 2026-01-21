import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import EventForm from '@/components/admin/EventForm';

export default async function EditEventPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: eventId } = await params;
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect('/auth/login');
    }

    const { data: adminData } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .single();

    if (!adminData || !['super_admin', 'club_admin', 'event_volunteer'].includes(adminData.role)) {
        redirect('/');
    }

    // Fetch event data
    const { data: event, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single();

    if (error || !event) {
        redirect('/admin/events');
    }

    // UI guard: club_admin / volunteer can only edit events of their own club
    if (adminData.role !== 'super_admin') {
        if (!adminData.club_id) redirect('/');
        if (!event.club_id || event.club_id !== adminData.club_id) {
            redirect('/admin/events');
        }
    }

    // Fetch clubs for dropdown
    let clubsQuery = supabase.from('clubs').select('id, name').order('name');

    if (adminData.role !== 'super_admin') {
        // show only their club
        clubsQuery = clubsQuery.eq('id', adminData.club_id);
    }

    const { data: clubs } = await clubsQuery;

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-6">
                    <h1 className="text-3xl font-bold text-foreground">Edit Event</h1>
                    <p className="text-muted-foreground mt-1">Update event details</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                <EventForm
                    mode="edit"
                    clubs={clubs || []}
                    userId={user.id}
                    initialData={event}
                    role={adminData.role}
                    adminClubId={adminData.club_id || null}
                />
            </div>
        </div>
    );
}
