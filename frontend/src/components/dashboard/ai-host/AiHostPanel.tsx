"use client";

import React from "react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { AvatarCarousel } from "./AvatarCarousel";
import { VoiceToneSettings } from "./VoiceToneSettings";

export const AiHostPanel: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border p-3.5 transition ${
        currentStep === 2
          ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10"
          : "border-[#232c42] bg-[#0c1221]"
      }`}
    >
      <div className="shrink-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-blue-300">
            Step 2
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Host siap live
          </span>
        </div>
        <h3 className="text-base font-bold tracking-tight text-white">
          Pilih AI Host &amp; Suara
        </h3>
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-2.5">
        <AvatarCarousel />
        <VoiceToneSettings />
      </div>
    </div>
  );
};
