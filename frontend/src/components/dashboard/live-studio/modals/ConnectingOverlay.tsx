"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useAiHostStore } from "@/stores/useAiHostStore";

export const ConnectingOverlay: React.FC = () => {
  const isConnectingLive = useLiveSessionStore((state) => state.isConnectingLive);
  const connectingStageText = useLiveSessionStore((state) => state.connectingStageText);
  const connectingStageIndex = useLiveSessionStore((state) => state.connectingStageIndex);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const cancelInitialization = useLiveSessionStore((state) => state.cancelInitialization);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);

  if (!isConnectingLive) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md max-h-[90vh] rounded-3xl border border-indigo-500/30 bg-[#0a0f1d] text-center shadow-2xl shadow-indigo-500/25 flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-br from-blue-600/25 via-indigo-600/15 to-purple-600/25 blur-3xl rounded-full z-0" />
        <div className="pointer-events-none absolute -bottom-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-tr from-emerald-600/15 to-blue-600/15 blur-3xl rounded-full z-0" />

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 z-10 custom-scrollbar relative">
          <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-indigo-500/30 animate-ping opacity-60" />
            <div className="absolute inset-0 rounded-full border-2 border-t-indigo-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin" />
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 shadow-md shadow-indigo-500/40 animate-pulse">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          </div>

          <h3 className="text-base sm:text-lg font-extrabold text-white tracking-wide mb-0.5">
            Menyiapkan Sesi Live AI
          </h3>
          <p className="text-[11px] text-slate-400 mb-3">
            Host AI{" "}
            <span className="text-indigo-300 font-semibold">
              {selectedAvatar.name}
            </span>{" "}
            di{" "}
            <span className="text-indigo-300 font-semibold">
              {selectedPlatform}
            </span>
          </p>

          <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold text-indigo-300 mb-3.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
            </span>
            <span className="truncate max-w-[260px]">
              {connectingStageText}
            </span>
          </div>

          <div className="w-full bg-[#1e293b] rounded-full h-1.5 overflow-hidden mb-4">
            <div
              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-500"
              style={{
                width: `${Math.min(100, Math.max(15, (connectingStageIndex + 1) * 20))}%`,
              }}
            />
          </div>

          <button
            type="button"
            onClick={cancelInitialization}
            className="w-full py-2.5 rounded-xl border border-slate-700 bg-[#111827] text-xs font-semibold text-slate-400 hover:text-white hover:border-slate-500 transition cursor-pointer"
          >
            Batalkan Inisialisasi
          </button>
        </div>
      </div>
    </div>
  );
};
