"use client";

import React from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Sparkles, X } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Sparkles,
};

const iconColors = {
  success: "text-emerald-400",
  error: "text-rose-400",
  warning: "text-amber-400",
  info: "text-blue-400",
};

const containerStyles = {
  success: "border-emerald-500/50 bg-[#062817]/95 text-emerald-200 shadow-emerald-500/20",
  error: "border-rose-500/50 bg-[#2d0f15]/95 text-rose-200 shadow-rose-500/20",
  warning: "border-amber-500/50 bg-[#2b1e09]/95 text-amber-200 shadow-amber-500/20",
  info: "border-blue-500/50 bg-[#0f172a]/95 text-blue-200 shadow-blue-500/20",
};

export const ToastNotification: React.FC = () => {
  const toastMessage = useDashboardUIStore((state) => state.toastMessage);
  const toastType = useDashboardUIStore((state) => state.toastType);
  const hideToast = useDashboardUIStore((state) => state.hideToast);

  if (!toastMessage) return null;

  const IconComponent = icons[toastType] || icons.info;
  const iconColor = iconColors[toastType] || iconColors.info;
  const containerStyle = containerStyles[toastType] || containerStyles.info;

  return (
    <aside
      aria-live="polite"
      aria-label="Notifikasi sistem"
      className={`fixed bottom-6 right-6 z-50 flex max-w-sm sm:max-w-md items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold shadow-2xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${containerStyle}`}
    >
      <IconComponent className={`w-4 h-4 ${iconColor} shrink-0`} />
      <span className="flex-1 leading-snug">{toastMessage}</span>
      <button
        type="button"
        onClick={hideToast}
        className="ml-1 p-0.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer shrink-0"
        title="Tutup Notifikasi"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </aside>
  );
};
