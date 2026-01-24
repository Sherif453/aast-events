import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

export async function createClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            cookieStore.set(name, value, options);
                        });
                    } catch {
                        // Silently fail in Server Components (read-only context)
                        // This is expected behavior for RSC
                    }
                },
            },
        }
    );
}

// Route Handlers need a cookie adapter that reads from the incoming request and
// writes auth cookies onto the response we return.
export function createRouteHandlerClient(request: NextRequest, response: NextResponse) {
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name) {
                    return request.cookies.get(name)?.value;
                },
                set(name, value, options) {
                    response.cookies.set({ name, value, ...options });
                },
                remove(name, options) {
                    response.cookies.set({ name, value: "", ...options, maxAge: 0 });
                },
            },
        }
    );
}
