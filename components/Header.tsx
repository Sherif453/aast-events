"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { User as UserIcon, LogOut, ChevronDown, Loader2, Trophy, Shield, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import NotificationCenter from "./NotificationCenter";

const SESSION_TIMEOUT_MS = 10000; // Increased to 10s for very slow connections
const DB_TIMEOUT_MS = 10000; // Increased to 10s for very slow connections

// Absolute maximum time before we give up and show something
const ABSOLUTE_MAX_BOOT_MS = 15000; // 15 seconds hard limit

// Longer cache for stability
const CACHE_TTL_MS = 60_000; // 1 minute

type HeaderUser = {
    id: string;
    email: string | null;
    full_name: string | null;
    avatar_url: string | null;
};

type TimeoutResult<T> =
    | { ok: true; value: T }
    | { ok: false; timedOut: true; label: string }
    | { ok: false; timedOut: false; label: string; error: unknown };

async function runWithTimeout<T>(fn: () => Promise<T>, ms: number, label: string): Promise<TimeoutResult<T>> {
    let tid: any;
    try {
        const result = await Promise.race([
            fn(),
            new Promise<never>((_resolve, reject) => {
                tid = setTimeout(() => reject(new Error(label)), ms);
            }),
        ]);
        clearTimeout(tid);
        return { ok: true, value: result as T };
    } catch (e: any) {
        clearTimeout(tid);
        if (e instanceof Error && e.message === label) return { ok: false, timedOut: true, label };
        return { ok: false, timedOut: false, label, error: e };
    }
}

