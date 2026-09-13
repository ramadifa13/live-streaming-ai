import { apiFetch, storeResumeCode } from "@/lib/api";
import { toClientCopy } from "@/lib/client-copy";

export type OrderTicket = {
  orderId: string;
  resumeCode: string;
  planId: string;
  durationHours: number;
  amount: number;
  currency: string;
  status: string;
  sessionId: string | null;
  sessionState: string | null;
  invoiceUrl: string | null;
  canPrepare: boolean;
  canReconnect: boolean;
  consumedReason: string | null;
  message: string;
  devPayment?: boolean;
  automations?: {
    autoReply: boolean;
    autoPin: boolean;
    autoPromo: boolean;
    autoModeration: boolean;
  } | null;
};

export type PublicPlan = {
  id: string;
  hours: number;
  label: string;
  tag: string;
  amount: number;
  currency: string;
  priceLabel: string;
  automations: {
    autoReply: boolean;
    autoPin: boolean;
    autoPromo: boolean;
    autoModeration: boolean;
  };
  toast: string;
};

export function isDeadOrderStatus(status: string | undefined): boolean {
  return status === "consumed" || status === "refunded" || status === "expired";
}

export function isUsableOrderTicket(ticket: Pick<OrderTicket, "canPrepare" | "canReconnect" | "status">): boolean {
  return ticket.canPrepare || ticket.canReconnect || ticket.status === "pending_payment";
}

function isTransientOrderError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /terlalu banyak|failed to fetch|networkerror|load failed|502|503|504|sibuk|tidak merespons/i.test(message);
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Pembayaran dibatalkan", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Pembayaran dibatalkan", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readOrder(res: Response): Promise<OrderTicket> {
  const json = await res.json().catch(() => ({} as { error?: unknown; data?: OrderTicket }));
  if (!res.ok || !json.data) {
    if (res.status === 429) {
      throw new Error("Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.");
    }
    if (res.status >= 500) {
      throw new Error("Server sibuk. Tunggu sebentar, lalu coba lagi.");
    }
    throw new Error(toClientCopy(json.error, "Kode tidak ditemukan atau belum dibayar."));
  }
  const data = json.data as OrderTicket;
  if (isUsableOrderTicket(data)) {
    storeResumeCode(data.resumeCode);
  } else if (isDeadOrderStatus(data.status)) {
    storeResumeCode(null);
  }
  return data;
}

export const orderService = {
  async listPlans(): Promise<PublicPlan[]> {
    const res = await apiFetch("/api/plans", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(toClientCopy(json.error, "Gagal memuat paket."));
    return (json.data || []) as PublicPlan[];
  },

  async createInvoice(planId: string): Promise<OrderTicket> {
    const res = await apiFetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    return readOrder(res);
  },

  async lookup(resumeCode: string): Promise<OrderTicket> {
    const res = await apiFetch(`/api/orders/${encodeURIComponent(resumeCode.trim().toUpperCase())}`, {
      cache: "no-store",
    });
    return readOrder(res);
  },

  async lookupMine(): Promise<OrderTicket | null> {
    const res = await apiFetch("/api/orders/me", { cache: "no-store" });
    if (res.status === 404) return null;
    return readOrder(res);
  },

  async simulatePaid(resumeCode: string): Promise<OrderTicket> {
    const res = await apiFetch("/api/orders/dev/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeCode: resumeCode.trim().toUpperCase() }),
    });
    return readOrder(res);
  },

  async waitUntilPaid(resumeCode: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<OrderTicket> {
    const timeoutMs = options?.timeoutMs ?? 15 * 60_000;
    const started = Date.now();
    let delayMs = 2500;
    while (Date.now() - started < timeoutMs) {
      if (options?.signal?.aborted) {
        throw new DOMException("Pembayaran dibatalkan", "AbortError");
      }
      try {
        const ticket = await this.lookup(resumeCode);
        if (ticket.status !== "pending_payment") return ticket;
        delayMs = 2500;
      } catch (err) {
        if (!isTransientOrderError(err)) throw err;
        delayMs = Math.min(delayMs + 1500, 8000);
      }
      await sleep(delayMs, options?.signal);
    }
    throw new Error("Pembayaran belum terverifikasi. Jika sudah transfer, masukkan kode LIV di Lanjutkan siaran.");
  },
};
