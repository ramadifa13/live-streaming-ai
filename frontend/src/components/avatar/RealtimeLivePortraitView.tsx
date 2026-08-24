/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useRef } from "react";

interface RealtimeLivePortraitViewProps {
  avatarName?: string;
  avatarImage?: string;
  avatarRole?: string;
  isSpeaking?: boolean;
  videoUrl?: string;
  mode?: "live" | "video_ads";
  soundOn?: boolean;
  className?: string;
}

export default function RealtimeLivePortraitView({
  avatarName = "Namira",
  avatarImage,
  isSpeaking = false,
  videoUrl,
  mode = "live",
  soundOn = false,
  className = "",
}: RealtimeLivePortraitViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const cleanUgcImages: Record<string, string> = {
    Namira: "/avatars/host_3d_dinamis_namira.png",
    Nana: "/avatars/host_2d_statis_nana.png",
    Ardi: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=720&h=1280&fit=crop&q=80",
    Maya: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=720&h=1280&fit=crop&q=80",
  };

  const defaultLiveImages: Record<string, string> = {
    Namira: "/avatars/host_3d_dinamis_namira.png",
    Nana: "/avatars/host_2d_statis_nana.png",
    Ardi: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&q=80",
    Maya: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&q=80",
  };

  const resolvedImageSrc = mode === "video_ads"
    ? (cleanUgcImages[avatarName] || avatarImage || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=720&h=1280&fit=crop&q=80")
    : ((avatarImage && avatarImage !== "/avatars/ardi-2d.jpg" && avatarImage !== "/avatars/maya-2d.jpg")
      ? avatarImage
      : defaultLiveImages[avatarName] || "/avatars/host_3d_dinamis_namira.png");

  // When videoUrl changes, safely play the video
  useEffect(() => {
    if (videoRef.current && videoUrl) {
      videoRef.current.muted = !soundOn;
      videoRef.current.playsInline = true;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    }
  }, [videoUrl, soundOn]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#07050f] select-none ${className}`}>
      {/* ── Visual Output (Video or Photo) ── */}
      {videoUrl ? (
        <video
          key={videoUrl}           // Force remount when URL changes (new lip-sync video)
          ref={videoRef}
          src={videoUrl}
          autoPlay
          playsInline
          muted={!soundOn}
          loop
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full relative">
          <img
            src={resolvedImageSrc}
            alt={avatarName}
            className={`w-full h-full object-cover transition-transform duration-700 ${
              isSpeaking ? "scale-105" : "scale-100"
            }`}
          />
          {/* Subtle studio ambient gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />
        </div>
      )}

      {/* ── SPEAKING WAVEFORM OVERLAY (Floating safely above bottom e-commerce card) ── */}
      {isSpeaking && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0c1024]/90 backdrop-blur-md border border-purple-500/50 shadow-[0_0_20px_rgba(124,58,237,0.5)] animate-fadeIn">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <div className="flex items-center gap-0.5 h-3.5">
            <span className="w-1 bg-purple-400 rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-2" />
            <span className="w-1 bg-purple-300 rounded-full animate-[pulse_0.3s_ease-in-out_infinite_0.1s] h-3.5" />
            <span className="w-1 bg-purple-400 rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.2s] h-2.5" />
            <span className="w-1 bg-purple-300 rounded-full animate-[pulse_0.35s_ease-in-out_infinite_0.3s] h-3.5" />
          </div>
          <span className="text-[9.5px] font-bold text-white tracking-wide">
            {avatarName} sedang berbicara...
          </span>
        </div>
      )}
    </div>
  );
}

