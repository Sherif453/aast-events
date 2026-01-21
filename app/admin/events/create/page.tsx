import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import EventForm from '@/components/admin/EventForm';

export default async function CreateEventPage() {
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

    // Fetch clubs for dropdown
    let clubsQuery = supabase.from('clubs').select('id, name').order('name');

    if (adminData.role !== 'super_admin') {
        // club_admin + event_volunteer should only see their club
        if (!adminData.club_id) redirect('/'); // no club assigned => block
        clubsQuery = clubsQuery.eq('id', adminData.club_id);
    }

    const { data: clubs } = await clubsQuery;

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-6">
                    <h1 className="text-3xl font-bold text-foreground">Create New Event</h1>
                    <p className="text-muted-foreground mt-1">Fill in the details to create a new event</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                <EventForm
                    mode="create"
                    clubs={clubs || []}
                    userId={user.id}
                    role={adminData.role}
                    adminClubId={adminData.club_id || null}
                />
            </div>
        </div>
    );
}
