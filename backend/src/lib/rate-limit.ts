import type { FastifyReply, FastifyRequest } from "fastify";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size < 2000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (current.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { ok: true };
}

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.ip || "unknown";
}

export function rateLimitPreHandler(name: string, limit: number, windowMs: number) {
  return async function rateLimitGuard(request: FastifyRequest, reply: FastifyReply) {
    const result = consumeRateLimit(`${name}:${clientIp(request)}`, limit, windowMs);
    if (result.ok) return;
    reply.header("Retry-After", String(result.retryAfterSec));
    reply.code(429);
    return reply.send({ error: "Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi." });
  };
}
