"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Clock, User, Users } from "lucide-react";
import Image from "next/image";
import { passthroughImageLoader } from "@/lib/nextImageLoader";

export interface EventProps {
    id: string;
    created_at: string;
    title: string;
    image_url: string | null;
    organizer_name: string;
    location: string;
    campus: string;
    start_time: string;
    attendee_count: number; // RSVPs
    checked_in_count?: number; // checked-ins (optional)
    club_name?: string | null;
    club_id?: string | null;
}

const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);

    const day = date.getUTCDate();
    const month = date
        .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
        .toUpperCase();

    const formattedTime = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
    });

    return { day, month, time: formattedTime };
};

export function EventCard({
    event,
    viewMode = "grid",
}: {
    event: EventProps;
    viewMode?: "grid" | "list";
}) {
    const router = useRouter();
    const { day, month, time } = formatDateTime(event.start_time);

    const now = new Date();
    const start = new Date(event.start_time);
    const isPast = start < now;

    const displayCount = isPast
        ? (event.checked_in_count ?? event.attendee_count)
        : event.attendee_count;

    const displayLabel = isPast ? "attended" : "attending";

    // LIST VIEW
    if (viewMode === "list") {
        return (
            <div
                onClick={() => router.push(`/event/${Number(event.id)}`)}
                className="block rounded-2xl shadow-sm border border-border overflow-hidden hover:shadow-lg transition-all duration-300 cursor-pointer bg-card"
            >
                <div className="flex flex-col sm:flex-row">
	                    <div className="relative sm:w-64 flex-shrink-0">
	                        {event.image_url ? (
	                            <Image
	                                src={event.image_url}
	                                alt={event.title}
	                                width={800}
	                                height={480}
	                                className="w-full h-48 sm:h-full object-cover"
	                                sizes="(max-width: 640px) 100vw, 256px"
	                                loader={passthroughImageLoader}
	                                unoptimized
	                            />
	                        ) : (
	                            <div className="w-full h-48 sm:h-full bg-gradient-to-br from-[#00386C] to-[#00509d] flex items-center justify-center">
	                                <span className="text-xl font-black text-white/70 px-4 text-center">
	                                    {event.title}
                                </span>
                            </div>
                        )}

                        <div className="absolute top-4 left-4 bg-[#FFC333] text-[#00386C] font-extrabold text-center p-2 rounded-lg shadow-lg">
                            <div className="text-lg leading-none">{day}</div>
                            <div className="text-xs uppercase leading-none">{month}</div>
                        </div>
                    </div>

                    <div className="p-5 flex-1 flex flex-col justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-foreground mb-2">
                                {event.title}
                            </h2>

                            {event.club_name && event.club_id && (
                                <Link
                                    href={`/clubs/${event.club_id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-3 hover:bg-blue-500/20 dark:hover:bg-blue-500/30 transition border border-blue-500/30"
                                >
                                    <Users className="h-3 w-3" />
                                    {event.club_name}
                                </Link>
                            )}

                            <p className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-3">
                                <User className="h-4 w-4" />
                                {displayCount} {displayLabel}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center text-sm text-foreground">
                                <MapPin className="h-4 w-4 mr-2 text-[#00386C]" />
                                <span className="font-medium">
                                    {event.location} ({event.campus})
                                </span>
                            </div>
                            <div className="flex items-center text-sm text-foreground">
                                <Clock className="h-4 w-4 mr-2 text-[#00386C]" />
                                <span className="font-medium">{time}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // GRID VIEW
    return (
        <div
            onClick={() => router.push(`/event/${Number(event.id)}`)}
            className="block rounded-2xl shadow-xl overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:scale-[1.02] h-full flex flex-col cursor-pointer bg-card"
        >
	            <div className="relative flex-shrink-0">
	                {event.image_url ? (
	                    <Image
	                        src={event.image_url}
	                        alt={event.title}
	                        width={800}
	                        height={480}
	                        className="w-full h-48 object-cover"
	                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
	                        loader={passthroughImageLoader}
	                        unoptimized
	                    />
	                ) : (
	                    <div className="w-full h-48 bg-gradient-to-br from-[#00386C] to-[#00509d] flex items-center justify-center">
	                        <span className="text-2xl font-black text-white/70 px-4 text-center line-clamp-2">
	                            {event.title}
                        </span>
                    </div>
                )}

                <div className="absolute top-4 left-4 bg-[#FFC333] text-[#00386C] font-extrabold text-center p-2 rounded-lg shadow-lg">
                    <div className="text-lg leading-none">{day}</div>
                    <div className="text-xs uppercase leading-none">{month}</div>
                </div>

                {event.club_name && event.club_id && (
                    <div className="absolute top-4 right-4">
                        <Link
                            href={`/clubs/${event.club_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-900 dark:text-gray-100 text-xs font-semibold shadow-lg hover:bg-white dark:hover:bg-gray-800 transition border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
                        >
                            <Users className="h-3 w-3" />
                            {event.club_name}
                        </Link>
                    </div>
                )}
            </div>

            <div className="p-5 space-y-3 flex-1 flex flex-col">
                <h2 className="text-xl font-bold text-foreground line-clamp-2 min-h-[56px]">
                    {event.title}
                </h2>

                <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {displayCount} {displayLabel}
                </p>

                <div className="pt-3 border-t border-border space-y-2 mt-auto">
                    <div className="flex items-center text-sm text-foreground">
                        <MapPin className="h-4 w-4 mr-2 text-[#00386C]" />
                        <span className="font-medium truncate">
                            {event.location} ({event.campus})
                        </span>
                    </div>
                    <div className="flex items-center text-sm text-foreground">
                        <Clock className="h-4 w-4 mr-2 text-[#00386C]" />
                        <span className="font-medium">{time}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
