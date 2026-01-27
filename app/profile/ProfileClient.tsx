"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import DarkModeToggle from "@/components/DarkModeToggle";
import type { User, UserIdentity } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    ChevronLeft,
    Mail,
    Calendar,
    CheckCircle,
    Edit2,
    Save,
    X,
    Phone,
    ShieldCheck,
    Link2,
    Unlink as UnlinkIcon,
    Trophy,
    EyeOff,
    Lock,
    Check,
} from "lucide-react";
import EventCalendar from "@/components/EventCalendar";
import { badgeToneClass, computeBadges, type Badge } from "@/lib/badges";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BadgeIcon } from "@/lib/badge-icons";
import UnoptimizedImage from "@/components/UnoptimizedImage";

type ProfileRow = {
    full_name: string | null;
    major: string | null;
    year: number | null;
    email: string | null;
    avatar_url: string | null;
};

type Banner = { type: "success" | "error" | "info"; text: string } | null;

const OTP_COOLDOWN_SECONDS = 60;
const PROFILE_LOAD_TIMEOUT_MS = 10000; // 10 seconds
const ABSOLUTE_MAX_LOAD_MS = 15000; // 15 seconds hard limit
const MAJOR_GROUPS: Array<{ label: string; options: string[] }> = [
    {
        label: "College of Engineering & Technology",
        options: [
            "Mechanical Engineering",
            "Electronics & Communication Engineering",
            "Computer Engineering",
            "Electrical & Control Engineering",
            "Construction & Building Engineering",
            "Industrial & Management Engineering",
            "Architectural Engineering & Environmental Design",
            "Petrol & Gas Engineering",
            "Marine Engineering",
        ],
    },
    {
        label: "College of Computing & Information Technology",
        options: [
            "Computer Science",
            "Information Systems",
            "Software Engineering",
            "Multimedia & Computer Graphics",
            "Artificial Intelligence (AI)",
            "Cybersecurity",
        ],
    },
    {
        label: "Basic & Applied Sciences Engineering",
        options: ["Mathematics", "Physics", "Chemistry"],
    },
    {
        label: "College of Management & Technology",
        options: [
            "Accounting & Finance",
            "Business Information Systems",
            "Marketing & International Business",
            "Media Management",
            "Hotel & Tourism Management",
            "Sustainable & Digital Business Economics",
        ],
    },
    {
        label: "College of International Transport & Logistics",
        options: ["International Transport & Logistics", "Energy & Petroleum Logistics Management"],
    },
    {
        label: "Others",
        options: ["Fine arts and design", "Language & Translation"],
    },
];

const otpLastSentKey = (userId: string) => `aast_phone_change_otp_last_sent_${userId}`;

function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(label)), ms);
        p.then((v) => {
            clearTimeout(t);
            resolve(v);
        }).catch((e) => {
            clearTimeout(t);
            reject(e);
        });
    });
}

