"use client";

import React from "react";

interface ToastProps {
  message: string | null;
  onClose?: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-blue-500/30 bg-[#0f172a]/95 px-4 py-3 text-sm text-slate-100 shadow-2xl backdrop-blur-md animate-fadeIn">
      <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
      <span>{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-2 text-xs text-slate-400 hover:text-slate-200"
          type="button"
        >
          ✕
        </button>
      )}
    </div>
  );
}
