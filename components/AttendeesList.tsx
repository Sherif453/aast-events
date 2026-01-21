import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { AttendeeItem } from "@/components/AvatarStack";

interface AttendeesListProps {
    attendees: AttendeeItem[];
}

export function AttendeesList({ attendees }: AttendeesListProps) {
    if (attendees.length === 0) {
        return (
            <p className="text-sm text-gray-500 text-center py-4">
                No attendees yet. Be the first to RSVP!
            </p>
        );
    }

    return (
        <div className="space-y-3 max-h-96 overflow-y-auto">
            {attendees.map((attendee, index) => {
                const name = attendee.profiles?.full_name || "Anonymous User";
                const initials = name
                    .split(' ')
                    .map(n => n.charAt(0))
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                return (
                    <div
                        key={index}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition"
                    >
                        <Avatar className="h-10 w-10 ring-2 ring-blue-100">
                            <AvatarImage
                                src={attendee.profiles?.avatar_url || ''}
                                alt={name}
                            />
                            <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-semibold">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-foreground">
                                {name}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}