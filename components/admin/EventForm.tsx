'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type PostgrestRes<T> = { data: T; error: any };

type PendingAttachJob = {
  eventId: string | number;
  url: string;
  createdAt: number;
  attempts: number;
};

const PENDING_ATTACH_KEY = 'aast_pending_event_image_attach_jobs_v2';
const MAX_PENDING_JOBS = 20;
const PENDING_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_ATTACH_ATTEMPTS = 3;

// Persist create request id across refresh/back (short TTL)
const CREATE_REQ_KEY = 'aast_event_create_req_v1';
const CREATE_REQ_TTL_MS = 1000 * 60 * 10; // 10 minutes

function safeJsonParse<T>(v: string | null, fallback: T): T {
  try {
    if (!v) return fallback;
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function newRequestId(): string {
  // Browser-only component, crypto.randomUUID should exist on modern browsers.
  // Fallback included for completeness.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function getOrCreateRequestId(): string {
  if (typeof window === 'undefined') return newRequestId();

  try {
    const raw = sessionStorage.getItem(CREATE_REQ_KEY);
    const parsed = safeJsonParse<{ id: string; at: number } | null>(raw, null);

    if (parsed?.id && typeof parsed.at === 'number' && Date.now() - parsed.at < CREATE_REQ_TTL_MS) {
      return parsed.id;
    }

    const id = newRequestId();
    sessionStorage.setItem(CREATE_REQ_KEY, JSON.stringify({ id, at: Date.now() }));
    return id;
  } catch {
    // Some browsers/environments may block sessionStorage access.
    return newRequestId();
  }
}

function clearRequestId() {
  try {
    sessionStorage.removeItem(CREATE_REQ_KEY);
  } catch {}
}

export default function EventForm({ mode, clubs, userId, role, adminClubId, initialData }: EventFormProps) {
  const isSuperAdmin = role === 'super_admin';
  const mountedRef = useRef(true);

  // One Supabase client instance per component lifetime
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  //  PostgREST timeboxed calls (never hang forever) 
  const postgrestWithTimeout = useCallback(
    async <T,>(builder: any, ms: number, label: string): Promise<PostgrestRes<T>> => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);

      try {
        const res = await (typeof builder?.abortSignal === 'function' ? builder.abortSignal(controller.signal) : builder);
        return res as PostgrestRes<T>;
      } catch (err: any) {
        if (err?.name === 'AbortError') throw new Error(label);
        throw err;
      } finally {
        clearTimeout(t);
      }
    },
    []
  );

  //  datetime-local conversions 
  const toLocalDateTimeInputValue = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  const localDateTimeToIso = (local: string) => {
    const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const d = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  };

  //  club forcing for non-super admins 
  const forcedClubId = useMemo(() => {
    if (isSuperAdmin) return null;
    return adminClubId || clubs?.[0]?.id || null;
  }, [isSuperAdmin, adminClubId, clubs]);

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    description: initialData?.description || '',
    location: initialData?.location || '',
    campus: initialData?.campus || '',
    organizer_name: initialData?.organizer_name || '',
    start_time: initialData?.start_time ? toLocalDateTimeInputValue(initialData.start_time) : '',
    image_url: initialData?.image_url || '',
    club_id: initialData?.club_id || (forcedClubId || ''),
  });

  useEffect(() => {
    if (!isSuperAdmin && forcedClubId) {
      setFormData((prev) => (prev.club_id !== forcedClubId ? { ...prev, club_id: forcedClubId } : prev));
    }
  }, [isSuperAdmin, forcedClubId]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.image_url || initialData?.image_file || null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  //  idempotency for create 
  // Persisted across refresh/back for short TTL.
  const createRequestIdRef = useRef<string>(getOrCreateRequestId());

  useEffect(() => {
    if (mode === 'create') {
      // Keep existing session value if present; otherwise create.
      createRequestIdRef.current = getOrCreateRequestId();
    } else {
      // No need to keep create id around in edit mode.
      clearRequestId();
    }
  }, [mode]);

  //  image preview / validation 
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp']);
    const mime = String(file.type || '').toLowerCase();
    const ext = String(file.name.split('.').pop() || '').toLowerCase();

    const isAllowed =
      allowedMime.has(mime) ||
      (mime === '' && (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp'));

    // Restrict to safe raster formats (avoid SVG unless you sanitize it end-to-end).
    if (!isAllowed) {
      alert('Please select a PNG, JPG, or WebP image');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }

    setImageFile(file);

    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData((prev) => ({ ...prev, image_url: '' }));
  };

  //  soft timeout wrapper for non-abortable promises 
  const withSoftTimeout = useCallback(async <T,>(p: Promise<T>, ms: number, timeoutLabel: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutLabel)), ms);
    });

    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  //  storage upload core 
  const uploadImageCore = useCallback(
    async (file: File, opts?: { silent?: boolean }): Promise<string> => {
      const silent = opts?.silent ?? false;

      const mime = String(file.type || '').toLowerCase();
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const contentType = mime || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = `events/${fileName}`;

      if (!silent && mountedRef.current) setUploadProgress(30);

      const { error: uploadError } = await supabase.storage.from('event-images').upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });

      if (uploadError) throw uploadError;

      if (!silent && mountedRef.current) setUploadProgress(70);

      const {
        data: { publicUrl },
      } = supabase.storage.from('event-images').getPublicUrl(filePath);

      if (!publicUrl) throw new Error('missing_public_url');

      if (!silent && mountedRef.current) setUploadProgress(100);
      return publicUrl;
    },
    [supabase]
  );

  //  pending attach persistence (localStorage) 
  const enqueuePendingAttach = useCallback((job: PendingAttachJob) => {
    try {
      const raw = localStorage.getItem(PENDING_ATTACH_KEY);
      const existing = safeJsonParse<PendingAttachJob[]>(raw, []);
      const now = Date.now();

      // Drop expired + dedupe by (eventId,url)
      const filtered = existing
        .filter((j) => now - j.createdAt < PENDING_TTL_MS)
        .filter((j) => !(String(j.eventId) === String(job.eventId) && j.url === job.url));

      const nextJob: PendingAttachJob = {
        ...job,
        attempts: Math.min(job.attempts ?? 1, MAX_ATTACH_ATTEMPTS),
      };

      if (nextJob.attempts > MAX_ATTACH_ATTEMPTS) return;

      filtered.unshift(nextJob);
      localStorage.setItem(PENDING_ATTACH_KEY, JSON.stringify(filtered.slice(0, MAX_PENDING_JOBS)));
    } catch {
      // ignore storage issues
    }
  }, []);

  const dequeueAllPendingAttach = useCallback((): PendingAttachJob[] => {
    try {
      const raw = localStorage.getItem(PENDING_ATTACH_KEY);
      const existing = safeJsonParse<PendingAttachJob[]>(raw, []);
      localStorage.removeItem(PENDING_ATTACH_KEY);

      const now = Date.now();
      return existing.filter((j) => now - j.createdAt < PENDING_TTL_MS);
    } catch {
      return [];
    }
  }, []);

  const attachImageToEvent = useCallback(
    async (eventId: string | number, url: string) => {
      const { error } = await postgrestWithTimeout<null>(
        supabase.from('events').update({ image_url: url, image_file: url }).eq('id', eventId as any),
        12_000,
        'event_image_update_timeout'
      );
      if (error) throw error;
    },
    [postgrestWithTimeout, supabase]
  );

  // Resume pending image attach jobs when this form mounts (best-effort, bounded)
  useEffect(() => {
    const run = async () => {
      const jobs = dequeueAllPendingAttach();
      if (!jobs.length) return;

      for (const job of jobs) {
        try {
          await attachImageToEvent(job.eventId, job.url);
        } catch {
          const attempts = (job.attempts ?? 1) + 1;
          if (attempts <= MAX_ATTACH_ATTEMPTS) {
            enqueuePendingAttach({ ...job, attempts, createdAt: Date.now() });
          }
        }
      }
    };

    if (typeof window !== 'undefined') void run();
  }, [attachImageToEvent, dequeueAllPendingAttach, enqueuePendingAttach]);

  const notifyClubFollowers = useCallback(
    async (eventId: string | number) => {
      try {
        const { error } = await postgrestWithTimeout<any>(
          supabase.rpc('notify_followers_new_event', { p_event_id: eventId as any }),
          8000,
          'notify_followers_timeout'
        );
        if (error) throw error;
      } catch (error) {
        console.error('Failed to notify followers (non-critical):', error);
      }
    },
    [postgrestWithTimeout, supabase]
  );

  const humanizeTimeout = (label: string) => {
    if (label === 'event_create_timeout') return 'Event creation timed out. It may have saved — refresh the events list to confirm.';
    if (label === 'event_update_timeout') return 'Event update timed out. Please refresh and confirm.';
    if (label === 'event_image_update_timeout') return 'Event saved, but attaching the image timed out. It will retry automatically.';
    if (label === 'image_upload_timeout') return 'Image upload is taking too long. Event will be saved without the image (it will retry).';
    if (label === 'event_recover_timeout') return 'Event may have saved, but recovery timed out. Please refresh events list.';
    return 'Request timed out. Please try again.';
  };

  //  CREATE idempotent flow 
  const recoverCreatedEventId = useCallback(
    async (clientRequestId: string) => {
      const { data, error } = await postgrestWithTimeout<{ id: number }>(
        supabase.from('events').select('id').eq('client_request_id', clientRequestId).maybeSingle(),
        10_000,
        'event_recover_timeout'
      );

      if (error) throw error;
      return data?.id ?? null;
    },
    [postgrestWithTimeout, supabase]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const startTimeIso = formData.start_time ? localDateTimeToIso(formData.start_time) : null;
      if (!startTimeIso) throw new Error('Invalid start time');

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

      const typedImageUrlRaw = (formData.image_url || '').trim() || null;
      const typedImageUrl = typedImageUrlRaw ? normalizeImageUrl(typedImageUrlRaw) : null;
      if (typedImageUrlRaw && !typedImageUrl) throw new Error('Invalid image URL');
      const hasFile = Boolean(imageFile);

      // Start upload immediately if file exists
      const fileToUpload = imageFile ?? null;
      const uploadPromise = fileToUpload ? uploadImageCore(fileToUpload) : null;

      // Wait a bit for upload (soft timeout), otherwise save without image and attach later.
      let finalImageUrl: string | null = hasFile ? null : typedImageUrl;
      let uploadTimedOut = false;

      if (uploadPromise) {
        try {
          finalImageUrl = await withSoftTimeout(uploadPromise, 15_000, 'image_upload_timeout');
        } catch (err: any) {
          const label = String(err?.message || '');
          if (label === 'image_upload_timeout') {
            uploadTimedOut = true;
            finalImageUrl = null;
          } else {
            throw new Error(`Image upload failed: ${err?.message || 'Unknown error'}`);
          }
        }
      }

      const baseEventData: any = {
        ...formData,
        start_time: startTimeIso,
        image_url: finalImageUrl,
        image_file: finalImageUrl,
        club_id: formData.club_id || null,
      };

      let savedEventId: string | number | null = null;

      if (mode === 'create') {
        const clientRequestId = createRequestIdRef.current;

        const payload = {
          ...baseEventData,
          created_by: userId,
          client_request_id: clientRequestId,
        };

        // STRICT idempotency: retry never mutates existing row
        // Step 1: insert-only upsert
        let maybeReturnedId: number | null = null;
        let upsertError: any = null;
        try {
          const { data, error } = await postgrestWithTimeout<{ id: number }>(
            supabase
              .from('events')
              .upsert([payload], { onConflict: 'client_request_id', ignoreDuplicates: true })
              .select('id')
              .maybeSingle(),
            12_000,
            'event_create_timeout'
          );
          if (error) upsertError = error;
          maybeReturnedId = data?.id ?? null;
        } catch (err: any) {
          if (String(err?.message || '') === 'event_create_timeout') {
            // write may have succeeded -> recover below
          } else {
            throw err;
          }
        }

        // Step 2: recover id if it wasn't returned (works for both created or duplicate)
        savedEventId = maybeReturnedId ?? (await recoverCreatedEventId(clientRequestId));
        if (!savedEventId && upsertError) throw upsertError;
        if (!savedEventId) throw new Error('event_create_failed_no_id');

        // Create succeeded -> clear the request id so a fresh event uses a fresh id
        clearRequestId();

        if (savedEventId && formData.club_id) void notifyClubFollowers(savedEventId);
      } else {
        const { error } = await postgrestWithTimeout<null>(
          supabase.from('events').update(baseEventData).eq('id', initialData.id),
          12_000,
          'event_update_timeout'
        );
        if (error) throw error;
        savedEventId = initialData.id;
      }

      // If upload finished after timeout, attach later and persist job for reliability.
      if (savedEventId && uploadTimedOut && uploadPromise) {
        void uploadPromise
          .then(async (url) => {
            try {
              await attachImageToEvent(savedEventId as any, url);
            } catch {
              enqueuePendingAttach({ eventId: savedEventId as any, url, createdAt: Date.now(), attempts: 1 });
            }
          })
          .catch((err) => {
            console.warn('Background image upload failed (non-critical):', err);
          });
      }

      router.push('/admin/events');
      router.refresh();
    } catch (error: any) {
      const msg = String(error?.message || '');
      const isTimeout =
        msg === 'event_create_timeout' ||
        msg === 'event_update_timeout' ||
        msg === 'event_image_update_timeout' ||
        msg === 'image_upload_timeout' ||
        msg === 'event_recover_timeout';

      console.error('Submit error details:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        fullError: error,
      });

      alert(isTimeout ? humanizeTimeout(msg) : `Failed to ${mode} event: ${msg || 'Unknown error occurred'}`);
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false);
        setUploadProgress(0);
      }
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
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, description: e.target.value })}
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
                <img src={imagePreview} alt="Preview" className="w-full h-64 object-cover rounded-lg border border-border" />
                <Button type="button" variant="destructive" size="sm" className="absolute top-2 right-2" onClick={removeImage}>
                  <X className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
            ) : (
	              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition cursor-pointer">
	                <input type="file" id="image-upload" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="hidden" />
	                <label htmlFor="image-upload" className="cursor-pointer flex flex-col items-center">
                  <ImageIcon className="h-12 w-12 text-muted-foreground mb-3" />
                  <span className="text-sm font-medium text-foreground">Click to upload image</span>
                  <span className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP up to 5MB</span>
                </label>
              </div>
            )}

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}

            {!imagePreview && (
              <div className="text-center">
                <span className="text-sm text-muted-foreground">OR</span>
	                <Input
	                  type="url"
	                  value={formData.image_url}
	                  onChange={(e) => {
	                    const next = e.target.value;
	                    setFormData({ ...formData, image_url: next });
	                    const normalized = (() => {
	                      const v = next.trim();
	                      if (!v) return null;
	                      if (v.startsWith('/') && !v.startsWith('//')) return v;
	                      try {
	                        const u = new URL(v);
	                        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
	                        return u.toString();
	                      } catch {
	                        return null;
	                      }
	                    })();
	                    setImagePreview(normalized);
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

          {formData.club_id && <p className="text-xs text-muted-foreground mt-1">📢 Followers of this club will be notified about this event</p>}
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

        <Button asChild variant="outline">
          <Link href="/admin/events">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
