import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// ✅ Next.js expects `proxy` (new convention)
export async function proxy(request: NextRequest) {
    const response = NextResponse.next({
        request: { headers: request.headers },
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    // ✅ triggers refresh/rotation when needed
    // ✅ never redirect / never throw
    try {
        await supabase.auth.getClaims();
    } catch {
        // swallow – never break navigation
    }

    return response;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
    ],
};