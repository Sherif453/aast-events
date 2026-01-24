'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
    ChevronLeft,
    ChevronRight,
    Users,
    Calendar,
    Bell,
    BellOff,
    Award,
    Newspaper,
    Megaphone,
    TrendingUp,
    Trash2,
    Pencil,
    MessageSquare,
} from 'lucide-react';
import { EventCard } from '@/components/EventCard';
import ClubChatPanel from '@/components/ClubChatPanel';

interface Club {
    id: string;
    name: string;
    description: string;
    image_url: string | null;
}

interface ClubNews {
    id: string;
    title: string;
    content: string;
    type: 'news' | 'achievement' | 'announcement';
    image_url: string | null;
    created_at: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(label)), ms);
        promise
            .then((v) => {
                clearTimeout(t);
                resolve(v);
            })
            .catch((e) => {
                clearTimeout(t);
                reject(e);
            });
    });
}

export default function ClubDetailClient({ clubId }: { clubId: string }) {
    const [club, setClub] = useState<Club | null>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [news, setNews] = useState<ClubNews[]>([]);
    const [isFollowing, setIsFollowing] = useState(false);
    const [followerCount, setFollowerCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [chatOpen, setChatOpen] = useState(false);

    // Controls whether Edit/Delete shows
    const [isAdmin, setIsAdmin] = useState(false);

    const [editingNews, setEditingNews] = useState<ClubNews | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');

    // For arrow navigation - using callback ref to handle dynamic mounting
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const supabase = useMemo(() => createClient(), []);

    // Auth persistence guard: never clear user state on transient failures.
    // Only clear on the explicit SIGNED_OUT event.
    useEffect(() => {
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                setUserId(null);
                setIsAdmin(false);
                setIsFollowing(false);
                return;
            }

            const next = session?.user?.id ?? null;
            if (next) setUserId((prev) => (prev === next ? prev : next));
        });

        return () => {
            sub.subscription.unsubscribe();
        };
    }, [supabase]);

    const checkScrollButtons = useCallback(() => {
        if (!scrollContainer) return;

        const scrollLeft = Math.round(scrollContainer.scrollLeft);
        const scrollWidth = Math.round(scrollContainer.scrollWidth);
        const clientWidth = Math.round(scrollContainer.clientWidth);

        // Show left arrow if scrolled right at all (5px threshold)
        setCanScrollLeft(scrollLeft > 5);
        // Show right arrow if not at the end (5px threshold)
        setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
    }, [scrollContainer]);

    const loadData = useCallback(async () => {
        setLoading(true);

        try {
            let currentUserId: string | null = userId;

            // Seed from local session first (fast/local) to avoid auth flicker.
            try {
                const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 2500, 'club_session_timeout');
                const sessionUserId = sessionData.session?.user?.id ?? null;
                if (sessionUserId) {
                    currentUserId = sessionUserId;
                    setUserId((prev) => (prev === sessionUserId ? prev : sessionUserId));
                }
            } catch {
                // ignore transient session errors
            }

            // Best-effort verified user refresh; never clear on failure.
            try {
                const { data } = await withTimeout(supabase.auth.getUser(), 3500, 'club_getuser_timeout');
                if (data.user?.id) {
                    currentUserId = data.user.id;
                    setUserId((prev) => (prev === data.user!.id ? prev : data.user!.id));
                }
            } catch {
                // ignore
            }

            const nowIso = new Date().toISOString();

            const [adminRes, clubRes, eventsRes, newsRes, followRes, followerCountRes] = await Promise.allSettled([
                currentUserId
                    ? withTimeout(
                        Promise.resolve().then(async () => {
                            return await supabase.from('admin_users').select('role, club_id').eq('id', currentUserId!).maybeSingle();
                        }),
                        5000,
                        'club_admin_timeout'
                    )
                    : Promise.resolve(null as any),
                withTimeout(
                    Promise.resolve().then(async () => {
                        return await supabase.from('clubs').select('*').eq('id', clubId).single();
                    }),
                    8000,
                    'club_load_timeout'
                ),
                withTimeout(
                    Promise.resolve().then(async () => {
                        return await supabase
                            .from('events')
                            .select(
                                `
                                *,
                                clubs (
                                    id,
                                    name
                                )
                            `
                            )
                            .eq('club_id', clubId)
                            .gte('start_time', nowIso)
                            .order('start_time', { ascending: true });
                    }),
                    8000,
                    'club_events_timeout'
                ),
                withTimeout(
                    Promise.resolve().then(async () => {
                        return await supabase
                            .from('club_news')
                            .select('*')
                            .eq('club_id', clubId)
                            .order('created_at', { ascending: false })
                            .limit(10);
                    }),
                    8000,
                    'club_news_timeout'
                ),
                currentUserId
                    ? withTimeout(
                        Promise.resolve().then(async () => {
                            return await supabase
                                .from('club_followers')
                                .select('id')
                                .eq('user_id', currentUserId!)
                                .eq('club_id', clubId)
                                .maybeSingle();
                        }),
                        5000,
                        'club_follow_timeout'
                    )
                    : Promise.resolve(null as any),
                withTimeout(
                    Promise.resolve().then(async () => {
                        return await supabase
                            .from('club_followers')
                            .select('id', { count: 'exact', head: true })
                            .eq('club_id', clubId);
                    }),
                    6000,
                    'club_follow_count_timeout'
                ),
            ]);

            if (adminRes.status === 'fulfilled' && adminRes.value) {
                const { data: adminData, error: adminErr } = adminRes.value as any;
                if (!adminErr && adminData) {
                    const isSuperAdminUser = adminData.role === 'super_admin';
                    const isClubAdminOfThisClub = adminData.role === 'club_admin' && adminData.club_id === clubId;
                    setIsAdmin(isSuperAdminUser || isClubAdminOfThisClub);
                } else if (!currentUserId) {
                    setIsAdmin(false);
                }
            } else if (!currentUserId) {
                setIsAdmin(false);
            }

            if (clubRes.status === 'fulfilled') {
                const { data: clubData } = clubRes.value as any;
                setClub((clubData as any) ?? null);
            } else {
                console.error('[Club] club load failed:', clubRes.reason);
                setClub(null);
            }

            if (eventsRes.status === 'fulfilled') {
                const { data: eventsData } = eventsRes.value as any;
                const eventsWithCounts = ((eventsData as any[]) ?? []).map((event: any) => ({
                    ...event,
                    attendee_count: event.attendee_count ?? 0,
                    checked_in_count: event.checked_in_count ?? 0,
                    club_name: event.clubs?.name || null,
                    club_id: event.clubs?.id || event.club_id || null,
                }));
                setEvents(eventsWithCounts);
            } else {
                console.error('[Club] events load failed:', eventsRes.reason);
                setEvents([]);
            }

            if (newsRes.status === 'fulfilled') {
                const { data: newsData } = newsRes.value as any;
                setNews(((newsData as any[]) ?? []) as ClubNews[]);
            } else {
                console.error('[Club] news load failed:', newsRes.reason);
                setNews([]);
            }

            if (followRes.status === 'fulfilled' && followRes.value) {
                const { data: followData } = followRes.value as any;
                setIsFollowing(!!followData);
            } else if (!currentUserId && !userId) {
                setIsFollowing(false);
            }

            if (followerCountRes.status === 'fulfilled') {
                const { count } = followerCountRes.value as any;
                setFollowerCount(count || 0);
            } else {
                console.error('[Club] follower count failed:', followerCountRes.reason);
                setFollowerCount(0);
            }
        } catch (e) {
            console.error('[Club] loadData unexpected error:', e);
        } finally {
            setLoading(false);
        }
    }, [supabase, clubId, userId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (!scrollContainer) return;

        // Multiple attempts to check, in case DOM isn't ready
        const timeouts = [
            setTimeout(checkScrollButtons, 0),
            setTimeout(checkScrollButtons, 100),
            setTimeout(checkScrollButtons, 300),
        ];

        // Create handler for scroll events
        const handleScroll = () => {
            checkScrollButtons();
        };

        // Add listeners
        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', checkScrollButtons);

        // Periodic check as backup
        const checkInterval = setInterval(checkScrollButtons, 2000);

        return () => {
            scrollContainer.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', checkScrollButtons);
            timeouts.forEach(clearTimeout);
            clearInterval(checkInterval);
        };
    }, [scrollContainer, news, checkScrollButtons]);

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollContainer) return;

        const scrollAmount = 356; // 340px card + 16px gap
        const targetScroll = direction === 'left'
            ? scrollContainer.scrollLeft - scrollAmount
            : scrollContainer.scrollLeft + scrollAmount;

        scrollContainer.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });
    };


    const toggleFollow = async () => {
        if (!userId) {
            alert('Please log in to follow clubs');
            return;
        }

        try {
            if (isFollowing) {
                await supabase
                    .from('club_followers')
                    .delete()
                    .eq('user_id', userId)
                    .eq('club_id', clubId);

                setIsFollowing(false);
                setFollowerCount((prev) => prev - 1);
            } else {
                await supabase
                    .from('club_followers')
                    .insert([{ user_id: userId, club_id: clubId }]);

                setIsFollowing(true);
                setFollowerCount((prev) => prev + 1);
            }
        } catch (error: any) {
            console.error('Follow error:', error);
            alert('Failed to update follow status');
        }
    };

    const handleDeleteNews = async (newsId: string, newsTitle: string) => {
        if (!confirm(`Are you sure you want to delete "${newsTitle}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('club_news')
                .delete()
                .eq('id', newsId);

            if (error) throw error;

            setNews(news.filter(n => n.id !== newsId));
            alert('News deleted successfully!');
        } catch (error: any) {
            console.error('Delete error:', error);
            alert(`Failed to delete news: ${error.message}`);
        }
    };

    const startEditNews = (newsItem: ClubNews) => {
        setEditingNews(newsItem);
        setEditTitle(newsItem.title);
        setEditContent(newsItem.content);
    };

    const cancelEdit = () => {
        setEditingNews(null);
        setEditTitle('');
        setEditContent('');
    };

    const saveEdit = async () => {
        if (!editingNews) return;

        if (!editTitle.trim() || !editContent.trim()) {
            alert('Title and content cannot be empty');
            return;
        }

        try {
            const { error } = await supabase
                .from('club_news')
                .update({
                    title: editTitle.trim(),
                    content: editContent.trim(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', editingNews.id);

            if (error) throw error;

            setNews(news.map(n =>
                n.id === editingNews.id
                    ? { ...n, title: editTitle.trim(), content: editContent.trim() }
                    : n
            ));

            cancelEdit();
            alert('News updated successfully!');
        } catch (error: any) {
            console.error('Update error:', error);
            alert(`Failed to update news: ${error.message}`);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!club) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-foreground mb-4">Club Not Found</h1>
                    <Button asChild>
                        <Link href="/clubs">Back to Clubs</Link>
                    </Button>
                </div>
            </div>
        );
    }

    const getNewsStyle = (type: string) => {
        switch (type) {
            case 'achievement':
                return {
                    icon: <Award className="h-5 w-5" />,
                    bgColor: 'bg-yellow-500/10 dark:bg-yellow-500/20',
                    borderColor: 'border-yellow-500/30',
                    iconColor: 'text-yellow-600 dark:text-yellow-400',
                    badgeBg: 'bg-yellow-500/20 dark:bg-yellow-500/30',
                    badgeText: 'text-yellow-700 dark:text-yellow-300',
                };
            case 'announcement':
                return {
                    icon: <Megaphone className="h-5 w-5" />,
                    bgColor: 'bg-blue-500/10 dark:bg-blue-500/20',
                    borderColor: 'border-blue-500/30',
                    iconColor: 'text-blue-600 dark:text-blue-400',
                    badgeBg: 'bg-blue-500/20 dark:bg-blue-500/30',
                    badgeText: 'text-blue-700 dark:text-blue-300',
                };
            default:
                return {
                    icon: <Newspaper className="h-5 w-5" />,
                    bgColor: 'bg-green-500/10 dark:bg-green-500/20',
                    borderColor: 'border-green-500/30',
                    iconColor: 'text-green-600 dark:text-green-400',
                    badgeBg: 'bg-green-500/20 dark:bg-green-500/30',
                    badgeText: 'text-green-700 dark:text-green-300',
                };
        }
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Edit Modal */}
            {editingNews && (
                <div className="fixed inset-0 z-[9999]">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={cancelEdit}
                    />

                    <div className="relative min-h-[100dvh] w-full flex items-center justify-center p-4">
                        <div className="w-full max-w-2xl max-h-[90dvh] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl flex flex-col">
                            <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                                <h2 className="text-2xl font-bold text-foreground">Edit News</h2>

                                <button
                                    type="button"
                                    onClick={cancelEdit}
                                    className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted transition text-2xl leading-none text-muted-foreground"
                                    aria-label="Close"
                                >
                                    ×
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto px-6 py-5">
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-foreground mb-2">Title</label>
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                            maxLength={200}
                                        />
                                        <p className="text-xs text-muted-foreground mt-1">{editTitle.length}/200</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-foreground mb-2">Content</label>
                                        <textarea
                                            value={editContent}
                                            onChange={(e) => setEditContent(e.target.value)}
                                            rows={8}
                                            className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                                            maxLength={2000}
                                        />
                                        <p className="text-xs text-muted-foreground mt-1">{editContent.length}/2000</p>
                                    </div>
                                </div>
                            </div>

                            <div className="px-6 py-5 border-t border-border flex gap-3">
                                <Button
                                    type="button"
                                    onClick={saveEdit}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                >
                                    Save Changes
                                </Button>
                                <Button
                                    type="button"
                                    onClick={cancelEdit}
                                    variant="outline"
                                    className="flex-1"
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="relative bg-gradient-to-r from-[#00386C] to-[#6D28D9] text-white py-9 md:py-10 overflow-hidden">
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute -top-24 -left-24 w-72 h-72 bg-white rounded-full blur-3xl"></div>
                    <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-white rounded-full blur-3xl"></div>
                </div>

                <div className="max-w-7xl mx-auto px-4 relative z-10">
                    <Link
                        href="/clubs"
                        className="inline-flex items-center text-white/90 hover:text-white mb-5 transition font-medium"
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Back to Clubs
                    </Link>

                    <div className="flex items-start gap-7 flex-col md:flex-row">
                        {club.image_url ? (
                            <img
                                src={club.image_url}
                                alt={club.name}
                                className="w-32 h-32 md:w-36 md:h-36 object-cover rounded-2xl border-4 border-white/30 shadow-2xl"
                            />
                        ) : (
                            <div className="w-32 h-32 md:w-36 md:h-36 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-2xl border-4 border-white/30">
                                <Users className="h-16 w-16 text-white/70" />
                            </div>
                        )}

                        <div className="flex-1">
                            <div className="flex items-start justify-between flex-wrap gap-6">
                                <div className="flex-1">
                                    <h1 className="text-4xl md:text-5xl font-black mb-3 drop-shadow-lg">
                                        {club.name}
                                    </h1>

                                    <p className="text-white/95 mb-5 text-lg md:text-xl max-w-2xl leading-relaxed">
                                        {club.description}
                                    </p>

                                    <div className="flex items-center gap-4 flex-wrap">
                                        <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
                                            <Users className="h-5 w-5" />
                                            <span className="font-bold text-lg">{followerCount}</span>
                                            <span className="text-white/90">followers</span>
                                        </div>

                                        <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
                                            <Calendar className="h-5 w-5" />
                                            <span className="font-bold text-lg">{events.length}</span>
                                            <span className="text-white/90">upcoming events</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <Button
                                        onClick={toggleFollow}
                                        variant={isFollowing ? 'outline' : 'secondary'}
                                        size="lg"
                                        className={`
                      shadow-xl font-bold text-base px-8
                      ${isFollowing
                                                ? 'bg-white/10 backdrop-blur-sm border-2 border-white/50 text-white hover:bg-white/20'
                                                : 'bg-white text-purple-600 hover:bg-white/90'
                                            }
                    `}
                                    >
                                        {isFollowing ? (
                                            <>
                                                <BellOff className="h-5 w-5 mr-2" />
                                                Following
                                            </>
                                        ) : (
                                            <>
                                                <Bell className="h-5 w-5 mr-2" />
                                                Follow Club
                                            </>
                                        )}
                                    </Button>

                                    <Button
                                        onClick={() => setChatOpen((s) => !s)}
                                        variant="outline"
                                        size="lg"
                                        className="shadow-xl font-bold text-base px-6 bg-white/10 backdrop-blur-sm border-2 border-white/50 text-white hover:bg-white/20"
                                        title="Open club chat"
                                    >
                                        <MessageSquare className="h-5 w-5 mr-2" />
                                        {chatOpen ? 'Close Chat' : 'Chat'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-12 space-y-12">
                {news.length > 0 && (
                    <section>
                        <h2 className="text-3xl font-bold text-foreground mb-8 flex items-center gap-3">
                            <TrendingUp className="h-7 w-7 text-primary" />
                            Latest Updates
                        </h2>

                        {/*  Horizontal scroll with arrow navigation */}
                        <div className="relative group">
                            {/* Left Arrow - Always render but hide with opacity */}
                            <button
                                onClick={() => scroll('left')}
                                className={`absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 shadow-xl rounded-full p-3 transition-all duration-200 hover:scale-110 ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
                                    }`}
                                aria-label="Scroll left"
                            >
                                <ChevronLeft className="h-6 w-6 text-gray-700 dark:text-gray-200" />
                            </button>

                            {/* Right Arrow - Always render but hide with opacity */}
                            <button
                                onClick={() => scroll('right')}
                                className={`absolute right-2 top-1/2 -translate-y-1/2 z-20 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 shadow-xl rounded-full p-3 transition-all duration-200 hover:scale-110 ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
                                    }`}
                                aria-label="Scroll right"
                            >
                                <ChevronRight className="h-6 w-6 text-gray-700 dark:text-gray-200" />
                            </button>

                            <div
                                ref={setScrollContainer}
                                className="flex gap-6 overflow-x-auto scrollbar-hide pb-2"
                                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            >
                                {news.map((item) => {
                                    const style = getNewsStyle(item.type);
                                    return (
                                        <div
                                            key={item.id}
                                            className={`relative bg-card rounded-2xl shadow-sm border ${style.borderColor} p-6 hover:shadow-lg transition-all duration-200 flex-shrink-0 w-[340px]`}
                                        >
                                            {/* Admin Actions - Edit & Delete */}
                                            {isAdmin && (
                                                <div className="absolute top-3 right-3 flex gap-2 z-10">
                                                    <button
                                                        onClick={() => startEditNews(item)}
                                                        className="p-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg transition"
                                                        title="Edit news"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteNews(item.id, item.title)}
                                                        className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-lg transition"
                                                        title="Delete news"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between mb-4 pr-20">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide ${style.badgeBg} ${style.badgeText}`}
                                                >
                                                    <span className={style.iconColor}>{style.icon}</span>
                                                    {item.type}
                                                </span>
                                            </div>

                                            <div className="text-xs text-muted-foreground mb-4">
                                                {new Date(item.created_at).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric',
                                                })}
                                            </div>

                                            {item.image_url && (
                                                <div className="mb-4 -mx-6 -mt-6 pt-6">
                                                    <img
                                                        src={item.image_url}
                                                        alt={item.title}
                                                        className="w-full h-48 object-cover"
                                                    />
                                                </div>
                                            )}

                                            <h3 className="text-xl font-bold text-foreground mb-3 leading-tight">
                                                {item.title}
                                            </h3>

                                            <p className="text-sm text-muted-foreground line-clamp-4 leading-relaxed">
                                                {item.content}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>
                )}

                <section>
                    <h2 className="text-3xl font-bold text-foreground mb-8 flex items-center gap-3">
                        <Calendar className="h-7 w-7 text-primary" />
                        Upcoming Events ({events.length})
                    </h2>

                    {events.length === 0 ? (
                        <div className="text-center py-16 bg-card rounded-2xl border border-border">
                            <Calendar className="h-20 w-20 mx-auto text-muted-foreground mb-4 opacity-50" />
                            <p className="text-lg font-semibold text-foreground mb-2">No upcoming events</p>
                            <p className="text-sm text-muted-foreground">
                                Check back later for new events from this club
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {events.map((event) => (
                                <EventCard key={event.id} event={event} />
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <ClubChatPanel
                clubId={clubId}
                clubName={club.name}
                isFollowing={isFollowing}
                isAdmin={isAdmin}
                open={chatOpen}
                initialUserId={userId}
                onClose={() => setChatOpen(false)}
            />
        </div>
    );
}
