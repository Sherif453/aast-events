'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import type { PostgrestSingleResponse } from "@supabase/supabase-js";

const REMINDER_TYPES = ['1_day', '1_hour'] as const;

type Props = {
  eventId: number | string;      // bigint in DB
  initialUserId?: string | null; // optional server-provided user id
};

type PostgrestBuilderLike<T> = PromiseLike<PostgrestSingleResponse<T>> & {
  abortSignal?: (signal: AbortSignal) => PostgrestBuilderLike<T>;
};

export default function EventReminderButton({ eventId, initialUserId }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const eventIdNum = useMemo(() => {
    const n = typeof eventId === 'number' ? eventId : Number(eventId);
    return Number.isFinite(n) ? n : null;
  }, [eventId]);

  const [hasReminder, setHasReminder] = useState(false);
  const [userId, setUserId] = useState<string | null>(initialUserId ?? null);
  const [sessionChecked, setSessionChecked] = useState(initialUserId !== undefined);
  const [busy, setBusy] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const postgrestWithTimeout = useCallback(
    async <T,>(builder: PostgrestBuilderLike<T>, ms: number, label: string): Promise<PostgrestSingleResponse<T>> => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);

      try {
        const res = await (typeof builder.abortSignal === 'function' ? builder.abortSignal(controller.signal) : builder);
        return res;
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : String((err as { name?: unknown } | null)?.name ?? '');
        if (name === 'AbortError') throw new Error(label);
        throw err;
      } finally {
        clearTimeout(t);
      }
    },
    []
  );

  const checkReminder = useCallback(
    async (uid: string) => {
      if (eventIdNum == null) return;

      try {
        const { data, error } = await postgrestWithTimeout(
          supabase
            .from('event_reminders')
            .select('id')
            .eq('user_id', uid)
            .eq('event_id', eventIdNum)
            .in('reminder_type', [...REMINDER_TYPES]),
          8000,
          'reminder_check_timeout'
        );

        if (error) throw error;
        if (!mountedRef.current) return;

        setHasReminder((data?.length ?? 0) > 0);
      } catch (e) {
        console.warn('[EventReminderButton] checkReminder failed (non-fatal):', e);
        if (!mountedRef.current) return;
        setHasReminder(false);
      }
    },
    [supabase, eventIdNum, postgrestWithTimeout]
  );

  useEffect(() => {
    let active = true;

    const init = async () => {
      if (eventIdNum == null) {
        if (active) setSessionChecked(true);
        return;
      }

      // If server already provided userId, avoid loading flicker
      if (initialUserId !== undefined) {
        if (initialUserId) void checkReminder(initialUserId);
        if (active) setSessionChecked(true);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;

      const sid = sessionData.session?.user?.id ?? null;
      if (sid) {
        setUserId(sid);
        void checkReminder(sid);
      }
      setSessionChecked(true);

      // best-effort verification (does not “log out” UI on failure)
      void (async () => {
        try {
          const { data: userData } = await supabase.auth.getUser();
          if (!active) return;
          if (userData.user?.id) {
            setUserId(userData.user.id);
            void checkReminder(userData.user.id);
          }
        } catch {
          // ignore
        }
      })();
    };

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && nextUserId) {
        setSessionChecked(true);
        setUserId(nextUserId);
        void checkReminder(nextUserId);
      }

      if (event === 'SIGNED_OUT') {
        setSessionChecked(true);
        setUserId(null);
        setHasReminder(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, checkReminder, initialUserId, eventIdNum]);

  const toggleReminder = async () => {
    if (eventIdNum == null) {
      alert('Invalid event id');
      return;
    }

    if (!userId) {
      const next = `/event/${eventIdNum}`;
      router.push(`/auth/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (busy) return;
    setBusy(true);

    try {
      if (hasReminder) {
        const { error } = await postgrestWithTimeout<null>(
          supabase
            .from('event_reminders')
            .delete()
            .eq('user_id', userId)
            .eq('event_id', eventIdNum)
            .in('reminder_type', [...REMINDER_TYPES]),
          10_000,
          'reminder_delete_timeout'
        );

        if (error) throw error;
        if (mountedRef.current) setHasReminder(false);
      } else {
        const rows = REMINDER_TYPES.map((reminder_type) => ({
          user_id: userId,
          event_id: eventIdNum,
          reminder_type,
        }));

        // ignoreDuplicates => no UPDATE perms needed for “set again”
        const { error } = await postgrestWithTimeout<null>(
          supabase
            .from('event_reminders')
            .upsert(rows, {
              onConflict: 'user_id,event_id,reminder_type',
              ignoreDuplicates: true,
            }),
          10_000,
          'reminder_upsert_timeout'
        );

        if (error) throw error;
        if (mountedRef.current) setHasReminder(true);
      }

      router.refresh();
    } catch (err) {
      console.error('[EventReminderButton] toggle failed:', err);
      alert('Failed to update reminder. Please try again.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const label = !sessionChecked
    ? 'Loading...'
    : !userId
      ? 'Login to set reminders'
      : hasReminder
        ? 'Reminder Set'
        : 'Remind Me (1d + 1h)';

  return (
    <Button
      onClick={toggleReminder}
      variant={hasReminder ? 'default' : 'outline'}
      size="sm"
      disabled={!sessionChecked || busy || eventIdNum == null}
    >
      {!sessionChecked || busy ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : hasReminder ? (
        <BellOff className="h-4 w-4 mr-2" />
      ) : (
        <Bell className="h-4 w-4 mr-2" />
      )}
      {busy ? 'Saving...' : label}
    </Button>
  );
}
