import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default async function ClubsPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    // Check if super admin
    const { data: adminData } = user
        ? await supabase.from('admin_users').select('role').eq('id', user.id).single()
        : { data: null };

    const isSuperAdmin = adminData?.role === 'super_admin';

    // Fetch all clubs with event counts
    const { data: clubs } = await supabase
        .from('clubs')
        .select('*')
        .order('name');

    const clubsWithCounts = await Promise.all(
        (clubs || []).map(async (club) => {
            const { count } = await supabase
                .from('events')
                .select('id', { count: 'exact', head: true })
                .eq('club_id', club.id);

            return { ...club, event_count: count || 0 };
        })
    );

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-[#00386C] text-white py-12">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-4xl font-bold mb-2">Student Clubs & Societies</h1>
                            <p className="text-blue-100">
                                Join clubs, attend events, and connect with like-minded students
                            </p>
                        </div>
                        {isSuperAdmin && (
                            <Link href="/admin/clubs/create">
                                <Button className="bg-white text-[#00386C] hover:bg-blue-50">
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add Club
                                </Button>
                            </Link>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-10">
                {clubsWithCounts.length === 0 ? (
                    <div className="text-center py-20 bg-card rounded-xl border border-border">
                        <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        <h3 className="text-xl font-semibold text-foreground mb-2">No clubs yet</h3>
                        <p className="text-muted-foreground">Check back soon for student organizations</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {clubsWithCounts.map((club) => (
                            <Link
                                key={club.id}
                                href={`/clubs/${club.id}`}
                                className="bg-card rounded-xl shadow-sm border border-border p-6 hover:shadow-lg transition"
                            >
                                {club.image_url ? (
                                    <img
                                        src={club.image_url}
                                        alt={club.name}
                                        className="w-full h-48 object-cover rounded-lg mb-4"
                                    />
                                ) : (
                                    <div className="w-full h-48 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg mb-4 flex items-center justify-center">
                                        <Users className="h-16 w-16 text-white/50" />
                                    </div>
                                )}
                                <h3 className="text-xl font-bold text-foreground mb-2">{club.name}</h3>
                                <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                                    {club.description || 'No description available'}
                                </p>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{club.event_count} events</span>
                                    <span className="text-blue-600 dark:text-blue-400 font-semibold">View Club →</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}