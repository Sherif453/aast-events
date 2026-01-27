'use client';

import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import Image from "next/image";

interface QRCodeDisplayProps {
    eventId: string;
    eventTitle: string;
    userName: string;
    onClose: () => void;
}

const REFRESH_SAFETY_MS = 5_000; // refresh shortly before expiry so scanning never hits an expired token
const RETRY_AFTER_ERROR_MS = 5_000;

export default function QRCodeDisplay({ eventId, eventTitle, userName, onClose }: QRCodeDisplayProps) {
    const [qrImage, setQrImage] = useState<string>('');
    const [mounted, setMounted] = useState(false);
    const [token, setToken] = useState<string>('');
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [loadingToken, setLoadingToken] = useState(true);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [nowSec, setNowSec] = useState(0);

    const secondsLeft = useMemo(() => {
        if (!expiresAt) return null;
        return Math.max(0, expiresAt - nowSec);
    }, [expiresAt, nowSec]);

    const fetchToken = useCallback(async () => {
        setLoadingToken(true);
        setTokenError(null);
        try {
            const res = await fetch(`/api/ticket/qr?eventId=${encodeURIComponent(eventId)}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = typeof json?.error === 'string' ? json.error : 'Failed to load ticket';
                throw new Error(msg);
            }

            const nextToken = String(json?.token || '');
            const nextExp = Number(json?.expiresAt || 0);
            if (!nextToken || !Number.isFinite(nextExp) || nextExp <= 0) throw new Error('Invalid ticket token');

            setToken(nextToken);
            setExpiresAt(nextExp);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to load ticket';
            setTokenError(msg);
            setToken('');
            setExpiresAt(null);
        } finally {
            setLoadingToken(false);
        }
    }, [eventId]);

    const downloadTicket = useCallback(async () => {
        setDownloading(true);
        setDownloadError(null);
        try {
            const res = await fetch(`/api/ticket/qr?eventId=${encodeURIComponent(eventId)}&mode=download`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });

            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = typeof json?.error === 'string' ? json.error : 'Failed to prepare download';
                throw new Error(msg);
            }

            const dlToken = String(json?.token || '');
            if (!dlToken) throw new Error('Invalid ticket token');

            const dlQr = await QRCode.toDataURL(dlToken, {
                width: 600,
                margin: 2,
                color: {
                    dark: '#00386C',
                    light: '#FFFFFF',
                },
            });

            const link = document.createElement('a');
            link.href = dlQr;
            link.download = `ticket-${eventTitle.replace(/\s+/g, '-')}.png`;
            link.click();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Download failed';
            setDownloadError(msg);
        } finally {
            setDownloading(false);
        }
    }, [eventId, eventTitle]);

    useEffect(() => {
        setMounted(true);
        document.body.style.overflow = 'hidden';
        void fetchToken();

        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [eventId, fetchToken]);

    useEffect(() => {
        if (!mounted) return;
        setNowSec(Math.floor(Date.now() / 1000));
        const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(id);
    }, [mounted]);

    useEffect(() => {
        if (!mounted) return;
        if (!eventId) return;

        let id: ReturnType<typeof setTimeout> | null = null;

        const schedule = () => {
            const nowMs = Date.now();

            if (expiresAt) {
                const expMs = expiresAt * 1000;
                const waitMs = Math.max(1000, expMs - nowMs - REFRESH_SAFETY_MS);
                id = setTimeout(() => void fetchToken(), waitMs);
                return;
            }

            if (tokenError) {
                id = setTimeout(() => void fetchToken(), RETRY_AFTER_ERROR_MS);
            }
        };

        schedule();

        return () => {
            if (id) clearTimeout(id);
        };
    }, [mounted, eventId, expiresAt, tokenError, fetchToken]);

    useEffect(() => {
        if (!token) return;
        void QRCode.toDataURL(token, {
            width: 300,
            margin: 2,
            color: {
                dark: '#00386C',
                light: '#FFFFFF',
            },
        }).then(setQrImage);
    }, [token]);

    if (!mounted) return null;

    const modalContent = (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-[9999]"
            onClick={onClose}
        >
            <div
                className="bg-card rounded-2xl shadow-2xl max-w-md w-full p-6 relative border-2 border-border"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10 hover:bg-muted rounded-full p-1 transition"
                >
                    <X className="h-6 w-6" />
                </button>

                <div className="text-center">
                    <h2 className="text-2xl font-bold text-foreground mb-2">Your Event Ticket</h2>
                    <p className="text-sm text-muted-foreground mb-1">{eventTitle}</p>
                    <p className="text-xs text-muted-foreground mb-6">{userName}</p>

	                    <div className="bg-white p-6 rounded-xl border-4 border-[#00386C] inline-block shadow-lg">
	                        {qrImage && !loadingToken ? (
	                            <Image src={qrImage} alt="QR Code" width={256} height={256} className="w-64 h-64" unoptimized />
	                        ) : tokenError ? (
	                            <div className="w-64 h-64 flex flex-col items-center justify-center text-center px-4">
	                                <p className="text-sm font-semibold text-foreground mb-2">Ticket unavailable</p>
	                                <p className="text-xs text-muted-foreground mb-4">{tokenError}</p>
	                                <Button onClick={() => void fetchToken()} size="sm" className="bg-[#00386C] hover:bg-[#00509d] text-white">
                                    Retry
                                </Button>
	                    </div>
                        ) : (
                            <div className="w-64 h-64 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00386C]"></div>
                            </div>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground mt-4 mb-6">
                        {secondsLeft !== null ? `Auto-refreshing (valid for ~${secondsLeft}s)` : 'Show this QR code at the event entrance'}
                    </p>

	                    <Button
	                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
	                            e.stopPropagation();
	                            void downloadTicket();
	                        }}
                        className="w-full bg-[#00386C] hover:bg-[#00509d] text-white"
                        disabled={loadingToken || downloading}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        {downloading ? 'Preparing…' : 'Download Ticket'}
                    </Button>
                    {downloadError && (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{downloadError}</p>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
