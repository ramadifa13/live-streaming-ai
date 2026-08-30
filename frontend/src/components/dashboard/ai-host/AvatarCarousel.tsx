"use client";

import React, { useRef } from "react";
import { Check, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
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
              <div
                className="absolute inset-0 bg-cover bg-top bg-no-repeat transition-transform duration-500 group-hover/card:scale-110"
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

       <div className="relative h-[155px] w-[calc(33.333%-6px)] min-w-[95px] flex-shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-slate-700 bg-gradient-to-br from-[#0c1221]/80 to-[#111827]/80 backdrop-blur-sm cursor-default group/soon transition-all duration-300 hover:border-blue-500/40 hover:shadow-[0_0_15px_rgba(59,130,246,0.1)]"  title="Coming Soon">
          <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
            <div className="relative mb-2.5">
              <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-md group-hover/soon:bg-blue-500/30 transition-all duration-500 animate-pulse" />
              
              <div className="relative h-12 w-12 rounded-full border border-slate-600/60 bg-slate-800/80 flex items-center justify-center backdrop-blur-md shadow-inner">
                <svg className="h-5 w-5 text-slate-400 group-hover/soon:text-blue-300 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <div className="absolute -top-1 -right-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                </div>
              </div>
            </div>
            
            <p className="text-xs font-bold bg-gradient-to-r from-slate-300 to-slate-500 bg-clip-text text-transparent group-hover/soon:from-blue-200 group-hover/soon:to-blue-400 transition-all duration-300">
              Coming Soon
            </p>
            <p className="text-[8.5px] text-amber-400/80 font-medium mt-0.5">
              AI Host Baru
            </p>
          </div>
        </div>
      
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
