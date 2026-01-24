'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { CheckCircle, XCircle, Camera, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

interface QRScannerProps {
    onCheckInSuccess: (attendeeId: string, checkedInAt: string) => void;
    disabled?: boolean;
}

type CameraDevice = { id: string; label?: string };

export default function QRScanner({ onCheckInSuccess, disabled }: QRScannerProps) {
    const qrRef = useRef<InstanceType<typeof Html5Qrcode> | null>(null);
    const isStartingOrStoppingRef = useRef(false);
    const scanLockRef = useRef(false);
    const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nextAllowedScanAtRef = useRef<number>(0);

    const [scanning, setScanning] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [debugInfo, setDebugInfo] = useState<string>('');

    const [cameras, setCameras] = useState<CameraDevice[]>([]);
    const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

    const canSwitchCamera = useMemo(() => cameras.length > 1, [cameras]);

    const clearMessageTimeout = () => {
        if (messageTimeoutRef.current) {
            clearTimeout(messageTimeoutRef.current);
            messageTimeoutRef.current = null;
        }
    };

    const setMessageWithAutoClear = (msg: { type: 'success' | 'error'; text: string }, ms: number) => {
        setMessage(msg);
        clearMessageTimeout();
        messageTimeoutRef.current = setTimeout(() => setMessage(null), ms);
    };

    const ensureInstance = () => {
        if (!qrRef.current) qrRef.current = new Html5Qrcode('qr-reader');
        return qrRef.current;
    };

    const loadCameras = async () => {
        try {
            const devices = (await Html5Qrcode.getCameras()) as CameraDevice[];
            setCameras(devices);

            if (!selectedCameraId && devices.length > 0) {
                const back =
                    devices.find((device: CameraDevice) => /back|rear|environment/i.test(device.label ?? '')) ||
                    devices[devices.length - 1];

                setSelectedCameraId(back?.id ?? null);
            }
        } catch {
            setCameras([]);
        }
    };

    const handleScan = async (token: string) => {
        const now = Date.now();
        if (now < nextAllowedScanAtRef.current) {
            setMessageWithAutoClear({ type: 'error', text: 'Please wait a moment…' }, 1200);
            return;
        }
        nextAllowedScanAtRef.current = now + 900;

        if (scanLockRef.current) return;
        scanLockRef.current = true;

        try {
            setDebugInfo(`Scanning token: ${token.substring(0, 24)}...`);

            const res = await fetch('/api/checkin/qr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });

            const json = await res.json().catch(() => ({}));

            if (res.status === 401) {
                setMessageWithAutoClear({ type: 'error', text: 'Please log in again.' }, 4000);
                return;
            }

            if (res.status === 403) {
                setMessageWithAutoClear({ type: 'error', text: 'Not allowed to check in for this event.' }, 5000);
                return;
            }

            if (!res.ok && typeof json?.error === 'string') {
                const msg =
                    json.error === 'token_expired'
                        ? 'Ticket expired — ask the attendee to refresh their QR.'
                        : json.error === 'invalid_token' || json.error === 'invalid_signature'
                            ? 'Invalid ticket — ask the attendee to reopen their QR.'
                            : json.error;
                setMessageWithAutoClear({ type: 'error', text: msg }, 5000);
                return;
            }

            if (json?.ok === false && json?.error === 'already_checked_in') {
                setMessageWithAutoClear({ type: 'error', text: `${json?.attendeeName || 'User'} already checked in!` }, 3000);
                return;
            }

            if (json?.ok !== true) {
                setMessageWithAutoClear({ type: 'error', text: 'Check-in failed. Please try again.' }, 5000);
                return;
            }

            const attendeeId = String(json?.attendeeId || '');
            const checkedInAt = String(json?.checkedInAt || '');
            const attendeeName = String(json?.attendeeName || 'Unknown User');

            if (!attendeeId || !checkedInAt) {
                setMessageWithAutoClear({ type: 'error', text: 'Check-in failed (invalid response).' }, 5000);
                return;
            }

            setMessage({ type: 'success', text: `✓ ${attendeeName} checked in successfully!` });

            clearMessageTimeout();
            messageTimeoutRef.current = setTimeout(() => {
                setMessage(null);
                onCheckInSuccess(attendeeId, checkedInAt);
            }, 800);
        } catch (error: unknown) {
            console.error('Scan error:', error);
            setMessageWithAutoClear({ type: 'error', text: 'Unexpected error. Check console.' }, 5000);
        } finally {
            scanLockRef.current = false;
        }
    };

    const startScanner = async () => {
        if (disabled) return;
        if (isStartingOrStoppingRef.current) return;

        isStartingOrStoppingRef.current = true;
        setMessage(null);
        clearMessageTimeout();
        setDebugInfo('Starting scanner...');
        setScanning(true);

        try {
            const qr = ensureInstance();
            await loadCameras();

            const state = qr.getState?.();
            if (state === Html5QrcodeScannerState.SCANNING) {
                isStartingOrStoppingRef.current = false;
                return;
            }

            const cameraConfig = selectedCameraId
                ? ({ deviceId: { exact: selectedCameraId } } as const)
                : ({ facingMode: 'environment' } as const);

            await qr.start(
                cameraConfig as any,
                { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
                async (decodedText: string) => {
                    await stopScanner();
                    await handleScan(decodedText);
                },
                () => { }
            );

            await loadCameras();
            setDebugInfo('Scanner started (rear camera preferred).');
        } catch (e: unknown) {
            console.error('Failed to start scanner:', e);
            setScanning(false);
            setDebugInfo('');

            const msg =
                typeof (e as any)?.message === 'string'
                    ? (e as any).message
                    : 'Camera failed to start. On mobile, ensure HTTPS and allow camera permission.';
            setMessageWithAutoClear({ type: 'error', text: msg }, 6000);
        } finally {
            isStartingOrStoppingRef.current = false;
        }
    };

    const stopScanner = async () => {
        if (isStartingOrStoppingRef.current) return;
        isStartingOrStoppingRef.current = true;

        try {
            const qr = qrRef.current;
            if (!qr) return;

            const state = qr.getState?.();
            if (state === Html5QrcodeScannerState.SCANNING) {
                await qr.stop();
            }
            await qr.clear();
        } catch {
        } finally {
            setScanning(false);
            setDebugInfo('');
            scanLockRef.current = false;
            isStartingOrStoppingRef.current = false;
        }
    };

    const switchCamera = async () => {
        if (!canSwitchCamera) return;
        if (disabled) return;
        if (!scanning) return;
        if (isStartingOrStoppingRef.current) return;

        await loadCameras();
        if (cameras.length < 2) return;

        const currentIndex = cameras.findIndex((device: CameraDevice) => device.id === selectedCameraId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cameras.length : 0;
        const nextId = cameras[nextIndex].id;

        setSelectedCameraId(nextId);

        setDebugInfo('Switching camera...');
        await stopScanner();
        await startScanner();
    };

    useEffect(() => {
        loadCameras();

        return () => {
            clearMessageTimeout();
            (async () => {
                try {
                    if (qrRef.current) {
                        const state = qrRef.current.getState?.();
                        if (state === Html5QrcodeScannerState.SCANNING) {
                            await qrRef.current.stop();
                        }
                        await qrRef.current.clear();
                    }
                } catch {
                } finally {
                    qrRef.current = null;
                }
            })();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-4">
            {!scanning ? (
                <Button
                    onClick={startScanner}
                    disabled={!!disabled}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                >
                    <Camera className="h-5 w-5 mr-2" />
                    Start QR Scanner
                </Button>
            ) : (
                <div className="flex gap-2">
                    <Button
                        onClick={stopScanner}
                        variant="outline"
                        className="flex-1 border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                    >
                        Stop Scanner
                    </Button>

                    {canSwitchCamera && (
                        <Button
                            onClick={switchCamera}
                            variant="outline"
                            className="border-border bg-card hover:bg-accent"
                            title="Switch camera"
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            )}

            {debugInfo && (
                <div className="p-3 rounded-lg text-sm border bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-900/40">
                    <strong>Debug:</strong> {debugInfo}
                </div>
            )}

            <div id="qr-reader" className="rounded-lg overflow-hidden bg-card border border-border" />

            {message && (
                <div
                    className={`p-4 rounded-lg flex items-center gap-3 border ${message.type === 'success'
                            ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/20 dark:text-green-300 dark:border-green-900/40'
                            : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-300 dark:border-red-900/40'
                        }`}
                >
                    {message.type === 'success' ? (
                        <CheckCircle className="h-5 w-5 flex-shrink-0" />
                    ) : (
                        <XCircle className="h-5 w-5 flex-shrink-0" />
                    )}
                    <p className="font-medium">{message.text}</p>
                </div>
            )}
        </div>
    );
}
