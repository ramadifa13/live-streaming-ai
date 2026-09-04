"use client";

import React, { useRef } from "react";
import { Check, ChevronLeft, ChevronRight, Sparkles, UserRound } from "lucide-react";
import { avatars } from "@/app/dashboard/constants";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

export const AvatarCarousel: React.FC = () => {
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const setSelectedAvatar = useAiHostStore((state) => state.setSelectedAvatar);
  const setSelectedVoice = useAiHostStore((state) => state.setSelectedVoice);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const carouselRef = useRef<HTMLDivElement>(null);
  const filteredAvatars = avatars.filter((a) => a.type === "3D");
  const slotCount = filteredAvatars.length + 1;
  const showNav = slotCount > 2;

  const scrollAvatars = (direction: "left" | "right") => {
    if (!carouselRef.current) return;
    const amount = Math.max(180, carouselRef.current.clientWidth * 0.55);
    carouselRef.current.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {showNav && (
        <>
          <button
            type="button"
            onClick={() => scrollAvatars("left")}
            className="absolute left-1 top-1/2 z-30 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/55 text-slate-200 shadow-lg backdrop-blur-md transition hover:border-blue-400/50 hover:bg-blue-600 hover:text-white active:scale-95 cursor-pointer"
            title="Geser Host ke Kiri"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollAvatars("right")}
            className="absolute right-1 top-1/2 z-30 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/55 text-slate-200 shadow-lg backdrop-blur-md transition hover:border-blue-400/50 hover:bg-blue-600 hover:text-white active:scale-95 cursor-pointer"
            title="Geser Host ke Kanan"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      <div
        ref={carouselRef}
        className={`flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden scroll-smooth px-0.5 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          slotCount <= 2 ? "" : "snap-x snap-mandatory"
        }`}
      >
        {filteredAvatars.map((av) => {
          const isSelected = selectedAvatar.id === av.id;
          return (
            <button
              key={av.id || av.name}
              type="button"
              onClick={() => {
                setSelectedAvatar(av);
                if (av.voice) setSelectedVoice(av.voice);
                showToast(`Avatar dipilih: ${av.name} (${av.role})`);
              }}
              className={`group/card relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl text-left transition duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 snap-start ${
                slotCount <= 2 ? "w-1/2 min-w-0 flex-1" : "w-[46%] min-w-[11rem] shrink-0"
              } ${
                isSelected
                  ? "border border-blue-400/70 bg-[#0a1224] shadow-[0_12px_40px_-12px_rgba(37,99,235,0.55)] ring-1 ring-blue-500/40"
                  : "border border-[#2a3348] bg-[#0a101c] hover:border-slate-500 hover:bg-[#0d1524]"
              }`}
            >
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                  className="absolute inset-0 scale-[1.12] bg-cover bg-no-repeat transition duration-500 group-hover/card:scale-[1.16]"
                  style={{
                    backgroundImage: `url('${av.image}')`,
                    backgroundPosition: "center 40%",
                  }}
                />
                <div className="absolute inset-0 bg-linear-to-t  from-[#060a14] via-[#060a14]/20 to-transparent" />
                <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
                 
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                      isSelected
                        ? "border-blue-300 bg-blue-500 text-white"
                        : "border-white/15 bg-black/35 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>

              <div className="relative z-10 shrink-0 space-y-1 border-t border-white/5 bg-[#080e1a]/95 rounded-b-2xl px-3 py-3 backdrop-blur-sm">
                <p className="truncate text-[15px] font-bold tracking-tight text-white">
                  {av.name}
                </p>
                {isSelected && (
                  <p className="pt-0.5 text-[10px] font-semibold text-emerald-400">
                    Dipilih untuk live
                  </p>
                )}
              </div>
            </button>
          );
        })}

        <div
          className={`relative flex h-full min-h-[280px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[#3a455c] bg-[linear-gradient(160deg,#0b1220_0%,#111a2d_55%,#0c1424_100%)] px-4 text-center snap-start ${
            slotCount <= 2 ? "w-1/2 min-w-0 flex-1" : "w-[46%] min-w-[11rem] shrink-0"
          }`}
          title="Coming Soon"
        >
          <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_50%_30%,rgba(59,130,246,0.18),transparent_55%)]" />
          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/70 shadow-inner">
            <UserRound className="h-6 w-6 text-slate-400" />
          </div>
          <p className="relative text-sm font-bold text-slate-200">Coming Soon</p>
          <p className="relative mt-1 max-w-[10rem] text-[11px] leading-snug text-slate-500">
            Host AI Baru Akan Segera Hadir
          </p>
        </div>
      </div>
    </div>
  );
};
