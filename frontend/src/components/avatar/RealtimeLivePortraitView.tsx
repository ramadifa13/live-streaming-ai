"use client";

import React, { useEffect, useRef } from "react";

interface RealtimeLivePortraitViewProps {
  avatarName?: string;
  avatarImage?: string;
  avatarRole?: string;
  isSpeaking?: boolean;
  videoUrl?: string;
  onVideoEnded?: () => void;
  mode?: "live" | "video_ads";
  soundOn?: boolean;
  className?: string;
}

export default function RealtimeLivePortraitView({
  avatarName = "Namira",
  avatarImage,
  isSpeaking = false,
  videoUrl,
  onVideoEnded,
  mode = "live",
  soundOn = false,
  className = "",
}: RealtimeLivePortraitViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const resolvedFillerSrc = "/avatars/namira.mp4";

  const resolvedImageSrc =
    mode === "video_ads"
      ? "/avatars/namira.png"
      : avatarImage || "/avatars/namira.png";

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
    <div
      className={`relative w-full h-full overflow-hidden bg-[#07050f] select-none ${className}`}
    >
      {/* ── Visual Output (Video Lipsync or Continuous Idle Video) ── */}
      {videoUrl ? (
        <video
          key={videoUrl} // Force remount when URL changes (new lip-sync video)
          ref={videoRef}
          src={videoUrl}
          autoPlay
          playsInline
          muted={!soundOn}
          onEnded={onVideoEnded}
          className="w-full h-full object-cover"
        />
      ) : (
        // CONTINUOUS IDLE & FILLER VIDEO: Selalu memutar video avatar dinamis secara mulus
        <video
          key={`idle-${avatarName}`}
          src={resolvedFillerSrc}
          autoPlay
          loop
          playsInline
          muted
          poster={resolvedImageSrc}
          className="w-full h-full object-cover"
        />
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
