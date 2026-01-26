'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const [rtNonce, setRtNonce] = useState(0);
  const supabase = useMemo(() => createClient(), []);

  const mountedRef = useRef(true);

  const loadingRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const retryRef = useRef<{ tries: number; timer: ReturnType<typeof setTimeout> | null }>({
    tries: 0,
    timer: null,
  });

  useEffect(() => {
    mountedRef.current = true;

    // Copy refs to locals for cleanup stability (satisfies eslint warning)
    const retry = retryRef;
    const reloadDebounce = reloadDebounceRef;
    const activeAbort = activeAbortRef;

    return () => {
      mountedRef.current = false;

      if (retry.current.timer) {
        clearTimeout(retry.current.timer);
        retry.current.timer = null;
      }

      if (reloadDebounce.current) {
        clearTimeout(reloadDebounce.current);
        reloadDebounce.current = null;
      }

      if (activeAbort.current) {
        activeAbort.current.abort();
        activeAbort.current = null;
      }
    };
  }, []);

  const scheduleResubscribe = useCallback((reason: string) => {
    if (!mountedRef.current) return;

    // Option A: use the param (no lint warning)
    // If you don't want logs, keep this "void reason" line.
    void reason;

    // (Optional) enable when debugging:
    // console.debug('[NotificationCenter] resubscribe due to:', reason);

    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer);
      retryRef.current.timer = null;
    }

    retryRef.current.tries = Math.min(retryRef.current.tries + 1, 6);
    const delay = Math.min(1000 * Math.pow(2, retryRef.current.tries - 1), 30000);

    retryRef.current.timer = setTimeout(() => {
      if (!mountedRef.current) return;
      setRtNonce((n) => n + 1);
    }, delay);
  }, []);

  const resetBackoff = useCallback(() => {
    retryRef.current.tries = 0;
    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer);
      retryRef.current.timer = null;
    }
  }, []);

  const loadNotifications = useCallback(
    async function doLoadNotifications(uid: string) {
      if (!uid) return;

      if (loadingRef.current) {
        pendingReloadRef.current = true;
        return;
      }
      loadingRef.current = true;

      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
        activeAbortRef.current = null;
      }

      const controller = new AbortController();
      activeAbortRef.current = controller;

      const myReqId = ++requestIdRef.current;
      const t = setTimeout(() => controller.abort(), 10_000);

      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('id,title,message,type,related_id,read,created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(20)
          .abortSignal(controller.signal);

        if (error) {
          const msg = String((error as any)?.message || '').toLowerCase();
          const code = String((error as any)?.code || '').toLowerCase();
          const details = typeof (error as any)?.details === 'string' ? (error as any).details : '';
          const hint = typeof (error as any)?.hint === 'string' ? (error as any).hint : '';
          const aborted = controller.signal.aborted;

          const isEmptyError = !!error && !msg && !code && !details && !hint;

          const isTransient =
            aborted ||
            isEmptyError ||
            msg.includes('abort') ||
            msg.includes('canceled') ||
            msg.includes('cancelled') ||
            msg.includes('fetch') ||
            msg.includes('failed to fetch') ||
            msg.includes('network') ||
            msg.includes('connection') ||
            msg.includes('load failed') ||
            msg.includes('timeout');

          if (!isTransient) {
            console.error('Failed to load notifications:', error, {
              message: (error as any)?.message,
              details,
              hint,
              code: (error as any)?.code,
            });
          }
          return;
        }

        if (!mountedRef.current) return;
        if (userIdRef.current !== uid) return;
        if (myReqId !== requestIdRef.current) return;

        const list = (data as Notification[]) || [];
        setNotifications(list);
        setUnreadCount(list.filter((n) => !n.read).length);
      } catch (err: any) {
        const name = String(err?.name || '');
        const msg = String(err?.message || '').toLowerCase();

        const isTransient =
          name === 'AbortError' ||
          msg.includes('failed to fetch') ||
          msg.includes('network') ||
          msg.includes('timeout');

        if (!isTransient) {
          console.error('Failed to load notifications (thrown):', err);
        }
      } finally {
        clearTimeout(t);

        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }

        loadingRef.current = false;

        if (pendingReloadRef.current && mountedRef.current && userIdRef.current === uid) {
          pendingReloadRef.current = false;

          if (!reloadDebounceRef.current) {
            reloadDebounceRef.current = setTimeout(() => {
              reloadDebounceRef.current = null;
              if (!mountedRef.current) return;
              if (userIdRef.current !== uid) return;
              void doLoadNotifications(uid);
            }, 250);
          }
        } else {
          pendingReloadRef.current = false;
        }
      }
    },
    [supabase],
  );

  const scheduleLoadNotifications = useCallback(
    (uid: string) => {
      if (!uid || !mountedRef.current) return;

      if (loadingRef.current) {
        pendingReloadRef.current = true;
        return;
      }

      if (reloadDebounceRef.current) return;

      reloadDebounceRef.current = setTimeout(() => {
        reloadDebounceRef.current = null;
        if (!mountedRef.current) return;
        if (userIdRef.current !== uid) return;
        void loadNotifications(uid);
      }, 250);
    },
    [loadNotifications],
  );

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') setRtNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      setUserId(sessionData.session?.user?.id ?? null);

      try {
        const { data: userData } = await supabase.auth.getUser();
        if (cancelled) return;
        if (userData.user?.id) setUserId(userData.user.id);
      } catch {
        // ignore
      }
    };

    void init();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user?.id ?? null;

      if (event === 'SIGNED_OUT') {
        setUserId(null);
        setIsOpen(false);
        setNotifications([]);
        setUnreadCount(0);

        loadingRef.current = false;
        pendingReloadRef.current = false;

        if (reloadDebounceRef.current) {
          clearTimeout(reloadDebounceRef.current);
          reloadDebounceRef.current = null;
        }

        if (activeAbortRef.current) {
          activeAbortRef.current.abort();
          activeAbortRef.current = null;
        }

        resetBackoff();
        return;
      }

      if (nextId) setUserId(nextId);

      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        setRtNonce((n) => n + 1);
      }
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
    };
  }, [supabase, resetBackoff]);

  useEffect(() => {
    if (!userId) return;

    void loadNotifications(userId);

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
          scheduleLoadNotifications(userId);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          resetBackoff();
          scheduleLoadNotifications(userId);
          return;
        }

        if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          scheduleResubscribe(status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, rtNonce, loadNotifications, scheduleLoadNotifications, scheduleResubscribe, resetBackoff]);

  const markAsRead = async (id: string) => {
    if (!userId) return;

    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) {
      console.error('Failed to mark notification as read:', error);
      return;
    }

    scheduleLoadNotifications(userId);
  };

  const markAllAsRead = async () => {
    if (!userId) return;

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      console.error('Failed to mark all notifications as read:', error);
      return;
    }

    scheduleLoadNotifications(userId);
  };

  const deleteNotification = async (id: string, e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;

    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete notification:', error);
      return;
    }

    scheduleLoadNotifications(userId);
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

          <div className="absolute right-0 mt-2 w-96 bg-background border border-border rounded-lg shadow-2xl z-[1100] max-h-[600px] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between bg-background rounded-t-lg">
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
                  <p className="text-sm mt-1 text-muted-foreground">Follow clubs to get notified about new events and news</p>
                </div>
              ) : (
                notifications.map((notif) => {
                  const href = getNotificationLink(notif);

                  return (
                    <div
                      key={notif.id}
                      className={[
                        'relative group p-4 hover:bg-muted transition cursor-pointer',
                        !notif.read ? 'bg-blue-50 dark:bg-blue-950/30 border-l-4 border-l-blue-500' : 'bg-background',
                      ].join(' ')}
                    >
                      <Link
                        href={href}
                        aria-label={`Open notification: ${notif.title}`}
                        className="absolute inset-0 z-0"
                        onClick={() => {
                          if (!notif.read) void markAsRead(notif.id);
                          setIsOpen(false);
                        }}
                      />

                      <div className="flex items-start justify-between relative z-10 pointer-events-none">
                        <div className="flex-1 pr-2 pointer-events-none">
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
                          type="button"
                          aria-label="Delete notification"
                          onClick={(e) => void deleteNotification(notif.id, e)}
                          className="opacity-0 group-hover:opacity-100 transition p-1 hover:bg-muted rounded pointer-events-auto"
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
