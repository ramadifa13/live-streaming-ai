"use client";

import React, { useState } from "react";
import { X, ArrowLeft, ArrowRight, ExternalLink, Check } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fadeIn">
      <div className="relative flex max-h-[90vh] w-full max-w-130 flex-col overflow-hidden rounded-3xl border border-white/8 bg-[#0b1220] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Panduan</p>
            <h3 className="mt-0.5 text-[17px] font-semibold text-white">Ambil kode siaran</h3>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/6 hover:text-white cursor-pointer"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {LIVE_PLATFORM_GUIDES.map((item) => {
              const active = item.id === guide.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => switchPlatform(item.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition cursor-pointer ${
                    active
                      ? "bg-white text-slate-900"
                      : "bg-white/5 text-slate-400 hover:bg-white/8 hover:text-slate-200"
                  }`}
                >
                  {item.platformKey ? <PlatformIcon name={item.platformKey} size="sm" /> : null}
                  {item.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-6 px-6">
          <button
            type="button"
            onClick={() => setView("steps")}
            className={`pb-2 text-[13px] font-medium transition cursor-pointer ${
              view === "steps" ? "border-b-2 border-white text-white" : "border-b-2 border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            Langkah
          </button>
          <button
            type="button"
            onClick={() => setView("syarat")}
            className={`pb-2 text-[13px] font-medium transition cursor-pointer ${
              view === "syarat" ? "border-b-2 border-white text-white" : "border-b-2 border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            Syarat akun
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {view === "steps" && step ? (
            <div className="flex flex-col">
              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {safeIndex + 1} / {totalSteps}
                  </span>
                  <span>{step.place === "livio" ? "Di Livio" : "Di komputer"}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full bg-white/70 transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <h4 className="text-[22px] font-semibold leading-snug tracking-tight text-white">{step.title}</h4>

              {isFirst ? <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{guide.intro}</p> : null}

              {step.website ? (
                <a
                  href={step.website.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-slate-900 transition hover:bg-slate-100"
                >
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">Buka situs</p>
                    <p className="text-[14px] font-semibold">{step.website.label}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold">
                    {step.website.buttonLabel}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                </a>
              ) : null}

              <ol className="mt-6 space-y-4">
                {step.doThis.map((item, itemIndex) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/8 text-[11px] font-semibold text-slate-300">
                      {itemIndex + 1}
                    </span>
                    <p className="text-[14px] leading-relaxed text-slate-200">{item}</p>
                  </li>
                ))}
              </ol>

              {step.youWillSee ? (
                <p className="mt-6 text-[13px] leading-relaxed text-slate-500">
                  Lalu Anda akan melihat: {step.youWillSee}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-[15px] font-semibold text-white">Akun harus memenuhi ini</h4>
                <ul className="mt-3 space-y-3">
                  {guide.requirements.map((item) => (
                    <li key={item} className="flex gap-3 text-[13px] leading-relaxed text-slate-300">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {guide.warnings.length > 0 ? (
                <div>
                  <h4 className="text-[15px] font-semibold text-white">Kalau gagal, biasanya karena ini</h4>
                  <ul className="mt-3 space-y-3">
                    {guide.warnings.map((item) => (
                      <li key={item} className="text-[13px] leading-relaxed text-slate-400">
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
                className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-300"
              >
                {guide.officialLabel}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/6 px-6 py-4">
          {view === "steps" ? (
            <>
              <button
                type="button"
                onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
                disabled={isFirst}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-slate-400 transition hover:text-white disabled:invisible cursor-pointer"
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
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-slate-900 transition hover:bg-slate-100 cursor-pointer"
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
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-slate-400 transition hover:text-white cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Ke langkah
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-slate-900 transition hover:bg-slate-100 cursor-pointer"
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
