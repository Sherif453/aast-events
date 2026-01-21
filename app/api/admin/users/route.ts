import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
    // 1) verify requester is super_admin (cookie-based client)
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: adminRow, error: adminErr } = await supabase
        .from('admin_users')
        .select('role')
        .eq('id', user.id) // ✅ FIXED (id not user_id)
        .maybeSingle();

    if (adminErr) {
        return NextResponse.json({ error: adminErr.message }, { status: 500 });
    }

    if (adminRow?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2) fetch private profile data using service role
    const admin = createAdminClient();

    const { data, error } = await admin
        .from('profiles')
        .select('id, email, phone, full_name, major, year, updated_at')
        .order('updated_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
}
