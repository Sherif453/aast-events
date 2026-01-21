'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface DeleteEventButtonProps {
    eventId: string;
    eventTitle: string;
    enabled?: boolean; // NEW
}

export default function DeleteEventButton({ eventId, eventTitle, enabled = true }: DeleteEventButtonProps) {
    const [isDeleting, setIsDeleting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    if (!enabled) return null;

    const handleDelete = async () => {
        setIsDeleting(true);

        try {
            const { error } = await supabase.from('events').delete().eq('id', eventId);

            if (error) throw error;

            router.refresh();
        } catch (error: any) {
            console.error('Delete error:', error);
            alert(`Failed to delete event: ${error.message}`);
        } finally {
            setIsDeleting(false);
            setShowConfirm(false);
        }
    };

    if (showConfirm) {
        return (
            <div className="flex gap-2">
                <Button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white"
                    title={`Delete "${eventTitle}"`}
                >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
                </Button>
                <Button onClick={() => setShowConfirm(false)} variant="outline" size="sm">
                    Cancel
                </Button>
            </div>
        );
    }

    return (
        <Button
            onClick={() => setShowConfirm(true)}
            variant="outline"
            size="sm"
            className="border-red-300 text-red-600 hover:bg-red-50"
            title={`Delete "${eventTitle}"`}
        >
            <Trash2 className="h-4 w-4" />
        </Button>
    );
}
