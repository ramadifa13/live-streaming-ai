"use client";

import React from "react";
import { X, RefreshCw, Copy, ScrollText, AlertTriangle } from "lucide-react";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { copyToClipboard } from "@/utils/clipboard";

export const LiveScriptModal: React.FC = () => {
  const showScriptModal = useDashboardUIStore((state) => state.showScriptModal);
  const setShowScriptModal = useDashboardUIStore((state) => state.setShowScriptModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const selectedTone = useAiHostStore((state) => state.selectedTone);
  const liveSalesScriptData = useAiHostStore((state) => state.liveSalesScriptData);
  const isLoadingLiveScript = useAiHostStore((state) => state.isLoadingLiveScript);
  const fetchLiveSalesScript = useAiHostStore((state) => state.fetchLiveSalesScript);

  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);

  if (!showScriptModal) return null;

  const handleCopyScript = async () => {
    if (!liveSalesScriptData?.fullScript) return;
    const ok = await copyToClipboard(liveSalesScriptData.fullScript);
    if (ok) {
      showToast("Script promosi live disalin ke clipboard!");
    }
  };

  const handleRegenerate = async () => {
    try {
      await fetchLiveSalesScript(activeFeaturedProduct);
      showToast("✨ Naskah promosi AI Host berhasil dibuat ulang!");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal generate naskah");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => setShowScriptModal(false)}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-2 border-b border-[#232c42] pb-3">
          <ScrollText className="w-6 h-6 text-blue-400" />
          <div>
            <h3 className="text-lg font-bold text-white">
              AI Generated Sales Script (RAG Engine)
            </h3>
            <p className="text-[11px] text-slate-400">
              Presenter:{" "}
              <strong className="text-blue-300">
                {selectedAvatar.name}
              </strong>{" "}
              • Gaya:{" "}
              <strong className="text-purple-300">{selectedTone}</strong>{" "}
              • Produk:{" "}
              <strong className="text-emerald-300">
                {activeFeaturedProduct.name}
              </strong>
            </p>
          </div>
        </div>

        {isLoadingLiveScript ? (
          <div className="py-12 text-center space-y-3">
            <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-300 font-semibold">
              AI Host sedang menganalisis deskripsi &amp; manfaat produk...
            </p>
            <p className="text-[10px] text-slate-500">
              Menyusun Hook, Problem-Solution, dan Call To Action...
            </p>
          </div>
        ) : liveSalesScriptData ? (
          <div className="rounded-xl bg-[#111827] border border-[#232c42] p-4 text-xs text-slate-200 space-y-3 font-sans max-h-72 overflow-y-auto pr-1.5 shadow-inner">
            <div className="rounded-lg bg-blue-950/30 border border-blue-500/20 p-2.5">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">
                🎣 [1. HOOK PEMBUKA &amp; SAPAAN]
              </p>
              <p className="text-slate-200 leading-relaxed">
                &ldquo;{liveSalesScriptData.hook}&rdquo;
              </p>
            </div>

            <div className="rounded-lg bg-purple-950/30 border border-purple-500/20 p-2.5">
              <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1">
                💡 [2. BEDAH MANFAAT &amp; SELLING POINTS]
              </p>
              <p className="text-slate-200 leading-relaxed">
                &ldquo;{liveSalesScriptData.showcase}&rdquo;
              </p>
            </div>

            <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/20 p-2.5">
              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                ⚡ [3. CALL TO ACTION &amp; URGENCY PROMO]
              </p>
              <p className="text-slate-200 leading-relaxed">
                &ldquo;{liveSalesScriptData.cta}&rdquo;
              </p>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 mx-auto text-amber-400" />
            <p className="text-xs text-amber-300 font-semibold">
              Belum ada naskah yang digenerate oleh AI.
            </p>
            <p className="text-[10px] text-slate-400">
              Klik tombol di bawah untuk membuat naskah otomatis dari AI Host.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-[#232c42]">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={isLoadingLiveScript}
            className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3.5 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 transition active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLiveScript ? "animate-spin" : ""}`} />
            <span>Regenerate Script</span>
          </button>

          <div className="flex items-center gap-2">
            {liveSalesScriptData?.fullScript && (
              <button
                type="button"
                onClick={handleCopyScript}
                className="rounded-lg border border-[#232c42] bg-[#111827] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:border-blue-500 transition active:scale-95 shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Naskah</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowScriptModal(false)}
              className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:brightness-110 shadow-md shadow-blue-600/30 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
