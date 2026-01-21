import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ClubForm from '@/components/admin/ClubForm';

export default async function CreateClubPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect('/auth/login');

    const { data: adminData } = await supabase
        .from('admin_users')
        .select('role')
        .eq('id', user.id)
        .single();

    if (adminData?.role !== 'super_admin') redirect('/admin');

    return (
        <div className="min-h-screenbg-background">
            <div className="bg-card border-b border-border p-6">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-3xl font-bold text-foreground">Create New Club</h1>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                <ClubForm userId={user.id} />
            </div>
        </div>
    );
}