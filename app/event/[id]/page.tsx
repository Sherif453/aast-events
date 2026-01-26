import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { ReactNode } from "react";
import {
    MapPin,
    Calendar,
    Clock,
    User,
    Users,
    ClipboardCheck,
    ArrowLeft,
    RefreshCcw,
} from "lucide-react";

import { EventProps } from "@/components/EventCard";
import RSVPButton from "@/components/RSVPButton";
import { AvatarStack, AttendeeItem } from "@/components/AvatarStack";
import { AttendeesList } from "@/components/AttendeesList";
import EventReminderButton from "@/components/EventReminderButton";

export const revalidate = 0;
//  Ensure the page re-renders properly after auth changes (prevents “needs reload” issues)
export const dynamic = "force-dynamic";

const getEventStatus = (startTime: string) => {
    const now = new Date();
    const start = new Date(startTime);

    const concludedAt = new Date(start.getTime() + 4 * 60 * 60 * 1000); //  concluded after 4 hours

    if (now >= concludedAt) {
        return { text: "Event Concluded", className: "bg-gray-800 text-white border-2 border-gray-600" };
    }

    if (now >= start) {
        return { text: "In Progress", className: "bg-green-600 text-white" };
    }

    if (start.getTime() - now.getTime() < 86400000 * 3) {
        return { text: "Happening Soon!", className: "bg-green-600 text-white" };
    }

    return { text: "Upcoming", className: "bg-blue-600 text-white" };
};

type AdminRole = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";

