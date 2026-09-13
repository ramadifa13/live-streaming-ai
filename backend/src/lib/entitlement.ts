import type { FastifyReply, FastifyRequest } from "fastify";
import prisma from "./prisma.js";
import { EntitlementError, extractOrderId, extractResumeCode } from "./order-ticket.js";
import { findOrderById, findOrderByResumeCode, isStartableStatus } from "../services/order-service.js";

export async function resolveOrderFromRequest(request: FastifyRequest) {
  const orderId = extractOrderId(request);
  const resumeCode = extractResumeCode(request);
  if (orderId) {
    const byId = await findOrderById(orderId);
    if (byId) return byId;
  }
  if (resumeCode) {
    return findOrderByResumeCode(resumeCode);
  }
  return null;
}

export async function requireStartableOrder(request: FastifyRequest) {
  const order = await resolveOrderFromRequest(request);
  if (!order) {
    throw new EntitlementError("Pembayaran belum terverifikasi. Bayar paket dulu, atau masukkan kode LIV.");
  }
  if (order.status === "pending_payment") {
    throw new EntitlementError("Pembayaran belum selesai.", 402);
  }
  if (order.status === "consumed") {
    throw new EntitlementError(
      order.consumedReason === "duration_elapsed"
        ? "Durasi paket sudah habis. Bayar paket baru untuk siaran berikutnya."
        : "Kode ini sudah dipakai. Bayar paket baru untuk siaran berikutnya.",
      409,
    );
  }
  if (order.status === "refunded" || order.status === "expired") {
    throw new EntitlementError("Kode ini tidak bisa dipakai. Buat pembayaran baru.", 409);
  }
  if (!isStartableStatus(order.status)) {
    throw new EntitlementError("Kode ini tidak bisa dipakai untuk siaran.", 409);
  }
  return order;
}

export async function requireOrderForSession(request: FastifyRequest, sessionId?: string | null) {
  const order = await requireStartableOrder(request);
  if (sessionId && order.sessionId && order.sessionId !== sessionId) {
    const linked = await prisma.liveSession.findFirst({
      where: { id: sessionId, orderId: order.id },
      select: { id: true },
    });
    if (!linked) {
      throw new EntitlementError("Sesi ini bukan milik kode pembayaran Anda.", 403);
    }
  }
  return order;
}

export function sendEntitlementError(reply: FastifyReply, error: unknown) {
  if (error instanceof EntitlementError) {
    reply.code(error.statusCode);
    return { error: error.message };
  }
  throw error;
}
