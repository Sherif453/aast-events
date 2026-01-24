'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plus, QrCode } from "lucide-react";
import { useRouter } from "next/navigation";
import QRCodeDisplay from "./QRCodeDisplay";

interface RSVPButtonProps {
    eventId: string;
    eventTitle: string;
    userId: string | null;
    userName: string | null;
    initialAttendanceStatus: boolean;
    startTime?: string; //  used to lock RSVP after 24h
}

export default function RSVPButton({
    eventId,
    eventTitle,
    userName,
    initialAttendanceStatus,
    startTime,
}: RSVPButtonProps) {
    const [isAttending, setIsAttending] = useState(initialAttendanceStatus);
    const [showQR, setShowQR] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);

    //  RSVP lock: block actions 24 hours after start time
    const isRSVPLocked = useMemo(() => {
        if (!startTime) return false;
        const start = new Date(startTime).getTime();
        const lockAt = start + 24 * 60 * 60 * 1000;
        return Date.now() >= lockAt;
    }, [startTime]);

    //  Refetch RSVP status for current session user
    const refetchMyAttendance = useCallback(async (uid: string) => {
        const { data, error } = await supabase
            .from("attendees")
            .select("id")
            .eq("event_id", eventId)
            .eq("user_id", uid)
            .maybeSingle();

        if (error) return;

        const attendingNow = !!data;
        setIsAttending(attendingNow);
    }, [eventId, supabase]);

    //  Fix: after login/logout, update state + refresh + refetch RSVP immediately
    useEffect(() => {
        let isMounted = true;

        (async () => {
            const { data: sessionData } = await supabase.auth.getSession();
            const uid = sessionData?.session?.user?.id ?? null;
            if (!isMounted) return;

            if (uid) {
                await refetchMyAttendance(uid);
            } else {
                // logged out
                setIsAttending(false);
            }
        })();

        const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
            const uid = session?.user?.id ?? null;

            if (uid) {
                await refetchMyAttendance(uid);
            } else {
                setIsAttending(false);
            }

            // Keep server parts in sync (attendeeCount, stacks, etc.)
            router.refresh();
        });

        return () => {
            isMounted = false;
            sub.subscription.unsubscribe();
        };
    }, [eventId, router, supabase, refetchMyAttendance]);

    const handleRSVP = async () => {
        if (isRSVPLocked) {
            alert("This event is closed. Catch us next time!");
            return;
        }

        setIsLoading(true);

        try {
            //  Logged out => go to login page (NOT direct Google OAuth)
            const { data: sessionData } = await supabase.auth.getSession();
            const uid = sessionData?.session?.user?.id ?? null;

            if (!uid) {
                const next = `/event/${eventId}`;
                router.push(`/auth/login?next=${encodeURIComponent(next)}`);
                return;
            }

            if (isAttending) {
                const { error } = await supabase
                    .from("attendees")
                    .delete()
                    .eq("event_id", eventId)
                    .eq("user_id", uid);

                if (error) throw error;

                setIsAttending(false);
            } else {
                const { data, error } = await supabase
                    .from("attendees")
                    .insert({
                        event_id: eventId,
                        user_id: uid,
                    })
                    .select("id")
                    .single();

                if (error) throw error;

                setIsAttending(true);
                void data;
            }

            //  keep rest of page (counts, lists) in sync
            router.refresh();
        } catch (error: any) {
            console.error("RSVP Error:", error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const primaryText = (() => {
        if (isRSVPLocked) {
            return isAttending ? "Event Closed" : "Catch us next time";
        }
        return isAttending ? "You are going!" : "Count Me In";
    })();

    return (
        <>
            <div className="space-y-2">
                <Button
                    onClick={handleRSVP}
                    disabled={isLoading || isRSVPLocked}
                    className={`w-full shadow-lg transition ${isAttending
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-blue-900 hover:bg-blue-700 text-white"
                        }`}
                >
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isAttending ? (
                        <>
                            <Check className="h-4 w-4 mr-2" /> {primaryText}
                        </>
                    ) : (
                        <>
                            <Plus className="h-4 w-4 mr-2" /> {primaryText}
                        </>
                    )}
                </Button>

                {isAttending && (
                    <Button
                        onClick={() => setShowQR(true)}
                        variant="outline"
                        className="w-full border-[#00386C] text-[#00386C] hover:bg-[#00386C] hover:text-white"
                    >
                        <QrCode className="h-4 w-4 mr-2" />
                        Show My Ticket
                    </Button>
                )}
            </div>

            {showQR && (
                <QRCodeDisplay
                    eventId={eventId}
                    eventTitle={eventTitle}
                    userName={userName || "Student"}
                    onClose={() => setShowQR(false)}
                />
            )}
        </>
    );
}