export default async function EventDetailsPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: eventId } = await params;
    const supabase = await createClient();

    //  : use getUser() for verified auth data (avoid session-user warning)
    let user: any = null;
    try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();

        // Only warn if it's NOT the common “missing session” case.
        if (userErr && (userErr as any)?.name !== "AuthSessionMissingError") {
            console.warn("[EventDetails] getUser error:", {
                message: (userErr as any).message,
                code: (userErr as any).code,
            });
        }

        user = userData?.user ?? null;
    } catch (e: any) {
        // Keep it non-fatal and non-overlay-ish
        console.warn("[EventDetails] getUser threw:", { message: e?.message });
        user = null;
    }

    const userId = user?.id ?? null;

    //  SAFE: Wrapped event fetch with detailed error handling
    const { data: event, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

    //  SAFE: Distinguish between "not found" and "network error"
    if (error) {
        console.error("Event fetch error:", error);

        const isNotFound = error.code === "PGRST116" || error.message?.includes("0 rows");

        if (isNotFound || !event) {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center p-4 text-muted-foreground">
                    <h1 className="text-2xl font-bold">Event Not Found</h1>
                    <Link href="/" className="mt-4 text-blue-600 hover:text-blue-700 underline transition">
                        Return Home
                    </Link>
                </div>
            );
        }

        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-4">
                <div className="text-center max-w-md bg-card border border-border rounded-2xl p-8 shadow-lg">
                    <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/20">
                        <RefreshCcw className="h-8 w-8 text-red-600 dark:text-red-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-foreground mb-3">Connection Error</h1>
                    <p className="text-muted-foreground mb-6">
                        We&apos;re having trouble loading this event. Please check your internet connection and try again.
                    </p>
                    <div className="flex gap-3 justify-center">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold transition inline-flex items-center gap-2"
                        >
                            <RefreshCcw className="h-4 w-4" />
                            Retry
                        </button>
                        <Link
                            href="/"
                            className="px-6 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 font-semibold transition"
                        >
                            Go Home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (!event) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 text-muted-foreground">
                <h1 className="text-2xl font-bold">Event Not Found</h1>
                <Link href="/" className="mt-4 text-blue-600 hover:text-blue-700 underline transition">
                    Return Home
                </Link>
            </div>
        );
    }

    //  SAFE: Fetch admin role + club_id (if logged in)
    const { data: adminRow } = userId
        ? await supabase
            .from("admin_users")
            .select("role, club_id")
            .eq("id", userId)
            .maybeSingle()
        : { data: null as any };

    const adminRole = (adminRow?.role as AdminRole | undefined) ?? undefined;
    const adminClubId = adminRow?.club_id ?? null;

    const isAdmin = !!adminRow;

    //  UI guard for showing check-in link (scoped)
    const canSeeCheckin =
        adminRole === "super_admin" ||
        ((adminRole === "club_admin" || adminRole === "event_volunteer") &&
            !!event.club_id &&
            !!adminClubId &&
            adminClubId === event.club_id);

    const { data: rawAttendees } = await supabase
        .from("attendees")
        .select("user_id, created_at, checked_in")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

    let attendees: AttendeeItem[] = [];
    if (rawAttendees && rawAttendees.length > 0) {
        const userIds = rawAttendees.map((a) => a.user_id);

        //  : use PUBLIC profiles here so normal users don't break on RLS
        const { data: profilesData } = await supabase
            .from("profiles_public")
            .select("id, full_name, avatar_url")
            .in("id", userIds);

        attendees = rawAttendees.map((a) => {
            const profile = profilesData?.find((p) => p.id === a.user_id);
            return {
                profiles: {
                    full_name: profile?.full_name ?? null,
                    avatar_url: profile?.avatar_url ?? null,
                },
            };
        });
    }

    const { count: attendeeCount } = await supabase
        .from("attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId);

    const { count: checkedInCount } = await supabase
        .from("attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("checked_in", true);

    // Check user's attendance status
    const { data: myAttendance } = userId
        ? await supabase
            .from("attendees")
            .select("id")
            .eq("event_id", eventId)
            .eq("user_id", userId)
            .maybeSingle()
        : { data: null };

    const isAttending = !!myAttendance;

    // Get user profile for RSVP button (self-only is fine)
    const { data: userProfile } = userId
        ? await supabase.from("profiles").select("full_name").eq("id", userId).single()
        : { data: null };

    const currentEvent = event as EventProps & { description: string | null };

    const dateObj = new Date(currentEvent.start_time);
    const formattedDate = dateObj.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const formattedTime = dateObj.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });

    const status = getEventStatus(currentEvent.start_time);
    const isConcluded = status.text === "Event Concluded";
    const heroSrc = currentEvent.image_url || "";

    return (
        <div className="min-h-screen bg-background pb-20">
            <div className="relative w-full">
                <div className="relative h-[400px] w-full overflow-hidden bg-muted">
                    {heroSrc ? (
                        <img src={heroSrc} alt={currentEvent.title} className="h-full w-full object-cover object-center" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
                            <h1 className="text-3xl font-black text-white/30 px-8 text-center">{currentEvent.title}</h1>
                        </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent pointer-events-none" />

                    <Link
                        href="/"
                        aria-label="Go back to home"
                        className="absolute left-6 top-6 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/75 transition shadow-lg"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </div>

                <div className="relative z-20 -mt-16 w-full">
                    <div
                        className={`absolute right-6 top-0 z-40 -translate-y-1/2 rounded-full px-5 py-2.5 text-sm font-bold shadow-xl backdrop-blur-sm ${status.className}`}
                    >
                        {status.text}
                    </div>

                    <div className="w-full rounded-t-[32px] bg-background border-t border-border shadow-[0_-12px_30px_-20px_rgba(0,0,0,0.45)]">
                        <div className="mx-auto max-w-6xl px-6 pt-6 pb-10">
                            <div className="flex items-center gap-4 flex-wrap mb-4">
                                <h1 className="text-3xl font-extrabold text-foreground leading-tight">{currentEvent.title}</h1>

                                {!isConcluded && (
                                    <EventReminderButton
                                        eventId={event.id}
                                        initialUserId={userId}
                                    />
                                )}
                            </div>

                            <p className="text-sm font-bold text-yellow-500 uppercase tracking-wide mb-6">
                                Hosted by {currentEvent.organizer_name}
                            </p>

                            {isAdmin && canSeeCheckin && (
                                <Link
                                    href={`/event/${event.id}/checkin`}
                                    className="mb-6 inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition"
                                >
                                    <ClipboardCheck className="h-5 w-5" />
                                    Check-In Dashboard ({checkedInCount}/{attendeeCount} checked in)
                                </Link>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                                <DetailItem icon={<Calendar />} label="Date" value={formattedDate} />
                                <DetailItem icon={<Clock />} label="Time" value={formattedTime} />
                                <DetailItem icon={<MapPin />} label="Location" value={currentEvent.location} />
                                <DetailItem icon={<User />} label="Campus" value={currentEvent.campus} />
                            </div>

                            <div className="bg-card rounded-2xl p-5 border border-border mb-8 shadow-sm">
                                <h2 className="text-xl font-bold text-foreground mb-3">Description</h2>
                                <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                    {currentEvent.description || "No description provided."}
                                </p>
                            </div>

                            <div className="bg-card rounded-2xl p-5 border border-border mb-8 shadow-sm">
                                <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
                                    <div>
                                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{attendeeCount ?? 0} Going</span>
                                        <span className="block text-xs text-muted-foreground">Join your classmates!</span>
                                    </div>

                                    <AvatarStack attendees={attendees} totalCount={attendeeCount ?? 0} maxVisible={5} />
                                </div>

                                <RSVPButton
                                    eventId={eventId}
                                    eventTitle={currentEvent.title}
                                    userId={userId}
                                    userName={userProfile?.full_name || user?.user_metadata?.full_name || null}
                                    initialAttendanceStatus={isAttending}
                                    startTime={currentEvent.start_time}
                                />
                            </div>

                            {attendeeCount && attendeeCount > 0 && (
                                <div className="bg-card rounded-2xl p-5 border border-border mb-8 shadow-sm">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                        <h2 className="text-lg font-bold text-foreground">Who&apos;s Going ({attendeeCount})</h2>
                                    </div>
                                    <AttendeesList attendees={attendees} scrollAfter={10} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DetailItem({
    icon,
    label,
    value,
}: {
    icon: ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-muted border border-border">
            <div className="text-blue-600 dark:text-blue-400 flex-shrink-0">{icon}</div>
            <div className="min-w-0">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</div>
                <div className="text-sm font-semibold text-foreground break-words">{value}</div>
            </div>
        </div>
    );
}
