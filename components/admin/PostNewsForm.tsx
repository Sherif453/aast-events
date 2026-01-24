'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Award, Megaphone, Newspaper, X } from 'lucide-react';

interface PostNewsFormProps {
    clubId: string;
    userId: string;
}

const BUCKET = 'club-news';

export default function PostNewsForm({ clubId, userId }: PostNewsFormProps) {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [type, setType] = useState<'news' | 'achievement' | 'announcement'>('news');

    const [imageUrl, setImageUrl] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [localPreviewUrl, setLocalPreviewUrl] = useState<string>('');

    const [loading, setLoading] = useState(false);

    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        if (!imageFile) {
            setLocalPreviewUrl('');
            return;
        }
        const url = URL.createObjectURL(imageFile);
        setLocalPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [imageFile]);

    const newsTypes = useMemo(
        () => [
            { value: 'news', label: 'News', icon: <Newspaper className="h-5 w-5" />, color: 'green' },
            { value: 'achievement', label: 'Achievement', icon: <Award className="h-5 w-5" />, color: 'yellow' },
            { value: 'announcement', label: 'Announcement', icon: <Megaphone className="h-5 w-5" />, color: 'blue' },
        ],
        []
    );

    const onPickFile = (file: File | null) => {
        if (!file) return;

        const allowed = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allowed.includes(file.type)) {
            alert('Please upload a PNG, JPG, or WEBP image.');
            return;
        }

        const maxMb = 5;
        if (file.size > maxMb * 1024 * 1024) {
            alert(`Image is too large. Max size is ${maxMb}MB.`);
            return;
        }

        setImageFile(file);
        setImageUrl('');
    };

    const clearImage = () => {
        setImageFile(null);
        setImageUrl('');
    };

    const uploadImageIfNeeded = async (): Promise<string | null> => {
        if (imageFile) {
            const safeName = imageFile.name.replace(/\s+/g, '-').replace(/[^\w.\-]/g, '');
            const path = `${clubId}/${Date.now()}-${safeName}`;

            const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, imageFile, {
                cacheControl: '3600',
                upsert: false,
                contentType: imageFile.type,
            });

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
            return data.publicUrl ?? null;
        }

        const url = imageUrl.trim();
        return url ? url : null;
    };

    //  Non-blocking fanout (DB-side) so we don't violate notifications RLS from the client
    const notifyFollowersNonBlocking = async (clubNewsId: string) => {
        try {
            // If you already created an RPC for this, we’ll use it.
            // If it doesn’t exist, this will error and we’ll just skip (no breaking post flow).
            const { error } = await supabase.rpc('notify_followers_club_news', {
                p_club_news_id: clubNewsId,
            });

            if (error) throw error;
        } catch (err) {
            console.warn('Follower notification skipped (non-critical):', err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title.trim() || !content.trim()) {
            alert('Please fill in all required fields');
            return;
        }

        setLoading(true);

        try {
            const finalImageUrl = await uploadImageIfNeeded();

            const { data: newsData, error } = await supabase
                .from('club_news')
                .insert([
                    {
                        club_id: clubId,
                        title: title.trim(),
                        content: content.trim(),
                        type,
                        image_url: finalImageUrl,
                        created_by: userId,
                    },
                ])
                .select()
                .single();

            if (error) throw error;

            //  Don’t do client-side follower reads / notifications inserts (RLS will block)
            if (newsData?.id) {
                await notifyFollowersNonBlocking(newsData.id);
            }

            alert('News posted successfully!');
            router.push('/admin/clubs');
            router.refresh();
        } catch (error: any) {
            console.error('Error posting news:', error);
            alert(`Failed to post news: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const previewSrc = localPreviewUrl || imageUrl.trim();
    const showPreview = Boolean(previewSrc);

    return (
        <form onSubmit={handleSubmit} className="bg-card rounded-xl shadow-sm border border-border p-8 space-y-6">
            <div>
                <Label className="text-foreground font-semibold mb-3 block">News Type *</Label>
                <div className="grid grid-cols-3 gap-3">
                    {newsTypes.map((newsType) => (
                        <button
                            key={newsType.value}
                            type="button"
                            onClick={() => setType(newsType.value as any)}
                            className={`p-4 rounded-lg border-2 transition flex flex-col items-center gap-2 ${type === newsType.value
                                ? newsType.color === 'green'
                                    ? 'border-green-500 bg-green-50 dark:bg-green-950'
                                    : newsType.color === 'yellow'
                                        ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950'
                                        : 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                                : 'border-border bg-background hover:bg-muted'
                                }`}
                        >
                            <span
                                className={
                                    type === newsType.value
                                        ? newsType.color === 'green'
                                            ? 'text-green-600 dark:text-green-400'
                                            : newsType.color === 'yellow'
                                                ? 'text-yellow-600 dark:text-yellow-400'
                                                : 'text-blue-600 dark:text-blue-400'
                                        : 'text-muted-foreground'
                                }
                            >
                                {newsType.icon}
                            </span>
                            <span className={`text-sm font-semibold ${type === newsType.value ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {newsType.label}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <Label htmlFor="title" className="text-foreground font-semibold">
                    Title *
                </Label>
                <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter news title"
                    required
                    maxLength={200}
                    className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">{title.length}/200 characters</p>
            </div>

            <div>
                <Label htmlFor="content" className="text-foreground font-semibold">
                    Content *
                </Label>
                <Textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Write your news content here..."
                    required
                    rows={8}
                    maxLength={2000}
                    className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">{content.length}/2000 characters</p>
            </div>

            <div className="space-y-3">
                <Label className="text-foreground font-semibold">Cover Image (Optional)</Label>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
                    <div className="space-y-2">
                        <Label htmlFor="imageUpload" className="text-sm text-muted-foreground">
                            Upload Image
                        </Label>

                        <div className="flex items-center gap-3">
                            <Input
                                id="imageUpload"
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                                className="h-10"
                            />
                            {(imageFile || imageUrl.trim()) && (
                                <Button type="button" variant="outline" onClick={clearImage} className="h-10 shrink-0">
                                    <X className="h-4 w-4 mr-2" />
                                    Remove
                                </Button>
                            )}
                        </div>

                        <p className="text-xs text-muted-foreground">PNG / JPG / WEBP (max 5MB)</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="imageUrl" className="text-sm text-muted-foreground">
                            Or paste Image URL
                        </Label>

                        <div className="flex items-center gap-3">
                            <Input
                                id="imageUrl"
                                type="url"
                                value={imageUrl}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setImageUrl(v);
                                    if (v.trim()) setImageFile(null);
                                }}
                                placeholder="https://example.com/image.jpg"
                                className="h-10"
                            />

                            <div className="hidden md:block w-[108px]" />
                        </div>

                        <p className="text-xs text-muted-foreground">Paste a direct image URL</p>
                    </div>
                </div>

                {showPreview && (
                    <div className="mt-2 border border-border rounded-lg overflow-hidden">
                        <img
                            src={previewSrc}
                            alt="Preview"
                            className="w-full h-48 object-cover"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    </div>
                )}
            </div>

            <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700 flex-1">
                    {loading ? 'Posting...' : 'Post News'}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.push('/admin/clubs')} disabled={loading}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}
