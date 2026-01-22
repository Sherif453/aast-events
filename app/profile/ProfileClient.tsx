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
} from "lucide-react";
import EventCalendar from "@/components/EventCalendar";

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

    const [rsvpCount, setRsvpCount] = useState<number>(0);
    const [verifiedCount, setVerifiedCount] = useState<number>(0);

    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [profileRow, setProfileRow] = useState<ProfileRow | null>(null);
    const [profileData, setProfileData] = useState({ full_name: "", major: "", year: "" });

    const [identities, setIdentities] = useState<UserIdentity[]>([]);
    const [identitiesFresh, setIdentitiesFresh] = useState(false); // ✅ NEW: true only after a successful identities load
    const identitiesReqIdRef = useRef(0); // ✅ NEW: avoid out-of-order identity updates

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
        const base = env ? env.replace(/\/+$/, "") : window.location.origin;
        return base;
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
     * ✅ FIXED: Don't wipe identities to [] on transient failures.
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
                const { data, error } = result as any;
                if (error) throw error;

                if (!mountedRef.current || myReq !== identitiesReqIdRef.current) return false;

                safeSet(() => {
                    setIdentities((data?.identities ?? []) as UserIdentity[]);
                    setIdentitiesFresh(true);
                });

                return true;
            } catch (e: any) {
                // ✅ Key change: DO NOT setIdentities([]) here (that causes the "unlink becomes link" bug)
                if (e?.message !== "identities_timeout") {
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

    const logAudit = async (action: string, meta?: Record<string, any>) => {
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

                const { data, error } = profileResult as any;
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
            } catch (e: any) {
                // Timeouts can happen during slow network / token rotation; don't show scary dev overlay
                if (e?.message === "getUser_timeout" || e?.message === "profile_timeout") {
                    console.warn("[refreshUserAndProfile timeout]", e?.message);
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

        const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
            const next = session?.user ?? null;
            safeSet(() => setUser(next));
            if (next?.id) {
                // best-effort; won't wipe identities if it fails
                await safeLoadIdentities();
                restoreOtpCooldown(next.id);
            }
        });

        return () => {
            mountedRef.current = false;
            sub.subscription.unsubscribe();
        };
    }, [supabase, safeLoadIdentities, safeSet, restoreOtpCooldown]);

    // OAuth callback handling
    useEffect(() => {
        const provider = searchParams.get("link_provider");
        const success = searchParams.get("link_success");
        const err = searchParams.get("link_error");
        if (!provider) return;

        (async () => {
            if (provider === "google" && success === "1") {
                safeSet(() => setBanner({ type: "success", text: "Google linked successfully." }));

                const { data } = await supabase.auth.getUser();
                if (data?.user?.id) {
                    safeSet(() => setUser(data.user));

                    try {
                        await withTimeout(refreshUserAndProfile(data.user.id), 8000, "refresh_timeout");
                    } catch (e) {
                        console.error("[OAuth callback refresh timeout]", e);
                    }
                }

                window.dispatchEvent(new Event("aast-profile-changed"));
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
    }, [searchParams, supabase, refreshUserAndProfile, safeSet]);

    // Initial load with retry + failsafe
    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        let cancelled = false;

        const failsafeTimeout = setTimeout(() => {
            if (!mountedRef.current || cancelled) return;
            console.warn("[Profile] Failsafe triggered - forcing ready state");
            safeSet(() => setLoading(false));
        }, ABSOLUTE_MAX_LOAD_MS);

        (async () => {
            safeSet(() => setLoading(true));

            const MAX_RETRIES = 2;
            let attempt = 0;

            while (attempt <= MAX_RETRIES && !cancelled) {
                attempt++;

                try {
                    const {
                        data: { user: currentUser },
                        error: userError,
                    } = await withTimeout(supabase.auth.getUser(), PROFILE_LOAD_TIMEOUT_MS, "getUser_timeout");

                    if (cancelled || !mountedRef.current) {
                        clearTimeout(failsafeTimeout);
                        return;
                    }

                    if (userError) {
                        if (attempt <= MAX_RETRIES) {
                            console.warn(
                                `[Profile load] User fetch failed, retrying (${attempt}/${MAX_RETRIES + 1})...`,
                                userError
                            );
                            await new Promise((resolve) => setTimeout(resolve, 500));
                            continue;
                        }
                        throw userError;
                    }

                    if (!currentUser) {
                        clearTimeout(failsafeTimeout);
                        safeSet(() => setLoading(false));
                        return;
                    }

                    safeSet(() => setUser(currentUser));
                    restoreOtpCooldown(currentUser.id);

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

                        const { data, error } = profileResult as any;
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
                            const [{ count: rsvpC }, { count: verC }] = await Promise.all([
                                supabase.from("attendees").select("id", { count: "exact", head: true }).eq("user_id", currentUser.id),
                                supabase
                                    .from("attendees")
                                    .select("id", { count: "exact", head: true })
                                    .eq("user_id", currentUser.id)
                                    .eq("checked_in", true),
                            ]);
                            if (!cancelled) {
                                safeSet(() => {
                                    setRsvpCount(rsvpC || 0);
                                    setVerifiedCount(verC || 0);
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
    }, [supabase, safeLoadIdentities, safeSet, restoreOtpCooldown]);

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
                    } as any,
                    { onConflict: "id" }
                );

            if (error) throw error;

            safeSet(() => {
                setProfileRow((prev) => ({
                    full_name: (nextRow.full_name as any) ?? prev?.full_name ?? null,
                    major: (nextRow.major as any) ?? prev?.major ?? null,
                    year: (nextRow.year as any) ?? prev?.year ?? null,
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
        } catch (error: any) {
            console.error("[Update error]", error);
            safeSet(() => setBanner({ type: "error", text: `Failed to update profile: ${error.message}` }));
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
            const { error } = await supabase.auth.linkIdentity({
                provider: "google",
                options: {
                    redirectTo,
                    queryParams: { prompt: "select_account" },
                } as any,
            });
            if (error) throw error;
        } catch (e: any) {
            safeSet(() => {
                setBanner({ type: "error", text: `Failed to link Google: ${e?.message || "Unknown error"}` });
                setLinkLoading(false);
            });
        }
    };

    const unlinkGoogle = async () => {
        if (!user) return;

        // ✅ Ensure identities are up-to-date before deciding/linking/unlinking
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
            // ✅ If identities are temporarily unavailable, try one more refresh before failing
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
        } catch (e: any) {
            safeSet(() => setBanner({ type: "error", text: `Failed to unlink Google: ${e?.message || "Unknown error"}` }));
        } finally {
            safeSet(() => setLinkLoading(false));
        }
    };

    /**
     * ✅ FIX: "Google linked" should NOT depend only on identities (network can fail).
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
                const anyErr: any = error;
                const status = anyErr?.context?.status;
                const remaining = anyErr?.context?.body?.remaining_seconds;

                if (status === 429 && typeof remaining === "number") {
                    safeSet(() => {
                        setOtpCooldown(remaining);
                        setBanner({ type: "error", text: `Please wait ${remaining}s before requesting another OTP.` });
                    });
                    return;
                }

                throw new Error(anyErr?.message || "Failed to send OTP");
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
        } catch (e: any) {
            safeSet(() => setBanner({ type: "error", text: `Failed to send OTP: ${e.message}` }));
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
        } catch (e: any) {
            safeSet(() => setBanner({ type: "error", text: `OTP verification failed: ${e.message}` }));
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

    // ✅ Email display logic (fixed): trust profiles.email as the real source
    const emailDisplay = hasGoogleIdentity
        ? (profileRow?.email ?? user.email ?? "").trim() || "No email"
        : "No email";

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
                            <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
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
                                <Button onClick={sendPhoneChangeOtp} disabled={linkLoading || otpBusy || otpCooldown > 0} className="w-full">
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
                </div>

                <EventCalendar />
            </div>
        </div>
    );
}