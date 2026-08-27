"use client";

import React from "react";

interface StepIndicatorProps {
  currentStep: number;
  onSelectStep: (step: number) => void;
}

const STEPS = [
  { id: 1, label: "1. Produk", icon: "📦" },
  { id: 2, label: "2. Avatar & Suara", icon: "🎙️" },
  { id: 3, label: "3. Durasi & Platform", icon: "⏱️" },
  { id: 4, label: "4. Test & Preview", icon: "✨" },
  { id: 5, label: "5. Live Control", icon: "🔴" },
];

export function StepIndicator({
  currentStep,
  onSelectStep,
}: StepIndicatorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#1f2638] bg-[#0c1221] p-3 text-xs">
      {STEPS.map((s) => {
        const isActive = currentStep === s.id;
        const isPassed = currentStep > s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelectStep(s.id)}
            type="button"
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
              isActive
                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                : isPassed
                  ? "bg-[#162038] text-blue-300 hover:bg-[#1f2c4d]"
                  : "bg-transparent text-slate-400 hover:bg-[#141b2d] hover:text-slate-200"
            }`}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
