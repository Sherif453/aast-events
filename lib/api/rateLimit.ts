type RateLimitSpec = {
  max: number;
  windowMs: number;
};

type RateLimitResult = {
  ok: true;
} | {
  ok: false;
  retryAfterSeconds: number;
};

type Store = {
  incr(key: string, ttlMs: number): Promise<number>;
};

function getMemoryStore(): Store {
  // Dev-only / best-effort fallback. In serverless production this is not a durable shared backend.
  const g = globalThis as unknown as { __aastRateLimitStore?: Map<string, { value: number; expiresAt: number }> };
  if (!g.__aastRateLimitStore) g.__aastRateLimitStore = new Map();
  const map = g.__aastRateLimitStore;

  return {
    async incr(key: string, ttlMs: number) {
      const now = Date.now();
      const existing = map.get(key);
      if (!existing || existing.expiresAt <= now) {
        map.set(key, { value: 1, expiresAt: now + ttlMs });
        return 1;
      }
      const next = existing.value + 1;
      map.set(key, { value: next, expiresAt: existing.expiresAt });
      return next;
    },
  };
}

function getUpstashStore(): Store | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;

  const pipelineUrl = url.replace(/\/+$/, "") + "/pipeline";

  return {
    async incr(key: string, ttlMs: number) {
      const res = await fetch(pipelineUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([["INCR", key], ["PEXPIRE", key, ttlMs]]),
      });

      if (!res.ok) throw new Error(`upstash_bad_status_${res.status}`);
      const json = (await res.json()) as Array<{ result?: unknown; error?: string }>;
      const incrResult = json?.[0]?.result;
      const n = typeof incrResult === "number" ? incrResult : Number(incrResult);
      if (!Number.isFinite(n)) throw new Error("upstash_bad_result");
      return n;
    },
  };
}

function firstIpFromXff(xff: string) {
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

export function getRequestIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return firstIpFromXff(xff);

  const candidates = [
    req.headers.get("x-real-ip"),
    req.headers.get("cf-connecting-ip"),
    req.headers.get("true-client-ip"),
  ].filter(Boolean) as string[];

  return candidates[0] ?? null;
}

export type RateLimitOptions = {
  keyPrefix: string;
  ip: RateLimitSpec;
  user?: RateLimitSpec;
  userId?: string | null;
};

function retryAfterSeconds(windowMs: number, nowMs: number) {
  return Math.max(0, Math.ceil((windowMs - (nowMs % windowMs)) / 1000));
}

function windowKey(prefix: string, kind: "ip" | "user", id: string, windowMs: number, nowMs: number) {
  const windowId = Math.floor(nowMs / windowMs);
  return `${prefix}:${kind}:${id}:${windowId}`;
}

export async function checkRateLimit(req: Request, opts: RateLimitOptions): Promise<RateLimitResult> {
  if (req.method === "OPTIONS") return { ok: true };

  const nowMs = Date.now();
  const upstash = getUpstashStore();
  const store = upstash ?? getMemoryStore();

  const ip = getRequestIp(req) ?? "unknown";

  const ipKey = windowKey(opts.keyPrefix, "ip", ip, opts.ip.windowMs, nowMs);
  const ttlMs = opts.ip.windowMs * 2;

  let ipCount = 0;
  try {
    ipCount = await store.incr(ipKey, ttlMs);
  } catch (e) {
    console.error("rate_limit_store_error(ip):", e);
    return { ok: true };
  }

  const ipExceeded = ipCount > opts.ip.max;
  const ipRetry = retryAfterSeconds(opts.ip.windowMs, nowMs);

  let userExceeded = false;
  let userRetry = 0;
  if (opts.user && opts.userId) {
    const userKey = windowKey(opts.keyPrefix, "user", opts.userId, opts.user.windowMs, nowMs);
    try {
      const userCount = await store.incr(userKey, opts.user.windowMs * 2);
      userExceeded = userCount > opts.user.max;
      userRetry = retryAfterSeconds(opts.user.windowMs, nowMs);
    } catch (e) {
      console.error("rate_limit_store_error(user):", e);
      return { ok: true };
    }
  }

  if (!ipExceeded && !userExceeded) return { ok: true };

  const retryAfter = Math.max(ipExceeded ? ipRetry : 0, userExceeded ? userRetry : 0);
  return { ok: false, retryAfterSeconds: retryAfter };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  const res = Response.json({ ok: false, error: "rate_limited", retryAfterSeconds }, { status: 429 });
  res.headers.set("Retry-After", String(retryAfterSeconds));
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  return res;
}
