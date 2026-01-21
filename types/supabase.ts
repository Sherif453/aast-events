// types/supabase.ts
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
    public: {
        Tables: {
            events: {
                Row: {
                    id: string;
                    title: string;
                    start_time: string;
                    location: string;
                    campus: string;
                    organizer_name: string;
                    image_url: string | null;
                    description: string | null;
                    attendee_count?: number;
                };
                Insert: Partial<Omit<Database['public']['Tables']['events']['Row'], 'id'>>;
                Update: Partial<Omit<Database['public']['Tables']['events']['Row'], 'id'>>;
            };
            attendees: {
                Row: {
                    id: string;
                    user_id: string;
                    event_id: string;
                    created_at: string;
                };
                Insert: {
                    user_id: string;
                    event_id: string;
                };
                Update: Partial<Omit<Database['public']['Tables']['attendees']['Row'], 'id'>>;
            };
            profiles: {
                Row: {
                    id: string;
                    full_name: string | null;
                    avatar_url: string | null;
                };
                Insert: {
                    full_name?: string | null;
                    avatar_url?: string | null;
                };
                Update: {
                    full_name?: string | null;
                    avatar_url?: string | null;
                };
            };
        };
    };
}
