import { randomBytes } from "node:crypto";
import prisma from "../lib/prisma.js";
import { getPlanById, type LivePlan } from "../config/plans.js";
import {
  createXenditInvoice,
  isExpiredInvoiceStatus,
  isPaidInvoiceStatus,
  isXenditDevMode,
} from "./xendit.js";

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "preparing",
  "live",
  "failed",
  "consumed",
  "expired",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type ConsumedReason = "user_ended" | "duration_elapsed";

export const REUSABLE_STATUSES: OrderStatus[] = ["paid", "preparing", "failed"];
export const STARTABLE_STATUSES: OrderStatus[] = ["paid", "preparing", "failed", "live"];
const MAX_PREPARE_ATTEMPTS = 3;
const PREPARE_WINDOW_MS = 24 * 60 * 60 * 1000;

const RESUME_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateResumeCode(): string {
  const bytes = randomBytes(8);
  let suffix = "";
  for (let i = 0; i < 8; i += 1) {
    suffix += RESUME_ALPHABET[bytes[i] % RESUME_ALPHABET.length];
  }
  return `LIV-${suffix}`;
}

export function normalizeResumeCode(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function isReusableStatus(status: string): boolean {
  return REUSABLE_STATUSES.includes(status as OrderStatus);
}

export function isStartableStatus(status: string): boolean {
  return STARTABLE_STATUSES.includes(status as OrderStatus);
}

export function consumeReasonFromEndedReason(endedReason?: string | null): ConsumedReason | null {
  if (endedReason === "user_stop" || endedReason === "user_ended") return "user_ended";
  if (endedReason === "duration_expiry" || endedReason === "duration_elapsed") return "duration_elapsed";
  return null;
}

export function publicOrderMessage(status: string, consumedReason?: string | null): string {
  if (status === "pending_payment") return "Pembayaran belum selesai.";
  if (status === "paid" || status === "failed" || status === "preparing") {
    return "Pembayaran sudah masuk. Siapkan siaran tanpa bayar ulang.";
  }
  if (status === "live") return "Siaran ini masih berjalan. Menyambungkan kembali ke studio yang sama.";
  if (status === "consumed") {
    return consumedReason === "duration_elapsed"
      ? "Durasi paket sudah habis. Bayar paket baru untuk siaran berikutnya."
      : "Siaran ini sudah diakhiri. Buat pembayaran baru untuk live berikutnya.";
  }
  if (status === "expired") return "Invoice sudah kadaluarsa. Buat pembayaran baru.";
  if (status === "refunded") return "Pembayaran ini sudah dikembalikan.";
  return "Kode tidak bisa dipakai.";
}

async function uniqueResumeCode(): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const resumeCode = generateResumeCode();
    const exists = await prisma.order.findUnique({ where: { resumeCode }, select: { id: true } });
    if (!exists) return resumeCode;
  }
  throw new Error("Gagal membuat kode pemulihan.");
}

export async function createCheckoutOrder(planId: string) {
  const plan = getPlanById(planId);
  if (!plan) {
    throw Object.assign(new Error("Paket tidak valid."), { statusCode: 400 });
  }

  const resumeCode = await uniqueResumeCode();
  const externalId = `livio-${resumeCode.toLowerCase()}`;
  const appUrl = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:3000").split(",")[0].trim();
  const successUrl = `${appUrl}/dashboard?paid=${encodeURIComponent(resumeCode)}`;
  const failureUrl = `${appUrl}/dashboard?pay_failed=1`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let invoiceId: string | null = null;
  let invoiceUrl: string | null = null;
  let devPayment = false;

  if (isXenditDevMode()) {
    invoiceId = `dev-${externalId}`;
    invoiceUrl = null;
    devPayment = true;
  } else {
    const invoice = await createXenditInvoice({
      externalId,
      amount: plan.amount,
      description: `Livio Live ${plan.label}`,
      successRedirectUrl: successUrl,
      failureRedirectUrl: failureUrl,
    });
    invoiceId = invoice.id;
    invoiceUrl = invoice.invoice_url;
  }

  const order = await prisma.order.create({
    data: {
      resumeCode,
      xenditInvoiceId: invoiceId,
      xenditExternalId: externalId,
      planId: plan.id,
      durationHours: plan.hours,
      amount: plan.amount,
      currency: plan.currency,
      status: "pending_payment",
      expiresAt,
    },
  });

  return { order, plan, invoiceUrl, devPayment };
}

export async function findOrderByResumeCode(resumeCode: string) {
  return prisma.order.findUnique({
    where: { resumeCode: normalizeResumeCode(resumeCode) },
  });
}

export async function findOrderById(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId } });
}

