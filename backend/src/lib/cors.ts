const DEFAULT_ORIGINS = [
  "https://livio.id",
  "https://www.livio.id",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function corsAllowlist(): string[] {
  const extra = String(process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_ORIGINS, ...extra]));
}

export function isAllowedOrigin(origin: string | undefined, allowlist = corsAllowlist()): boolean {
  if (!origin) return true;
  return allowlist.includes(origin);
}
