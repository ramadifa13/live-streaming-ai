"use client";

import React from "react";
import { Play, Pause, Loader2, Languages, AudioLines } from "lucide-react";
import {
  DEFAULT_VOICE_ID,
  TTS_LANGS,
  localVoicePreviewUrl,
  voicesForAvatarGender,
  type TtsLangCode,
} from "@/app/dashboard/constants";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

export const VoiceToneSettings: React.FC = () => {
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const selectedVoice = useAiHostStore((state) => state.selectedVoice);
  const selectedLang = useAiHostStore((state) => state.selectedLang);
  const setSelectedLang = useAiHostStore((state) => state.setSelectedLang);
  const setSelectedVoice = useAiHostStore((state) => state.setSelectedVoice);
  const isPlayingAudio = useAiHostStore((state) => state.isPlayingAudio);
  const isSynthesizingAudio = useAiHostStore((state) => state.isSynthesizingAudio);
  const isAvatarSpeaking = useAiHostStore((state) => state.isAvatarSpeaking);
  const speakText = useAiHostStore((state) => state.speakText);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const voiceOptions = voicesForAvatarGender(selectedAvatar.gender);
  const voiceId =
    selectedVoice || selectedAvatar.voice || DEFAULT_VOICE_ID;
  const activeVoice =
    voiceOptions.find((v) => v.id === voiceId) || voiceOptions[0];

  const isBusy = isSynthesizingAudio || isPlayingAudio || isAvatarSpeaking;
  const statusLabel = isSynthesizingAudio
    ? "Memuat…"
    : isPlayingAudio || isAvatarSpeaking
      ? "Memutar"
      : "Siap";

  const handlePlayAudioPreview = async () => {
    if (!activeVoice) {
      showToast("Tidak ada suara untuk host ini.");
      return;
    }
    showToast(`Preview lokal · ${activeVoice.label}`);
    try {
      // Pre-live: sample statis saja — tidak hit pod / VoxCPM2.
      await speakText("__local_preview__", {
        voice: activeVoice.id,
        avatar: selectedAvatar.name,
        lang: selectedLang,
        localPreviewOnly: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal memutar audio.";
      showToast(`Gagal memutar audio: ${msg}`);
    }
  };

  return (
    <div className="shrink-0 rounded-xl border border-[#2a3348] bg-[#0a101c] p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-blue-500/25 bg-blue-500/10 text-blue-300">
            <AudioLines className="h-3 w-3" />
          </span>
          <p className="truncate text-[11px] font-bold text-white">
            Suara · {selectedAvatar.name}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tracking-wide ${
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

      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-1.5">
          <label className="block min-w-0">
            <span className="mb-0.5 block text-[8px] font-semibold uppercase tracking-wider text-slate-500">
              Host Voice
            </span>
            {voiceOptions.length === 0 ? (
              <div className="w-full rounded-md border border-[#2a3348] bg-[#111827] px-2 py-1.5 text-[11px] text-slate-500">
                Belum ada suara untuk gender ini
              </div>
            ) : (
              <select
                value={activeVoice?.id || ""}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="w-full rounded-md border border-[#2a3348] bg-[#111827] px-2 py-1.5 text-[11px] font-semibold text-white cursor-pointer"
              >
                {voiceOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="min-w-0">
            <span className="mb-0.5 flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-wider text-slate-500">
              <Languages className="h-2.5 w-2.5" />
              Lang
            </span>
            <div className="flex gap-1">
              {TTS_LANGS.map((lang) => {
                const active = selectedLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setSelectedLang(lang.code as TtsLangCode)}
                    className={`min-w-9 rounded-md border px-2 py-1.5 text-[10px] font-bold transition cursor-pointer ${
                      active
                        ? "border-blue-400/50 bg-blue-500/15 text-white"
                        : "border-[#2a3348] bg-[#111827] text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    }`}
                  >
                    {lang.short}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handlePlayAudioPreview()}
            disabled={isSynthesizingAudio || voiceOptions.length === 0}
            aria-label={isPlayingAudio ? "Jeda preview" : "Putar preview suara"}
            className={`mb-px flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-md transition active:scale-95 disabled:cursor-wait disabled:opacity-60 cursor-pointer ${
              isBusy
                ? "bg-blue-500 shadow-blue-500/30"
                : "bg-linear-to-br from-blue-500 to-indigo-600 shadow-blue-600/25 hover:brightness-110"
            }`}
          >
            {isSynthesizingAudio ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPlayingAudio ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="ml-0.5 h-3 w-3 fill-current" />
            )}
          </button>
        </div>

        <div className="rounded-lg border border-white/5 bg-[#080e1a]/80 px-2 py-1.5">
          <p className="text-[9px] text-slate-500 leading-snug">
            Preview memakai file lokal (
            {localVoicePreviewUrl(activeVoice?.id || DEFAULT_VOICE_ID, selectedLang)}
            ). VoxCPM2 hanya saat live.
          </p>
        </div>

        {(isSynthesizingAudio || isPlayingAudio || isAvatarSpeaking) && (
          <p className="truncate text-[9px] text-slate-500">
            {isSynthesizingAudio
              ? "Memuat sample…"
              : `Preview ${activeVoice?.label || voiceId} · ${selectedLang.toUpperCase()}`}
          </p>
        )}
      </div>
    </div>
  );
};
