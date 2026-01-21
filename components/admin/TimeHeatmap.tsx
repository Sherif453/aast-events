'use client';

export default function TimeHeatmap({ data }: { data: { [key: string]: number } }) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = Array.from({ length: 24 }, (_, i) => i);

    const maxCount = Math.max(...Object.values(data));

    const getColor = (count: number) => {
        if (count === 0) return 'bg-gray-100';
        const intensity = Math.min((count / maxCount) * 100, 100);
        if (intensity < 25) return 'bg-blue-200';
        if (intensity < 50) return 'bg-blue-400';
        if (intensity < 75) return 'bg-blue-600';
        return 'bg-blue-800';
    };

    return (
        <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
                <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-1">
                    <div></div>
                    {hours.map((hour) => (
                        <div key={hour} className="text-xs text-center text-muted-foreground font-medium">
                            {hour}
                        </div>
                    ))}

                    {days.map((day, dayIndex) => (
                        <div key={day} className="contents">
                            <div className="text-xs text-muted-foreground font-medium pr-2">
                                {day}
                            </div>
                            {hours.map((hour) => {
                                const key = `${dayIndex}-${hour}`;
                                const count = data[key] || 0;
                                return (
                                    <div
                                        key={key}
                                        className={`h-8 rounded ${getColor(count)} relative group cursor-pointer`}
                                        title={`${day} ${hour}:00 - ${count} events`}
                                    >
                                        {count > 0 && (
                                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                                                {count}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}