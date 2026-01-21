'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface ExportButtonsProps {
    eventId: string | null;
}

export default function ExportButtons({ eventId }: ExportButtonsProps) {
    const handleExport = (type: 'rsvps' | 'checked-in') => {
        const params = new URLSearchParams();
        if (eventId) params.append('eventId', eventId);
        params.append('type', type);

        window.open(`/api/admin/export-csv?${params.toString()}`, '_blank');
    };

    return (
        <div className="flex gap-2">
            <Button onClick={() => handleExport('rsvps')} variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                All RSVPs
            </Button>
            <Button
                onClick={() => handleExport('checked-in')}
                variant="outline"
                size="sm"
                className="border-green-300 text-green-600 hover:bg-green-50"
            >
                <Download className="h-4 w-4 mr-2" />
                Checked In Only
            </Button>
        </div>
    );
}