export default function ProfileClient() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();

    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [authLoadIssue, setAuthLoadIssue] = useState<null | { kind: "session_timeout" | "session_error"; message: string }>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const debugAuth =
        process.env.NEXT_PUBLIC_DEBUG_AUTH === "1" ||
        (searchParams.get("debug_auth") === "1");

    const [rsvpCount, setRsvpCount] = useState<number>(0);
    const [verifiedCount, setVerifiedCount] = useState<number>(0);
    const [verifiedThisMonth, setVerifiedThisMonth] = useState<number>(0);
    const [badges, setBadges] = useState<Badge[]>([]);

    const [isAdminUser, setIsAdminUser] = useState(false);
    const [privacy, setPrivacy] = useState<{ hide_from_leaderboard: boolean; anonymous_polls: boolean }>({
        hide_from_leaderboard: false,
        anonymous_polls: false,
    });
    const [privacyBusy, setPrivacyBusy] = useState(false);

    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [profileRow, setProfileRow] = useState<ProfileRow | null>(null);
    const [profileData, setProfileData] = useState({ full_name: "", major: "", year: "" });

    const [identities, setIdentities] = useState<UserIdentity[]>([]);
    const [identitiesFresh, setIdentitiesFresh] = useState(false); //   true only after a successful identities load
    const identitiesReqIdRef = useRef(0); //   avoid out-of-order identity updates

    const [linkLoading, setLinkLoading] = useState(false);
    const [banner, setBanner] = useState<Banner>(null);

    const [showPhoneChange, setShowPhoneChange] = useState(false);
    const [phoneLocal, setPhoneLocal] = useState("");
    const [phoneE164, setPhoneE164] = useState("");
    const [phoneOtp, setPhoneOtp] = useState("");
    const [phoneOtpSent, setPhoneOtpSent] = useState(false);

    const [otpCooldown, setOtpCooldown] = useState(0);
    const [otpBusy, setOtpBusy] = useState(false);

    const mountedRef = useRef(false);
    const loadedRef = useRef(false); // Prevent re-running initial load

    const safeSet = useCallback((fn: () => void) => {
        if (!mountedRef.current) return;
        fn();
    }, []);

    // Auto-dismiss banner after 5s
    useEffect(() => {
        if (!banner) return;
        const t = setTimeout(() => setBanner(null), 5000);
        return () => clearTimeout(t);
    }, [banner]);

    // OTP countdown tick
    useEffect(() => {
        if (otpCooldown <= 0) return;
        const t = setTimeout(() => setOtpCooldown((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [otpCooldown]);

    const siteUrl = useMemo(() => {
        if (typeof window === "undefined") return "";
        const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
        if (env) {
            const normalized = env.replace(/\/+$/, "");
            try {
                const u = new URL(normalized);
                if (u.hostname && u.hostname !== "0.0.0.0") return normalized;
            } catch {
                // ignore invalid env values
            }
        }
        return window.location.origin;
    }, []);

    const redirectTo = useMemo(() => {
        if (!siteUrl) return "";
        return `${siteUrl}/auth/callback`;
    }, [siteUrl]);

    const isValidEgyptLocalPhone = (value: string) => {
        const digits = value.replace(/\s+/g, "");
        return /^01[0125]\d{8}$/.test(digits);
    };

    const normalizeEgyptPhoneToE164 = (value: string) => {
        const digits = value.replace(/\s+/g, "");
        return `+20${digits.replace(/^0/, "")}`;
    };

    const formatPhoneForDisplay = (raw?: string | null) => {
        if (!raw) return "";
        const v = String(raw).trim();
        if (!v) return "";
        if (v.startsWith("+20")) return "0" + v.replace(/^\+20/, "");
        if (/^20\d{10}$/.test(v)) return "0" + v.replace(/^20/, "");
        if (/^01[0125]\d{8}$/.test(v)) return v;
        return v;
    };

    const getInitials = (fullName?: string, email?: string | null) => {
        const name = (fullName || "").trim();
        if (name) {
            const parts = name.split(/\s+/).filter(Boolean);
            const first = parts[0]?.[0] || "";
            const second = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
            return (first + second).toUpperCase() || "U";
        }
        if (email) return (email[0] || "U").toUpperCase();
        return "U";
    };

    const computeProfileData = (row: ProfileRow | null) => ({
        full_name: row?.full_name || "",
        major: row?.major || "",
        year: row?.year?.toString() || "",
    });

    /**
     *   Don't wipe identities to [] on transient failures.
     * - Returns true only when we successfully refreshed identities.
     * - Uses request id to prevent out-of-order "older" results overriding newer state.
     */
    const safeLoadIdentities = useCallback(
        async (_opts?: { force?: boolean }) => {
            void _opts;
            const myReq = ++identitiesReqIdRef.current;

            try {
                const identitiesPromise = supabase.auth.getUserIdentities();
                const result = await withTimeout(identitiesPromise, 5000, "identities_timeout");
                const { data, error } = result as unknown as {
                    data: { identities: UserIdentity[] } | null;
                    error: { message?: unknown } | null;
                };
                if (error) throw error;

                if (!mountedRef.current || myReq !== identitiesReqIdRef.current) return false;

                safeSet(() => {
                    setIdentities((data?.identities ?? []) as UserIdentity[]);
                    setIdentitiesFresh(true);
                });

                return true;
            } catch (e: unknown) {
                //  Key change: DO NOT setIdentities([]) here (that causes the "unlink becomes link" bug)
                const msg = e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? "");
                if (msg !== "identities_timeout") {
                    console.error("[safeLoadIdentities]", e);
                }
                if (!mountedRef.current || myReq !== identitiesReqIdRef.current) return false;

                safeSet(() => setIdentitiesFresh(false));
                return false;
            }
        },
        [supabase, safeSet]
    );

    const restoreOtpCooldown = useCallback((uid: string) => {
        if (typeof window === "undefined") return;
        const raw = window.localStorage.getItem(otpLastSentKey(uid));
        const last = raw ? Number(raw) : 0;
        if (!last) return;

        const elapsed = Math.floor((Date.now() - last) / 1000);
        const remaining = OTP_COOLDOWN_SECONDS - elapsed;
        safeSet(() => setOtpCooldown(remaining > 0 ? remaining : 0));
    }, [safeSet]);

    const logAudit = async (action: string, meta?: Record<string, unknown>) => {
        if (!user?.id) return;
        try {
            const { error } = await supabase.from("auth_audit_logs").insert({
                user_id: user.id,
                action,
                meta: meta || {},
            });
            if (error) console.error("[Audit]", error);
        } catch (e) {
            console.error("[Audit exception]", e);
        }
    };

    const refreshUserAndProfile = useCallback(
        async (userId: string) => {
            try {
                const { data: refreshed } = await withTimeout(supabase.auth.getUser(), 8000, "getUser_timeout");
                const refreshedUser = refreshed?.user || null;
                if (refreshedUser) safeSet(() => setUser(refreshedUser));

                const profileResult = await withTimeout(
                    (async () => {
                        return await supabase
                            .from("profiles")
                            .select("full_name, major, year, email, avatar_url")
                            .eq("id", userId)
                            .maybeSingle<ProfileRow>();
                    })(),
                    5000,
                    "profile_timeout"
                );

                const { data, error } = profileResult as unknown as { data: ProfileRow | null; error: unknown | null };
                if (error) console.error("[refreshUserAndProfile]", error);

                const profile = data ?? null;
                safeSet(() => {
                    setProfileRow(profile);
                    setProfileData(computeProfileData(profile));
                });

                const local = formatPhoneForDisplay(refreshedUser?.phone || "");
                safeSet(() => {
                    if (local && local.startsWith("01")) {
                        setPhoneLocal(local);
                        setPhoneE164(normalizeEgyptPhoneToE164(local));
                    } else {
                        setPhoneLocal("");
                        setPhoneE164("");
                    }
                });

                // identities refresh (best-effort)
                await safeLoadIdentities({ force: true });

                restoreOtpCooldown(userId);
            } catch (e: unknown) {
                // Timeouts can happen during slow network / token rotation; don't show scary dev overlay
                const msg = e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? "");
                if (msg === "getUser_timeout" || msg === "profile_timeout") {
                    console.warn("[refreshUserAndProfile timeout]", msg);
                    return;
                }
                console.error("[refreshUserAndProfile exception]", e);
            }
        },
        [supabase, safeSet, safeLoadIdentities, restoreOtpCooldown]
    );

    // Auth listener
    useEffect(() => {
        mountedRef.current = true;

        const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
            const next = session?.user ?? null;

            if (debugAuth) {
                console.info("[AuthDebug] onAuthStateChange", {
                    event,
                    hasSession: Boolean(session),
                    hasUser: Boolean(next),
                });
            }

            // Never clear user state on transient auth issues; only on explicit SIGNED_OUT.
            if (event === "SIGNED_OUT") {
                safeSet(() => setUser(null));
                return;
            }

            if (next?.id) {
                safeSet(() => setUser(next));
                // best-effort; won't wipe identities if it fails
                await safeLoadIdentities();
                restoreOtpCooldown(next.id);
            }
        });

        return () => {
            mountedRef.current = false;
            sub.subscription.unsubscribe();
        };
    }, [supabase, safeLoadIdentities, safeSet, restoreOtpCooldown, debugAuth]);

    // Best-effort client auth diagnostics (dev-only unless explicitly enabled).
    useEffect(() => {
        if (!debugAuth) return;
        if (typeof window === "undefined") return;

        const safeStorageAvailable = (kind: "localStorage" | "sessionStorage") => {
            try {
                const storage = kind === "localStorage" ? window.localStorage : window.sessionStorage;
                const k = "__aast_storage_test__";
                storage.setItem(k, "1");
                storage.removeItem(k);
                return true;
            } catch {
                return false;
            }
        };

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const supabaseOrigin = (() => {
            try {
                return supabaseUrl ? new URL(supabaseUrl).origin : null;
            } catch {
                return null;
            }
        })();

        console.info("[AuthDebug] environment", {
            locationOrigin: window.location.origin,
            supabaseOrigin,
            hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
            cookieEnabled: navigator.cookieEnabled,
            localStorageOk: safeStorageAvailable("localStorage"),
            sessionStorageOk: safeStorageAvailable("sessionStorage"),
            visibility: document.visibilityState,
            online: navigator.onLine,
        });
    }, [debugAuth]);

    // OAuth callback handling
    useEffect(() => {
        const provider = searchParams.get("link_provider");
        const success = searchParams.get("link_success");
        const err = searchParams.get("link_error");
        if (!provider) return;

        (async () => {
            if (provider === "google" && success === "1") {
                safeSet(() => setBanner({ type: "success", text: "Google linked successfully." }));

                try {
                    // Make hasGoogleIdentity flip ASAP.
                    await safeLoadIdentities({ force: true });

                    // Sync profiles.email immediately (fast) so Header/Profile show email without waiting.
                    const syncRes = await fetch("/api/auth/sync-profile", { method: "POST" });
                    const syncJson: unknown = syncRes.ok ? await syncRes.json().catch(() => null) : null;
                    const syncObj = syncJson && typeof syncJson === "object" ? (syncJson as Record<string, unknown>) : null;
                    const syncedEmail = typeof syncObj?.email === "string" ? syncObj.email : null;
                    if (syncedEmail) {
                        safeSet(() =>
                            setProfileRow((prev) => ({
                                full_name: prev?.full_name ?? null,
                                major: prev?.major ?? null,
                                year: prev?.year ?? null,
                                avatar_url: prev?.avatar_url ?? null,
                                email: syncedEmail,
                            }))
                        );
                    }

                    const { data } = await supabase.auth.getUser();
                    if (data?.user?.id) {
                        safeSet(() => setUser(data.user));

                        try {
                            await withTimeout(refreshUserAndProfile(data.user.id), 8000, "refresh_timeout");
                        } catch (e) {
                            console.error("[OAuth callback refresh timeout]", e);
                        }
                    }
                } finally {
                    window.dispatchEvent(new Event("aast-profile-changed"));
                }
            } else if (provider === "google" && err) {
                const msg =
                    err === "manual_linking_disabled"
                        ? "Linking is disabled in Supabase. Enable it in Auth settings."
                        : err === "provider_already_linked"
                            ? "This Google account is already linked to another user. Use a different Google account."
                            : err === "exchange_failed"
                                ? "Linking failed during session exchange. Please try again."
                                : "Linking failed. Please try again.";
                safeSet(() => setBanner({ type: "error", text: msg }));
            }

            // Clean URL
            if (typeof window !== "undefined") {
                const u = new URL(window.location.href);
                u.searchParams.delete("link_provider");
                u.searchParams.delete("link_success");
                u.searchParams.delete("link_error");
                window.history.replaceState({}, "", u.toString());
            }
        })();
    }, [searchParams, supabase, refreshUserAndProfile, safeLoadIdentities, safeSet]);

    // Initial load with retry + failsafe
    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        let cancelled = false;

        const failsafeTimeout = setTimeout(() => {
            if (!mountedRef.current || cancelled) return;
            console.warn("[Profile] Failsafe triggered - forcing ready state");
            safeSet(() => setAuthLoadIssue({ kind: "session_timeout", message: "Session check timed out. You may still be signed in—please retry." }));
            safeSet(() => setLoading(false));
        }, ABSOLUTE_MAX_LOAD_MS);

        (async () => {
            safeSet(() => setLoading(true));
            safeSet(() => setAuthLoadIssue(null));

            const MAX_RETRIES = 2;
            let attempt = 0;

            while (attempt <= MAX_RETRIES && !cancelled) {
                attempt++;

                try {
                    const sessionPromise = supabase.auth.getSession();
                    const t0 = debugAuth ? Date.now() : 0;
                    if (debugAuth) {
                        void sessionPromise.then(
                            () => console.info("[AuthDebug] getSession resolved", { ms: Date.now() - t0 }),
                            (err: unknown) => console.info("[AuthDebug] getSession rejected", { ms: Date.now() - t0, err })
                        );
                    }
                    const {
                        data: { session },
                        error: sessionError,
                    } = await withTimeout(sessionPromise, PROFILE_LOAD_TIMEOUT_MS, "getSession_timeout");

                    if (cancelled || !mountedRef.current) {
                        clearTimeout(failsafeTimeout);
                        return;
                    }

                    if (sessionError) {
                        if (attempt <= MAX_RETRIES) {
                            console.warn(
                                `[Profile load] Session fetch failed, retrying (${attempt}/${MAX_RETRIES + 1})...`,
                                sessionError
                            );
                            await new Promise((resolve) => setTimeout(resolve, 500));
                            continue;
                        }
                        throw sessionError;
                    }

                    // Seed from session (fast, local). Do not treat network failures as "logged out".
                    let currentUser = session?.user ?? null;
                    if (currentUser) {
                        safeSet(() => setUser(currentUser));
                        restoreOtpCooldown(currentUser.id);
                    }
                    safeSet(() => setAuthLoadIssue(null));

                    // Verify with Auth server (best-effort). If it fails, keep the session user.
                    try {
                        const { data: verified } = await withTimeout(supabase.auth.getUser(), 8000, "getUser_timeout");
                        if (cancelled || !mountedRef.current) {
                            clearTimeout(failsafeTimeout);
                            return;
                        }
                        if (verified?.user) {
                            currentUser = verified.user;
                            safeSet(() => setUser(verified.user));
                            restoreOtpCooldown(verified.user.id);
                        }
                    } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? "");
                        if (msg === "getUser_timeout") {
                            console.warn("[Profile load] getUser timeout (keeping session user)");
                        } else {
                            console.warn("[Profile load] getUser failed (keeping session user)", e);
                        }
                    }

                    if (!currentUser) {
                        clearTimeout(failsafeTimeout);
                        safeSet(() => setLoading(false));
                        return;
                    }

                    try {
                        const profileResult = await withTimeout(
                            (async () => {
                                return await supabase
                                    .from("profiles")
                                    .select("full_name, major, year, email, avatar_url")
                                    .eq("id", currentUser.id)
                                    .maybeSingle<ProfileRow>();
                            })(),
                            PROFILE_LOAD_TIMEOUT_MS,
                            "profile_timeout"
                        );

                        const { data, error } = profileResult as unknown as { data: ProfileRow | null; error: unknown | null };
                        if (error) throw error;

                        const row: ProfileRow | null = data ?? null;
                        safeSet(() => {
                            setProfileRow(row);
                            setProfileData(computeProfileData(row));
                        });

                        const local = formatPhoneForDisplay(currentUser.phone || "");
                        safeSet(() => {
                            if (local && local.startsWith("01")) {
                                setPhoneLocal(local);
                                setPhoneE164(normalizeEgyptPhoneToE164(local));
                            }
                        });
                    } catch (e) {
                        if (attempt <= MAX_RETRIES) {
                            console.warn(`[Profile load] Profile fetch timeout, retrying (${attempt}/${MAX_RETRIES + 1})...`);
                            await new Promise((resolve) => setTimeout(resolve, 500));
                            continue;
                        }
                        console.error("[Profile load] Failed after retries:", e);
                    }

                    // identities load (best-effort; won't wipe old identities if it fails)
                    await safeLoadIdentities();

                    // Load stats async (don't block)
                    void (async () => {
                        try {
                            const now = new Date();
                            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

                            const [rsvpRes, verRes, monthRes, adminRes, privacyRes] = await Promise.allSettled([
                                supabase.from("attendees").select("id", { count: "exact", head: true }).eq("user_id", currentUser.id),
                                supabase
                                    .from("attendees")
                                    .select("id", { count: "exact", head: true })
                                    .eq("user_id", currentUser.id)
                                    .eq("checked_in", true),
                                supabase
                                    .from("attendees")
                                    .select("id", { count: "exact", head: true })
                                    .eq("user_id", currentUser.id)
                                    .eq("checked_in", true)
                                    .gte("checked_in_at", monthStart.toISOString()),
                                supabase.from("admin_users").select("role").eq("id", currentUser.id).maybeSingle(),
                                supabase
                                    .from("user_privacy_settings")
                                    .select("hide_from_leaderboard, anonymous_polls")
                                    .eq("user_id", currentUser.id)
                                    .maybeSingle(),
                            ]);

                            const rsvpC = rsvpRes.status === "fulfilled" ? (rsvpRes.value.count ?? 0) : 0;
                            const verC = verRes.status === "fulfilled" ? (verRes.value.count ?? 0) : 0;
                            const monthC = monthRes.status === "fulfilled" ? (monthRes.value.count ?? 0) : 0;

                            const adminOk =
                                adminRes.status === "fulfilled" && !adminRes.value.error && Boolean(adminRes.value.data);

                            const nextPrivacy =
                                privacyRes.status === "fulfilled" && !privacyRes.value.error
                                    ? {
                                        hide_from_leaderboard: Boolean(
                                            (privacyRes.value.data as unknown as { hide_from_leaderboard?: unknown } | null)?.hide_from_leaderboard
                                        ),
                                        anonymous_polls: Boolean(
                                            (privacyRes.value.data as unknown as { anonymous_polls?: unknown } | null)?.anonymous_polls
                                        ),
                                    }
                                    : null;

                            if (!cancelled) {
                                safeSet(() => {
                                    setRsvpCount(rsvpC);
                                    setVerifiedCount(verC);
                                    setVerifiedThisMonth(monthC);
                                    setBadges(computeBadges({ verifiedTotal: verC, verifiedThisMonth: monthC }));
                                    setIsAdminUser(adminOk);
                                    if (nextPrivacy) setPrivacy(nextPrivacy);
                                });
                            }
                        } catch (e) {
                            console.error("[Stats load error]", e);
                        }
                    })();

                    clearTimeout(failsafeTimeout);
                    safeSet(() => setLoading(false));
                    return;
                } catch (e) {
                    if (attempt <= MAX_RETRIES) {
                        console.warn(`[Profile load] Exception, retrying (${attempt}/${MAX_RETRIES + 1})...`, e);
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        continue;
                    }
                    console.error("[Profile load] Failed after retries:", e);
                    const msg = e instanceof Error ? e.message : "unknown_error";
                    if (msg === "getSession_timeout") {
                        safeSet(() =>
                            setAuthLoadIssue({
                                kind: "session_timeout",
                                message: "Session check timed out. You may still be signed in—please retry.",
                            })
                        );
                    } else {
                        safeSet(() =>
                            setAuthLoadIssue({
                                kind: "session_error",
                                message: "Failed to verify your session. Please retry.",
                            })
                        );
                    }
                    clearTimeout(failsafeTimeout);
                    safeSet(() => setLoading(false));
                    return;
                }
            }
        })();

        return () => {
            cancelled = true;
            clearTimeout(failsafeTimeout);
            loadedRef.current = false;
        };
    }, [supabase, safeLoadIdentities, safeSet, restoreOtpCooldown, reloadKey, debugAuth]);

    const handleSave = async () => {
        if (!user) return;

        safeSet(() => setIsSaving(true));
        try {
            const nextRow: Partial<ProfileRow> = {
                full_name: profileData.full_name,
                major: profileData.major,
                year: profileData.year ? parseInt(profileData.year, 10) : null,
            };

            const { error } = await supabase
                .from("profiles")
                .upsert(
                    {
                        id: user.id,
                        ...nextRow,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: "id" }
                );

            if (error) throw error;

            safeSet(() => {
                setProfileRow((prev) => ({
                    full_name: nextRow.full_name ?? prev?.full_name ?? null,
                    major: nextRow.major ?? prev?.major ?? null,
                    year: nextRow.year ?? prev?.year ?? null,
                    email: prev?.email ?? null,
                    avatar_url: prev?.avatar_url ?? null,
                }));
                setIsEditing(false);
            });

            try {
                await withTimeout(refreshUserAndProfile(user.id), 5000, "refresh_timeout");
            } catch { }
            safeSet(() => setBanner({ type: "success", text: "Profile updated successfully!" }));
            window.dispatchEvent(new Event("aast-profile-changed"));
        } catch (error: unknown) {
            console.error("[Update error]", error);
            const message = error instanceof Error ? error.message : "Update failed";
            safeSet(() => setBanner({ type: "error", text: `Failed to update profile: ${message}` }));
        } finally {
            safeSet(() => setIsSaving(false));
        }
    };

    const handleCancelEdit = () => {
        safeSet(() => {
            setProfileData(computeProfileData(profileRow));
            setIsEditing(false);
        });
    };

    const linkGoogle = async () => {
        if (!redirectTo) {
            safeSet(() => setBanner({ type: "error", text: "Missing redirect URL. Set NEXT_PUBLIC_SITE_URL correctly." }));
            return;
        }

        safeSet(() => {
            setLinkLoading(true);
            setBanner({ type: "info", text: "Redirecting to Google..." });
        });

        try {
            // After linking succeeds, redirect back to Profile with a success marker so we can sync email immediately.
            const cb = new URL(redirectTo);
            cb.searchParams.set("next", "/profile?link_provider=google&link_success=1");

            const { error } = await supabase.auth.linkIdentity({
                provider: "google",
                options: {
                    redirectTo: cb.toString(),
                    queryParams: { prompt: "select_account" },
                },
            });
            if (error) throw error;
        } catch (e: unknown) {
            safeSet(() => {
                const message = e instanceof Error ? e.message : "Unknown error";
                setBanner({ type: "error", text: `Failed to link Google: ${message}` });
                setLinkLoading(false);
            });
        }
    };

    const unlinkGoogle = async () => {
        if (!user) return;

        //  Ensure identities are up-to-date before deciding/linking/unlinking
        await safeLoadIdentities({ force: true });

        const hasPhone = Boolean(user?.phone);

        const otherIdentities = identities.filter((i) => i.provider && i.provider !== "google");
        const hasOtherIdentity = otherIdentities.length > 0;

        if (!hasPhone && !hasOtherIdentity) {
            safeSet(() =>
                setBanner({
                    type: "error",
                    text: "Cannot unlink Google: you would be locked out. Add a phone number (or another provider) first.",
                })
            );
            return;
        }

        const ok = confirm("Unlink Google from this account?");
        if (!ok) return;

        safeSet(() => {
            setLinkLoading(true);
            setBanner({ type: "info", text: "Unlinking Google..." });
        });

        try {
            //  If identities are temporarily unavailable, try one more refresh before failing
            let googleIdentity = identities.find((i) => i.provider === "google");
            if (!googleIdentity) {
                await safeLoadIdentities({ force: true });
                googleIdentity = identities.find((i) => i.provider === "google");
            }

            if (!googleIdentity) {
                safeSet(() => {
                    setBanner({ type: "error", text: "Unable to load Google identity right now (network issue). Please try again." });
                    setLinkLoading(false);
                });
                return;
            }

            const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
            if (error) throw error;

            // Clear profiles.email immediately after unlink
            const { error: updateError } = await supabase
                .from("profiles")
                .update({ email: null, updated_at: new Date().toISOString() })
                .eq("id", user.id);

            if (updateError) console.error("[Profile email clear]", updateError);

            await logAudit("unlink_google", { had_phone: hasPhone });

            try {
                await withTimeout(refreshUserAndProfile(user.id), 8000, "refresh_timeout");
            } catch (e) {
                console.error("[Unlink refresh timeout]", e);
            }

            safeSet(() => setBanner({ type: "success", text: "Google unlinked successfully." }));
            window.dispatchEvent(new Event("aast-profile-changed"));
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Unknown error";
            safeSet(() => setBanner({ type: "error", text: `Failed to unlink Google: ${message}` }));
        } finally {
            safeSet(() => setLinkLoading(false));
        }
    };

    /**
     *  "Google linked" should NOT depend only on identities (network can fail).
     * - identities can be stale/fail; profileRow.email is your durable truth (you clear it on unlink).
     */
    const googleLinkedFromIdentities = identities.some((i) => i.provider === "google");
    const googleLinkedFromProfile = Boolean((profileRow?.email ?? "").trim());
    const hasGoogleIdentity = googleLinkedFromIdentities || googleLinkedFromProfile;

    const hasPhone = Boolean(user?.phone);

    const sendPhoneChangeOtp = async () => {
        if (!user) return;
        if (otpBusy || linkLoading) return;

        restoreOtpCooldown(user.id);
        if (otpCooldown > 0) {
            safeSet(() => setBanner({ type: "error", text: `Please wait ${otpCooldown}s before requesting another OTP.` }));
            return;
        }

        if (!phoneLocal || !isValidEgyptLocalPhone(phoneLocal)) {
            safeSet(() => setBanner({ type: "error", text: "Invalid Egyptian number. Example: 01012345678" }));
            return;
        }

        const e164 = normalizeEgyptPhoneToE164(phoneLocal);

        safeSet(() => {
            setOtpBusy(true);
            setLinkLoading(true);
        });

        try {
            const { data, error } = await supabase.functions.invoke("phone-change-request", {
                body: { phone_e164: e164 },
            });

            if (error) {
                const anyErr = error as unknown as {
                    message?: unknown;
                    context?: { status?: unknown; body?: unknown };
                };
                const status = typeof anyErr.context?.status === "number" ? anyErr.context.status : null;
                const body = anyErr.context?.body && typeof anyErr.context.body === "object" ? (anyErr.context.body as Record<string, unknown>) : null;
                const remaining = typeof body?.remaining_seconds === "number" ? body.remaining_seconds : null;

                if (status === 429 && typeof remaining === "number") {
                    safeSet(() => {
                        setOtpCooldown(remaining);
                        setBanner({ type: "error", text: `Please wait ${remaining}s before requesting another OTP.` });
                    });
                    return;
                }

                throw new Error(typeof anyErr.message === "string" ? anyErr.message : "Failed to send OTP");
            }

            if (!data?.ok) throw new Error("Failed to send OTP");

            safeSet(() => {
                setPhoneE164(e164);
                setPhoneOtp("");
                setPhoneOtpSent(true);
            });

            if (typeof window !== "undefined") {
                window.localStorage.setItem(otpLastSentKey(user.id), String(Date.now()));
            }
            safeSet(() => setOtpCooldown(OTP_COOLDOWN_SECONDS));
            safeSet(() => setBanner({ type: "success", text: "OTP sent. Enter the code to confirm your phone number." }));
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Send OTP failed";
            safeSet(() => setBanner({ type: "error", text: `Failed to send OTP: ${message}` }));
        } finally {
            safeSet(() => {
                setLinkLoading(false);
                setOtpBusy(false);
            });
        }
    };

    const verifyPhoneChangeOtp = async () => {
        if (!phoneE164 || !phoneOtp) {
            safeSet(() => setBanner({ type: "error", text: "Enter the OTP code." }));
            return;
        }

        safeSet(() => setLinkLoading(true));
        try {
            const { error } = await supabase.auth.verifyOtp({
                phone: phoneE164,
                token: phoneOtp,
                type: "phone_change",
            });

            if (error) throw error;

            await logAudit("phone_verified", { phone_e164: phoneE164 });

            try {
                await withTimeout(refreshUserAndProfile(user!.id), 5000, "refresh_timeout");
            } catch { }

            safeSet(() => {
                setPhoneOtpSent(false);
                setShowPhoneChange(false);
            });

            safeSet(() => setBanner({ type: "success", text: "Phone verified and linked successfully!" }));
            window.dispatchEvent(new Event("aast-profile-changed"));
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "OTP verification failed";
            safeSet(() => setBanner({ type: "error", text: `OTP verification failed: ${message}` }));
        } finally {
            safeSet(() => setLinkLoading(false));
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
                <p className="text-muted-foreground text-sm">Loading profile...</p>
            </div>
        );
    }

    if (!user) {
        if (authLoadIssue) {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center gap-4">
                    <h1 className="text-2xl font-bold text-foreground">Having trouble loading your session</h1>
                    <p className="text-sm text-muted-foreground max-w-md">{authLoadIssue.message}</p>
                    <div className="flex gap-3">
                        <Button
                            onClick={() => {
                                setLoading(true);
                                setAuthLoadIssue(null);
                                setReloadKey((k) => k + 1);
                            }}
                        >
                            Retry
                        </Button>
                        <Link href="/">
                            <Button variant="outline">Go Home</Button>
                        </Link>
                    </div>
                </div>
            );
        }
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background">
                <h1 className="text-2xl font-bold mb-4 text-foreground">Not Logged In</h1>
                <Link href="/">
                    <Button>Go Home</Button>
                </Link>
            </div>
        );
    }

    const avatarUrl =
        (profileRow?.avatar_url && String(profileRow.avatar_url).trim()) ||
        (user.user_metadata?.avatar_url && String(user.user_metadata.avatar_url).trim()) ||
        "";

    const initials = getInitials(profileData.full_name, user.email);
    const phoneDisplay = formatPhoneForDisplay(user.phone || "");

    //  Email display logic : trust profiles.email as the real source
    const emailDisplay = hasGoogleIdentity
        ? (profileRow?.email ?? user.email ?? "").trim() || "No email"
        : "No email";

    const updatePrivacy = async (next: Partial<{ hide_from_leaderboard: boolean; anonymous_polls: boolean }>) => {
        if (!user?.id) return;
        if (privacyBusy) return;
        if (isAdminUser) {
            setBanner({ type: "info", text: "Privacy settings are disabled for admins." });
            return;
        }

        const merged = { ...privacy, ...next };
        setPrivacy(merged);
        setPrivacyBusy(true);
        try {
            const res = await withTimeout(
                Promise.resolve().then(async () => {
                    return await supabase
                        .from("user_privacy_settings")
                        .upsert(
                            {
                                user_id: user.id,
                                hide_from_leaderboard: merged.hide_from_leaderboard,
                                anonymous_polls: merged.anonymous_polls,
                                updated_at: new Date().toISOString(),
                            },
                            { onConflict: "user_id" }
                        );
                }),
                5000,
                "privacy_timeout"
            );
            const err = (res as unknown as { error?: unknown } | null)?.error ?? null;
            if (err) throw err;
        } catch (e: unknown) {
            console.error("[Privacy] update failed:", e);
            setBanner({ type: "error", text: "Failed to update privacy settings. Please try again." });
        } finally {
            setPrivacyBusy(false);
        }
    };

    const SwitchRow = ({
        label,
        description,
        checked,
        onChange,
    }: {
        label: string;
        description: string;
        checked: boolean;
        onChange: (v: boolean) => void;
    }) => {
        const disabled = privacyBusy || isAdminUser;
        return (
            <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-4">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                        {label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{description}</p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => onChange(!checked)}
                    className={[
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
                        checked ? "bg-blue-600" : "bg-muted",
                        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                    ].join(" ")}
                    title={isAdminUser ? "Admins cannot enable privacy mode" : undefined}
                >
                    <span
                        className={[
                            "inline-block h-5 w-5 transform rounded-full bg-background border border-border shadow transition",
                            checked ? "translate-x-5" : "translate-x-1",
                        ].join(" ")}
                    />
                </button>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-background">
            <div className="bg-card border-b border-border p-4 sticky top-0 z-10 shadow-sm">
                <div className="relative">
                    <Link
                        href="/"
                        className="absolute left-0 top-1/2 -translate-y-1/2 hover:opacity-70 transition px-4"
                        aria-label="Back"
                    >
                        <ChevronLeft className="h-6 w-6 text-foreground" />
                    </Link>

                    <h1 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg font-bold text-primary">
                        Student Profile
                    </h1>

                    <div className="max-w-md mx-auto flex items-center justify-end">
                        {!isEditing ? (
                            <Button onClick={() => setIsEditing(true)} variant="outline" size="sm">
                                <Edit2 className="h-4 w-4 mr-2" />
                                Edit
                            </Button>
                        ) : (
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                    {isSaving ? (
                                        "Saving..."
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4 mr-2" />
                                            Save
                                        </>
                                    )}
                                </Button>
                                <Button onClick={handleCancelEdit} variant="outline" size="sm" disabled={isSaving}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-md mx-auto p-6 space-y-6">
                {banner && (
                    <div
                        className={`rounded-xl border p-3 text-sm ${banner.type === "success"
                            ? "bg-green-50 text-green-800 border-green-200 dark:bg-green-950/20 dark:text-green-300 dark:border-green-900/40"
                            : banner.type === "error"
                                ? "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-300 dark:border-red-900/40"
                                : "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-900/40"
                            }`}
                    >
                        {banner.text}
                    </div>
                )}

                <div className="bg-card rounded-2xl shadow-lg border border-border p-6 flex flex-col items-center text-center">
                        <div className="h-24 w-24 rounded-full overflow-hidden border-4 border-primary/20 shadow-lg mb-4 bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold">
                            {avatarUrl ? (
                            <UnoptimizedImage
                                src={avatarUrl}
                                alt="Profile"
                                width={96}
                                height={96}
                                className="h-full w-full object-cover"
                                sizes="96px"
                                priority
                                unoptimized
                            />
                            ) : (
                                <span>{initials}</span>
                            )}
                        </div>

                    {!isEditing ? (
                        <>
                            <h2 className="text-2xl font-bold text-foreground">{profileData.full_name || "Student"}</h2>

                            <div className="flex items-center text-muted-foreground mt-2 space-x-2 text-sm">
                                <Mail className="h-3 w-3" />
                                <span>{emailDisplay}</span>
                            </div>

                            <div className="flex items-center text-muted-foreground mt-1 space-x-2 text-sm">
                                <Phone className="h-3 w-3" />
                                <span>{phoneDisplay || "No phone linked yet"}</span>
                            </div>

                            {profileData.major && (
                                <p className="text-sm text-muted-foreground mt-3">
                                    📚 {profileData.major}
                                    {profileData.year && ` - Year ${profileData.year}`}
                                </p>
                            )}
                        </>
                    ) : (
                        <div className="w-full space-y-4 mt-4">
                            <div>
                                <Label htmlFor="full_name" className="text-left block mb-1 text-foreground">
                                    Full Name
                                </Label>
                                <Input
                                    id="full_name"
                                    value={profileData.full_name}
                                    onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                                    placeholder="Enter your full name"
                                />
                            </div>
                            <div>
                                <Label htmlFor="major" className="text-left block mb-1 text-foreground">
                                    Major
                                </Label>

                                <select
                                    id="major"
                                    value={profileData.major}
                                    onChange={(e) => setProfileData({ ...profileData, major: e.target.value })}
                                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
                                >
                                    <option value="">Select Major</option>

                                    {MAJOR_GROUPS.map((group) => (
                                        <optgroup key={group.label} label={group.label}>
                                            {group.options.map((opt) => (
                                                <option key={opt} value={opt}>
                                                    {opt}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <Label htmlFor="year" className="text-left block mb-1 text-foreground">
                                    Year
                                </Label>
                                <select
                                    id="year"
                                    value={profileData.year}
                                    onChange={(e) => setProfileData({ ...profileData, year: e.target.value })}
                                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
                                >
                                    <option value="">Select Year</option>
                                    <option value="1">Year 1</option>
                                    <option value="2">Year 2</option>
                                    <option value="3">Year 3</option>
                                    <option value="4">Year 4</option>
                                    <option value="5">Year 5</option>
                                </select>
                            </div>

                            <p className="text-xs text-muted-foreground text-left flex items-center gap-2">
                                <Mail className="h-3 w-3" />
                                {emailDisplay}
                            </p>
                            <p className="text-xs text-muted-foreground text-left flex items-center gap-2">
                                <Phone className="h-3 w-3" />
                                {phoneDisplay || "No phone linked yet"}
                            </p>
                        </div>
                    )}

                    <div className="w-full grid grid-cols-2 gap-3 mt-6">
                        <div className="bg-blue-500/10 dark:bg-blue-500/20 rounded-xl p-4 border border-blue-500/20 dark:border-blue-500/30 hover:border-blue-500/40 transition">
                            <div className="flex items-center justify-center gap-2 mb-1">
                                <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">RSVPs</p>
                            </div>
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{rsvpCount}</p>
                        </div>

                        <Link
                            href="/profile/attendance"
                            className="bg-green-500/10 dark:bg-green-500/20 rounded-xl p-4 hover:bg-green-500/20 dark:hover:bg-green-500/30 transition cursor-pointer border border-green-500/20 dark:border-green-500/30 hover:border-green-500/40"
                        >
                            <div className="flex items-center justify-center gap-2 mb-1">
                                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                                <p className="text-xs font-semibold text-green-700 dark:text-green-300">Attended</p>
                            </div>
                            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{verifiedCount}</p>
                        </Link>
                    </div>
                </div>

                <div className="bg-card rounded-2xl shadow-lg border border-border p-6">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <h3 className="text-lg font-bold text-foreground">Badges</h3>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Trophy className="h-4 w-4" />
                                <span>{verifiedThisMonth} this month</span>
                            </div>

                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-8">
                                        View all
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="p-0 sm:max-w-2xl" showCloseButton={false}>
                                    <div className="flex max-h-[80vh] flex-col">
                                        <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
                                        <DialogClose asChild>
                                            <Button variant="outline" size="sm" className="h-8">
                                                <ChevronLeft className="h-4 w-4 mr-2" />
                                                Back
                                            </Button>
                                        </DialogClose>
                                        <div className="min-w-0 text-center flex-1">
                                            <DialogTitle className="text-base">All badges</DialogTitle>
                                        </div>
                                        <DialogClose asChild>
                                            <Button variant="ghost" size="sm" className="h-8 px-2">
                                                <X className="h-4 w-4" />
                                                <span className="sr-only">Close</span>
                                            </Button>
                                        </DialogClose>
                                        </div>

                                        <div className="px-4 pb-5 pt-4 overflow-y-auto">
                                            <div className="rounded-2xl border border-border bg-card/40 p-4">
                                                <DialogDescription className="text-sm">
                                                    Badges are based on verified attendance (checked-in). Some badges refresh monthly.
                                                </DialogDescription>
                                            </div>

                                            <div className="mt-4 grid grid-cols-1 gap-3">
                                                {[
                                                    { id: "tier_10", label: "Rising (10+)", req: "Attend 10 events", ok: verifiedCount >= 10, tone: "amber" as const },
                                                    { id: "tier_20", label: "Committed (20+)", req: "Attend 20 events", ok: verifiedCount >= 20, tone: "green" as const },
                                                    { id: "tier_40", label: "Dedicated (40+)", req: "Attend 40 events", ok: verifiedCount >= 40, tone: "blue" as const },
                                                    { id: "tier_70", label: "Elite (70+)", req: "Attend 70 events", ok: verifiedCount >= 70, tone: "purple" as const },
                                                    { id: "tier_100", label: "Legend (100+)", req: "Attend 100 events", ok: verifiedCount >= 100, tone: "purple" as const },
                                                    { id: "month_events", label: "3+ events this month", req: "Attend 3+ events this month", ok: verifiedThisMonth >= 3, tone: "blue" as const },
                                                ].map((b) => (
                                                    <div
                                                        key={b.id}
                                                        className={[
                                                            "rounded-2xl border border-border bg-card p-4 shadow-sm",
                                                            b.ok ? "" : "opacity-90",
                                                        ].join(" ")}
                                                    >
                                                        <div className="flex items-start justify-between gap-4">
                                                            <div className="flex items-start gap-3 min-w-0">
                                                                <div
                                                                    className={[
                                                                        "h-10 w-10 rounded-2xl border flex items-center justify-center shrink-0",
                                                                        badgeToneClass(b.tone),
                                                                    ].join(" ")}
                                                                >
                                                                    <BadgeIcon id={b.id} className="h-5 w-5" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-sm font-semibold text-foreground">{b.label}</p>
                                                                    <p className="text-xs text-muted-foreground mt-1">{b.req}</p>
                                                                </div>
                                                            </div>
                                                            <div
                                                                className={[
                                                                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shrink-0",
                                                                    b.ok
                                                                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800/40"
                                                                        : "bg-muted text-muted-foreground border-border",
                                                                ].join(" ")}
                                                            >
                                                                {b.ok ? <Check className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                                                                {b.ok ? "Unlocked" : "Locked"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>

                    {badges.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Attend more events to unlock badges (first tier at 10 verified events).
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {badges.map((b) => (
                                <span
                                    key={b.id}
                                    className={[
                                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                                        badgeToneClass(b.tone),
                                    ].join(" ")}
                                >
                                    <BadgeIcon id={b.id} className="h-4 w-4" />
                                    {b.label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-card rounded-2xl shadow-lg border border-border p-6 space-y-4">
                    <h3 className="text-lg font-bold text-foreground">Sign-in methods</h3>

                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                            <ShieldCheck className="h-4 w-4" />
                            <span className="text-foreground">Google</span>
                            <span className="text-muted-foreground">
                                {hasGoogleIdentity ? "(linked)" : "(not linked)"}
                                {/* optional: tiny hint if identities fetch is currently failing */}
                                {!identitiesFresh && hasGoogleIdentity ? " (syncing…)" : ""}
                            </span>
                        </div>

                        <div className="flex gap-2">
                            {hasGoogleIdentity ? (
                                <Button onClick={unlinkGoogle} disabled={linkLoading} size="sm" variant="outline">
                                    <UnlinkIcon className="h-4 w-4 mr-2" />
                                    {linkLoading ? "..." : "Unlink"}
                                </Button>
                            ) : (
                                <Button onClick={linkGoogle} disabled={linkLoading} size="sm" variant="outline">
                                    <Link2 className="h-4 w-4 mr-2" />
                                    {linkLoading ? "Linking..." : "Link Google"}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4" />
                            <span className="text-foreground">Phone</span>
                            <span className="text-muted-foreground">{hasPhone ? "(linked)" : "(not linked)"}</span>
                        </div>

                        <Button
                            onClick={() => {
                                setShowPhoneChange((v) => !v);
                                setPhoneOtp("");
                                setPhoneOtpSent(false);

                                if (user?.id) restoreOtpCooldown(user.id);

                                const local = formatPhoneForDisplay(user.phone || "");
                                setPhoneLocal(local || "");
                                setPhoneE164(local ? normalizeEgyptPhoneToE164(local) : "");
                            }}
                            disabled={linkLoading}
                            size="sm"
                            variant="outline"
                        >
                            {hasPhone ? "Change" : "Add"}
                        </Button>
                    </div>

                    {showPhoneChange && (
                        <div className="pt-2 space-y-3">
                            <Label htmlFor="phoneLocal" className="text-sm text-foreground">
                                {hasPhone ? "Change your Egyptian phone number" : "Add an Egyptian phone number"}
                            </Label>

                            <Input
                                id="phoneLocal"
                                value={phoneLocal}
                                onChange={(e) => setPhoneLocal(e.target.value)}
                                placeholder="01012345678"
                                type="tel"
                                disabled={phoneOtpSent || linkLoading}
                            />

                            {!phoneOtpSent ? (
                                <Button
                                    onClick={sendPhoneChangeOtp}
                                    disabled={linkLoading || otpBusy || otpCooldown > 0}
                                    className="w-full bg-[#00386C] hover:bg-[#00509d] text-white"
                                >
                                    {otpBusy || linkLoading ? "Sending..." : otpCooldown > 0 ? `Wait ${otpCooldown}s` : "Send OTP"}
                                </Button>
                            ) : (
                                <div className="space-y-2">
                                    <Input
                                        value={phoneOtp}
                                        onChange={(e) => setPhoneOtp(e.target.value)}
                                        placeholder="Enter 6-digit OTP"
                                        inputMode="numeric"
                                        maxLength={6}
                                        disabled={linkLoading}
                                    />
                                    <div className="flex gap-2">
                                        <Button onClick={verifyPhoneChangeOtp} disabled={linkLoading} className="flex-1">
                                            {linkLoading ? "Verifying..." : "Verify"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setPhoneOtp("");
                                                setPhoneOtpSent(false);
                                                setPhoneE164("");
                                                if (user?.id) restoreOtpCooldown(user.id);
                                            }}
                                            disabled={linkLoading}
                                        >
                                            Cancel
                                        </Button>
                                    </div>

                                    <Button
                                        onClick={sendPhoneChangeOtp}
                                        disabled={linkLoading || otpBusy || otpCooldown > 0}
                                        variant="outline"
                                        className="w-full"
                                        title="Resend allowed after cooldown"
                                    >
                                        {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend OTP"}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="bg-card rounded-2xl shadow-lg border border-border p-6">
                    <h3 className="text-lg font-bold text-foreground mb-4">Preferences</h3>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Theme</span>
                        <DarkModeToggle />
                    </div>

                    <div className="mt-6 pt-6 border-t border-border">
                        <p className="text-sm font-semibold text-foreground mb-1">Privacy</p>
                        <p className="text-xs text-muted-foreground">
                            These settings affect what non-admin users can see about you.
                        </p>
                        {isAdminUser && (
                            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                Privacy options are disabled for admins.
                            </div>
                        )}

                        <div className="mt-3 rounded-xl border border-border overflow-hidden divide-y divide-border">
                            <SwitchRow
                                label="Hide my name from leaderboards"
                                description="If enabled, your name/avatar won’t appear on public leaderboards to non-admin viewers."
                                checked={privacy.hide_from_leaderboard}
                                onChange={(v) => void updatePrivacy({ hide_from_leaderboard: v })}
                            />

                            <SwitchRow
                                label="Anonymous polls"
                                description="If enabled, polls won’t show your identity to non-admin viewers."
                                checked={privacy.anonymous_polls}
                                onChange={(v) => void updatePrivacy({ anonymous_polls: v })}
                            />
                        </div>
                    </div>
                </div>

                <EventCalendar />
            </div>
        </div>
    );
}
