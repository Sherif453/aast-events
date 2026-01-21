'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';

export default function DarkModeToggle() {
    const [mounted, setMounted] = useState(false);
    const { theme, setTheme } = useTheme();

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
                disabled
            >
                <Moon className="h-4 w-4" />
                <span className="hidden sm:inline">Theme</span>
            </Button>
        );
    }

    return (
        <Button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
        >
            {theme === 'dark' ? (
                <>
                    <Sun className="h-4 w-4" />
                    <span className="hidden sm:inline">Light</span>
                </>
            ) : (
                <>
                    <Moon className="h-4 w-4" />
                    <span className="hidden sm:inline">Dark</span>
                </>
            )}
        </Button>
    );
}