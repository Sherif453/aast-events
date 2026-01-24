'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface QRCodeDisplayProps {
    eventId: string;
    eventTitle: string;
    userName: string;
    onClose: () => void;
}

const REFRESH_EVERY_MS = 12_000;

export default function QRCodeDisplay({ eventId, eventTitle, userName, onClose }: QRCodeDisplayProps) {
    const [qrImage, setQrImage] = useState<string>('');
    const [mounted, setMounted] = useState(false);
    const [token, setToken] = useState<string>('');
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [loadingToken, setLoadingToken] = useState(true);
    const [tokenError, setTokenError] = useState<string | null>(null);
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
        } catch (e: any) {
            setTokenError(e?.message || 'Failed to load ticket');
            setToken('');
            setExpiresAt(null);
        } finally {
            setLoadingToken(false);
        }
    }, [eventId]);

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

        const id = setInterval(() => void fetchToken(), REFRESH_EVERY_MS);
        return () => clearInterval(id);
    }, [mounted, eventId, fetchToken]);

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
                            <img src={qrImage} alt="QR Code" className="w-64 h-64" />
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
                        onClick={(e: any) => {
                            e.stopPropagation();
                            const link = document.createElement('a');
                            link.href = qrImage;
                            link.download = `ticket-${eventTitle.replace(/\s+/g, '-')}.png`;
                            link.click();
                        }}
                        className="w-full bg-[#00386C] hover:bg-[#00509d] text-white"
                        disabled={!qrImage || loadingToken}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Download Ticket
                    </Button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