export async function markOrderPaidByInvoice(input: {
  invoiceId?: string | null;
  externalId?: string | null;
  paidAt?: Date;
}) {
  const where = input.invoiceId
    ? { xenditInvoiceId: input.invoiceId }
    : input.externalId
      ? { xenditExternalId: input.externalId }
      : null;
  if (!where) return null;

  const order = await prisma.order.findUnique({ where });
  if (!order) return null;
  if (order.status === "consumed" || order.status === "refunded") return order;
  if (order.status !== "pending_payment" && order.status !== "expired") return order;

  return prisma.order.update({
    where: { id: order.id },
    data: {
      status: "paid",
      paidAt: input.paidAt || new Date(),
    },
  });
}

export async function markOrderExpiredByInvoice(input: { invoiceId?: string | null; externalId?: string | null }) {
  const where = input.invoiceId
    ? { xenditInvoiceId: input.invoiceId }
    : input.externalId
      ? { xenditExternalId: input.externalId }
      : null;
  if (!where) return null;
  const order = await prisma.order.findUnique({ where });
  if (!order || order.status !== "pending_payment") return order;
  return prisma.order.update({
    where: { id: order.id },
    data: { status: "expired" },
  });
}

export async function applyInvoiceStatus(status: string, invoiceId?: string | null, externalId?: string | null) {
  if (isPaidInvoiceStatus(status)) {
    return markOrderPaidByInvoice({ invoiceId, externalId });
  }
  if (isExpiredInvoiceStatus(status)) {
    return markOrderExpiredByInvoice({ invoiceId, externalId });
  }
  return null;
}

export function canRetryPrepare(order: { status: string; prepareAttempts: number; lastPrepareAt: Date | null; paidAt: Date | null }): { ok: true } | { ok: false; message: string } {
  if (!isReusableStatus(order.status) && order.status !== "live") {
    return { ok: false, message: publicOrderMessage(order.status) };
  }
  const windowStart = Date.now() - PREPARE_WINDOW_MS;
  const attempts = order.lastPrepareAt && order.lastPrepareAt.getTime() >= windowStart ? order.prepareAttempts : 0;
  if (attempts >= MAX_PREPARE_ATTEMPTS && order.status !== "live") {
    return {
      ok: false,
      message: "Batas percobaan menyiapkan siaran sudah tercapai. Hubungi dukungan Livio untuk bantuan atau pengembalian dana.",
    };
  }
  return { ok: true };
}

export async function markOrderPreparing(orderId: string, sessionId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  const withinWindow = order.lastPrepareAt && Date.now() - order.lastPrepareAt.getTime() < PREPARE_WINDOW_MS;
  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: order.status === "live" ? "live" : "preparing",
      sessionId,
      prepareAttempts: withinWindow ? order.prepareAttempts + 1 : 1,
      lastPrepareAt: new Date(),
    },
  });
}

export async function markOrderLive(orderId: string, sessionId: string) {
  return prisma.order.updateMany({
    where: { id: orderId, status: { in: ["paid", "preparing", "failed", "live"] } },
    data: { status: "live", sessionId },
  });
}

export async function markOrderFailed(orderId: string) {
  return prisma.order.updateMany({
    where: { id: orderId, status: { in: ["paid", "preparing", "live", "failed"] } },
    data: { status: "failed" },
  });
}

export async function consumeOrder(orderId: string, reason: ConsumedReason) {
  return prisma.order.updateMany({
    where: { id: orderId, status: { notIn: ["consumed", "refunded"] } },
    data: {
      status: "consumed",
      consumedAt: new Date(),
      consumedReason: reason,
    },
  });
}

export async function consumeOrderForSession(sessionId: string, endedReason?: string | null) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ sessionId }, { liveSessions: { some: { id: sessionId } } }] },
  });
  if (!order) return { order: null, consumed: false };
  const reason = consumeReasonFromEndedReason(endedReason);
  if (reason) {
    await consumeOrder(order.id, reason);
    return { order: { ...order, status: "consumed", consumedReason: reason }, consumed: true };
  }
  if (order.status !== "consumed" && order.status !== "refunded") {
    await markOrderFailed(order.id);
  }
  return { order, consumed: false };
}

export function toPublicOrder(
  order: {
    id: string;
    resumeCode: string;
    planId: string;
    durationHours: number;
    amount: number;
    currency: string;
    status: string;
    sessionId: string | null;
    consumedReason: string | null;
    paidAt: Date | null;
    expiresAt: Date | null;
  },
  extras?: { sessionState?: string | null; invoiceUrl?: string | null; plan?: LivePlan | null; devPayment?: boolean },
) {
  const canPrepare = isReusableStatus(order.status);
  const canReconnect = order.status === "live" && Boolean(order.sessionId);
  return {
    orderId: order.id,
    resumeCode: order.resumeCode,
    planId: order.planId,
    durationHours: order.durationHours,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    sessionId: order.sessionId,
    sessionState: extras?.sessionState ?? null,
    invoiceUrl: extras?.invoiceUrl ?? null,
    canPrepare,
    canReconnect,
    consumedReason: order.consumedReason,
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    devPayment: extras?.devPayment === true,
    message: publicOrderMessage(order.status, order.consumedReason),
    automations: extras?.plan?.automations ?? getPlanById(order.planId)?.automations ?? null,
  };
}
