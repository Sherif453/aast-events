'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Tab = 'google' | 'phone';

export default function LoginPage() {
    const supabase = useMemo(() => createClient(), []);
    const router = useRouter();
    const searchParams = useSearchParams();

    // ✅ NEW: where to go after login
    const nextPath = useMemo(() => {
        const raw = searchParams?.get('next') || '/';
        // basic safety: must be internal path
        if (!raw.startsWith('/')) return '/';
        return raw;
    }, [searchParams]);

    // Public URL (for OAuth redirect). If you later use ngrok, set NEXT_PUBLIC_SITE_URL to the ngrok URL.
    const siteUrl = useMemo(() => {
        if (typeof window === 'undefined') return undefined;

        const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
        if (env) return env.replace(/\/+$/, '');
        return window.location.origin;
    }, []);

    const redirectTo = useMemo(() => {
        if (!siteUrl) return undefined;

        // ✅ NEW: preserve next through callback
        const cb = new URL(`${siteUrl}/auth/callback`);
        if (nextPath) cb.searchParams.set('next', nextPath);
        return cb.toString();
    }, [siteUrl, nextPath]);

    const [tab, setTab] = useState<Tab>('google');

    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // mounted guard (prevents setState after unmount)
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const safeSetLoading = (v: boolean) => {
        if (!mountedRef.current) return;
        setLoading(v);
    };

    const msgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const safeSetMessage = (m: { type: 'success' | 'error'; text: string } | null, ms?: number) => {
        if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
        if (!mountedRef.current) return;

        setMsg(m);

        if (m && ms) {
            msgTimeoutRef.current = setTimeout(() => {
                if (!mountedRef.current) return;
                setMsg(null);
            }, ms);
        }
    };

    useEffect(() => {
        return () => {
            if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
        };
    }, []);

    // Reset UI feedback when switching tabs
    useEffect(() => {
        safeSetLoading(false);
        safeSetMessage(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    // If already signed in, redirect away from login
    useEffect(() => {
        const run = async () => {
            const { data } = await supabase.auth.getSession();
            if (data.session) {
                router.replace(nextPath || '/');
                router.refresh();
            }
        };
        run();
    }, [supabase, router, nextPath]);

    const prettyAuthError = (raw: string) => {
        const m = raw.toLowerCase();

        if (m.includes('invalid login credentials')) return 'Login failed. Please try again.';
        if (m.includes('otp') && m.includes('expired')) return 'The code expired. Request a new OTP.';

        // Twilio/provider errors often surface like this:
        if (m.includes('error sending confirmation otp to provider') || m.includes('twilio') || m.includes('20003')) {
            return 'Phone OTP is not configured yet (SMS provider missing). For now, use Google login.';
        }

        return raw;
    };

    // Google OAuth
    const signInWithGoogle = async () => {
        safeSetLoading(true);
        safeSetMessage(null);

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                ...(redirectTo ? { redirectTo } : {}),
                queryParams: {
                    prompt: 'select_account',
                    access_type: 'offline',
                },
            },
        });

        if (error) safeSetMessage({ type: 'error', text: prettyAuthError(error.message) }, 7000);
        safeSetLoading(false);
    };

    // Phone OTP (Egypt UX)
    const [phone, setPhone] = useState(''); // e.g. 01012345678
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [phoneE164, setPhoneE164] = useState('');

    const isValidEgyptLocalPhone = (value: string) => {
        const digits = value.replace(/\s+/g, '');
        return /^01[0125]\d{8}$/.test(digits);
    };

    const normalizeEgyptPhoneToE164 = (value: string) => {
        const digits = value.replace(/\s+/g, '');
        return `+20${digits.replace(/^0/, '')}`;
    };

    const sendPhoneOtp = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!phone) {
            safeSetMessage({ type: 'error', text: 'Please enter your phone number.' }, 4000);
            return;
        }

        if (!isValidEgyptLocalPhone(phone)) {
            safeSetMessage({ type: 'error', text: 'Invalid Egyptian number. Example: 01012345678' }, 6000);
            return;
        }

        const e164 = normalizeEgyptPhoneToE164(phone);

        safeSetLoading(true);
        safeSetMessage(null);

        const { error } = await supabase.auth.signInWithOtp({ phone: e164 });

        if (error) {
            safeSetMessage({ type: 'error', text: prettyAuthError(error.message) }, 8000);
            setOtpSent(false);
            setPhoneE164('');
        } else {
            setOtpSent(true);
            setPhoneE164(e164);
            safeSetMessage({ type: 'success', text: 'OTP sent. Enter the code you received.' }, 8000);
        }

        safeSetLoading(false);
    };

    const verifyPhoneOtp = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!otp || !phoneE164) {
            safeSetMessage({ type: 'error', text: 'Please enter the OTP code.' }, 4000);
            return;
        }

        safeSetLoading(true);
        safeSetMessage(null);

        const { error } = await supabase.auth.verifyOtp({
            phone: phoneE164,
            token: otp,
            type: 'sms',
        });

        if (error) {
            safeSetMessage({ type: 'error', text: prettyAuthError(error.message) }, 8000);
        } else {
            safeSetMessage({ type: 'success', text: 'Signed in successfully.' }, 1200);
            setTimeout(() => {
                router.push(nextPath || '/');
                router.refresh();
            }, 1200);
        }

        safeSetLoading(false);
    };

    const tabId = (t: Tab) => `login-tab-${t}`;
    const panelId = (t: Tab) => `login-panel-${t}`;

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <div className="bg-card p-8 rounded-2xl shadow-lg w-full max-w-md border border-border space-y-6">
                <h1 className="text-2xl font-bold text-center text-[#00386C] dark:text-blue-400">
                    Welcome to AAST Events
                </h1>

                {/* Tabs */}
                <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Login methods">
                    <Button
                        id={tabId('google')}
                        role="tab"
                        aria-selected={tab === 'google'}
                        aria-controls={panelId('google')}
                        type="button"
                        variant={tab === 'google' ? 'default' : 'outline'}
                        onClick={() => setTab('google')}
                        className={tab === 'google' ? 'bg-[#00386C] hover:bg-[#00509d]' : ''}
                    >
                        Google
                    </Button>

                    <Button
                        id={tabId('phone')}
                        role="tab"
                        aria-selected={tab === 'phone'}
                        aria-controls={panelId('phone')}
                        type="button"
                        variant={tab === 'phone' ? 'default' : 'outline'}
                        onClick={() => setTab('phone')}
                        className={tab === 'phone' ? 'bg-[#00386C] hover:bg-[#00509d]' : ''}
                    >
                        Phone OTP
                    </Button>
                </div>

                {/* Google */}
                {tab === 'google' && (
                    <div id={panelId('google')} role="tabpanel" aria-labelledby={tabId('google')} className="space-y-3">
                        <Button
                            onClick={signInWithGoogle}
                            disabled={loading}
                            className="w-full bg-[#00386C] hover:bg-[#00509d] text-white"
                        >
                            {loading ? 'Opening Google…' : 'Continue with Google'}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            You’ll be redirected to Google to choose an account.
                        </p>
                    </div>
                )}

                {/* Phone */}
                {tab === 'phone' && (
                    <form id={panelId('phone')} role="tabpanel" aria-labelledby={tabId('phone')}
                        onSubmit={otpSent ? verifyPhoneOtp : sendPhoneOtp}
                        className="space-y-3"
                    >
                        <Input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="Egypt number (e.g., 01012345678)"
                            type="tel"
                            className="bg-card"
                            disabled={otpSent}
                            aria-label="Phone number"
                        />

                        {!otpSent ? (
                            <>
                                <Button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-[#00386C] hover:bg-[#00509d] text-white"
                                >
                                    {loading ? 'Sending…' : 'Send OTP'}
                                </Button>

                                <p className="text-xs text-muted-foreground">
                                    Phone OTP requires an SMS provider (Twilio/others). If it’s not configured yet, use Google login for now.
                                </p>
                            </>
                        ) : (
                            <>
                                <Input
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value)}
                                    placeholder="Enter 6-digit code"
                                    inputMode="numeric"
                                    maxLength={6}
                                    className="bg-card"
                                    autoFocus
                                    aria-label="OTP code"
                                />

                                <div className="flex gap-2">
                                    <Button
                                        type="submit"
                                        disabled={loading}
                                        className="flex-1 bg-[#00386C] hover:bg-[#00509d] text-white"
                                    >
                                        {loading ? 'Verifying…' : 'Verify'}
                                    </Button>

                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            setOtp('');
                                            setOtpSent(false);
                                            setPhoneE164('');
                                            safeSetMessage(null);
                                        }}
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </>
                        )}
                    </form>
                )}

                {/* Message */}
                {msg && (
                    <div
                        role="status"
                        aria-live="polite"
                        className={`p-3 rounded-lg text-sm border ${msg.type === 'success'
                            ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/20 dark:text-green-300 dark:border-green-900/40'
                            : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-300 dark:border-red-900/40'
                            }`}
                    >
                        {msg.text}
                    </div>
                )}

                <p className="text-center text-xs text-muted-foreground">
                    By continuing, you agree to our Terms &amp; Privacy Policy.
                </p>
            </div>
        </div>
    );
}