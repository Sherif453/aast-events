'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Shield, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

type AdminRole = 'super_admin' | 'club_admin' | 'event_volunteer' | 'read_only_analytics';

type AdminUserInsert = {
    id: string;
    role: AdminRole;
    assigned_by: string;
    club_id: string | null;
};

interface AdminRoleManagerProps {
    currentAdmins: {
        id: string;
        role: string;
        full_name: string;
        email?: string | null;
        club_id?: string | null;
        club_name?: string | null;
    }[];

    allUsers: { id: string; full_name: string; email: string | null }[];

    currentUserId: string;
    currentUserRole: string;
    adminClubId: string | null;

    clubs: { id: string; name: string }[];
}

export default function AdminRoleManager({
    currentAdmins,
    allUsers,
    currentUserId,
    currentUserRole,
    adminClubId,
    clubs,
}: AdminRoleManagerProps) {
    const isSuperAdmin = currentUserRole === 'super_admin';
    const isClubAdmin = currentUserRole === 'club_admin';

    const [selectedUser, setSelectedUser] = useState('');
    const [selectedRole, setSelectedRole] = useState<AdminRole>('event_volunteer');
    const [selectedClubId, setSelectedClubId] = useState<string>(adminClubId || '');
    const [isAdding, setIsAdding] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const router = useRouter();
    const supabase = createClient();

    const availableUsers = useMemo(() => {
        return allUsers.filter((u) => !currentAdmins.some((admin) => admin.id === u.id));
    }, [allUsers, currentAdmins]);

    const roleOptions: { value: AdminRole; label: string }[] = useMemo(() => {
        if (isClubAdmin) return [{ value: 'event_volunteer', label: 'Event Volunteer' }];
        return [
            { value: 'event_volunteer', label: 'Event Volunteer' },
            { value: 'read_only_analytics', label: 'Analytics Viewer' },
            { value: 'club_admin', label: 'Club Admin' },
            { value: 'super_admin', label: 'Super Admin' },
        ];
    }, [isClubAdmin]);

    const needsClub = selectedRole === 'club_admin' || selectedRole === 'event_volunteer';

    const canSubmitAdd =
        !!selectedUser &&
        !isAdding &&
        ((isClubAdmin && !!adminClubId && selectedRole === 'event_volunteer') ||
            (isSuperAdmin && (!needsClub || !!selectedClubId)));

    const userLabel = (u: { full_name: string; email: string | null }) => {
        const name = (u.full_name || '').trim() || 'Unknown';
        const email = (u.email || '').trim();
        return email ? `${name} (${email})` : name;
    };

    const handleAddAdmin = async () => {
        if (!canSubmitAdd) return;

        setIsAdding(true);
        try {
            const finalRole: AdminRole = isClubAdmin ? 'event_volunteer' : selectedRole;

            const payload: AdminUserInsert = {
                id: selectedUser,
                role: finalRole,
                assigned_by: currentUserId,
                club_id:
                    finalRole === 'club_admin' || finalRole === 'event_volunteer'
                        ? (isClubAdmin ? adminClubId : selectedClubId)
                        : null,
            };

            const { error } = await supabase.from('admin_users').insert(payload);
            if (error) throw error;

            setSelectedUser('');
            setSelectedRole('event_volunteer');
            setSelectedClubId(adminClubId || '');
            router.refresh();
        } catch (error: unknown) {
            console.error('Add admin error:', error);
            const message = error instanceof Error ? error.message : 'Add failed';
            alert(`Failed to add admin: ${message}`);
        } finally {
            setIsAdding(false);
        }
    };

    const handleRemoveAdmin = async (adminId: string, adminRole: string) => {
        if (adminId === currentUserId) {
            alert("You can't remove yourself!");
            return;
        }

        if (isClubAdmin && adminRole !== 'event_volunteer') {
            alert('You can only remove event volunteers in your club.');
            return;
        }

        setRemovingId(adminId);
        try {
            const { error } = await supabase.from('admin_users').delete().eq('id', adminId);
            if (error) throw error;

            router.refresh();
        } catch (error: unknown) {
            console.error('Remove admin error:', error);
            const message = error instanceof Error ? error.message : 'Remove failed';
            alert(`Failed to remove admin: ${message}`);
        } finally {
            setRemovingId(null);
        }
    };

    const roleColors: Record<string, string> = {
        super_admin: 'bg-purple-100 text-purple-800',
        club_admin: 'bg-blue-100 text-blue-800',
        event_volunteer: 'bg-green-100 text-green-800',
        read_only_analytics: 'bg-gray-100 text-gray-800',
    };

    return (
        <div className="space-y-6">
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    {isSuperAdmin ? 'Add New Admin' : 'Add New Volunteer'}
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <select
                        value={selectedUser}
                        onChange={(e) => setSelectedUser(e.target.value)}
                        className="h-10 px-3 rounded-md border border-gray-300 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">Select User</option>
                        {availableUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                                {userLabel({ full_name: u.full_name, email: u.email })}
                            </option>
                        ))}
                    </select>

                    <div className="flex flex-col">
                        <select
                            value={isClubAdmin ? 'event_volunteer' : selectedRole}
                            onChange={(e) => setSelectedRole(e.target.value as AdminRole)}
                            disabled={isClubAdmin}
                            className="h-10 px-3 rounded-md border border-gray-300 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                        >
                            {roleOptions.map((r) => (
                                <option key={r.value} value={r.value}>
                                    {r.label}
                                </option>
                            ))}
                        </select>

                        {isSuperAdmin && needsClub && (
                            <select
                                value={selectedClubId}
                                onChange={(e) => setSelectedClubId(e.target.value)}
                                className="h-10 px-3 rounded-md border border-gray-300 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mt-2"
                            >
                                <option value="">Select Club</option>
                                {clubs.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <Button onClick={handleAddAdmin} disabled={!canSubmitAdd} className="bg-blue-600 hover:bg-blue-700">
                        {isAdding ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <UserPlus className="h-4 w-4 mr-2" />
                                {isSuperAdmin ? 'Add Admin' : 'Add Volunteer'}
                            </>
                        )}
                    </Button>
                </div>
            </div>

            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    {isSuperAdmin ? `Current Admins (${currentAdmins.length})` : `Your Club Admins (${currentAdmins.length})`}
                </h2>

                <div className="space-y-3">
                    {currentAdmins.map((admin) => {
                        const canShowDelete =
                            admin.id !== currentUserId && (isSuperAdmin || (isClubAdmin && admin.role === 'event_volunteer'));

                        return (
                            <div key={admin.id} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-foreground">{admin.full_name}</h3>
                                    <p className="text-sm text-muted-foreground">{admin.email ?? 'Hidden'}</p>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`px-3 py-1 rounded-full text-xs font-semibold ${roleColors[admin.role] || 'bg-gray-100 text-gray-800'
                                                }`}
                                        >
                                            {admin.role.replace('_', ' ').toUpperCase()}
                                        </span>

                                        {(admin.role === 'club_admin' || admin.role === 'event_volunteer') && admin.club_name && (
                                            <span className="text-xs text-muted-foreground">• {admin.club_name}</span>
                                        )}
                                    </div>

                                    {canShowDelete && (
                                        <Button
                                            onClick={() => handleRemoveAdmin(admin.id, admin.role)}
                                            disabled={removingId === admin.id}
                                            variant="outline"
                                            size="sm"
                                            className="border-red-300 text-red-600 hover:bg-red-50"
                                        >
                                            {removingId === admin.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="h-4 w-4" />
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
