"use client";

import React from "react";
import Image from "next/image";
import { RotateCw, Tag } from "lucide-react";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { LiveMetricsBar } from "@/components/dashboard/LiveMetricsBar";
import { Product } from "@/app/dashboard/types";
import { formatTime } from "@/utils/formatters";

interface LiveRuntimePanelProps {
  activeFeaturedProduct: Product;
  onSwitchProduct: () => void;
}

export const LiveRuntimePanel: React.FC<LiveRuntimePanelProps> = ({ activeFeaturedProduct, onSwitchProduct }) => {
  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const isLivePaused = useLiveSessionStore((state) => state.isLivePaused);
  const liveSeconds = useLiveSessionStore((state) => state.liveSeconds);
  const selectedDuration = useLiveSessionStore((state) => state.selectedDuration);
  const metrics = useLiveSessionStore((state) => state.metrics);
  const pipelineStatus = useLiveSessionStore((state) => state.pipelineStatus);
  const progress = Math.min(100, (liveSeconds / (selectedDuration * 3600)) * 100);

  return (
    <>
      <div className="mb-3 border-b border-[#232c42] pb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[9px] font-bold tracking-widest text-white ${
                !isLivePaused ? "bg-red-500 animate-pulse" : "bg-amber-600"
              }`}
            >
              {isLivePaused ? "PAUSED" : "LIVE"}
            </span>
            <span className="text-[12px] font-bold tracking-wider text-slate-100 font-mono">
              {formatTime(liveSeconds)}{" "}
              <span className="text-[9px] font-normal text-slate-400 font-sans">/ {selectedDuration} Jam</span>
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold text-emerald-400">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1c2438]">
          <div
            className={`h-full transition-all duration-300 ${
              progress > 90
                ? "bg-gradient-to-r from-amber-500 to-red-500 animate-pulse"
                : "bg-gradient-to-r from-blue-500 to-emerald-400"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mb-3">
        <LiveMetricsBar
          viewers={metrics.viewers}
          comments={metrics.comments}
          clicks={metrics.clicks}
          sales={metrics.sales}
        />
      </div>

      {isLiveActive && pipelineStatus && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-purple-500/20 bg-purple-950/20 px-2.5 py-2 text-[9px]">
          <span className="font-semibold text-purple-300">Script Bank</span>
          <span className="text-slate-300">{pipelineStatus.scriptBankRemaining ?? "-"} naskah tersisa</span>
          <span className="text-slate-500">
            {pipelineStatus.scriptBankSource === "mixed"
              ? "LLM+lokal"
              : pipelineStatus.scriptBankSource === "payload"
                ? "prepared"
                : "lokal"}
          </span>
          {(pipelineStatus.scriptBankRemaining ?? 99) <= 8 && (
            <span className="font-bold text-amber-400">Refill...</span>
          )}
        </div>
      )}

      <div className="mb-3 rounded-xl border border-blue-500/20 bg-[#111827] p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[9px] font-bold text-slate-300">
            <Tag className="h-3 w-3 text-blue-400" />
            <span>Produk Aktif di Siaran</span>
          </p>
          <button
            type="button"
            onClick={onSwitchProduct}
            className="cursor-pointer text-[8.5px] font-bold text-blue-400 hover:underline"
          >
            Ganti Produk
          </button>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/20 shadow">
            <Image
              src={
                activeFeaturedProduct.image?.startsWith("http") ||
                activeFeaturedProduct.image?.startsWith("/") ||
                activeFeaturedProduct.image?.startsWith("data:")
                  ? activeFeaturedProduct.image
                  : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
              }
              alt={activeFeaturedProduct.name}
              fill
              unoptimized
              className="object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-bold text-white">{activeFeaturedProduct.name}</p>
            <p className="text-[11px] font-bold text-emerald-400">{activeFeaturedProduct.price}</p>
          </div>
          <div className="border-l border-[#232c42] pl-2 text-right">
            <p className="text-[7.5px] text-slate-500">Klik</p>
            <p className="text-[9.5px] font-bold text-white">{metrics.activeProductClicks}</p>
          </div>
          <div className="border-l border-[#232c42] pl-2 text-right">
            <p className="text-[7.5px] text-slate-500">Terjual</p>
            <p className="text-[9.5px] font-bold text-emerald-400">{metrics.activeProductSold} ↑</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSwitchProduct}
          className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg bg-[#4148e2] py-1.5 text-[9px] font-bold text-white shadow-sm transition hover:bg-blue-600 active:scale-95"
        >
          <RotateCw className="h-3 w-3" />
          <span>Pin &amp; Sorot Produk Berikutnya</span>
        </button>
      </div>
    </>
  );
};
