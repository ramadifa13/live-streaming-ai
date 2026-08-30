"use client";

import React from "react";
import { X, Settings } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

export const SettingsModal: React.FC = () => {
  const showSettingsModal = useDashboardUIStore((state) => state.showSettingsModal);
  const setShowSettingsModal = useDashboardUIStore((state) => state.setShowSettingsModal);

  if (!showSettingsModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md rounded-2xl border border-blue-500/30 bg-[#0c1221] p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => setShowSettingsModal(false)}
          className="absolute right-4 top-4 text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-400" />
          <span>Pengaturan Live Control</span>
        </h3>
        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
            <span>Resolusi Video Stream</span>
            <span className="text-blue-400 font-bold">
              1080x1920 (Vertical 9:16)
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
            <span>GPU Cloud Orchestrator</span>
            <span className="text-emerald-400 font-bold">
              NVIDIA RTX 4090 (On-Demand)
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
            <span>AI Video Engine</span>
            <span className="text-purple-400 font-bold">
              LivePortrait / MuseTalk Neural
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
            <span>Voice TTS Engine</span>
            <span className="text-cyan-400 font-bold">
              Chatterbox-TTS-Indonesian (Voice Clone)
            </span>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setShowSettingsModal(false)}
            className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 cursor-pointer"
          >
            Simpan &amp; Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
