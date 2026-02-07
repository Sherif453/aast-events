import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import EditClubForm from '@/components/admin/EditClubForm';

export default async function EditClubPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: clubId } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const { data: adminData } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .single();

    if (!adminData) redirect('/admin');

    //  Allow super_admin OR club_admin (only their own club)
    if (adminData.role === 'club_admin') {
        if (!adminData.club_id) redirect('/admin');
        if (adminData.club_id !== clubId) redirect('/admin/clubs');
    } else if (adminData.role !== 'super_admin') {
        redirect('/admin');
    }

    const { data: club } = await supabase
        .from('clubs')
        .select('*')
        .eq('id', clubId)
        .single();

    if (!club) redirect('/admin/clubs');

    return (
        <div className="min-h-screen bg-muted">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-6">
                    <h1 className="text-3xl font-bold text-foreground">Edit Club</h1>
                    <p className="text-muted-foreground mt-1">Update club information</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                <EditClubForm club={club} userId={user.id} />
            </div>
        </div>
    );
}
