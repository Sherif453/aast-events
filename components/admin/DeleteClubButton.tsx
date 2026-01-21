'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DeleteClubButton({ clubId, clubName }: { clubId: string; clubName: string }) {
    const [isDeleting, setIsDeleting] = useState(false);
    const router = useRouter();
    const supabase = createClient();

    const handleDelete = async () => {
        if (!confirm(`Are you sure you want to delete "${clubName}"? This will also delete all associated events and cannot be undone.`)) {
            return;
        }

        setIsDeleting(true);

        try {
            const { error } = await supabase
                .from('clubs')
                .delete()
                .eq('id', clubId);

            if (error) throw error;

            router.refresh();
        } catch (error: any) {
            console.error('Delete error:', error);
            alert(`Failed to delete club: ${error.message}`);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Button
            onClick={handleDelete}
            disabled={isDeleting}
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50"
        >
            {isDeleting ? (
                <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                </>
            ) : (
                <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                </>
            )}
        </Button>
    );
}