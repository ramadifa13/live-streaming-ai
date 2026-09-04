"use client";

import React from "react";
import { Play, Pause, Loader2, Languages, AudioLines } from "lucide-react";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

const LANGS = [{ value: "Bahasa Indonesia", short: "ID", label: "Bahasa Indonesia" }];

export const VoiceToneSettings: React.FC = () => {
  const selectedVoice = useAiHostStore((state) => state.selectedVoice);
  const selectedLang = useAiHostStore((state) => state.selectedLang);
  const setSelectedLang = useAiHostStore((state) => state.setSelectedLang);
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const isPlayingAudio = useAiHostStore((state) => state.isPlayingAudio);
  const isSynthesizingAudio = useAiHostStore((state) => state.isSynthesizingAudio);
  const isAvatarSpeaking = useAiHostStore((state) => state.isAvatarSpeaking);
  const speakText = useAiHostStore((state) => state.speakText);

  const showToast = useDashboardUIStore((state) => state.showToast);

  const isBusy = isSynthesizingAudio || isPlayingAudio || isAvatarSpeaking;
  const statusLabel = isSynthesizingAudio
    ? "Menyintesis…"
    : isPlayingAudio || isAvatarSpeaking
      ? "Memutar preview"
      : "Siap diputar";

  const handlePlayAudioPreview = async (voice: string = selectedVoice) => {
    const previewText = `Halo semuanya! ini suara saya ${selectedAvatar.name}.`;
    showToast(`Sintesis Piper TTS: ${selectedAvatar.name}...`);
    try {
      await speakText(previewText, {
        voice,
        avatar: selectedAvatar.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal memproses audio.";
      showToast(`Gagal memutar audio: ${msg}`);
    }
  };

  return (
    <div className="shrink-0 rounded-2xl border border-[#2a3348] bg-[#0a101c] p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-300">
            <AudioLines className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-white">Preview Suara Host</p>
            <p className="truncate text-[10px] text-slate-500">
              {selectedAvatar.name || "-"}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide ${
            isSynthesizingAudio
              ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
              : isPlayingAudio || isAvatarSpeaking
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-slate-400"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl border border-white/5 bg-[#080e1a]/80 p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <Languages className="h-3 w-3" />
            Bahasa
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LANGS.map((lang) => {
              const active = selectedLang === lang.value;
              return (
                <button
                  key={lang.value}
                  type="button"
                  onClick={() => setSelectedLang(lang.value)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition cursor-pointer ${
                    active
                      ? "border-blue-400/50 bg-blue-500/15 text-white"
                      : "border-[#2a3348] bg-[#111827] text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  }`}
                >
                  <span className="block text-[10px] font-bold leading-none">{lang.short}</span>
                  <span className="mt-0.5 block text-[9px] leading-tight opacity-80">
                    {lang.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(8,14,26,0.9)_45%)] p-2.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handlePlayAudioPreview(selectedVoice)}
              disabled={isSynthesizingAudio}
              aria-label={isPlayingAudio ? "Jeda preview" : "Putar preview Piper"}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95 disabled:cursor-wait disabled:opacity-60 cursor-pointer ${
                isBusy
                  ? "bg-blue-500 shadow-blue-500/30"
                  : "bg-linear-to-br from-blue-500 to-indigo-600 shadow-blue-600/25 hover:brightness-110"
              }`}
            >
              {isSynthesizingAudio ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isPlayingAudio ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="ml-0.5 h-4 w-4 fill-current" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex h-8 items-end gap-[2px] overflow-hidden">
                {Array.from({ length: 36 }).map((_, i) => {
                  const idleH = 18 + ((i * 17) % 55);
                  const activeH = 28 + ((i * 23 + 11) % 72);
                  return (
                    <span
                      key={i}
                      className={`w-[3px] rounded-full transition-all duration-150 ${
                        isSynthesizingAudio
                          ? "animate-pulse bg-slate-500"
                          : isPlayingAudio || isAvatarSpeaking
                            ? "animate-pulse bg-linear-to-t from-blue-500 to-cyan-300"
                            : i < 14
                              ? "bg-blue-500/70"
                              : "bg-slate-700"
                      }`}
                      style={{
                        height: `${
                          isPlayingAudio || isAvatarSpeaking
                            ? activeH
                            : isSynthesizingAudio
                              ? 36
                              : idleH
                        }%`,
                        animationDelay: `${(i % 9) * 0.08}s`,
                      }}
                    />
                  );
                })}
              </div>
              <p className="mt-1.5 truncate text-[10px] text-slate-400">
                {isSynthesizingAudio
                  ? "CPU lokal sedang generate audio…"
                  : "Klik play untuk dengar suara host"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
