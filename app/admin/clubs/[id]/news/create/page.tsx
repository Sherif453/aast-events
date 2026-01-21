import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import PostNewsForm from '@/components/admin/PostNewsForm';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default async function PostClubNewsPage({
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

    // ✅ Allow super_admin OR club_admin (only their own club)
    if (adminData.role === 'club_admin') {
        if (!adminData.club_id) redirect('/admin');
        if (adminData.club_id !== clubId) redirect('/admin/clubs');
    } else if (adminData.role !== 'super_admin') {
        redirect('/admin');
    }

    // Fetch club details (public select policy allows)
    const { data: club } = await supabase
        .from('clubs')
        .select('*')
        .eq('id', clubId)
        .single();

    if (!club) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold mb-4">Club Not Found</h1>
                    <Link href="/admin/clubs">
                        <Button>Back to Clubs</Button>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-muted">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-6">
                    <Link href="/admin/clubs">
                        <Button variant="outline" size="sm" className="mb-4">
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Back to Clubs
                        </Button>
                    </Link>
                    <h1 className="text-3xl font-bold text-foreground">Post News for {club.name}</h1>
                    <p className="text-muted-foreground mt-1">Share achievements, announcements, or updates</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                <PostNewsForm clubId={clubId} userId={user.id} />
            </div>
        </div>
    );
}
