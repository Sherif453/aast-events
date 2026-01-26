export type CorsOptions = {
  methods: string[];
  headers?: string[];
  allowCredentials?: boolean;
};

function normalizeOrigin(s: string) {
  try {
    return new URL(s).origin;
  } catch {
    return null;
  }
}

function allowedOrigins() {
  const origins = new Set<string>();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const siteOrigin = siteUrl ? normalizeOrigin(siteUrl) : null;
  if (siteOrigin) origins.add(siteOrigin);

  const extra = process.env.CORS_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  for (const o of extra) {
    const origin = normalizeOrigin(o);
    if (origin) origins.add(origin);
  }

  return origins;
}

export function applySecurityHeaders(headers: Headers) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
}

export function applyCors(req: Request, headers: Headers, opts: CorsOptions) {
  headers.append("Vary", "Origin");

  const origin = req.headers.get("origin");
  if (!origin) return;

  const allowed = allowedOrigins();
  if (!allowed.has(origin)) return;

  headers.set("Access-Control-Allow-Origin", origin);
  if (opts.allowCredentials) headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", opts.methods.join(", "));
  if (opts.headers?.length) headers.set("Access-Control-Allow-Headers", opts.headers.join(", "));
  headers.set("Access-Control-Max-Age", "600");
}

export function preflight(req: Request, opts: CorsOptions) {
  const res = new Response(null, { status: 204 });
  applyCors(req, res.headers, opts);
  applySecurityHeaders(res.headers);
  return res;
}

