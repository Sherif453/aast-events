import { createClient } from '@/lib/supabase/server';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trophy, Medal, Award, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { computeAttendanceTierBadge, badgeToneClass } from '@/lib/badges';
import { BadgeIcon } from '@/lib/badge-icons';

export const revalidate = 60;

interface LeaderboardUser {
    user_id: string;
    full_name: string;
    avatar_url: string;
    email?: string; // only for super_admin
    event_count: number;
    month_count: number;
}

type CheckedInAttendeeRow = { user_id: string; checked_in_at: string | null };
type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null; email?: string | null };
type PrivacyRow = { user_id: string; hide_from_leaderboard: boolean | null };

export default async function LeaderboardPage() {
    const supabase = await createClient();

    //  check if current viewer is super_admin (needed for showing emails)
    const {
        data: { user },
    } = await supabase.auth.getUser();

    let isSuperAdminViewer = false;
    if (user?.id) {
        const { data: adminRow } = await supabase
            .from('admin_users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

        isSuperAdminViewer = adminRow?.role === 'super_admin';
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    //  1) Get checked-in attendee rows (NO join)
    const { data: checkedInRows, error: checkedInErr } = await supabase
        .from('attendees')
        .select('user_id, checked_in_at')
        .eq('checked_in', true);

    if (checkedInErr) {
        console.error('Leaderboard attendees fetch error:', checkedInErr);
    }

    // Count per user (total + this month)
    const userEventCounts = new Map<string, number>();
    const userMonthCounts = new Map<string, number>();
    const checkedRows = (checkedInRows as unknown as CheckedInAttendeeRow[] | null) ?? [];
    checkedRows.forEach((r) => {
        userEventCounts.set(r.user_id, (userEventCounts.get(r.user_id) ?? 0) + 1);
        const ts = r.checked_in_at ? new Date(r.checked_in_at) : null;
        if (ts && ts >= monthStart) {
            userMonthCounts.set(r.user_id, (userMonthCounts.get(r.user_id) ?? 0) + 1);
        }
    });

    const userIds = Array.from(userEventCounts.keys());

    //  2) Fetch profiles:
    // - normal users: from profiles_public (safe)
    // - super_admin: from profiles (can see email via policy)
    const selectCols = isSuperAdminViewer
        ? 'id, full_name, avatar_url, email'
        : 'id, full_name, avatar_url';

    const { data: profilesData, error: profilesErr } = userIds.length
        ? isSuperAdminViewer
            ? await supabase.from('profiles').select(selectCols).in('id', userIds)
            : await supabase.from('profiles_public').select(selectCols).in('id', userIds)
        : { data: [], error: null };

    if (profilesErr) {
        console.error('Leaderboard profiles fetch error:', profilesErr);
    }

    const profileMap = new Map<string, ProfileRow>();
    const profileRows = (profilesData as unknown as ProfileRow[] | null) ?? [];
    profileRows.forEach((p) => profileMap.set(String(p.id), p));

    // Privacy: hide names/avatars from public leaderboards (non-super-admin viewers only).
    const { data: privacyRows, error: privacyErr } = userIds.length
        ? await supabase
            .from('user_privacy_settings')
            .select('user_id, hide_from_leaderboard')
            .in('user_id', userIds)
        : { data: [], error: null };

    if (privacyErr) {
        console.error('Leaderboard privacy fetch error:', privacyErr);
    }

    const privacyTyped = (privacyRows as unknown as PrivacyRow[] | null) ?? [];
    const hiddenFromLeaderboard = new Set<string>(
        privacyTyped.filter((r) => Boolean(r.hide_from_leaderboard)).map((r) => String(r.user_id))
    );

    const leaderboard: LeaderboardUser[] = userIds
        .map((user_id) => {
            const profile = profileMap.get(user_id);
            const hidePublic = !isSuperAdminViewer && hiddenFromLeaderboard.has(user_id);
            return {
                user_id,
                full_name: hidePublic ? 'Anonymous' : profile?.full_name || 'Anonymous',
                avatar_url: hidePublic ? '' : profile?.avatar_url || '',
                email: isSuperAdminViewer ? profile?.email || undefined : undefined,
                event_count: userEventCounts.get(user_id) ?? 0,
                month_count: userMonthCounts.get(user_id) ?? 0,
            };
        })
        .sort((a, b) => b.event_count - a.event_count)
        .slice(0, 50);

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map((n) => n.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const getRankIcon = (index: number) => {
        if (index === 0) return <Trophy className="h-6 w-6 text-yellow-500" />;
        if (index === 1) return <Medal className="h-6 w-6 text-gray-400" />;
        if (index === 2) return <Award className="h-6 w-6 text-orange-600" />;
        return null;
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-4xl mx-auto p-6">
                <div className="mb-8">
                    <Link
                        href="/"
                        className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-flex items-center gap-2"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Back to Events
                    </Link>

                    <h1 className="text-3xl font-bold text-foreground">🏆 Event Attendance Leaderboard</h1>
                    <p className="text-muted-foreground mt-2">
                        Top students by verified event attendance (checked-in only)
                    </p>
                </div>

                <div className="bg-card rounded-2xl shadow-lg border border-border">
                    {leaderboard.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground">
                            No verified attendees yet. Attend events and get checked in to appear here!
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {leaderboard.map((u, index) => (
                                <div
                                    key={u.user_id}
                                    className={`p-4 flex items-center gap-4 hover:bg-accent transition ${index < 3 ? 'bg-yellow-500/5 dark:bg-yellow-500/10' : ''
                                        }`}
                                >
                                    <div className="w-12 flex items-center justify-center">
                                        {getRankIcon(index) || (
                                            <span className="text-lg font-bold text-muted-foreground">
                                                #{index + 1}
                                            </span>
                                        )}
                                    </div>

                                    <Avatar className="h-12 w-12 ring-2 ring-blue-500/20">
                                        <AvatarImage src={u.avatar_url || ''} alt={u.full_name} />
                                        <AvatarFallback className="bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                                            {getInitials(u.full_name)}
                                        </AvatarFallback>
                                    </Avatar>

                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <p className="font-semibold text-foreground truncate">{u.full_name}</p>
                                            {(() => {
                                                // Leaderboard badges: only attendance tiers (start at 10 verified events).
                                                const top = computeAttendanceTierBadge(u.event_count);
                                                if (!top) return null;
                                                return (
                                                    <span
                                                        className={[
                                                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold shrink-0",
                                                            badgeToneClass(top.tone),
                                                        ].join(" ")}
                                                        title={top.description || top.label}
                                                    >
                                                        <BadgeIcon id={top.id} className="h-3.5 w-3.5" />
                                                        <span className="max-w-[140px] truncate">{top.label}</span>
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        {isSuperAdminViewer && u.email && (
                                            <p className="text-sm text-muted-foreground">{u.email}</p>
                                        )}
                                    </div>

                                    <div className="text-right">
                                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                            {u.event_count}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {u.event_count === 1 ? 'event' : 'events'}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
