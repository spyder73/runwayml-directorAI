import { NextResponse } from 'next/server';

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, { count: number; resetAt: number }>();

export const LOGIN_IP_RATE_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };
export const LOGIN_EMAIL_RATE_LIMIT = { limit: 8, windowMs: 15 * 60 * 1000 };
export const REGISTER_IP_RATE_LIMIT = { limit: 8, windowMs: 60 * 60 * 1000 };
export const RESEND_EMAIL_RATE_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };
export const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };
export const GENERATION_RATE_LIMIT = { limit: 40, windowMs: 60 * 60 * 1000 };
export const RENDER_RATE_LIMIT = { limit: 8, windowMs: 60 * 60 * 1000 };

function retryAfter(resetAt: number, now: number) {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = options.now ?? Date.now();
  const existing = buckets.get(key);
  const bucket = !existing || now >= existing.resetAt
    ? { count: 0, resetAt: now + options.windowMs }
    : existing;

  if (bucket.count >= options.limit) {
    buckets.set(key, bucket);
    return {
      allowed: false,
      limit: options.limit,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds: retryAfter(bucket.resetAt, now),
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: true,
    limit: options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: retryAfter(bucket.resetAt, now),
  };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}

export function requestIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function rateLimitKey(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => encodeURIComponent(String(part ?? 'missing').trim().toLowerCase()).slice(0, 160) || 'missing')
    .join(':');
}

export function rateLimitResponse(result: RateLimitResult) {
  return NextResponse.json(
    { error: 'Too many requests. Please wait a moment and try again.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}
