import { safeEqualString } from "../lib/order-ticket.js";

const XENDIT_INVOICE_URL = "https://api.xendit.co/v2/invoices";

export type XenditInvoice = {
  id: string;
  external_id: string;
  status: string;
  invoice_url: string;
  expiry_date?: string;
  paid_at?: string;
  amount?: number;
};

function secretKey(): string {
  return (process.env.XENDIT_SECRET_KEY || "").trim();
}

export function isXenditConfigured(): boolean {
  return Boolean(secretKey());
}

export function isXenditDevMode(): boolean {
  return !isXenditConfigured() && process.env.NODE_ENV !== "production";
}

export function verifyXenditCallbackToken(headerValue: string | string[] | undefined): boolean {
  const expected = (process.env.XENDIT_CALLBACK_TOKEN || "").trim();
  if (!expected) return false;
  const received = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!received) return false;
  return safeEqualString(received, expected);
}

export async function createXenditInvoice(input: {
  externalId: string;
  amount: number;
  description: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
  durationSeconds?: number;
}): Promise<XenditInvoice> {
  const key = secretKey();
  if (!key) {
    throw new Error("XENDIT_SECRET_KEY belum dikonfigurasi.");
  }

  const auth = Buffer.from(`${key}:`).toString("base64");
  const response = await fetch(XENDIT_INVOICE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: input.amount,
      currency: "IDR",
      description: input.description,
      invoice_duration: input.durationSeconds ?? 24 * 60 * 60,
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<XenditInvoice> & { message?: string };
  if (!response.ok || !payload.id || !payload.invoice_url) {
    throw new Error(payload.message || "Gagal membuat invoice pembayaran.");
  }

  return {
    id: payload.id,
    external_id: payload.external_id || input.externalId,
    status: payload.status || "PENDING",
    invoice_url: payload.invoice_url,
    expiry_date: payload.expiry_date,
    paid_at: payload.paid_at,
    amount: payload.amount,
  };
}

export function isPaidInvoiceStatus(status: string | undefined | null): boolean {
  const value = String(status || "").toUpperCase();
  return value === "PAID" || value === "SETTLED";
}

export function isExpiredInvoiceStatus(status: string | undefined | null): boolean {
  return String(status || "").toUpperCase() === "EXPIRED";
}
