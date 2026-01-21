'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';  // ← Use new client
import { Button } from '@/components/ui/button';
import { User } from '@supabase/supabase-js';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

export default function AuthButton() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        const checkUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setUser(session?.user ?? null);
            setLoading(false);
        };
        checkUser();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = '/';
    };

    if (loading) return <Button variant="ghost" size="sm" disabled>Loading...</Button>;

    if (!user) {
        return (
            <Button asChild className="bg-[#00386C] hover:bg-[#00509d] text-white">
                <Link href="/auth/login">
                    <LogIn className="mr-2 h-4 w-4" />
                    Log In
                </Link>
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full overflow-hidden border border-border">
                    {user.user_metadata.avatar_url ? (
                        <img src={user.user_metadata.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
                    ) : (
                        <div className="bg-[#00386C] text-white h-full w-full flex items-center justify-center font-bold">
                            {user.email?.charAt(0).toUpperCase()}
                        </div>
                    )}
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user.user_metadata.full_name || 'Student'}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer flex w-full">
                        <UserIcon className="mr-2 h-4 w-4" /> Profile
                    </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={handleLogout} className="text-red-600 cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" /> Log out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}