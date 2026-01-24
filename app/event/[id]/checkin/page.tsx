import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CheckInInterface from "@/components/CheckInInterface";

type AdminRole = "super_admin" | "club_admin" | "event_volunteer" | "read_only_analytics";

type ProfileRow = {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
};

export default async function CheckInPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id: eventId } = await params;
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/auth/login");

    //  Fetch admin role + club scope
    const { data: adminData, error: adminErr } = await supabase
        .from("admin_users")
        .select("id, role, club_id")
        .eq("id", user.id)
        .maybeSingle();

    if (adminErr) {
        console.error("Admin fetch error:", adminErr);
        redirect("/");
    }
    if (!adminData) redirect("/");

    const adminRole = adminData.role as AdminRole;
    const adminClubId = adminData.club_id ?? null;

    //  Fetch event details
    const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

    if (eventError || !event) {
        console.error("Event fetch error:", eventError);
        redirect("/");
    }

    const eventClubId = event.club_id ?? null;

    //  Allow access only if:
    // super_admin OR (club_admin/event_volunteer AND same club)
    const isAllowed =
        adminRole === "super_admin" ||
        (eventClubId &&
            (adminRole === "club_admin" || adminRole === "event_volunteer") &&
            adminClubId === eventClubId);

    if (!isAllowed) redirect("/");

    //  Fetch RSVPs
    const { data: rawAttendees, error: attendeesErr } = await supabase
        .from("attendees")
        .select("id, user_id, checked_in, checked_in_at, qr_code, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });

    if (attendeesErr) {
        console.error("Attendees fetch error:", attendeesErr);
    }

    //  Fetch profiles (robust)
    let attendees: any[] = [];
    if (rawAttendees && rawAttendees.length > 0) {
        const userIds = Array.from(new Set(rawAttendees.map((a) => a.user_id)));

        // 1) Try private profiles first (should work for super_admin / club_admin / analytics + after policy for volunteer)
        const { data: profilesData, error: profilesErr } = await supabase
            .from("profiles")
            .select("id, full_name, email, avatar_url")
            .in("id", userIds);

        if (profilesErr) {
            console.error("Profiles fetch error:", profilesErr);
        }

        const profileMap = new Map<string, ProfileRow>();
        (profilesData ?? []).forEach((p) => profileMap.set(p.id, p as ProfileRow));

        // 2) If some are missing, try public fallback for missing ones
        const missingIds = userIds.filter((id) => !profileMap.has(id));

        if (missingIds.length > 0) {
            const { data: pubProfiles, error: pubErr } = await supabase
                .from("profiles_public")
                .select("id, full_name, email, avatar_url")
                .in("id", missingIds);

            // If profiles_public doesn't have email/avatar_url in your schema, Supabase will error.
            // In that case, you can change the select to only: "id, full_name"
            if (pubErr) {
                console.error("Profiles_public fetch error:", pubErr);
            } else {
                (pubProfiles ?? []).forEach((p: any) => {
                    // Only fill missing
                    if (!profileMap.has(p.id)) {
                        profileMap.set(p.id, {
                            id: p.id,
                            full_name: p.full_name ?? null,
                            email: p.email ?? null,
                            avatar_url: p.avatar_url ?? null,
                        });
                    }
                });
            }
        }

        attendees = rawAttendees.map((a) => {
            const profile = profileMap.get(a.user_id);
            return {
                id: a.id,
                user_id: a.user_id,
                checked_in: a.checked_in,
                checked_in_at: a.checked_in_at,
                qr_code: a.qr_code,
                profiles: {
                    full_name: profile?.full_name || "Unknown User",
                    email: profile?.email || null,
                    avatar_url: profile?.avatar_url || null,
                },
            };
        });
    }

    return (
        <CheckInInterface
            eventId={eventId}
            eventTitle={event?.title || "Event"}
            eventStartTime={event?.start_time}
            attendees={attendees}
            adminId={user.id}
        />
    );
}