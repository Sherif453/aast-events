import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export interface AttendeeItem {
    profiles: {
        full_name: string | null;
        avatar_url: string | null;
    } | null;
}

interface AvatarStackProps {
    attendees: AttendeeItem[];
    totalCount: number;
    maxVisible?: number;
}

export function AvatarStack({ attendees, totalCount, maxVisible = 4 }: AvatarStackProps) {
    const safeMax = Math.max(1, maxVisible);
    const displayAttendees = attendees.slice(0, safeMax);
    const remaining = Math.max(0, totalCount - safeMax);

    const getInitials = (name: string | null) => {
        if (!name) return "?";
        return name
            .split(' ')
            .map(n => n.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className="flex items-center -space-x-3">
            {displayAttendees.map((a, i) => (
                <Avatar
                    key={i}
                    className="h-8 w-8 ring-2 ring-white bg-gray-200"
                >
                    <AvatarImage src={a.profiles?.avatar_url || ''} />
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                        {getInitials(a.profiles?.full_name ?? null)}
                    </AvatarFallback>
                </Avatar>
            ))}

            {remaining > 0 && (
                <div className="h-8 w-8 flex items-center justify-center bg-gray-300 text-gray-700 text-xs font-bold rounded-full ring-2 ring-white">
                    +{remaining}
                </div>
            )}
        </div>
    );
}
