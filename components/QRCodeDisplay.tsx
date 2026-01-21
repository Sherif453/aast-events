'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface QRCodeDisplayProps {
    qrCode: string;
    eventTitle: string;
    userName: string;
    onClose: () => void;
}

export default function QRCodeDisplay({ qrCode, eventTitle, userName, onClose }: QRCodeDisplayProps) {
    const [qrImage, setQrImage] = useState<string>('');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        document.body.style.overflow = 'hidden';

        QRCode.toDataURL(qrCode, {
            width: 300,
            margin: 2,
            color: {
                dark: '#00386C',
                light: '#FFFFFF',
            },
        }).then(setQrImage);

        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [qrCode]);

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
                        {qrImage ? (
                            <img src={qrImage} alt="QR Code" className="w-64 h-64" />
                        ) : (
                            <div className="w-64 h-64 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00386C]"></div>
                            </div>
                        )}
                    </div>

                    <p className="text-xs text-muted-foreground mt-4 mb-6">
                        Show this QR code at the event entrance
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
                        disabled={!qrImage}
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