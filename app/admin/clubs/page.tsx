import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Plus, Pencil, Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DeleteClubButton from '@/components/admin/DeleteClubButton';
import UnoptimizedImage from "@/components/UnoptimizedImage";

export default async function ManageClubsPage() {
    console.log("ADMIN CLUBS PAGE LOADED");
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const { data: adminData } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .single();

    if (!adminData) redirect('/admin');

    const isSuperAdmin = adminData.role === 'super_admin';
    const isClubAdmin = adminData.role === 'club_admin';

    // Volunteers should not manage clubs
    if (!isSuperAdmin && !isClubAdmin) redirect('/admin');

    // If club_admin must have a club_id
    if (isClubAdmin && !adminData.club_id) redirect('/admin');

    // Fetch clubs:
    // - super_admin => all
    // - club_admin => only their club
    let clubsQuery = supabase.from('clubs').select('*').order('name');

    if (isClubAdmin) {
        clubsQuery = clubsQuery.eq('id', adminData.club_id);
    }

    const { data: clubs } = await clubsQuery;

    const clubsWithCounts = await Promise.all(
        (clubs || []).map(async (club) => {
            const { count } = await supabase
                .from('events')
                .select('id', { count: 'exact', head: true })
                .eq('club_id', club.id);

            return { ...club, event_count: count || 0 };
        })
    );

    const pageTitle = isSuperAdmin ? 'Manage Clubs' : 'Manage Your Club';
    const pageSubtitle = isSuperAdmin
        ? 'Edit, delete, or post news for clubs'
        : 'Edit your club details and post news';

    return (
        <div className="min-h-screen bg-muted">
            <div className="bg-card border-b border-border">
                <div className="max-w-7xl mx-auto p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link href="/admin">
                                <Button variant="outline" size="sm">
                                    <ChevronLeft className="h-4 w-4 mr-1" />
                                    Back
                                </Button>
                            </Link>
                            <div>
                                <h1 className="text-3xl font-bold text-foreground">{pageTitle}</h1>
                                <p className="text-muted-foreground mt-1">{pageSubtitle}</p>
                            </div>
                        </div>

                        {/* Only super_admin can create clubs */}
                        {isSuperAdmin && (
                            <Link href="/admin/clubs/create">
                                <Button className="bg-blue-600 hover:bg-blue-700">
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add Club
                                </Button>
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-6">
                {clubsWithCounts.length === 0 ? (
                    <div className="text-center py-20 bg-card rounded-xl border border-border">
                        <h3 className="text-xl font-semibold text-foreground mb-2">
                            {isSuperAdmin ? 'No clubs yet' : 'No club assigned'}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                            {isSuperAdmin
                                ? 'Create your first club to get started'
                                : 'Ask a super admin to assign you to a club'}
                        </p>

                        {isSuperAdmin && (
                            <Link href="/admin/clubs/create">
                                <Button>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Create Club
                                </Button>
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {clubsWithCounts.map((club) => (
                            <div
                                key={club.id}
                                className="bg-card rounded-xl shadow-sm border border-border p-6 flex items-center justify-between hover:shadow-md transition"
                            >
                                <div className="flex items-center gap-4">
                                    {club.image_url ? (
                                        <div className="relative w-16 h-16 rounded-lg overflow-hidden">
                                            <UnoptimizedImage
                                                src={club.image_url}
                                                alt={club.name}
                                                fill
                                                className="object-cover"
                                                sizes="64px"
                                                unoptimized
                                            />
                                        </div>
                                    ) : (
                                        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg" />
                                    )}
                                    <div>
                                        <h3 className="text-xl font-bold text-foreground">{club.name}</h3>
                                        <p className="text-sm text-muted-foreground line-clamp-1">
                                            {club.description || 'No description'}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {club.event_count} events
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* Keeping your existing UI/actions */}
                                    <Link href={`/admin/clubs/${club.id}/news/create`}>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="bg-green-50 hover:bg-green-100 dark:bg-green-950 dark:hover:bg-green-900 border-green-200 dark:border-green-800"
                                        >
                                            <Newspaper className="h-4 w-4 mr-2" />
                                            Post News
                                        </Button>
                                    </Link>

                                    <Link href={`/admin/clubs/edit/${club.id}`}>
                                        <Button variant="outline" size="sm">
                                            <Pencil className="h-4 w-4 mr-2" />
                                            Edit
                                        </Button>
                                    </Link>

                                    {/* Only super_admin can delete clubs by policy */}
                                    {isSuperAdmin && (
                                        <DeleteClubButton clubId={club.id} clubName={club.name} />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
