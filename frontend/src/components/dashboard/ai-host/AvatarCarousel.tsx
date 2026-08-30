"use client";

import React, { useRef } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
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

  const scrollAvatars = (direction: "left" | "right") => {
    if (carouselRef.current) {
      const scrollAmount = 140;
      carouselRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="relative mb-3.5 group">
      {filteredAvatars.length > 3 && (
        <button
          type="button"
          onClick={() => scrollAvatars("left")}
          className="absolute -left-2 top-1/2 -translate-y-1/2 z-30 h-7 w-7 rounded-full bg-[#0c1221]/95 border border-blue-500/50 text-blue-300 flex items-center justify-center hover:bg-blue-600 hover:text-white transition shadow-xl backdrop-blur-sm active:scale-90 cursor-pointer"
          title="Geser Host ke Kiri"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      <div
        ref={carouselRef}
        className="flex gap-2 overflow-x-hidden scroll-smooth py-1 px-0.5"
      >
        {filteredAvatars.map((av) => {
          const isSelected = selectedAvatar.id === av.id;
          return (
            <div
              key={av.id || av.name}
              onClick={() => {
                setSelectedAvatar(av);
                if (av.voice) setSelectedVoice(av.voice);
                showToast(`Avatar dipilih: ${av.name} (${av.role})`);
              }}
              className={`group/card relative h-[155px] w-[calc(33.333%-6px)] min-w-[95px] flex-shrink-0 overflow-hidden rounded-xl cursor-pointer transition-all duration-300 transform hover:-translate-y-1 ${
                isSelected
                  ? "border-2 border-blue-500 shadow-[0_0_18px_rgba(59,130,246,0.4)] ring-2 ring-blue-500/30"
                  : "border border-[#232c42] opacity-80 hover:opacity-100 hover:border-slate-600"
              }`}
            >
              {isSelected && (
                <div className="absolute top-1.5 right-1.5 z-20 rounded-full bg-blue-600 p-0.5 text-white shadow">
                  <Check className="w-2.5 h-2.5" />
                </div>
              )}
              <div className="absolute top-1.5 left-1.5 z-20 rounded bg-black/70 px-1 py-0.2 text-[7.5px] font-extrabold text-blue-300 backdrop-blur-sm border border-white/10">
                {av.type}
              </div>
              <div
                className="absolute inset-0 bg-contain bg-bottom bg-no-repeat transition-transform duration-500 group-hover/card:scale-110"
                style={{ backgroundImage: `url('${av.image}')` }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent z-10 flex flex-col justify-end p-2">
                <p className="text-xs font-bold text-white line-clamp-1">
                  {av.name}
                </p>
                <p className="text-[8.5px] text-blue-300 font-medium line-clamp-1">
                  {av.role}
                </p>
                {av.specialty && (
                  <span className="text-[7px] text-slate-300 bg-white/10 px-1 py-0.2 rounded mt-0.5 truncate">
                    {av.specialty}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredAvatars.length > 3 && (
        <button
          type="button"
          onClick={() => scrollAvatars("right")}
          className="absolute -right-2 top-1/2 -translate-y-1/2 z-30 h-7 w-7 rounded-full bg-[#0c1221]/95 border border-blue-500/50 text-blue-300 flex items-center justify-center hover:bg-blue-600 hover:text-white transition shadow-xl backdrop-blur-sm active:scale-90 cursor-pointer"
          title="Geser Host ke Kanan"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
