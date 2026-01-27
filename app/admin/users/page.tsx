import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import AdminRoleManager from '@/components/admin/AdminRoleManager';

type AdminRole = 'super_admin' | 'club_admin' | 'event_volunteer' | 'read_only_analytics';

type AdminRow = {
    id: string;
    role: AdminRole;
    assigned_at: string | null;
    club_id: string | null;
    clubs?: { name?: string | null } | null;
};

type UserOption = {
    id: string;
    full_name: string;
    email: string | null;
};

type ProfileLiteRow = { id: string; full_name: string | null; email: string | null };

export default async function AdminUsersPage() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect('/auth/login');

    const { data: adminData, error: adminErr } = await supabase
        .from('admin_users')
        .select('role, club_id')
        .eq('id', user.id)
        .maybeSingle();

    if (adminErr || !adminData || !['super_admin', 'club_admin'].includes(adminData.role)) {
        redirect('/admin');
    }

    const myRole = adminData.role as AdminRole;
    const myClubId = adminData.club_id ?? null;

    if (myRole === 'club_admin' && !myClubId) redirect('/admin');

    //  Current admins/volunteers list (scoped for club_admin)
    let adminsQuery = supabase
        .from('admin_users')
        .select('id, role, assigned_at, club_id, clubs(name)')
        .order('assigned_at', { ascending: false });

    if (myRole === 'club_admin' && myClubId) {
        adminsQuery = adminsQuery.eq('club_id', myClubId);
    }

    const { data: rawAdmins, error: rawAdminsErr } = await adminsQuery;
    if (rawAdminsErr) {
        console.error('admin_users fetch error:', rawAdminsErr);
        redirect('/admin');
    }

    const adminRows = (rawAdmins as AdminRow[] | null) ?? [];
    const adminIds = adminRows.map((a) => a.id);

    //  Fetch private profile info for listed admins/volunteers (emails must show for club_admin too)
    const { data: adminProfiles, error: adminProfilesErr } = adminIds.length
        ? await supabase.from('profiles').select('id, full_name, email').in('id', adminIds)
        : { data: [], error: null };

    if (adminProfilesErr) {
        console.error('profiles(admin list) fetch error:', adminProfilesErr);
    }

    const adminProfileMap = new Map<string, { id: string; full_name: string | null; email: string | null }>();
    const adminProfileRows = (adminProfiles as unknown as ProfileLiteRow[] | null) ?? [];
    adminProfileRows.forEach((p) => adminProfileMap.set(String(p.id), p));

    const admins = adminRows.map((a) => {
        const p = adminProfileMap.get(a.id);
        return {
            id: a.id,
            role: a.role,
            assigned_at: a.assigned_at,
            club_id: a.club_id,
            club_name: a.clubs?.name || null,
            full_name: p?.full_name || 'Unknown',
            email: p?.email || null,
        };
    });

    //  All users list for dropdown (ALWAYS pull from profiles so emails show for club_admin)
    const { data: allPrivate, error: allPrivateErr } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name');

    if (allPrivateErr) {
        console.error('profiles(all users) fetch error:', allPrivateErr);
    }

    const allPrivateRows = (allPrivate as unknown as ProfileLiteRow[] | null) ?? [];
    const allUsers: UserOption[] = allPrivateRows.map((u) => ({
        id: String(u.id),
        full_name: u.full_name || 'Unknown',
        email: u.email || null,
    }));

    //  Clubs list (super_admin sees all, club_admin sees only their club)
    let clubsQuery = supabase.from('clubs').select('id, name').order('name');
    if (myRole === 'club_admin' && myClubId) clubsQuery = clubsQuery.eq('id', myClubId);

    const { data: clubs, error: clubsErr } = await clubsQuery;
    if (clubsErr) console.error('clubs fetch error:', clubsErr);

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border">
                <div className="max-w-4xl mx-auto p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground">
                                {myRole === 'super_admin' ? 'Manage Admin Users' : 'Manage Volunteers'}
                            </h1>
                            <p className="text-muted-foreground mt-1">
                                {myRole === 'super_admin'
                                    ? 'Add or remove admin privileges'
                                    : 'Add or remove event volunteers in your club'}
                            </p>
                        </div>
                        <Link href="/admin">
                            <Button variant="outline">Back to Dashboard</Button>
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto p-6">
                <AdminRoleManager
                    currentAdmins={admins}
                    allUsers={allUsers}
                    currentUserId={user.id}
                    currentUserRole={myRole}
                    adminClubId={myClubId}
                    clubs={clubs || []}
                />
            </div>
        </div>
    );
}
