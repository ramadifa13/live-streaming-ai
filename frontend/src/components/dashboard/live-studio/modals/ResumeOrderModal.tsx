"use client";

import React, { useState } from "react";
import { Loader2, Ticket, X } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { isUsableOrderTicket, orderService, type OrderTicket } from "@/services/orderService";

type Props = {
  onResolved: (ticket: OrderTicket) => void;
};

export const ResumeOrderModal: React.FC<Props> = ({ onResolved }) => {
  const showResumeOrderModal = useDashboardUIStore((state) => state.showResumeOrderModal);
  const setShowResumeOrderModal = useDashboardUIStore((state) => state.setShowResumeOrderModal);
  const showToast = useDashboardUIStore((state) => state.showToast);
  const storedCode = useLiveSessionStore((state) => state.resumeCode);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (!showResumeOrderModal) return null;

  const submit = async () => {
    const resumeCode = (code || storedCode || "").replace(/\s+/g, "").trim().toUpperCase();
    if (!/^LIV-[A-Z0-9]{8}$/.test(resumeCode)) {
      showToast("Format kode: LIV- lalu 8 huruf/angka. Contoh LIV-7K2M9Q4X", "warning");
      return;
    }
    setBusy(true);
    try {
      const ticket = await orderService.lookup(resumeCode);
      const usable = isUsableOrderTicket(ticket);
      useLiveSessionStore.setState({
        orderId: usable ? ticket.orderId : null,
        resumeCode: usable ? ticket.resumeCode : null,
        selectedDuration: ticket.durationHours,
        selectedPlanId: ticket.planId,
        ...(ticket.automations ? { automations: ticket.automations } : {}),
      });
      if (!ticket.canPrepare && !ticket.canReconnect) {
        if (ticket.status === "pending_payment") {
          setShowResumeOrderModal(false);
          useDashboardUIStore.getState().setShowPaymentModal(true);
          showToast("Pembayaran belum selesai. Lanjutkan dari halaman bayar.", "warning");
          return;
        }
        showToast(ticket.message, "error");
        return;
      }
      setShowResumeOrderModal(false);
      onResolved(ticket);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Kode tidak ditemukan.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-sm rounded-2xl border border-blue-500/25 bg-[#0c1221] p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => setShowResumeOrderModal(false)}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-3 flex items-center gap-2 text-blue-300">
          <Ticket className="h-5 w-5" />
          <h3 className="text-base font-bold text-white">Lanjutkan siaran</h3>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          Masukkan kode yang Anda simpan setelah bayar. Tidak perlu bayar ulang jika siaran belum diakhiri dan durasi
          belum habis.
        </p>
        <input
          value={code || storedCode || ""}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="LIV-7K2M9Q4X"
          className="mb-3 w-full rounded-lg border border-[#232c42] bg-[#111827] px-3 py-2 font-mono text-sm tracking-wider text-white outline-none focus:border-blue-500"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#00b4db] to-[#0083b0] px-4 py-2.5 text-xs font-bold text-white cursor-pointer disabled:opacity-70"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Cek kode
        </button>
      </div>
    </div>
  );
};