const getInitials = (fullName: string | null) => {
    if (!fullName) return "?";
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

interface ProfileDropdownProps {
    userFullName: string | null;
    userEmail: string | null;
    userAvatarUrl: string | null;
    isAdmin: boolean;
    onLogout: () => Promise<void>;
}

const ProfileDropdown: React.FC<ProfileDropdownProps> = ({
    userFullName,
    userEmail,
    userAvatarUrl,
    isAdmin,
    onLogout,
}) => {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!isOpen) return;
            const target = e.target as HTMLElement | null;
            if (!target?.closest(".profile-dropdown-container")) setIsOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [isOpen]);

    const initials = getInitials(userFullName);
    const emailToShow = (userEmail ?? "").trim() || "No email";

    return (
        <div className="relative profile-dropdown-container">
            <button
                onClick={() => setIsOpen((s) => !s)}
                className="flex items-center space-x-2 p-1.5 rounded-full hover:bg-muted transition-colors focus:outline-none"
                aria-expanded={isOpen}
            >
                <Avatar className="h-8 w-8 ring-2 ring-[#FFC333]/50">
                    <AvatarImage src={userAvatarUrl || undefined} alt={userFullName || "User"} />
                    <AvatarFallback className="bg-[#00386C] text-white text-xs font-bold">{initials}</AvatarFallback>
                </Avatar>

                <span className="hidden sm:inline text-sm font-semibold text-foreground max-w-[150px] truncate">
                    {userFullName || "Profile"}
                </span>

                <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : "rotate-0"
                        }`}
                />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-[1090]" onClick={() => setIsOpen(false)} />

                    <div
                        className="absolute right-0 mt-2 w-72 origin-top-right rounded-xl bg-background shadow-2xl ring-1 ring-border divide-y divide-border z-[1100] border border-border"
                        style={{ backgroundColor: "hsl(var(--background))" }}
                    >
                        <div className="p-4 space-y-1 bg-background">
                            <p className="text-base font-bold text-foreground truncate">{userFullName || "Student"}</p>
                            <p className="text-sm text-muted-foreground truncate">{emailToShow}</p>
                        </div>

                        <div className="py-1 bg-background">
                            <Link
                                href="/profile"
                                onClick={() => setIsOpen(false)}
                                className="flex items-center px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                                role="menuitem"
                            >
                                <UserIcon className="mr-3 h-4 w-4" />
                                <span>View Profile</span>
                            </Link>

                            {isAdmin && (
                                <Link
                                    href="/admin"
                                    onClick={() => setIsOpen(false)}
                                    className="flex items-center px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors font-semibold"
                                    role="menuitem"
                                >
                                    <Shield className="mr-3 h-4 w-4" />
                                    <span>Admin Dashboard</span>
                                </Link>
                            )}

                            <button
                                onClick={async () => {
                                    try {
                                        await onLogout();
                                    } finally {
                                        setIsOpen(false);
                                    }
                                }}
                                className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors rounded-b-xl"
                                role="menuitem"
                            >
                                <LogOut className="mr-3 h-4 w-4" />
                                <span>Log Out</span>
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export function Header() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);

    const [ready, setReady] = useState(false);
    const [user, setUser] = useState<HeaderUser | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    const mountedRef = useRef(false);
    const reqIdRef = useRef(0);

    // ✅ FIX: Separate bootstrap flag to prevent auth listener conflicts
    const bootstrappedRef = useRef(false);

    // Cache with proper structure
    const cacheRef = useRef<{
        userId: string | null;
        ts: number;
        profile: { full_name: string | null; avatar_url: string | null; email: string | null } | null;
        isAdmin: boolean;
    }>({ userId: null, ts: 0, profile: null, isAdmin: false });

    const safeSet = useCallback((fn: () => void) => {
        if (!mountedRef.current) return;
        fn();
    }, []);

    /**
     * ✅ FIX: Improved cache check - validates userId AND freshness
     */
    const getCachedData = useCallback((userId: string) => {
        const c = cacheRef.current;
        if (c.userId !== userId) return null;
        if (!c.profile) return null;
        if (Date.now() - c.ts > CACHE_TTL_MS) return null;
        return c;
    }, []);

    /**
     * ✅ FIX: Single source of truth for fetching user data with retry
     */
    const fetchUserData = useCallback(
        async (userId: string, opts?: { useCache?: boolean }) => {
            const myReq = ++reqIdRef.current;

            // Check cache first if allowed
            if (opts?.useCache) {
                const cached = getCachedData(userId);
                if (cached) {
                    safeSet(() => {
                        setIsAdmin(cached.isAdmin);
                        setUser({
                            id: userId,
                            email: cached.profile!.email,
                            full_name: cached.profile!.full_name || "Student",
                            avatar_url: cached.profile!.avatar_url,
                        });
                    });
                    return true;
                }
            }

            // Fetch from DB with retry
            const MAX_RETRIES = 1;
            let attempt = 0;

            while (attempt <= MAX_RETRIES) {
                attempt++;

                const dbRes = await runWithTimeout(
                    async () => {
                        const [adminQ, profileQ] = await Promise.all([
                            supabase.from("admin_users").select("role").eq("id", userId).maybeSingle(),
                            supabase.from("profiles").select("full_name, avatar_url, email").eq("id", userId).maybeSingle(),
                        ]);
                        return [adminQ, profileQ];
                    },
                    DB_TIMEOUT_MS,
                    "header_db_timeout"
                );

                if (!mountedRef.current || myReq !== reqIdRef.current) return false;

                if (!dbRes.ok) {
                    // Retry on timeout
                    if (dbRes.timedOut && attempt <= MAX_RETRIES) {
                        console.warn(`[Header] DB timeout, retrying (${attempt}/${MAX_RETRIES + 1})...`);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        continue;
                    }

                    if (!dbRes.timedOut) {
                        console.error("[Header] DB fetch error:", dbRes.error);
                    }
                    // ✅ FIX: On timeout, keep existing user data if available
                    return false;
                }

                const [adminQ, profileQ] = dbRes.value as any[];

                if (adminQ?.error) console.error("[Header] admin_users error:", adminQ.error);
                if (profileQ?.error) console.error("[Header] profiles error:", profileQ.error);

                const profileRow = profileQ?.data ?? null;
                const isAdminUser = Boolean(adminQ?.data);

                // ✅ FIX: Update cache with fetched data
                cacheRef.current = {
                    userId,
                    ts: Date.now(),
                    profile: profileRow
                        ? {
                            full_name: profileRow.full_name ?? null,
                            avatar_url: profileRow.avatar_url ?? null,
                            email: profileRow.email ?? null,
                        }
                        : null,
                    isAdmin: isAdminUser,
                };

                safeSet(() => {
                    setIsAdmin(isAdminUser);
                    setUser({
                        id: userId,
                        email: profileRow?.email ?? null,
                        full_name: profileRow?.full_name || "Student",
                        avatar_url: profileRow?.avatar_url ?? null,
                    });
                });

                return true;
            }

            return false;
        },
        [supabase, safeSet, getCachedData]
    );

    /**
     * ✅ FIX: Simplified session refresh
     */
    const refreshSession = useCallback(
        async (reason: string, opts?: { useCache?: boolean }) => {
            const myReq = ++reqIdRef.current;

            const sessionRes = await runWithTimeout(
                async () => await supabase.auth.getSession(),
                SESSION_TIMEOUT_MS,
                "getSession_timeout"
            );

            if (!mountedRef.current || myReq !== reqIdRef.current) return;

            if (!sessionRes.ok) {
                if (!sessionRes.timedOut) {
                    console.error(`[Header] getSession error (${reason}):`, sessionRes.error);
                }
                return;
            }

            const sessionUser = sessionRes.value.data.session?.user ?? null;

            if (!sessionUser) {
                // ✅ FIX: Only clear if we're sure there's no session
                // Don't clear on transient failures during tab switch
                if (reason === "auth_state_change" || reason === "boot") {
                    safeSet(() => {
                        setUser(null);
                        setIsAdmin(false);
                    });
                }
                return;
            }

            await fetchUserData(sessionUser.id, { useCache: Boolean(opts?.useCache) });
        },
        [supabase, fetchUserData, safeSet]
    );

    const handleLogout = useCallback(async () => {
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.error("Sign out failed:", e);
        } finally {
            window.location.href = "/";
        }
    }, [supabase]);

    // ✅ FIX: Bootstrap ONCE with retry + absolute timeout failsafe
    useEffect(() => {
        if (bootstrappedRef.current) return;

        mountedRef.current = true;
        bootstrappedRef.current = true;

        let cancelled = false;

        // ✅ CRITICAL: Absolute failsafe - if we're not ready after 15s, force ready state
        const failsafeTimeout = setTimeout(() => {
            if (!mountedRef.current || cancelled) return;
            console.warn("[Header boot] Failsafe triggered - forcing ready state");
            safeSet(() => setReady(true));
        }, ABSOLUTE_MAX_BOOT_MS);

        (async () => {
            const MAX_RETRIES = 2;
            let attempt = 0;

            while (attempt <= MAX_RETRIES && !cancelled) {
                attempt++;

                try {
                    const sessionRes = await runWithTimeout(
                        async () => await supabase.auth.getSession(),
                        SESSION_TIMEOUT_MS,
                        "boot_timeout"
                    );

                    if (cancelled || !mountedRef.current) {
                        clearTimeout(failsafeTimeout);
                        return;
                    }

                    if (!sessionRes.ok) {
                        // If timeout and we have retries left, try again
                        if (sessionRes.timedOut && attempt <= MAX_RETRIES) {
                            console.warn(`[Header boot] Timeout on attempt ${attempt}/${MAX_RETRIES + 1}, retrying...`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                            continue;
                        }

                        // Give up after retries
                        console.error("[Header boot] Failed after retries:", sessionRes.timedOut ? "timeout" : sessionRes.error);
                        clearTimeout(failsafeTimeout);
                        safeSet(() => setReady(true));
                        return;
                    }

                    const sessionUser = sessionRes.value.data.session?.user ?? null;

                    if (!sessionUser) {
                        clearTimeout(failsafeTimeout);
                        safeSet(() => {
                            setUser(null);
                            setIsAdmin(false);
                            setReady(true);
                        });
                        return;
                    }

                    // Bootstrap with fresh data (no cache)
                    await fetchUserData(sessionUser.id, { useCache: false });

                    clearTimeout(failsafeTimeout);
                    safeSet(() => setReady(true));
                    return; // Success, exit loop

                } catch (e) {
                    if (attempt <= MAX_RETRIES) {
                        console.warn(`[Header boot] Exception on attempt ${attempt}/${MAX_RETRIES + 1}, retrying...`, e);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        continue;
                    }

                    console.error("[Header boot] Exception after retries:", e);
                    clearTimeout(failsafeTimeout);
                    safeSet(() => setReady(true));
                    return;
                }
            }
        })();

        return () => {
            cancelled = true;
            clearTimeout(failsafeTimeout);
            mountedRef.current = false;
        };
    }, [supabase, fetchUserData, safeSet]);

    // ✅ FIX: Auth state listener - only after bootstrap
    useEffect(() => {
        if (!ready || !bootstrappedRef.current) return;

        const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mountedRef.current) return;

            // ✅ FIX: Handle SIGNED_OUT explicitly
            if (event === "SIGNED_OUT") {
                safeSet(() => {
                    setUser(null);
                    setIsAdmin(false);
                    cacheRef.current = { userId: null, ts: 0, profile: null, isAdmin: false };
                });
                router.refresh();
                return;
            }

            const sessionUser = session?.user ?? null;

            if (sessionUser) {
                // ✅ FIX: Use cache for auth state changes (tab switches)
                await fetchUserData(sessionUser.id, { useCache: true });
            }
        });

        return () => listener?.subscription?.unsubscribe();
    }, [supabase, ready, fetchUserData, safeSet, router]);

    // ✅ FIX: Tab visibility - use cache aggressively
    useEffect(() => {
        if (!ready) return;

        let timeoutId: any = null;

        const handleVisibilityChange = () => {
            if (document.visibilityState !== "visible") return;
            if (!user?.id) return;

            // Debounce
            if (timeoutId) clearTimeout(timeoutId);

            timeoutId = setTimeout(() => {
                refreshSession("visibility_change", { useCache: true });
            }, 150);
        };

        const handleFocus = () => {
            if (!user?.id) return;

            if (timeoutId) clearTimeout(timeoutId);

            timeoutId = setTimeout(() => {
                refreshSession("focus", { useCache: true });
            }, 150);
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("focus", handleFocus);

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("focus", handleFocus);
        };
    }, [ready, user?.id, refreshSession]);

    // ✅ FIX: Profile changed event - invalidate cache and force refresh
    useEffect(() => {
        if (!ready) return;

        const handleProfileChanged = () => {
            // Invalidate cache
            cacheRef.current.ts = 0;

            // Force refresh without cache
            refreshSession("profile_changed", { useCache: false });
        };

        window.addEventListener("aast-profile-changed", handleProfileChanged);
        return () => window.removeEventListener("aast-profile-changed", handleProfileChanged);
    }, [ready, refreshSession]);

    return (
        <header
            className="sticky top-0 z-[1000] bg-background shadow-md border-b border-border isolation-isolate"
            style={{ backgroundColor: "hsl(var(--background))" }}
        >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <Link href="/" className="flex items-center space-x-3 text-[#00386C] hover:text-[#002040] transition-colors">
                        <div className="bg-[#00386C] rounded-md p-1.5">
                            <span className="text-white font-black text-xl leading-none">A</span>
                        </div>
                        <span className="text-xl font-bold tracking-tight text-foreground">AAST Events</span>
                    </Link>

                    <Link
                        href="/leaderboard"
                        className="hidden md:flex items-center gap-2 text-sm font-semibold text-foreground hover:text-[#00386C] transition-colors"
                    >
                        <Trophy className="h-4 w-4" />
                        Leaderboard
                    </Link>

                    <Link
                        href="/clubs"
                        className="hidden md:flex items-center gap-2 text-sm font-semibold text-foreground hover:text-[#00386C] transition-colors"
                    >
                        <Users className="h-4 w-4" />
                        Clubs
                    </Link>

                    {user && isAdmin && (
                        <Link
                            href="/admin"
                            className="hidden md:flex items-center gap-2 text-sm font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 transition-colors"
                        >
                            <Shield className="h-4 w-4" />
                            Admin Dashboard
                        </Link>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {user && <NotificationCenter />}

                    {!ready ? (
                        <div className="flex items-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                            <span className="text-sm">Loading...</span>
                        </div>
                    ) : user ? (
                        <ProfileDropdown
                            userFullName={user.full_name}
                            userEmail={user.email}
                            userAvatarUrl={user.avatar_url}
                            isAdmin={isAdmin}
                            onLogout={handleLogout}
                        />
                    ) : (
                        <Link
                            href="/auth/login"
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-full shadow-sm text-white bg-[#00386C] hover:bg-[#002040] transition-colors"
                        >
                            <UserIcon className="h-4 w-4 mr-2" />
                            Log In
                        </Link>
                    )}
                </div>
            </div>
        </header>
    );
}