import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const ORDER_COOKIE_NAME = "livio_order";
const COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export class EntitlementError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

function ticketSecret(): string {
  const secret = (process.env.ORDER_TICKET_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ORDER_TICKET_SECRET wajib diisi di production.");
  }
  return "livio-dev-order-ticket";
}

export function signResumeCode(resumeCode: string): string {
  return createHmac("sha256", ticketSecret()).update(resumeCode).digest("hex").slice(0, 32);
}

export function verifySignedResumeCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const [resumeCode, signature] = raw.split(".");
  if (!resumeCode || !signature) return null;
  const expected = signResumeCode(resumeCode);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return resumeCode;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setOrderCookie(reply: FastifyReply, resumeCode: string) {
  const value = `${resumeCode}.${signResumeCode(resumeCode)}`;
  reply.header(
    "Set-Cookie",
    `${ORDER_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}${cookieSecure() ? "; Secure" : ""}`,
  );
}

export function clearOrderCookie(reply: FastifyReply) {
  reply.header(
    "Set-Cookie",
    `${ORDER_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure() ? "; Secure" : ""}`,
  );
}

export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function extractResumeCode(request: FastifyRequest): string | null {
  const body = (request.body || {}) as Record<string, unknown>;
  const query = (request.query || {}) as Record<string, unknown>;
  const headerCode = request.headers["x-livio-resume"];
  const fromHeader = typeof headerCode === "string" ? headerCode.trim() : "";
  const fromBody =
    (typeof body.resumeCode === "string" && body.resumeCode) ||
    (typeof body.orderResumeCode === "string" && body.orderResumeCode) ||
    "";
  const fromQuery = typeof query.resumeCode === "string" ? query.resumeCode : "";
  const fromCookie = verifySignedResumeCode(readCookie(request, ORDER_COOKIE_NAME));
  const raw = (fromHeader || fromBody || fromQuery || fromCookie || "").trim().toUpperCase();
  return raw || null;
}

export function extractOrderId(request: FastifyRequest): string | null {
  const body = (request.body || {}) as Record<string, unknown>;
  const query = (request.query || {}) as Record<string, unknown>;
  const headerId = request.headers["x-livio-order"];
  const fromHeader = typeof headerId === "string" ? headerId.trim() : "";
  const fromBody = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const fromQuery = typeof query.orderId === "string" ? query.orderId.trim() : "";
  return fromHeader || fromBody || fromQuery || null;
}

export function safeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
