'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Loader2, Save, X, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';

type AdminRole = 'super_admin' | 'club_admin' | 'event_volunteer';

interface EventFormProps {
    mode: 'create' | 'edit';
    clubs: { id: string; name: string }[];
    userId: string;
    role: AdminRole;
    adminClubId: string | null;
    initialData?: any;
}

export default function EventForm({ mode, clubs, userId, role, adminClubId, initialData }: EventFormProps) {
    const isSuperAdmin = role === 'super_admin';

    // For club_admin / event_volunteer, this must be forced
    const forcedClubId = useMemo(() => {
        if (isSuperAdmin) return null;
        // create/edit pages already filter clubs to one + block if missing, so this should exist
        return adminClubId || (clubs?.[0]?.id ?? null);
    }, [isSuperAdmin, adminClubId, clubs]);

    const [formData, setFormData] = useState({
        title: initialData?.title || '',
        description: initialData?.description || '',
        location: initialData?.location || '',
        campus: initialData?.campus || '',
        organizer_name: initialData?.organizer_name || '',
        start_time: initialData?.start_time
            ? new Date(initialData.start_time).toISOString().slice(0, 16)
            : '',
        image_url: initialData?.image_url || '',
        club_id: initialData?.club_id || (forcedClubId || ''),
    });

    // Ensure non-super admins can never clear/change club_id (prevents RLS failures)
    useEffect(() => {
        if (!isSuperAdmin && forcedClubId) {
            setFormData((prev) => {
                if (prev.club_id !== forcedClubId) {
                    return { ...prev, club_id: forcedClubId };
                }
                return prev;
            });
        }
    }, [isSuperAdmin, forcedClubId]);

    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(
        initialData?.image_url || initialData?.image_file || null
    );
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const router = useRouter();
    const supabase = createClient();

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert('Image must be less than 5MB');
            return;
        }

        setImageFile(file);

        const reader = new FileReader();
        reader.onloadend = () => {
            setImagePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const removeImage = () => {
        setImageFile(null);
        setImagePreview(null);
        setFormData({ ...formData, image_url: '' });
    };

    const uploadImage = async (): Promise<string | null> => {
        if (!imageFile) return null;

        try {
            const fileExt = imageFile.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
            const filePath = `events/${fileName}`;

            setUploadProgress(30);

            const { error: uploadError } = await supabase.storage
                .from('event-images')
                .upload(filePath, imageFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            setUploadProgress(70);

            const { data: { publicUrl } } = supabase.storage
                .from('event-images')
                .getPublicUrl(filePath);

            setUploadProgress(100);
            return publicUrl;
        } catch (error: any) {
            console.error('Image upload error:', error);
            alert(`Failed to upload image: ${error.message}`);
            return null;
        }
    };

    const notifyClubFollowers = async (eventId: number) => {
        try {
            // Option B: DB-side notification fanout via RPC
            const { data, error } = await supabase.rpc('notify_followers_new_event', {
                p_event_id: eventId
            });

            if (error) throw error;

            console.log(' RPC notified followers:', data);
        } catch (error) {
            console.error('Failed to notify followers (non-critical):', error);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            let imageUrl = formData.image_url;

            // Step 1: Upload image if needed
            if (imageFile) {
                console.log('📤 Uploading image...');
                const uploadedUrl = await uploadImage();
                if (uploadedUrl) {
                    imageUrl = uploadedUrl;
                    console.log(' Image uploaded:', uploadedUrl);
                } else {
                    throw new Error('Image upload failed');
                }
            }

            // Step 2: Prepare event data
            const eventData = {
                ...formData,
                image_url: imageUrl || null,
                image_file: imageUrl || null,
                club_id: formData.club_id || null,
                created_by: userId,
            };

            console.log('📝 Event data:', eventData);

            // Step 3: Insert or update event
            if (mode === 'create') {
                console.log('🆕 Creating event...');
                const { data: newEvent, error } = await supabase
                    .from('events')
                    .insert([eventData])
                    .select('id')
                    .single();

                if (error) {
                    console.error(' Supabase insert error:', error);
                    throw error;
                }

                console.log(' Event created with ID:', newEvent?.id);

                // Step 4: Notify followers via RPC (only if club event)
                if (formData.club_id && newEvent?.id) {
                    console.log('🔔 Notifying followers via RPC...');
                    await notifyClubFollowers(newEvent.id);
                }
            } else {
                console.log('✏️ Updating event...');
                const { error } = await supabase
                    .from('events')
                    .update(eventData)
                    .eq('id', initialData.id);

                if (error) {
                    console.error(' Supabase update error:', error);
                    throw error;
                }

                console.log(' Event updated successfully');
            }

            console.log('🎉 Success! Redirecting...');
            router.push('/admin/events');
            router.refresh();
        } catch (error: any) {
            console.error(' Submit error details:', {
                message: error?.message,
                code: error?.code,
                details: error?.details,
                hint: error?.hint,
                fullError: error
            });

            const errorMessage = error?.message || error?.details || 'Unknown error occurred';
            alert(`Failed to ${mode} event: ${errorMessage}`);
        } finally {
            setIsSubmitting(false);
            setUploadProgress(0);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-card rounded-xl shadow-sm border border-border p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                    <Label htmlFor="title">Event Title *</Label>
                    <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        required
                        className="mt-1"
                        placeholder="e.g., AI Workshop 2026"
                    />
                </div>

                <div className="md:col-span-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                            setFormData({ ...formData, description: e.target.value })
                        }
                        className="mt-1"
                        rows={4}
                        placeholder="Describe your event..."
                    />
                </div>

                <div className="md:col-span-2">
                    <Label>Event Image</Label>
                    <div className="mt-2 space-y-3">
                        {imagePreview ? (
                            <div className="relative">
                                <img
                                    src={imagePreview}
                                    alt="Preview"
                                    className="w-full h-64 object-cover rounded-lg border border-border"
                                />
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    className="absolute top-2 right-2"
                                    onClick={removeImage}
                                >
                                    <X className="h-4 w-4 mr-1" />
                                    Remove
                                </Button>
                            </div>
                        ) : (
                            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition cursor-pointer">
                                <input
                                    type="file"
                                    id="image-upload"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="hidden"
                                />
                                <label htmlFor="image-upload" className="cursor-pointer flex flex-col items-center">
                                    <ImageIcon className="h-12 w-12 text-muted-foreground mb-3" />
                                    <span className="text-sm font-medium text-foreground">
                                        Click to upload image
                                    </span>
                                    <span className="text-xs text-muted-foreground mt-1">
                                        PNG, JPG, WebP up to 5MB
                                    </span>
                                </label>
                            </div>
                        )}

                        {uploadProgress > 0 && uploadProgress < 100 && (
                            <div className="w-full bg-muted rounded-full h-2">
                                <div
                                    className="bg-primary h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        )}

                        {!imagePreview && (
                            <div className="text-center">
                                <span className="text-sm text-muted-foreground">OR</span>
                                <Input
                                    type="url"
                                    value={formData.image_url}
                                    onChange={(e) => {
                                        setFormData({ ...formData, image_url: e.target.value });
                                        if (e.target.value) setImagePreview(e.target.value);
                                    }}
                                    placeholder="Paste image URL"
                                    className="mt-2"
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <Label htmlFor="start_time">Start Time *</Label>
                    <Input
                        id="start_time"
                        type="datetime-local"
                        value={formData.start_time}
                        onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                        required
                        className="mt-1"
                    />
                </div>

                <div>
                    <Label htmlFor="location">Location *</Label>
                    <Input
                        id="location"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        required
                        className="mt-1"
                        placeholder="e.g., Engineering Hall"
                    />
                </div>

                <div>
                    <Label htmlFor="campus">Campus *</Label>
                    <select
                        id="campus"
                        value={formData.campus}
                        onChange={(e) => setFormData({ ...formData, campus: e.target.value })}
                        required
                        className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
                    >
                        <option value="">Select Campus</option>
                        <option value="Abu Qir">Abu Qir</option>
                        <option value="Miami">Miami</option>
                    </select>
                </div>

                <div>
                    <Label htmlFor="organizer_name">Organizer Name *</Label>
                    <Input
                        id="organizer_name"
                        value={formData.organizer_name}
                        onChange={(e) => setFormData({ ...formData, organizer_name: e.target.value })}
                        required
                        className="mt-1"
                        placeholder="e.g., IEEE AAST"
                    />
                </div>

                <div>
                    <Label htmlFor="club_id">{isSuperAdmin ? 'Club (Optional)' : 'Club *'}</Label>
                    <select
                        id="club_id"
                        value={formData.club_id}
                        onChange={(e) => setFormData({ ...formData, club_id: e.target.value })}
                        disabled={!isSuperAdmin}
                        className="mt-1 w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground disabled:opacity-60"
                    >
                        {isSuperAdmin && <option value="">No Club</option>}
                        {clubs.map((club) => (
                            <option key={club.id} value={club.id}>
                                {club.name}
                            </option>
                        ))}
                    </select>

                    {formData.club_id && (
                        <p className="text-xs text-muted-foreground mt-1">
                            📢 Followers of this club will be notified about this event
                        </p>
                    )}
                </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-border">
                <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
                    {isSubmitting ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {mode === 'create' ? 'Creating...' : 'Saving...'}
                        </>
                    ) : (
                        <>
                            <Save className="h-4 w-4 mr-2" />
                            {mode === 'create' ? 'Create Event' : 'Save Changes'}
                        </>
                    )}
                </Button>
                <Link href="/admin/events">
                    <Button type="button" variant="outline">
                        Cancel
                    </Button>
                </Link>
            </div>
        </form>
    );
}
