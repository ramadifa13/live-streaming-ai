"use client";

import React, { useState } from "react";
import { X, ArrowLeft, ArrowRight, ExternalLink, Check, BookOpen } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { LIVE_PLATFORM_GUIDES, resolveLiveGuideId } from "@/lib/live-platform-guide";

type GuideView = "steps" | "syarat";

export const TutorialModal: React.FC = () => {
  const showTutorialModal = useDashboardUIStore((state) => state.showTutorialModal);
  const setShowTutorialModal = useDashboardUIStore((state) => state.setShowTutorialModal);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);

  const [activeId, setActiveId] = useState(resolveLiveGuideId(selectedPlatform));
  const [stepIndex, setStepIndex] = useState(0);
  const [view, setView] = useState<GuideView>("steps");
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  const openKey = showTutorialModal ? selectedPlatform : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey) {
      setActiveId(resolveLiveGuideId(openKey));
      setStepIndex(0);
      setView("steps");
    }
  }

  if (!showTutorialModal) return null;

  const guide = LIVE_PLATFORM_GUIDES.find((item) => item.id === activeId) || LIVE_PLATFORM_GUIDES[0];
  const totalSteps = guide.steps.length;
  const safeIndex = Math.min(stepIndex, Math.max(totalSteps - 1, 0));
  const step = guide.steps[safeIndex];
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === totalSteps - 1;
  const progress = totalSteps > 0 ? ((safeIndex + 1) / totalSteps) * 100 : 0;

  const switchPlatform = (id: string) => {
    setActiveId(id);
    setStepIndex(0);
    setView("steps");
  };

  const close = () => setShowTutorialModal(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-md animate-fadeIn sm:p-4">
      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#22314e] bg-[#0c1221] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e293b] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight text-white sm:text-lg">Ambil kode siaran</h3>
              <p className="text-[11px] text-slate-400">Ikuti satu langkah, lalu tekan Lanjut.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 border-b border-[#1e293b] bg-[#0a101c] px-5 py-2.5 sm:px-6">
          <div className="flex flex-wrap gap-1.5">
            {LIVE_PLATFORM_GUIDES.map((item) => {
              const active = item.id === guide.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => switchPlatform(item.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition cursor-pointer ${
                    active
                      ? "bg-linear-to-r from-blue-600 to-indigo-600 text-white shadow"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.platformKey ? <PlatformIcon name={item.platformKey} size="sm" /> : null}
                  {item.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 gap-5 border-b border-[#232c42] px-5 sm:px-6">
          <button
            type="button"
            onClick={() => setView("steps")}
            className={`py-2.5 text-[12px] font-bold transition cursor-pointer ${
              view === "steps"
                ? "border-b-2 border-blue-500 text-blue-300"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            Langkah
          </button>
          <button
            type="button"
            onClick={() => setView("syarat")}
            className={`py-2.5 text-[12px] font-bold transition cursor-pointer ${
              view === "syarat"
                ? "border-b-2 border-blue-500 text-blue-300"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            Syarat akun
          </button>
        </div>

        <div className="guide-modal-scrollbar min-h-70 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {view === "steps" && step ? (
            <div className="flex flex-col">
              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-slate-500">
                  <span>
                    {safeIndex + 1} / {totalSteps}
                  </span>
                  <span className={step.place === "livio" ? "text-cyan-300" : "text-blue-300"}>
                    {step.place === "livio" ? "Di Livio" : "Di komputer"}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-[#111827]">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <h4 className="text-xl font-bold leading-snug tracking-tight text-white">{step.title}</h4>

              {isFirst ? <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{guide.intro}</p> : null}

              {step.website ? (
                <a
                  href={step.website.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 flex items-center justify-between rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 transition hover:bg-blue-500/15"
                >
                  <div>
                    <p className="text-[11px] font-medium text-blue-300/80">Buka situs</p>
                    <p className="text-[13px] font-semibold text-white">{step.website.label}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[12px] font-bold text-blue-200">
                    {step.website.buttonLabel}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                </a>
              ) : null}

              <ol className="mt-6 space-y-3">
                {step.doThis.map((item, itemIndex) => (
                  <li key={item} className="flex gap-3 rounded-xl border border-[#232c42] bg-[#111827] px-3 py-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-[11px] font-bold text-white">
                      {itemIndex + 1}
                    </span>
                    <p className="text-[13px] leading-relaxed text-slate-200">{item}</p>
                  </li>
                ))}
              </ol>

              {step.youWillSee ? (
                <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-100/90">
                  Lalu Anda akan melihat: {step.youWillSee}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-[13px] font-bold text-blue-300">Akun harus memenuhi ini</h4>
                <ul className="mt-3 space-y-2">
                  {guide.requirements.map((item) => (
                    <li
                      key={item}
                      className="flex gap-3 rounded-xl border border-[#232c42] bg-[#111827] px-3 py-2.5 text-[13px] leading-relaxed text-slate-300"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {guide.warnings.length > 0 ? (
                <div>
                  <h4 className="text-[13px] font-bold text-amber-300">Kalau gagal, biasanya karena ini</h4>
                  <ul className="mt-3 space-y-2">
                    {guide.warnings.map((item) => (
                      <li
                        key={item}
                        className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-[13px] leading-relaxed text-amber-100/80"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <a
                href={guide.officialUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-blue-300 hover:underline"
              >
                {guide.officialLabel}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#232c42] bg-[#0c1221] px-5 py-3.5 sm:px-6">
          {view === "steps" ? (
            <>
              <button
                type="button"
                onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
                disabled={isFirst}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-400 transition hover:bg-white/5 hover:text-white disabled:invisible cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Kembali
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isLast) {
                    close();
                    return;
                  }
                  setStepIndex((value) => Math.min(totalSteps - 1, value + 1));
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-[12px] font-bold text-white shadow-md shadow-blue-600/30 transition hover:brightness-110 cursor-pointer"
              >
                {isLast ? "Selesai" : "Lanjut"}
                {!isLast ? <ArrowRight className="h-4 w-4" /> : null}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setView("steps")}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-400 transition hover:bg-white/5 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Ke langkah
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-[12px] font-bold text-white shadow-md shadow-blue-600/30 transition hover:brightness-110 cursor-pointer"
              >
                Tutup
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
