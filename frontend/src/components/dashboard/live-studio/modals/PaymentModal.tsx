"use client";

import React, { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { isDeadOrderStatus, orderService, type OrderTicket } from "@/services/orderService";
import { copyToClipboard } from "@/utils/clipboard";

type Props = {
  onPaid: (ticket: OrderTicket) => void;
};

export const PaymentModal: React.FC<Props> = ({ onPaid }) => {
  const showPaymentModal = useDashboardUIStore((state) => state.showPaymentModal);
  const setShowPaymentModal = useDashboardUIStore((state) => state.setShowPaymentModal);
  const showToast = useDashboardUIStore((state) => state.showToast);
  const selectedPlanId = useLiveSessionStore((state) => state.selectedPlanId);
  const plans = useLiveSessionStore((state) => state.plans);
  const resumeCode = useLiveSessionStore((state) => state.resumeCode);

  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<OrderTicket | null>(null);
  const [waiting, setWaiting] = useState(false);
  const waitAbortRef = useRef<AbortController | null>(null);

  const plan = plans.find((item) => item.id === selectedPlanId) || plans[0];

  const stopWaiting = () => {
    waitAbortRef.current?.abort();
    waitAbortRef.current = null;
    setWaiting(false);
  };

  useEffect(() => {
    if (!showPaymentModal) {
      waitAbortRef.current?.abort();
      waitAbortRef.current = null;
      setTicket(null);
      setWaiting(false);
      setBusy(false);
    }
  }, [showPaymentModal]);

  useEffect(() => {
    if (!showPaymentModal || !resumeCode) return;
    let cancelled = false;
    void orderService.lookup(resumeCode).then((found) => {
      if (cancelled) return;
      if (isDeadOrderStatus(found.status)) {
        setTicket((prev) => (prev && !isDeadOrderStatus(prev.status) ? prev : null));
        return;
      }
      setTicket((prev) => prev ?? found);
      if (found.canPrepare || found.canReconnect) return;
      if (found.status !== "pending_payment") return;
      setWaiting(true);
      waitAbortRef.current?.abort();
      const controller = new AbortController();
      waitAbortRef.current = controller;
      void orderService.waitUntilPaid(found.resumeCode, { signal: controller.signal }).then((paid) => {
        if (cancelled || controller.signal.aborted) return;
        setTicket(paid);
        setWaiting(false);
        if (paid.canPrepare || paid.canReconnect) {
          useLiveSessionStore.setState({
            orderId: paid.orderId,
            resumeCode: paid.resumeCode,
          });
          showToast("Pembayaran terverifikasi. Simpan kode LIV Anda.");
        }
      }).catch((err) => {
        if ((err as DOMException).name === "AbortError") return;
      });
    }).catch(() => {
      if (!cancelled) {
        showToast("Tidak bisa cek status pembayaran. Coba lagi.", "warning");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showPaymentModal, resumeCode, showToast]);

  if (!showPaymentModal) return null;

  const beginCheckout = async () => {
    if (!plan) {
      showToast("Pilih paket siaran terlebih dahulu.", "warning");
      return;
    }
    waitAbortRef.current?.abort();
    const controller = new AbortController();
    waitAbortRef.current = controller;
    setBusy(true);
    try {
      const created = await orderService.createInvoice(plan.id);
      setTicket(created);
      useLiveSessionStore.setState({
        orderId: created.orderId,
        resumeCode: created.resumeCode,
        selectedDuration: created.durationHours,
        selectedPlanId: created.planId,
      });
      if (created.invoiceUrl) {
        window.open(created.invoiceUrl, "_blank", "noopener,noreferrer");
      }
      setWaiting(true);
      setBusy(false);
      const paid = await orderService.waitUntilPaid(created.resumeCode, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (paid.status === "pending_payment") {
        showToast("Pembayaran belum masuk.", "warning");
        return;
      }
      if (!paid.canPrepare && !paid.canReconnect) {
        showToast(paid.message, "error");
        return;
      }
      setTicket(paid);
      showToast("Pembayaran terverifikasi. Simpan kode LIV Anda.");
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return;
      showToast(err instanceof Error ? err.message : "Gagal membuat pembayaran.", "error");
    } finally {
      setBusy(false);
      if (waitAbortRef.current === controller) {
        waitAbortRef.current = null;
        setWaiting(false);
      }
    }
  };

  const simulatePay = async () => {
    const code = ticket?.resumeCode || resumeCode;
    if (!code) {
      showToast("Buat pembayaran dulu, baru simulasi bisa dipakai.", "warning");
      return;
    }
    stopWaiting();
    setBusy(true);
    try {
      const paid = await orderService.simulatePaid(code);
      setTicket(paid);
      useLiveSessionStore.setState({
        orderId: paid.orderId,
        resumeCode: paid.resumeCode,
      });
      showToast("Pembayaran uji ditandai lunas. Simpan kode LIV Anda.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menandai lunas.", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code: string) => {
    const ok = await copyToClipboard(code);
    showToast(ok ? "Kode disalin. Simpan di tempat aman." : "Gagal menyalin kode.", ok ? "success" : "error");
  };

  const ticketDead = Boolean(ticket && isDeadOrderStatus(ticket.status));
  const activeTicket = ticket && !ticketDead ? ticket : null;
  const paidReady = Boolean(activeTicket && (activeTicket.canPrepare || activeTicket.canReconnect));
  const canSimulate =
    Boolean(activeTicket) &&
    !paidReady &&
    (activeTicket?.devPayment || (activeTicket?.status === "pending_payment" && !activeTicket.invoiceUrl));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md rounded-2xl border border-blue-500/25 bg-[#0c1221] p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => setShowPaymentModal(false)}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-3 flex items-center gap-2 text-blue-300">
          <ShieldCheck className="h-5 w-5" />
          <h3 className="text-base font-bold text-white">Bayar paket, baru siaran dimulai</h3>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          Studio AI hanya disiapkan setelah pembayaran terverifikasi. Setelah bayar, simpan kode di bawah. Kalau
          terputus sebelum siaran selesai, masukkan lagi tanpa bayar.
        </p>
        {plan && (
          <div className="mb-4 rounded-xl border border-[#232c42] bg-[#111827] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-white">
              {plan.label} · {plan.tag}
            </p>
            <p className="text-[10px] text-cyan-400">{plan.priceLabel}</p>
          </div>
        )}

        {(activeTicket?.resumeCode || (!ticketDead && resumeCode)) && (
          <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">Kode pemulihan</p>
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-lg font-bold tracking-wider text-white">{activeTicket?.resumeCode || resumeCode}</p>
              <button
                type="button"
                onClick={() => void copyCode(activeTicket?.resumeCode || resumeCode || "")}
                className="rounded-lg border border-amber-400/30 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/20 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-amber-100/80">
              Simpan kode ini. Kalau tab tertutup sebelum siaran selesai, masukkan lagi tanpa bayar.
            </p>
          </div>
        )}

        {ticketDead && ticket?.message && (
          <p className="mb-3 text-[11px] leading-relaxed text-rose-300">{ticket.message}</p>
        )}

        <div className="flex flex-col gap-2">
          {(!activeTicket || ticketDead) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void beginCheckout()}
              className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#00b4db] to-[#0083b0] px-4 py-2.5 text-xs font-bold text-white cursor-pointer disabled:opacity-70"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {ticketDead ? "Bayar paket baru" : "Lanjut ke pembayaran"}
            </button>
          )}
          {activeTicket?.invoiceUrl && !paidReady && (
            <button
              type="button"
              onClick={() => window.open(activeTicket.invoiceUrl || "", "_blank", "noopener,noreferrer")}
              className="flex items-center justify-center gap-2 rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-xs font-semibold text-blue-100 cursor-pointer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Buka halaman bayar
            </button>
          )}
          {canSimulate && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void simulatePay()}
              className="rounded-lg border border-amber-400/30 px-4 py-2 text-xs text-amber-100 hover:bg-amber-500/10 cursor-pointer disabled:opacity-70"
            >
              {busy ? "Menandai lunas…" : "Simulasi bayar (pengembangan)"}
            </button>
          )}
          {waiting && !paidReady && <p className="text-center text-[10px] text-slate-400">Menunggu konfirmasi pembayaran…</p>}
          {paidReady && activeTicket && (
            <button
              type="button"
              onClick={() => {
                setShowPaymentModal(false);
                onPaid(activeTicket);
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
            >
              Siapkan siaran
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
