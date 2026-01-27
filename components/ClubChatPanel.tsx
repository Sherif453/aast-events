'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageSquare, Plus, Pin, Trash2, ShieldBan, BarChart2, X, ChevronLeft, Loader2 } from 'lucide-react';

type ThreadRow = {
  id: string;
  club_id: string;
  created_by: string;
  title: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

type PostRow = {
  id: string;
  club_id: string;
  thread_id: string;
  user_id: string;
  type: 'message' | 'poll';
  content: string | null;
  poll_id: string | null;
  pinned: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
};

type PublicProfile = { id: string; full_name: string | null; avatar_url: string | null };

type PollRow = {
  id: string;
  club_id: string;
  thread_id: string;
  question: string;
  allow_multi: boolean;
  closed_at: string | null;
};

type PollOptionRow = { id: string; poll_id: string; option_text: string };
type PollResultRow = { option_id: string; option_text: string; vote_count: number };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
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

function initials(name: string | null) {
  const v = (name || '').trim();
  if (!v) return '?';
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function PollCard({
  pollId,
  clubId,
  userId,
  canVote,
  isAdmin,
  onChanged,
}: {
  pollId: string;
  clubId: string;
  userId: string | null;
  canVote: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [poll, setPoll] = useState<PollRow | null>(null);
  const [options, setOptions] = useState<PollOptionRow[]>([]);
  const [results, setResults] = useState<PollResultRow[]>([]);
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [pollQ, optQ] = await Promise.all([
      supabase.from('club_polls').select('id, club_id, thread_id, question, allow_multi, closed_at').eq('id', pollId).maybeSingle(),
      supabase.from('club_poll_options').select('id, poll_id, option_text').eq('poll_id', pollId).order('created_at', { ascending: true }),
    ]);

    if (!pollQ.error) setPoll((pollQ.data as unknown as PollRow | null) ?? null);
    if (!optQ.error) setOptions((optQ.data as unknown as PollOptionRow[] | null) ?? []);

    if (userId) {
      const votesQ = await supabase
        .from('club_poll_votes')
        .select('option_id')
        .eq('poll_id', pollId)
        .eq('user_id', userId);
      type VoteRow = { option_id: string | number };
      const voteRows = (votesQ.data as unknown as VoteRow[] | null) ?? [];
      if (!votesQ.error) setMyVotes(new Set(voteRows.map((r) => String(r.option_id))));
    }

    const resultsQ = await supabase.rpc('get_club_poll_results', { p_poll_id: pollId });
    if (!resultsQ.error) {
      type PollResultRpcRow = { option_id: string | number; option_text: string | null; vote_count: number | null };
      const rpcRows = (resultsQ.data as unknown as PollResultRpcRow[] | null) ?? [];
      setResults(
        rpcRows.map((r) => ({
          option_id: String(r.option_id),
          option_text: String(r.option_text),
          vote_count: Number(r.vote_count ?? 0),
        }))
      );
    }
  }, [supabase, pollId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const voteCountByOption = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of results) map.set(r.option_id, r.vote_count);
    return map;
  }, [results]);

  const totalVotes = useMemo(() => results.reduce((s, r) => s + (r.vote_count || 0), 0), [results]);

  const toggleVote = async (optionId: string) => {
    if (!userId) return;
    if (!poll) return;
    if (poll.closed_at) return;
    if (!canVote) return;

    setBusy(true);
    try {
      if (!poll.allow_multi) {
        await supabase.from('club_poll_votes').delete().eq('poll_id', pollId).eq('user_id', userId);
        const { error } = await supabase.from('club_poll_votes').insert({
          poll_id: pollId,
          club_id: clubId,
          option_id: optionId,
          user_id: userId,
        });
        if (error) throw error;
        setMyVotes(new Set([optionId]));
      } else {
        const has = myVotes.has(optionId);
        if (has) {
          const { error } = await supabase
            .from('club_poll_votes')
            .delete()
            .eq('poll_id', pollId)
            .eq('user_id', userId)
            .eq('option_id', optionId);
          if (error) throw error;
          const next = new Set(myVotes);
          next.delete(optionId);
          setMyVotes(next);
        } else {
          const { error } = await supabase.from('club_poll_votes').insert({
            poll_id: pollId,
            club_id: clubId,
            option_id: optionId,
            user_id: userId,
          });
          if (error) throw error;
          const next = new Set(myVotes);
          next.add(optionId);
          setMyVotes(next);
        }
      }

      await load();
      onChanged();
    } catch (e) {
      console.error('[Poll] vote failed:', e);
    } finally {
      setBusy(false);
    }
  };

  if (!poll) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="text-sm text-muted-foreground">Loading poll…</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-blue-50/60 dark:bg-blue-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BarChart2 className="h-4 w-4" />
            <span>{totalVotes} vote{totalVotes === 1 ? '' : 's'}</span>
            {poll.allow_multi ? <span className="ml-2">• multi-select</span> : <span className="ml-2">• single-choice</span>}
          </div>
          <p className="font-semibold text-foreground mt-1">{poll.question}</p>
        </div>
        {poll.closed_at && <span className="text-xs font-semibold text-muted-foreground">Closed</span>}
      </div>

      <div className="mt-3 space-y-2">
        {options.map((o) => {
          const c = voteCountByOption.get(o.id) ?? 0;
          const selected = myVotes.has(o.id);
          const pct = totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0;
          return (
            <button
              key={o.id}
              type="button"
              disabled={!canVote || busy || !!poll.closed_at}
              onClick={() => void toggleVote(o.id)}
              className={[
                'w-full text-left rounded-lg border px-3 py-2 transition',
                selected
                  ? 'border-blue-300 bg-white dark:bg-background'
                  : 'border-border bg-white/70 dark:bg-background/60 hover:bg-white dark:hover:bg-background',
                !canVote || poll.closed_at ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">{o.option_text}</span>
                <span className="text-xs text-muted-foreground">
                  {c} • {pct}%
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {!userId && <p className="text-xs text-muted-foreground mt-3">Log in to vote.</p>}
      {userId && !canVote && !isAdmin && (
        <p className="text-xs text-muted-foreground mt-3">Follow the club to vote.</p>
      )}
    </div>
  );
}

export default function ClubChatPanel({
  clubId,
  clubName,
  isFollowing,
  isAdmin,
  open,
  onClose,
  initialUserId,
}: {
  clubId: string;
  clubName?: string | null;
  isFollowing: boolean;
  isAdmin: boolean;
  open: boolean;
  onClose: () => void;
  initialUserId?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const [profileMap, setProfileMap] = useState<Map<string, PublicProfile>>(new Map());

  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [newThreadBody, setNewThreadBody] = useState('');
  const [creatingThread, setCreatingThread] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const [showPollForm, setShowPollForm] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollAllowMulti, setPollAllowMulti] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [creatingPoll, setCreatingPoll] = useState(false);

  const reqIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const init = async () => {
      if (initialUserId) setUserId((prev) => prev ?? initialUserId);

      // Seed from local session first (fast/local). If missing, verify best-effort
      // before we decide to show the "log in" CTA (prevents flicker).
      try {
        const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 2000);
        const sessionUserId = sessionData.session?.user?.id ?? null;
        if (!active) return;
        if (sessionUserId) {
          setUserId((prev) => (prev === sessionUserId ? prev : sessionUserId));
          setSessionChecked(true);
          return;
        }
      } catch {
        // ignore transient session errors
      }

      try {
        const { data } = await withTimeout(supabase.auth.getUser(), 3000);
        if (!active) return;
        if (data.user?.id) setUserId((prev) => (prev === data.user!.id ? prev : data.user!.id));
      } catch {
        // ignore
      } finally {
        if (active) setSessionChecked(true);
      }
    };

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUserId(null);
        setSessionChecked(true);
        return;
      }
      const next = session?.user?.id ?? null;
      if (next) setUserId(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, initialUserId]);

  const loadBlocked = useCallback(
    async (uid: string) => {
      const { data, error } = await supabase
        .from('club_chat_blocks')
        .select('user_id')
        .eq('club_id', clubId)
        .eq('user_id', uid)
        .maybeSingle();
      if (error) {
        setBlocked(false);
        return;
      }
      setBlocked(!!data);
    },
    [supabase, clubId]
  );

  const loadThreads = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setThreadsLoading(true);
    setThreadsError(null);

    if (!userId) {
      setThreads([]);
      setThreadsLoading(false);
      return;
    }

    try {
      const res = await supabase
        .from('club_threads')
        .select('id, club_id, created_by, title, created_at, deleted_at, deleted_by')
        .eq('club_id', clubId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(30);

      if (myReq !== reqIdRef.current) return;

      if (res.error) {
        const msg =
          typeof (res.error as unknown as { message?: unknown } | null)?.message === 'string'
            ? String((res.error as unknown as { message?: unknown } | null)?.message)
            : 'Failed to load chat';
        setThreadsError(msg);
        setThreads([]);
      } else {
        setThreads((res.data as unknown as ThreadRow[] | null) ?? []);
      }
    } finally {
      if (myReq === reqIdRef.current) setThreadsLoading(false);
    }
  }, [supabase, clubId, userId]);

  const loadPosts = useCallback(
    async (threadId: string) => {
      setPostsLoading(true);
      try {
        const res = await supabase
          .from('club_thread_posts')
          .select('id, club_id, thread_id, user_id, type, content, poll_id, pinned, deleted_at, deleted_by, created_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true })
          .limit(200);

        if (res.error) {
          setPosts([]);
          return;
        }

        const rows = (res.data as unknown as PostRow[] | null) ?? [];
        setPosts(rows);

        const userIds = Array.from(new Set(rows.map((p) => p.user_id)));
        if (userIds.length > 0) {
          const prof = await supabase.from('profiles_public').select('id, full_name, avatar_url').in('id', userIds);
          if (!prof.error) {
            const map = new Map<string, PublicProfile>();
            const profileRows = (prof.data as unknown as PublicProfile[] | null) ?? [];
            for (const p of profileRows) {
              map.set(String(p.id), { id: String(p.id), full_name: p.full_name ?? null, avatar_url: p.avatar_url ?? null });
            }
            setProfileMap(map);
          }
        }
      } finally {
        setPostsLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (!open) return;
    if (!userId) return;
    void loadThreads();
    void loadBlocked(userId);
  }, [open, userId, loadThreads, loadBlocked]);

  useEffect(() => {
    if (!open) return;
    if (!userId) return;
    if (!clubId) return;

    const channel = supabase
      .channel(`club-chat-${clubId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'club_thread_posts', filter: `club_id=eq.${clubId}` },
        () => {
          if (activeThreadId) void loadPosts(activeThreadId);
          else void loadThreads();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'club_threads', filter: `club_id=eq.${clubId}` },
        () => void loadThreads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, clubId, open, userId, activeThreadId, loadPosts, loadThreads]);

  const canAccess = Boolean(userId) && (isAdmin || isFollowing);
  const canPost = Boolean(userId) && (isAdmin || (isFollowing && !blocked));
  const canCreateThread = Boolean(userId) && isAdmin;

  const createThread = async () => {
    if (!userId) return;
    if (!canCreateThread) return;
    const title = newThreadTitle.trim();
    const body = newThreadBody.trim();
    if (!title || !body) return;

    setCreatingThread(true);
    try {
      const { data: thread, error: threadErr } = await supabase
        .from('club_threads')
        .insert({ club_id: clubId, created_by: userId, title })
        .select('id, club_id, created_by, title, created_at')
        .single();
      if (threadErr) throw threadErr;

      const threadRow = thread as unknown as ThreadRow;
      const threadId = String(threadRow.id);
      const { error: postErr } = await supabase.from('club_thread_posts').insert({
        club_id: clubId,
        thread_id: threadId,
        user_id: userId,
        type: 'message',
        content: body,
      });
      if (postErr) throw postErr;

      setNewThreadTitle('');
      setNewThreadBody('');
      await loadThreads();
      setActiveThreadId(threadId);
      await loadPosts(threadId);
    } catch (e) {
      console.error('[Chat] createThread failed:', e);
    } finally {
      setCreatingThread(false);
    }
  };

  const deleteThread = async () => {
    if (!isAdmin) return;
    if (!userId || !activeThreadId) return;
    if (!confirm('Delete this thread? It will no longer be visible to users.')) return;

    try {
      const { error } = await supabase
        .from('club_threads')
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .eq('id', activeThreadId);
      if (error) throw error;
      setActiveThreadId(null);
      setShowPollForm(false);
      await loadThreads();
    } catch (e) {
      console.error('[Chat] deleteThread failed:', e);
    }
  };

  const sendReply = async () => {
    if (!userId || !activeThreadId) return;
    if (!canPost) return;
    const body = replyText.trim();
    if (!body) return;

    setSendingReply(true);
    try {
      const { error } = await supabase.from('club_thread_posts').insert({
        club_id: clubId,
        thread_id: activeThreadId,
        user_id: userId,
        type: 'message',
        content: body,
      });
      if (error) throw error;

      setReplyText('');
      await loadPosts(activeThreadId);
    } catch (e) {
      console.error('[Chat] sendReply failed:', e);
    } finally {
      setSendingReply(false);
    }
  };

  const togglePin = async (post: PostRow) => {
    if (!isAdmin) return;
    const { error } = await supabase.from('club_thread_posts').update({ pinned: !post.pinned }).eq('id', post.id);
    if (!error && activeThreadId) void loadPosts(activeThreadId);
  };

  const deletePost = async (post: PostRow) => {
    if (!isAdmin) return;
    if (!userId) return;
    const { error } = await supabase
      .from('club_thread_posts')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId, content: null })
      .eq('id', post.id);
    if (!error && activeThreadId) void loadPosts(activeThreadId);
  };

  const blockUser = async (targetUserId: string) => {
    if (!isAdmin) return;
    if (!userId) return;
    if (!targetUserId || targetUserId === userId) return;
    const { error } = await supabase
      .from('club_chat_blocks')
      .upsert({ club_id: clubId, user_id: targetUserId, blocked_by: userId }, { onConflict: 'club_id,user_id' });
    if (error) console.error('[Chat] blockUser failed:', error);
  };

  const createPoll = async () => {
    if (!isAdmin) return;
    if (!userId || !activeThreadId) return;
    const question = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!question || opts.length < 2) return;

    setCreatingPoll(true);
    try {
      const { data: poll, error: pollErr } = await supabase
        .from('club_polls')
        .insert({
          club_id: clubId,
          thread_id: activeThreadId,
          question,
          allow_multi: pollAllowMulti,
          created_by: userId,
        })
        .select('id, club_id, thread_id, question, allow_multi, closed_at')
        .single();
      if (pollErr) throw pollErr;

      const pollRow = poll as unknown as PollRow;
      const pollId = String(pollRow.id);
      const { error: optErr } = await supabase.from('club_poll_options').insert(opts.map((o) => ({ poll_id: pollId, option_text: o })));
      if (optErr) throw optErr;

      const { error: postErr } = await supabase.from('club_thread_posts').insert({
        club_id: clubId,
        thread_id: activeThreadId,
        user_id: userId,
        type: 'poll',
        poll_id: pollId,
        content: null,
      });
      if (postErr) throw postErr;

      setShowPollForm(false);
      setPollQuestion('');
      setPollAllowMulti(false);
      setPollOptions(['', '']);
      await loadPosts(activeThreadId);
    } catch (e) {
      console.error('[Chat] createPoll failed:', e);
    } finally {
      setCreatingPoll(false);
    }
  };

  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId]);

  const orderedPosts = useMemo(() => {
    const pinned = posts.filter((p) => p.pinned);
    const rest = posts.filter((p) => !p.pinned);
    return [...pinned, ...rest];
  }, [posts]);

  const next = `/clubs/${clubId}`;
  const showAuthLoading = !sessionChecked && !userId;
  const showLoginCta = sessionChecked && !userId;

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-[1200] bg-black/40 backdrop-blur-sm transition-opacity',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={onClose}
      />

      <div
        className={[
          'fixed right-0 top-0 z-[1201] h-dvh w-full max-w-[520px] transform border-l border-border bg-background shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none',
        ].join(' ')}
      >
        <div className="h-full flex flex-col">
          <div className="px-4 py-4 border-b border-border flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Club Chat</p>
              <p className="text-sm font-bold text-foreground truncate">{clubName || 'Discussion board'}</p>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-muted transition"
              aria-label="Close chat"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {showAuthLoading ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading chat…</span>
              </div>
            ) : showLoginCta ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">Log in required</p>
                    <p className="text-sm text-muted-foreground mt-1">Log in to access this club’s discussion board.</p>
                    <Link
                      href={`/auth/login?next=${encodeURIComponent(next)}`}
                      className="inline-flex mt-3 items-center rounded-md bg-[#00386C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#002040] transition"
                    >
                      Log in
                    </Link>
                  </div>
                </div>
              </div>
            ) : !canAccess ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">Followers only</p>
                    <p className="text-sm text-muted-foreground mt-1">Follow this club to view and participate in discussions.</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {blocked && !isAdmin && (
                  <div className="mb-4 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 p-3">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">You are blocked from this club&apos;s chat.</p>
                  </div>
                )}

                {threadsError && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground mb-4">
                    {threadsError}
                  </div>
                )}

                {!activeThreadId || !activeThread ? (
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <p className="text-sm font-semibold text-foreground">Threads</p>
                      {isAdmin && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setActiveThreadId(null);
                            setShowPollForm(false);
                          }}
                          variant="outline"
                          className="h-8"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          New
                        </Button>
                      )}
                    </div>

                    {threadsLoading ? (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : threads.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No threads yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {threads.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              setActiveThreadId(t.id);
                              setShowPollForm(false);
                              void loadPosts(t.id);
                            }}
                            className="w-full text-left rounded-lg border border-border px-3 py-2 transition hover:bg-muted"
                          >
                            <p className="text-sm font-semibold text-foreground line-clamp-1">{t.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{new Date(t.created_at).toLocaleString()}</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {isAdmin ? (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-sm font-semibold text-foreground mb-2">Create a thread</p>
                        <Input
                          value={newThreadTitle}
                          onChange={(e) => setNewThreadTitle(e.target.value)}
                          placeholder="Thread title"
                          disabled={!canCreateThread || creatingThread}
                        />
                        <Textarea
                          className="mt-2"
                          value={newThreadBody}
                          onChange={(e) => setNewThreadBody(e.target.value)}
                          placeholder="Write the first message…"
                          disabled={!canCreateThread || creatingThread}
                        />
                        <Button
                          className="mt-3 w-full bg-[#00386C] hover:bg-[#00509d] text-white"
                          onClick={() => void createThread()}
                          disabled={!canCreateThread || creatingThread || !newThreadTitle.trim() || !newThreadBody.trim()}
                        >
                          {creatingThread ? 'Creating…' : 'Post thread'}
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-xs text-muted-foreground">
                          Threads are created by club admins. Open a thread to reply and participate.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveThreadId(null);
                          setShowPollForm(false);
                        }}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Threads
                      </button>

                      {isAdmin && (
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => void deleteThread()}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setShowPollForm((s) => !s)}>
                            <BarChart2 className="h-4 w-4 mr-2" />
                            {showPollForm ? 'Close poll' : 'Create poll'}
                          </Button>
                        </div>
                      )}
                    </div>

                    <p className="text-base font-bold text-foreground truncate">{activeThread.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                      Thread • {new Date(activeThread.created_at).toLocaleString()}
                    </p>

                    {showPollForm && isAdmin && (
                      <div className="rounded-xl border border-border bg-muted/30 p-4 mb-4">
                        <p className="text-sm font-semibold text-foreground mb-2">New poll</p>
                        <Input
                          value={pollQuestion}
                          onChange={(e) => setPollQuestion(e.target.value)}
                          placeholder="Poll question"
                          disabled={creatingPoll}
                        />
                        <div className="flex items-center justify-between gap-3 mt-2">
                          <span className="text-sm text-muted-foreground">Allow multiple selections</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={pollAllowMulti}
                            onClick={() => setPollAllowMulti((v) => !v)}
                            className={[
                              'relative inline-flex h-6 w-11 items-center rounded-full transition',
                              pollAllowMulti ? 'bg-blue-600' : 'bg-muted',
                            ].join(' ')}
                          >
                            <span
                              className={[
                                'inline-block h-5 w-5 transform rounded-full bg-background border border-border shadow transition',
                                pollAllowMulti ? 'translate-x-5' : 'translate-x-1',
                              ].join(' ')}
                            />
                          </button>
                        </div>

                        <div className="mt-3 space-y-2">
                          {pollOptions.map((v, idx) => (
                            <Input
                              key={idx}
                              value={v}
                              onChange={(e) => {
                                const next = pollOptions.slice();
                                next[idx] = e.target.value;
                                setPollOptions(next);
                              }}
                              placeholder={`Option ${idx + 1}`}
                              disabled={creatingPoll}
                            />
                          ))}
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPollOptions((o) => [...o, ''])}
                              disabled={creatingPoll || pollOptions.length >= 6}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add option
                            </Button>
                            <Button
                              type="button"
                              className="bg-[#00386C] hover:bg-[#00509d] text-white"
                              size="sm"
                              onClick={() => void createPoll()}
                              disabled={
                                creatingPoll ||
                                !pollQuestion.trim() ||
                                pollOptions.map((o) => o.trim()).filter(Boolean).length < 2
                              }
                            >
                              {creatingPoll ? 'Creating…' : 'Post poll'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {postsLoading ? (
                        <p className="text-sm text-muted-foreground">Loading messages…</p>
                      ) : orderedPosts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No messages yet.</p>
                      ) : (
                        orderedPosts.map((p) => {
                          const prof = profileMap.get(p.user_id);
                          const name = prof?.full_name ?? 'Student';
                          const isDeleted = !!p.deleted_at;
                          return (
                            <div key={p.id} className="rounded-xl border border-border bg-card p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3 min-w-0">
                                  <Avatar className="h-9 w-9 ring-2 ring-blue-500/10">
                                    <AvatarImage src={prof?.avatar_url || ''} alt={name} />
                                    <AvatarFallback className="bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold">
                                      {initials(prof?.full_name ?? null)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-semibold text-foreground truncate">{name}</p>
                                      {p.pinned && (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800/40">
                                          <Pin className="h-3 w-3" />
                                          Pinned
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(p.created_at).toLocaleString()}</p>
                                  </div>
                                </div>

                                {isAdmin && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => void togglePin(p)}
                                      className="p-2 rounded-md hover:bg-muted transition"
                                      title={p.pinned ? 'Unpin' : 'Pin'}
                                    >
                                      <Pin className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                    <button
                                      onClick={() => void deletePost(p)}
                                      className="p-2 rounded-md hover:bg-muted transition"
                                      title="Delete"
                                    >
                                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                    <button
                                      onClick={() => void blockUser(p.user_id)}
                                      className="p-2 rounded-md hover:bg-muted transition"
                                      title="Block user"
                                    >
                                      <ShieldBan className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="mt-3">
                                {p.type === 'poll' && p.poll_id ? (
                                  <PollCard
                                    pollId={p.poll_id}
                                    clubId={clubId}
                                    userId={userId}
                                    canVote={canPost}
                                    isAdmin={isAdmin}
                                    onChanged={() => void loadPosts(activeThreadId)}
                                  />
                                ) : isDeleted ? (
                                  <p className="text-sm text-muted-foreground italic">Message deleted</p>
                                ) : (
                                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">{p.content}</p>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-border">
                      <Textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={blocked && !isAdmin ? 'You are blocked from chat.' : 'Write a reply…'}
                        disabled={!canPost || sendingReply}
                      />
                      <div className="flex items-center justify-between gap-3 mt-2">
                        <p className="text-xs text-muted-foreground">
                          {blocked && !isAdmin ? 'You are blocked from this club chat.' : 'Be respectful & friendly.'}
                        </p>
                        <Button
                          className="bg-[#00386C] hover:bg-[#00509d] text-white"
                          onClick={() => void sendReply()}
                          disabled={!canPost || sendingReply || !replyText.trim()}
                        >
                          {sendingReply ? 'Sending…' : 'Send'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
