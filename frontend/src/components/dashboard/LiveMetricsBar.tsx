"use client";

import React, { memo } from "react";

export interface LiveMetricsBarProps {
  viewers: number;
  comments: number;
  clicks: number;
  sales: number;
}

export const LiveMetricsBar = memo(function LiveMetricsBar({
  viewers,
  comments,
  clicks,
  sales,
}: LiveMetricsBarProps) {
  return (
    <div className="grid grid-cols-4 gap-2 bg-[#0c1221]/80 backdrop-blur-md p-3 rounded-xl border border-[#232c42] shadow-inner">
      <div className="text-center">
        <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">
          Penonton
        </span>
        <p className="text-sm font-extrabold text-emerald-400 mt-0.5 tracking-tight flex items-center justify-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
          {viewers.toLocaleString("id-ID")}
        </p>
      </div>
      <div className="text-center border-l border-[#232c42]">
        <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">
          Chat
        </span>
        <p className="text-sm font-extrabold text-white mt-0.5 tracking-tight">
          {comments.toLocaleString("id-ID")}
        </p>
      </div>
      <div className="text-center border-l border-[#232c42]">
        <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">
          Klik
        </span>
        <p className="text-sm font-extrabold text-cyan-300 mt-0.5 tracking-tight">
          {clicks.toLocaleString("id-ID")}
        </p>
      </div>
      <div className="text-center border-l border-[#232c42]">
        <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">
          Omset
        </span>
        <p className="text-sm font-extrabold text-amber-400 mt-0.5 tracking-tight">
          Rp{sales.toLocaleString("id-ID")}
        </p>
      </div>
    </div>
  );
});
