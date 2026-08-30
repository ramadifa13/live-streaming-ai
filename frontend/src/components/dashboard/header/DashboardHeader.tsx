"use client";

import React from "react";
import Link from "next/link";
import { Radio, Clapperboard, Sparkles } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useProductStore } from "@/stores/useProductStore";

const STEPS = [
  { num: 1, label: "Data Produk" },
  { num: 2, label: "AI Host" },
  { num: 3, label: "Atur Live" },
  { num: 4, label: "Preview & Test" },
  { num: 5, label: "Go Live" },
];

export const DashboardHeader: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);
  const setCurrentStep = useDashboardUIStore((state) => state.setCurrentStep);
  const appMode = useDashboardUIStore((state) => state.appMode);
  const setAppMode = useDashboardUIStore((state) => state.setAppMode);

  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const fetchVideoScript = useAiHostStore((state) => state.fetchVideoScript);

  const handleSwitchToVideoGenerator = () => {
    setAppMode("VIDEO_GENERATOR");
    fetchVideoScript(activeFeaturedProduct);
  };

  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-[#1f2638] pb-4">
      <div className="flex items-center gap-6">
        <Link
          href="/"
          className="text-2xl font-black tracking-tight text-white hover:opacity-90 transition"
        >
          LiveStreamer<span className="text-blue-500">AI</span>
        </Link>

        {/* Top Mode Switcher */}
        <div className="flex items-center rounded-xl bg-[#111827] p-1 border border-[#232c42] shadow-inner">
          <button
            type="button"
            onClick={() => setAppMode("LIVE_STUDIO")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition active:scale-95 cursor-pointer ${
              appMode === "LIVE_STUDIO"
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Radio
              className={`w-3.5 h-3.5 ${isLiveActive ? "text-red-400 animate-pulse" : "text-blue-400"}`}
            />
            <span>24/7 Live Stream Studio</span>
          </button>
          <button
            type="button"
            onClick={handleSwitchToVideoGenerator}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition active:scale-95 cursor-pointer ${
              appMode === "VIDEO_GENERATOR"
                ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md shadow-purple-600/30"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Clapperboard className="w-3.5 h-3.5 text-pink-400" />
            <span>AI Video Ads Generator</span>
            <span className="rounded bg-pink-500/20 text-[9px] text-pink-300 px-1.5 py-0.2 border border-pink-500/30 flex items-center gap-0.5">
              <Sparkles className="w-2.5 h-2.5" />
              Hot
            </span>
          </button>
        </div>
      </div>

      {/* Progress Bar for Live Stream Studio */}
      {appMode === "LIVE_STUDIO" ? (
        <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-400 overflow-x-auto py-1">
          {STEPS.map((step, idx) => (
            <React.Fragment key={step.num}>
              <button
                type="button"
                onClick={() => setCurrentStep(step.num)}
                className="flex items-center gap-1.5 focus:outline-none transition group cursor-pointer"
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold transition ${
                    currentStep === step.num
                      ? "bg-[#4148e2] text-white shadow-[0_0_12px_rgba(65,72,226,0.6)]"
                      : "border border-white/10 bg-[#161d2d] text-slate-400 group-hover:border-blue-500"
                  }`}
                >
                  {step.num}
                </span>
                <span
                  className={`${
                    currentStep === step.num
                      ? "text-blue-400 font-bold"
                      : "text-slate-400 group-hover:text-slate-200"
                  }`}
                >
                  {step.label}
                </span>
              </button>
              {idx < STEPS.length - 1 && (
                <span className="h-px w-6 sm:w-10 bg-white/10" />
              )}
            </React.Fragment>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            Format:{" "}
            <strong className="text-white">
              Vertical 9:16 (TikTok / Reels / Shorts)
            </strong>
          </span>
        </div>
      )}
    </header>
  );
};
