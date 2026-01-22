'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Bell, X } from 'lucide-react';
import { Button } from './ui/button';
import Link from 'next/link';

interface Notification {
    id: string;
    title: string;
    message: string;
    type: string;
    related_id: string | null;
    read: boolean;
    created_at: string;
}

export default function NotificationCenter() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    // ✅ Create ONE Supabase client instance for the lifetime of this component
    const supabase = useMemo(() => createClient(), []);

    const loadNotifications = useCallback(async (uid: string) => {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            // ✅ Optional: don’t spam console on transient dev/network disconnects
            const msg = (error as any)?.message?.toLowerCase?.() || '';
            const isTransient =
                msg.includes('fetch') ||
                msg.includes('failed to fetch') ||
                msg.includes('network') ||
                msg.includes('connection') ||
                msg.includes('load failed');

            if (!isTransient) {
                // ✅ Better log (so you actually see what Supabase returned)
                console.error('❌ Failed to load notifications:', {
                    message: (error as any)?.message,
                    details: (error as any)?.details,
                    hint: (error as any)?.hint,
                    code: (error as any)?.code,
                });
            }

            return;
        }

        setNotifications(data || []);
        setUnreadCount((data || []).filter((n) => !n.read).length);
    }, [supabase]);

    // ✅ Always keep userId in sync (works across refresh/login/logout)
    useEffect(() => {
        const init = async () => {
            const { data } = await supabase.auth.getUser();
            setUserId(data.user?.id ?? null);
        };
        init();

        const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUserId(session?.user?.id ?? null);
        });

        return () => {
            authSub.subscription.unsubscribe();
        };
    }, [supabase]);

    // ✅ Realtime subscription tied to userId
    useEffect(() => {
        if (!userId) return;

        loadNotifications(userId);

        const channel = supabase
            .channel(`notifications-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${userId}`,
                },
                () => {
                    loadNotifications(userId);
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    loadNotifications(userId);
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase, userId, loadNotifications]);

    const markAsRead = async (id: string) => {
        if (!userId) return;
        await supabase.from('notifications').update({ read: true }).eq('id', id);
        loadNotifications(userId);
    };

    const markAllAsRead = async () => {
        if (!userId) return;
        await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
        loadNotifications(userId);
    };

    const deleteNotification = async (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!userId) return;
        await supabase.from('notifications').delete().eq('id', id);
        loadNotifications(userId);
    };

    const getNotificationLink = (notif: Notification) => {
        if (notif.type === 'event_reminder' && notif.related_id) return `/event/${notif.related_id}`;
        if (notif.type === 'club_news' && notif.related_id) return `/clubs/${notif.related_id}`;
        if (notif.type === 'event_update' && notif.related_id) return `/event/${notif.related_id}`;
        if (notif.type === 'club_announcement' && notif.related_id) return `/clubs/${notif.related_id}`;
        if (notif.type === 'new_club_event' && notif.related_id) return `/event/${notif.related_id}`;
        return '#';
    };

    if (!userId) return null;

    return (
        <div className="relative">
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(!isOpen)} className="relative hover:bg-muted">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-semibold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </Button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[1090]" onClick={() => setIsOpen(false)} />

                    <div
                        className="absolute right-0 mt-2 w-96 bg-background border border-border rounded-lg shadow-2xl z-[1100] max-h-[600px] flex flex-col"
                        style={{ backgroundColor: 'hsl(var(--background))' }}
                    >
                        <div
                            className="p-4 border-b border-border flex items-center justify-between bg-background rounded-t-lg"
                            style={{ backgroundColor: 'hsl(var(--background))' }}
                        >
                            <h3 className="font-bold text-foreground text-lg">Notifications</h3>
                            <div className="flex items-center gap-2">
                                {unreadCount > 0 && (
                                    <Button variant="ghost" size="sm" onClick={markAllAsRead} className="text-xs">
                                        Mark all read
                                    </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="h-8 w-8 p-0">
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="divide-y divide-border overflow-y-auto flex-1">
                            {notifications.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">
                                    <Bell className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                                    <p className="font-medium text-foreground">No notifications yet</p>
                                    <p className="text-sm mt-1 text-muted-foreground">
                                        Follow clubs to get notified about new events and news
                                    </p>
                                </div>
                            ) : (
                                notifications.map((notif) => (
                                    <Link
                                        key={notif.id}
                                        href={getNotificationLink(notif)}
                                        onClick={() => {
                                            if (!notif.read) markAsRead(notif.id);
                                            setIsOpen(false);
                                        }}
                                        className={[
                                            'block p-4 hover:bg-muted transition relative group',
                                            !notif.read
                                                ? 'bg-blue-50 dark:bg-blue-950/30 border-l-4 border-l-blue-500'
                                                : 'bg-background',
                                        ].join(' ')}
                                        style={!notif.read ? undefined : { backgroundColor: 'hsl(var(--background))' }}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 pr-2">
                                                <h4
                                                    className={[
                                                        'text-sm mb-1',
                                                        !notif.read ? 'font-bold text-foreground' : 'font-semibold text-foreground',
                                                    ].join(' ')}
                                                >
                                                    {notif.title}
                                                </h4>

                                                <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{notif.message}</p>

                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(notif.created_at).toLocaleString('en-US', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </p>
                                            </div>

                                            <button
                                                onClick={(e) => deleteNotification(notif.id, e)}
                                                className="opacity-0 group-hover:opacity-100 transition p-1 hover:bg-muted rounded"
                                            >
                                                <X className="h-4 w-4 text-muted-foreground" />
                                            </button>
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
