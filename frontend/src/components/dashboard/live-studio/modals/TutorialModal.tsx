"use client";

import React, { useEffect, useRef, useState } from "react";
import { X, BookOpen, AlertTriangle, CheckCircle2, ExternalLink, MousePointerClick, Monitor, Sparkles } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { LIVE_PLATFORM_GUIDES, resolveLiveGuideId, type GuideClickStep } from "@/lib/live-platform-guide";

function StepCard({ step, index }: { step: GuideClickStep; index: number }) {
  const inLivio = step.place === "livio";

  return (
    <article
      className={`rounded-2xl border px-4 py-4 sm:px-5 ${
        inLivio ? "border-cyan-400/40 bg-cyan-500/8" : "border-[#2a3550] bg-[#111827]"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
          {index + 1}
        </span>
        <h5 className="text-[15px] font-bold leading-snug text-white">{step.title}</h5>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            inLivio ? "bg-cyan-500/20 text-cyan-200" : "bg-white/8 text-slate-300"
          }`}
        >
          {inLivio ? "Kerjakan di Livio" : "Kerjakan di komputer"}
        </span>
      </div>

      {step.website ? (
        <div className="mb-3 rounded-xl border border-blue-400/25 bg-blue-500/10 px-3 py-3">
          <p className="text-[12px] font-semibold text-blue-100">Buka situs ini</p>
          <p className="mt-0.5 font-mono text-[13px] text-white">{step.website.label}</p>
          <a
            href={step.website.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[12px] font-bold text-white hover:brightness-110"
          >
            {step.website.buttonLabel}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      ) : null}

      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
        <MousePointerClick className="h-3.5 w-3.5 text-blue-300" />
        Lakukan ini, satu per satu
      </p>
      <ol className="space-y-2">
        {step.doThis.map((item, itemIndex) => (
          <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-slate-200">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/10 text-[10px] font-bold text-slate-300">
              {itemIndex + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>

      {step.youWillSee ? (
        <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-[12px] leading-relaxed text-emerald-100">
          <span className="font-bold text-emerald-200">Yang muncul: </span>
          {step.youWillSee}
        </p>
      ) : null}
    </article>
  );
}

export const TutorialModal: React.FC = () => {
  const showTutorialModal = useDashboardUIStore((state) => state.showTutorialModal);
  const setShowTutorialModal = useDashboardUIStore((state) => state.setShowTutorialModal);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);

  const [activeId, setActiveId] = useState(resolveLiveGuideId(selectedPlatform));
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTutorialModal) {
      setActiveId(resolveLiveGuideId(selectedPlatform));
    }
  }, [showTutorialModal, selectedPlatform]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [activeId, showTutorialModal]);

  if (!showTutorialModal) return null;

  const guide = LIVE_PLATFORM_GUIDES.find((item) => item.id === activeId) || LIVE_PLATFORM_GUIDES[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm animate-fadeIn sm:p-4">
      <div className="relative flex h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-blue-500/40 bg-[#0c1221] shadow-2xl">
        <button
          type="button"
          onClick={() => setShowTutorialModal(false)}
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-slate-400 transition hover:bg-white/5 hover:text-white cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start gap-3 border-b border-[#232c42] px-5 py-4 pr-12 sm:px-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Cara mengambil kode siaran</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-300">
              Ikuti seperti resep masak. Selesaikan satu langkah, baru lanjut ke langkah berikutnya. Kerjakan di komputer, bukan di HP.
            </p>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto border-b border-[#232c42] bg-[#0a101c] px-4 py-2">
          {LIVE_PLATFORM_GUIDES.map((item) => {
            const active = item.id === guide.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold transition cursor-pointer ${
                  active
                    ? "bg-linear-to-r from-blue-600 to-indigo-600 text-white shadow"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.platformKey ? <PlatformIcon name={item.platformKey} size="sm" /> : null}
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-slate-200 sm:px-6">
          <div className={`rounded-xl border px-4 py-3 ${guide.accentSoft}`}>
            <p className={`text-[13px] leading-relaxed font-medium ${guide.accent}`}>{guide.intro}</p>
            <a
              href={guide.officialUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-blue-300 hover:underline"
            >
              {guide.officialLabel}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <p className="rounded-xl border border-[#2a3550] bg-[#101826] px-4 py-2.5 text-[13px] leading-relaxed text-slate-300">
            <Monitor className="mr-1.5 inline h-4 w-4 text-blue-300" />
            Cara menyalin: di situs platform klik <span className="font-semibold text-white">Salin</span> /{" "}
            <span className="font-semibold text-white">Copy</span>, lalu di Livio klik kolom kosong dan tekan{" "}
            <span className="font-semibold text-white">Ctrl</span> + <span className="font-semibold text-white">V</span>.
            Jangan diketik satu per satu.
          </p>

          <section>
            <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-white">
              <Sparkles className="h-4 w-4 text-blue-400" />
              Langkah 1 sampai selesai
            </h4>
            <div className="space-y-3">
              {guide.steps.map((step, index) => (
                <StepCard key={`${guide.id}-${step.title}`} step={step} index={index} />
              ))}
            </div>
          </section>

          <section>
            <h4 className={`mb-2 flex items-center gap-1.5 text-[13px] font-bold ${guide.accent}`}>
              <AlertTriangle className="h-4 w-4" />
              Syarat akun, cek jika langkah di atas tidak muncul
            </h4>
            <ul className="space-y-2">
              {guide.requirements.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 rounded-xl border border-[#232c42] bg-[#111827] px-3 py-2.5 text-[13px] leading-relaxed text-slate-200"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {guide.warnings.length > 0 ? (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="mb-2 text-[13px] font-bold text-amber-300">Perlu diingat</p>
              <ul className="space-y-1.5 text-[13px] leading-relaxed text-amber-100/90">
                {guide.warnings.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-[#232c42] px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setShowTutorialModal(false)}
            className="cursor-pointer rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-600/30 transition hover:brightness-110 active:scale-95"
          >
            Mengerti &amp; tutup
          </button>
        </div>
      </div>
    </div>
  );
};
