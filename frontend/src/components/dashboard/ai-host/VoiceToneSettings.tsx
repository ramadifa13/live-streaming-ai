"use client";

import React from "react";
import { Play, Pause, Loader2 } from "lucide-react";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

const SPEEDS = [
  { val: 0.85, label: "0.85x" },
  { val: 1.0, label: "1.0x" },
  { val: 1.15, label: "1.15x" },
  { val: 1.3, label: "1.3x" },
];

const TONES = ["Energetic", "FOMO", "Professional"];

export const VoiceToneSettings: React.FC = () => {
  const selectedVoice = useAiHostStore((state) => state.selectedVoice);
  const selectedLang = useAiHostStore((state) => state.selectedLang);
  const setSelectedLang = useAiHostStore((state) => state.setSelectedLang);
  const selectedTone = useAiHostStore((state) => state.selectedTone);
  const setSelectedTone = useAiHostStore((state) => state.setSelectedTone);
  const speechSpeed = useAiHostStore((state) => state.speechSpeed);
  const setSpeechSpeed = useAiHostStore((state) => state.setSpeechSpeed);
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const isPlayingAudio = useAiHostStore((state) => state.isPlayingAudio);
  const isSynthesizingAudio = useAiHostStore((state) => state.isSynthesizingAudio);
  const isAvatarSpeaking = useAiHostStore((state) => state.isAvatarSpeaking);
  const speakText = useAiHostStore((state) => state.speakText);

  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const showToast = useDashboardUIStore((state) => state.showToast);

const handlePlayAudioPreview = async (
    voice: string = selectedVoice,
    tone: string = selectedTone,
    speed: number = speechSpeed,
  ) => {
    const previewText =
      tone === "FOMO"
        ? `Halo kak! Khusus promo hari ini, stok ${activeFeaturedProduct?.name && activeFeaturedProduct.name !== "Memuat Produk..." ? activeFeaturedProduct.name : "produk ini"} terbatas ya, yuk buruan checkout sekarang juga!`
        : tone === "Professional"
        ? `Halo semuanya, selamat datang. Saya ${selectedAvatar.name}. Hari ini kami mereview spesifikasi dan keunggulan ${activeFeaturedProduct?.name && activeFeaturedProduct.name !== "Memuat Produk..." ? activeFeaturedProduct.name : "produk unggulan kami"}.`
        : `Halo semuanya! Selamat datang di live streaming. Saya ${selectedAvatar.name}. Yuk langsung cek penawaran dan voucher spesial hari ini ya!`;

    showToast(
      `Memutar suara ${selectedAvatar.name} (${tone} ${speed}x)...`,
    );
    try {
      await speakText(previewText, {
        voice,
        tone,
        speed,
        avatar: selectedAvatar.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal memproses audio.";
      showToast(`Gagal memutar audio: ${msg}`);
    }
  };

  return (
    <>
      <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[10.5px] font-semibold text-slate-300">
            Bahasa Utama
          </label>
          <select
            value={selectedLang}
            onChange={(e) => {
              const newLang = e.target.value;
              setSelectedLang(newLang);
              handlePlayAudioPreview(
                selectedVoice,
                selectedTone,
                speechSpeed,
              );
            }}
            className="w-full rounded-lg border border-[#232c42] bg-[#111827] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500 font-medium"
          >
            <option value="Bahasa Indonesia">Bahasa Indonesia</option>
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center justify-between text-[10.5px] font-semibold text-slate-300">
            <span>Tempo Bicara</span>
            <span className="text-blue-400 font-mono">
              {speechSpeed}x
            </span>
          </label>
          <div className="grid grid-cols-4 gap-1">
            {SPEEDS.map((sp) => (
              <button
                key={sp.val}
                type="button"
                onClick={() => {
                  setSpeechSpeed(sp.val);
                  handlePlayAudioPreview(
                    selectedVoice,
                    selectedTone,
                    sp.val,
                  );
                }}
                className={`rounded-lg py-1 text-[10px] font-medium border transition cursor-pointer ${
                  speechSpeed === sp.val
                    ? "border-blue-500 bg-blue-500/20 text-white font-bold"
                    : "border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200"
                }`}
              >
                {sp.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block text-[10.5px] font-semibold text-slate-300">
            Gaya Bicara / Persona
          </label>
          <div className="grid grid-cols-3 gap-1">
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => {
                  setSelectedTone(tone);
                  handlePlayAudioPreview(
                    selectedVoice,
                    tone,
                    speechSpeed,
                  );
                }}
                className={`rounded-lg py-1 text-[10px] font-medium transition cursor-pointer ${
                  selectedTone === tone
                    ? "bg-purple-900/60 border border-purple-500 text-white font-bold shadow-inner"
                    : "border border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200"
                }`}
              >
                {tone === "Energetic"
                  ? "Energetik"
                  : tone === "Professional"
                    ? "Profesional"
                    : tone}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-auto rounded-xl border border-blue-500/30 bg-[#111827] p-3 shadow-inner">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                handlePlayAudioPreview(
                  selectedVoice,
                  selectedTone,
                  speechSpeed,
                )
              }
              disabled={isSynthesizingAudio}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:brightness-110 transition active:scale-95 shrink-0 shadow-md shadow-blue-600/30 disabled:opacity-60 disabled:cursor-wait cursor-pointer"
            >
              {isSynthesizingAudio ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isPlayingAudio ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>

            <div className="flex-1 h-5 flex items-center gap-[2.5px] overflow-hidden">
              {Array.from({ length: 42 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all duration-150 ${
                    isSynthesizingAudio
                      ? "bg-slate-600 animate-pulse"
                      : isPlayingAudio || isAvatarSpeaking
                        ? "bg-gradient-to-t from-blue-500 to-emerald-400 animate-pulse"
                        : i < 16
                          ? "bg-blue-600"
                          : "bg-slate-700"
                  }`}
                  style={{
                    height:
                      isPlayingAudio || isAvatarSpeaking
                        ? `${((i * 19 + 23) % 75) + 25}%`
                        : isSynthesizingAudio
                          ? "35%"
                          : `${(i % 6) * 15 + 20}%`,
                    animationDelay: `${(i % 8) * 0.12}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-[9.5px] font-mono text-slate-400 shrink-0">
              {isSynthesizingAudio
                ? "..."
                : isPlayingAudio
                  ? "00:04"
                  : "00:00"}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};
