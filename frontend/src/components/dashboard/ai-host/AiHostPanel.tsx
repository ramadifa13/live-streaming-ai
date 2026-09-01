"use client";

import React from "react";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { AvatarCarousel } from "./AvatarCarousel";
import { VoiceToneSettings } from "./VoiceToneSettings";

export const AiHostPanel: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border p-4 transition ${
        currentStep === 2
          ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10"
          : "border-[#232c42] bg-[#0c1221]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
            STEP 2
          </span>
          <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Host Siap Live
          </span>
        </div>
        <span className="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
          Aktif: {selectedAvatar.name} ({selectedAvatar.type})
        </span>
      </div>

      <div className="mb-2 mt-2 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>Pilih AI Host &amp; Suara TTS</span>
          </h3>
          <p className="text-[11px] text-slate-400">AI Host 3D dengan suara neural, tempo bicara, dan persona host.</p>
        </div>
      </div>
      <AvatarCarousel />
      <div className="mt-auto">
        <VoiceToneSettings />
      </div>
    </div>
  );
};
