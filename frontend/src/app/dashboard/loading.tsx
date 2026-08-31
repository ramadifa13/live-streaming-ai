"use client";

import React from "react";
import { Loader2, Video, Bot, Package } from "lucide-react";
import { LivioLogo } from "@/components/shared/LivioLogo";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#060a14] text-white p-4 font-sans">
      <div className="mx-auto w-full max-w-[1600px] space-y-8">
        <div className="flex items-center justify-between border-b border-[#1f2638] pb-4">
          <div className="flex items-center gap-4">
            <LivioLogo variant="primary" />
            <div className="flex items-center rounded-xl bg-[#111827] p-1 border border-[#232c42] shadow-inner">
              <div className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Loading...</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DashboardCardSkeleton title="Data Produk" icon={<Package className="w-5 h-5" />} />
          <DashboardCardSkeleton title="AI Host" icon={<Bot className="w-5 h-5" />} />
          <DashboardCardSkeleton title="Atur Live" icon={<Video className="w-5 h-5" />} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1.1fr]">
          <div className="space-y-4">
            <div className="aspect-video rounded-xl border border-[#232c42] bg-[#0c1221] animate-pulse" />
            <div className="aspect-video rounded-xl border border-[#232c42] bg-[#0c1221] animate-pulse" />
          </div>
          <div className="space-y-4">
            <div className="h-64 rounded-xl border border-[#232c42] bg-[#0c1221] animate-pulse" />
            <div className="h-48 rounded-xl border border-[#232c42] bg-[#0c1221] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardCardSkeleton({ icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#232c42] bg-[#0c1221] p-4 animate-pulse space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
          {icon}
        </div>
        <div className="h-4 w-24 bg-white/10 rounded" />
      </div>
      <div className="h-4 w-32 bg-white/10 rounded" />
      <div className="h-4 w-48 bg-white/10 rounded" />
      <div className="h-32 bg-white/5 rounded-lg" />
    </div>
  );
}