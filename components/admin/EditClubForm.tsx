'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Save, X, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';

export default function EditClubForm({ club, userId }: { club: any; userId: string }) {
    void userId;

    const [formData, setFormData] = useState({
        name: club.name || '',
        description: club.description || '',
        image_url: club.image_url || '',
    });
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(club.image_url || null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const router = useRouter();
    const supabase = createClient();

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        if (file.size > 3 * 1024 * 1024) {
            alert('Logo must be less than 3MB');
            return;
        }

        setLogoFile(file);

        const reader = new FileReader();
        reader.onloadend = () => {
            setLogoPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const removeLogo = () => {
        setLogoFile(null);
        setLogoPreview(null);
        setFormData({ ...formData, image_url: '' });
    };

    const uploadLogo = async (): Promise<string | null> => {
        if (!logoFile) return null;

        try {
            const fileExt = logoFile.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
            const filePath = `clubs/${fileName}`;

            setUploadProgress(30);

            const { error: uploadError } = await supabase.storage
                .from('club-logos')
                .upload(filePath, logoFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) throw uploadError;

            setUploadProgress(70);

            const { data: { publicUrl } } = supabase.storage
                .from('club-logos')
                .getPublicUrl(filePath);

            setUploadProgress(100);
            return publicUrl;
        } catch (error: any) {
            console.error('Logo upload error:', error);
            alert(`Failed to upload logo: ${error.message}`);
            return null;
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            let logoUrl = formData.image_url;

            if (logoFile) {
                const uploadedUrl = await uploadLogo();
                if (uploadedUrl) {
                    logoUrl = uploadedUrl;
                } else {
                    throw new Error('Logo upload failed');
                }
            }

            const { error } = await supabase
                .from('clubs')
                .update({
                    name: formData.name,
                    description: formData.description,
                    image_url: logoUrl || null,
                    image_file: logoUrl || null,
                })
                .eq('id', club.id);

            if (error) throw error;

            router.push('/admin/clubs');
            router.refresh();
        } catch (error: any) {
            console.error('Update error:', error);
            alert(`Failed to update club: ${error.message}`);
        } finally {
            setIsSubmitting(false);
            setUploadProgress(0);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="bg-card rounded-xl shadow-sm border border-border p-6 space-y-6">
            <div>
                <Label htmlFor="name">Club Name *</Label>
                <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="mt-1"
                    placeholder="e.g., IEEE AAST"
                />
            </div>

            <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="mt-1"
                    rows={4}
                    placeholder="Describe your club..."
                />
            </div>

            {/* Logo Upload Section */}
            <div>
                <Label>Club Logo</Label>
                <div className="mt-2 space-y-3">
                    {logoPreview ? (
                        <div className="relative">
                            <img
                                src={logoPreview}
                                alt="Logo Preview"
                                className="w-48 h-48 object-contain rounded-lg border border-border bg-muted mx-auto"
                            />
                            <Button
                                type="button"
                                variant="destructive"
                                size="icon-sm"
                                className="absolute top-2 right-2"
                                onClick={removeLogo}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition cursor-pointer">
                            <input
                                type="file"
                                id="logo-upload"
                                accept="image/*"
                                onChange={handleLogoChange}
                                className="hidden"
                            />
                            <label htmlFor="logo-upload" className="cursor-pointer flex flex-col items-center">
                                <ImageIcon className="h-12 w-12 text-gray-400 mb-3" />
                                <span className="text-sm font-medium text-gray-700">
                                    Click to upload logo
                                </span>
                                <span className="text-xs text-gray-500 mt-1">
                                    PNG, JPG, SVG up to 3MB
                                </span>
                            </label>
                        </div>
                    )}

                    {uploadProgress > 0 && uploadProgress < 100 && (
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                    )}

                    {!logoPreview && (
                        <div className="text-center">
                            <span className="text-sm text-gray-500">OR</span>
                            <Input
                                type="url"
                                value={formData.image_url}
                                onChange={(e) => {
                                    setFormData({ ...formData, image_url: e.target.value });
                                    if (e.target.value) setLogoPreview(e.target.value);
                                }}
                                placeholder="Paste logo URL"
                                className="mt-2"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-border">
                <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
                    {isSubmitting ? 'Saving...' : (
                        <>
                            <Save className="h-4 w-4 mr-2" />
                            Save Changes
                        </>
                    )}
                </Button>
                <Link href="/admin/clubs">
                    <Button type="button" variant="outline">Cancel</Button>
                </Link>
            </div>
        </form>
    );
}
