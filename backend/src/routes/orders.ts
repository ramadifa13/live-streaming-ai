import { FastifyInstance } from "fastify";
import { z } from "zod";
import { listPublicPlans } from "../config/plans.js";
import { rateLimitPreHandler } from "../lib/rate-limit.js";
import { clearOrderCookie, setOrderCookie } from "../lib/order-ticket.js";
import { resolveOrderFromRequest } from "../lib/entitlement.js";
import { liveSessionManager } from "../services/live-session-manager.js";
import {
  applyInvoiceStatus,
  createCheckoutOrder,
  findOrderByResumeCode,
  isReusableStatus,
  markOrderPaidByInvoice,
  normalizeResumeCode,
  publicOrderMessage,
  toPublicOrder,
} from "../services/order-service.js";
import { isXenditDevMode, verifyXenditCallbackToken } from "../services/xendit.js";

export async function orderRoutes(server: FastifyInstance) {
  server.get("/api/plans", async () => ({
    success: true,
    data: listPublicPlans(),
  }));

  server.post(
    "/api/orders",
    { preHandler: rateLimitPreHandler("orders-create", 8, 10 * 60_000) },
    async (request, reply) => {
      const parsed = z.object({ planId: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "Pilih paket siaran terlebih dahulu." };
      }
      try {
        const { order, plan, invoiceUrl, devPayment } = await createCheckoutOrder(parsed.data.planId);
        setOrderCookie(reply, order.resumeCode);
        return {
          success: true,
          data: toPublicOrder(order, { invoiceUrl, plan, devPayment }),
        };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode || 502;
        reply.code(status);
        return { error: err instanceof Error ? err.message : "Gagal membuat invoice." };
      }
    },
  );

  server.get(
    "/api/orders/me",
    { preHandler: rateLimitPreHandler("orders-me", 30, 60_000) },
    async (request, reply) => {
      const order = await resolveOrderFromRequest(request);
      if (!order) {
        reply.code(404);
        return { error: "Belum ada kode siaran tersimpan di browser ini." };
      }
      const managed = order.sessionId ? liveSessionManager.getSession(order.sessionId) : null;
      if (isReusableStatus(order.status) || order.status === "live" || order.status === "pending_payment") {
        setOrderCookie(reply, order.resumeCode);
      } else {
        clearOrderCookie(reply);
      }
      return {
        success: true,
        data: toPublicOrder(order, {
          sessionState: managed?.state || null,
          devPayment: isXenditDevMode() && order.status === "pending_payment",
        }),
      };
    },
  );

  server.get(
    "/api/orders/:resumeCode",
    { preHandler: rateLimitPreHandler("orders-lookup", 60, 60_000) },
    async (request, reply) => {
      const resumeCode = normalizeResumeCode((request.params as { resumeCode?: string }).resumeCode);
      if (!/^LIV-[A-Z0-9]{8}$/.test(resumeCode)) {
        reply.code(400);
        return { error: "Format kode tidak valid. Contoh: LIV-7K2M9Q4X" };
      }
      const order = await findOrderByResumeCode(resumeCode);
      if (!order) {
        reply.code(404);
        return { error: "Kode tidak ditemukan atau belum dibayar." };
      }
      const managed = order.sessionId ? liveSessionManager.getSession(order.sessionId) : null;
      if (isReusableStatus(order.status) || order.status === "live" || order.status === "pending_payment") {
        setOrderCookie(reply, order.resumeCode);
      }
      return {
        success: true,
        data: toPublicOrder(order, {
          sessionState: managed?.state || null,
          devPayment: isXenditDevMode() && order.status === "pending_payment",
        }),
      };
    },
  );

  server.post("/api/webhooks/xendit", async (request, reply) => {
    const token = request.headers["x-callback-token"];
    if (!verifyXenditCallbackToken(token)) {
      reply.code(401);
      return { error: "Callback token tidak valid." };
    }
    const body = (request.body || {}) as {
      id?: string;
      status?: string;
      external_id?: string;
      paid_at?: string;
    };
    const order = await applyInvoiceStatus(body.status || "", body.id, body.external_id);
    if (!order) {
      return { success: true, ignored: true };
    }
    return { success: true, orderId: order.id, status: order.status };
  });

  server.post(
    "/api/orders/dev/mark-paid",
    { preHandler: rateLimitPreHandler("orders-dev-paid", 10, 60_000) },
    async (request, reply) => {
      if (!isXenditDevMode()) {
        reply.code(404);
        return { error: "Tidak tersedia." };
      }
      const parsed = z.object({ resumeCode: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "Kode wajib diisi." };
      }
      const order = await findOrderByResumeCode(parsed.data.resumeCode);
      if (!order) {
        reply.code(404);
        return { error: "Kode tidak ditemukan." };
      }
      if (order.status === "consumed" || order.status === "refunded") {
        reply.code(409);
        return { error: publicOrderMessage(order.status, order.consumedReason) };
      }
      if (isReusableStatus(order.status) || order.status === "live") {
        setOrderCookie(reply, order.resumeCode);
        return { success: true, data: toPublicOrder(order) };
      }
      const paid = await markOrderPaidByInvoice({
        invoiceId: order.xenditInvoiceId,
        externalId: order.xenditExternalId,
      });
      if (!paid || paid.status !== "paid") {
        reply.code(409);
        return { error: publicOrderMessage(paid?.status || order.status, paid?.consumedReason || order.consumedReason) };
      }
      setOrderCookie(reply, paid.resumeCode);
      return { success: true, data: toPublicOrder(paid) };
    },
  );
}
