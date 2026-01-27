import { z } from "zod";

export { z };

export function sanitizePlainText(input: string) {
  return input
    .replaceAll("\u0000", "")
    .replace(/[\u0001-\u001f\u007f]/g, "")
    .trim();
}

export function normalizeEmail(input: string) {
  const email = sanitizePlainText(input).toLowerCase();
  const parsed = z.string().email().max(254).safeParse(email);
  return parsed.success ? parsed.data : null;
}

export function isUuid(input: string) {
  const s = input.trim();
  // Accept RFC 4122 UUIDs (v1-v5).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export const zUuid = z.string().uuid();

export const zIdString = z
  .string()
  .trim()
  .refine((v) => zUuid.safeParse(v).success || /^[0-9]+$/.test(v), "invalid_id");

export function zSafeText(opts: { min?: number; max: number }) {
  let inner = z.string();
  if (opts.min != null) inner = inner.min(opts.min);
  inner = inner.max(opts.max);

  return z.preprocess((v) => (typeof v === "string" ? sanitizePlainText(v) : v), inner);
}

export function assertNoUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  for (const k of Object.keys(obj)) {
    if (!allowedSet.has(k)) throw new Error("unknown_field");
  }
}

export function requireString(
  value: unknown,
  opts: { field: string; min?: number; max: number; trim?: boolean } = { field: "value", max: 4096 }
) {
  if (typeof value !== "string") throw new Error(`${opts.field}_not_string`);
  const s = opts.trim ? sanitizePlainText(value) : value;
  if (opts.min != null && s.length < opts.min) throw new Error(`${opts.field}_too_short`);
  if (s.length > opts.max) throw new Error(`${opts.field}_too_long`);
  return s;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Error("invalid_json");
  }
}

export async function parseJsonBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const body = await readJson(req);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("invalid_body");
  return parsed.data;
}

export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const url = new URL(req.url);
  const obj = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw new Error("invalid_query");
  return parsed.data;
}
