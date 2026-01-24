"use client";

import { useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AuthProfileSync() {
  const supabase = useMemo(() => createClient(), []);
  const runningRef = useRef(false);

  const maybeSync = async (opts?: { force?: boolean }) => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.user?.id) return;

      const userId = session.user.id;
      const successKey = `aast_profile_sync_ok_${userId}`;
      const attemptKey = `aast_profile_sync_try_${userId}`;

      // Throttle:
      // - if last successful sync was recent, skip (10 minutes)
      // - if last attempt was very recent, skip (2 minutes) unless forced
      const now = Date.now();
      const lastOk = Number(localStorage.getItem(successKey) || "0");
      if (now - lastOk < 10 * 60 * 1000) return;

      const lastTry = Number(localStorage.getItem(attemptKey) || "0");
      if (!opts?.force && now - lastTry < 2 * 60 * 1000) return;

      const res = await fetch("/api/auth/sync-profile", { method: "POST" });
      if (!res.ok) return;

      const json = (await res.json().catch(() => null)) as any;
      if (json?.ok && json?.googleLinked) {
        localStorage.setItem(successKey, String(now));
        localStorage.removeItem(attemptKey);

        // Refresh Header/UI even if the email already existed (no-op write),
        // because caches may still show stale profile values.
        window.dispatchEvent(new Event("aast-profile-changed"));
      } else {
        // Record a recent attempt so phone-only users don't spam the endpoint.
        localStorage.setItem(attemptKey, String(now));
      }
    } finally {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    void maybeSync();

    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_IN" || evt === "TOKEN_REFRESHED") {
        void maybeSync({ force: true });
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
