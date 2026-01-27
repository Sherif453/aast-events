'use client';

import React, { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Save, X, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import Image from "next/image";

export default function ClubForm({ userId }: { userId: string }) {
  void userId;

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image_url: '',
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const normalizeImageUrl = (raw: string): string | null => {
    const v = raw.trim();
    if (!v) return null;
    if (v.startsWith('/') && !v.startsWith('//')) return v;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp']);
    const mime = String(file.type || '').toLowerCase();
    const ext = String(file.name.split('.').pop() || '').toLowerCase();

    // Restrict to safe raster formats (avoid SVG unless you sanitize it everywhere).
    const isAllowed =
      allowedMime.has(mime) ||
      (mime === '' && (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp'));

    if (!isAllowed) {
      alert('Please select a PNG, JPG, or WebP image');
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      alert('Logo must be less than 3MB');
      return;
    }

    setLogoFile(file);

    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setFormData((p) => ({ ...p, image_url: '' }));
  };

  const uploadLogo = async (clubId: string, file: File): Promise<string> => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const objectPath = `${clubId}/logo.${ext}`; //  matches your policy requirement

    setUploadProgress(25);

    const { error: uploadError } = await supabase.storage.from('club-logos').upload(objectPath, file, {
      cacheControl: '3600',
      upsert: true, // overwrite if same club uploads again
      contentType: file.type || undefined,
    });

    if (uploadError) throw uploadError;

    setUploadProgress(75);

    const { data } = supabase.storage.from('club-logos').getPublicUrl(objectPath);
    const publicUrl = data?.publicUrl;
    if (!publicUrl) throw new Error('missing_public_url');

    setUploadProgress(100);
    return publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Never trust prop for created_by
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user?.id) {
        alert('You must be logged in to create a club.');
        return;
      }
      const createdBy = authData.user.id;

      //  Generate club id up-front so storage path can be enforced
      const clubId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

      const typedUrlRaw = (formData.image_url || '').trim() || null;
      const typedUrl = typedUrlRaw ? normalizeImageUrl(typedUrlRaw) : null;
      if (typedUrlRaw && !typedUrl) {
        alert('Invalid logo URL (must be http(s) or a relative /path).');
        return;
      }

      // If logo file exists, upload FIRST so insert includes logo URL
      let finalLogoUrl: string | null = typedUrl;

      if (logoFile) {
        finalLogoUrl = await uploadLogo(clubId, logoFile);
      }

      // Insert club with explicit id
      const { error: insertErr } = await supabase.from('clubs').insert([
        {
          id: clubId,
          name: formData.name,
          description: formData.description,
          image_url: finalLogoUrl,
          image_file: finalLogoUrl,
          created_by: createdBy,
        },
      ]);

      if (insertErr) throw insertErr;

      router.push('/clubs');
      router.refresh();
    } catch (error: unknown) {
      const errObj = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
      const message = error instanceof Error ? error.message : "Unknown error";

      console.error('Create club error:', {
        message,
        code: errObj?.code,
        details: errObj?.details,
        hint: errObj?.hint,
        fullError: error,
      });
      alert(`Failed to create club: ${message}`);
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
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
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
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setFormData((p) => ({ ...p, description: e.target.value }))
          }
          className="mt-1"
          rows={4}
          placeholder="Describe your club..."
        />
      </div>

      <div>
        <Label>Club Logo</Label>
        <div className="mt-2 space-y-3">
	          {logoPreview ? (
	            <div className="relative">
	              <Image
	                src={logoPreview}
	                alt="Logo Preview"
	                width={192}
	                height={192}
	                className="w-48 h-48 object-contain rounded-lg border border-border bg-muted mx-auto"
	                unoptimized
	              />
	              <Button type="button" variant="destructive" size="sm" className="absolute top-2 right-2" onClick={removeLogo}>
	                <X className="h-4 w-4 mr-1" />
	                Remove
	              </Button>
	            </div>
          ) : (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition cursor-pointer">
	              <input type="file" id="logo-upload" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} className="hidden" />
	              <label htmlFor="logo-upload" className="cursor-pointer flex flex-col items-center">
	                <ImageIcon className="h-12 w-12 text-muted-foreground mb-3" />
	                <span className="text-sm font-medium text-foreground">Click to upload logo</span>
	                <span className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP up to 3MB</span>
	              </label>
	            </div>
	          )}

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="w-full bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}

          {!logoPreview && (
            <div className="text-center">
              <span className="text-sm text-muted-foreground">OR</span>
              <Input
                type="url"
                value={formData.image_url}
                onChange={(e) => {
                  const v = e.target.value;
                  setFormData((p) => ({ ...p, image_url: v }));
                  setLogoPreview(normalizeImageUrl(v));
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
          {isSubmitting ? 'Creating...' : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Create Club
            </>
          )}
        </Button>
        <Button asChild variant="outline">
          <Link href="/clubs">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
