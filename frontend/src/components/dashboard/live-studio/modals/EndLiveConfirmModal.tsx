"use client";

import React, { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

export const EndLiveConfirmModal: React.FC = () => {
  const showEndLiveConfirm = useDashboardUIStore((state) => state.showEndLiveConfirm);
  const setShowEndLiveConfirm = useDashboardUIStore((state) => state.setShowEndLiveConfirm);
  const setShowSummaryModal = useDashboardUIStore((state) => state.setShowSummaryModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const endLiveSession = useLiveSessionStore((state) => state.endLiveSession);

  const [isEnding, setIsEnding] = useState(false);

  if (!showEndLiveConfirm) return null;

  const handleConfirmEnd = async () => {
    setIsEnding(true);
    showToast("Mengakhiri siaran…");
    try {
      await endLiveSession();
      setShowEndLiveConfirm(false);
      setShowSummaryModal(true);
      showToast("Siaran berakhir. Ringkasan siap.");
    } catch {
      showToast("Gagal mengakhiri live session.");
    } finally {
      setIsEnding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-sm rounded-2xl border border-red-500/30 bg-[#0c1221] p-6 shadow-2xl text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-400 text-2xl">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-white mb-2">
          Akhiri Live Streaming?
        </h3>
        <p className="text-xs text-slate-400 mb-6">
          AI Host akan menghentikan siaran di platform {selectedPlatform}.
          Seluruh ringkasan analitik dan omzet penjualan akan dihitung otomatis.
        </p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => setShowEndLiveConfirm(false)}
            className="rounded-lg border border-[#232c42] px-4 py-2 text-xs text-slate-300 hover:bg-white/5 cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={isEnding}
            onClick={handleConfirmEnd}
            className="rounded-lg bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-500 shadow-lg shadow-red-600/30 cursor-pointer disabled:opacity-70 flex items-center gap-1.5"
          >
            {isEnding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Ya, Akhiri Live</span>
          </button>
        </div>
      </div>
    </div>
  );
};
