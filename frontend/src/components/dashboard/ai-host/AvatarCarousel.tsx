"use client";

import React from "react";
import { Check, UserRound } from "lucide-react";
import { avatars } from "@/app/dashboard/constants";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

export const AvatarCarousel: React.FC = () => {
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const setSelectedAvatar = useAiHostStore((state) => state.setSelectedAvatar);
  const setSelectedVoice = useAiHostStore((state) => state.setSelectedVoice);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const filteredAvatars = avatars.filter((a) => a.type === "3D");

  return (
    <div className="flex min-h-0 flex-1 gap-2.5">
      {/* Preview host terpilih */}
      <div className="relative min-h-[160px] w-[42%] min-w-0 overflow-hidden rounded-xl border border-blue-400/40 bg-[#080e1a]">
        <div
          className="absolute inset-0 bg-cover bg-no-repeat"
          style={{
            backgroundImage: `url('${selectedAvatar.image}')`,
            backgroundPosition: "center 50%",
          }}
        />
        <div className="absolute inset-0 bg-linear-to-t from-[#060a14] via-[#060a14]/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 space-y-0.5 p-2.5">
          <p className="truncate text-[13px] font-bold text-white">
            {selectedAvatar.name}
          </p>
          <p className="truncate text-[9px] text-slate-300">
            {selectedAvatar.gender === "male" ? "Male" : "Female"} ·{" "}
            {selectedAvatar.role}
          </p>
        </div>
      </div>

      {/* Daftar pilihan host */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto [scrollbar-width:thin]">
        {filteredAvatars.map((av) => {
          const isSelected = selectedAvatar.id === av.id;
          return (
            <button
              key={av.id || av.name}
              type="button"
              onClick={() => {
                setSelectedAvatar(av);
                if (av.voice) setSelectedVoice(av.voice);
                showToast(
                  `Host: ${av.name} · ${av.gender === "male" ? "Male" : "Female"} voices`,
                );
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-2 py-1.5 text-left transition cursor-pointer ${
                isSelected
                  ? "border-blue-400/60 bg-blue-500/10 ring-1 ring-blue-500/25"
                  : "border-[#2a3348] bg-[#0a101c] hover:border-slate-500 hover:bg-[#0d1524]"
              }`}
            >
              <span
                className="h-11 w-11 shrink-0 rounded-lg bg-cover bg-center ring-1 ring-white/10"
                style={{
                  backgroundImage: `url('${av.image}')`,
                  backgroundPosition: "center 30%",
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold text-white">
                  {av.name}
                </span>
                <span className="block truncate text-[9px] text-slate-500">
                  {av.gender === "male" ? "Male" : "Female"} · {av.type}
                </span>
              </span>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  isSelected
                    ? "border-blue-300 bg-blue-500 text-white"
                    : "border-white/10 text-transparent"
                }`}
              >
                <Check className="h-3 w-3" />
              </span>
            </button>
          );
        })}

        <div className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-[#3a455c] bg-[#0a101c]/70 px-2 py-1.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-slate-500">
            <UserRound className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-bold text-slate-300">
              Coming Soon
            </span>
            <span className="block truncate text-[9px] text-slate-600">
              Host AI baru segera hadir
            </span>
          </span>
        </div>
      </div>
    </div>
  );
};
