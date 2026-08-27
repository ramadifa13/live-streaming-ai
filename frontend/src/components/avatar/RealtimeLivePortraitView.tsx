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
  isLiveActive?: boolean;
  workerState?: "ready" | "warming" | "error";
  workerError?: string;
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
  isLiveActive = false,
  workerState,
  workerError,
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

  const isGpuLive = mode === "live" && isLiveActive && !!videoUrl;

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


      {/* ── WORKER STATE OVERLAY (Cold Start / Error) ── */}
      {workerState === "warming" && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="mt-4 text-sm font-bold text-blue-400">AI Worker Sedang Cold Start...</p>
          <p className="text-xs text-slate-300">Mohon tunggu 1-2 menit untuk inisialisasi GPU.</p>
        </div>
      )}
      {workerState === "error" && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-500">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <p className="mt-4 text-sm font-bold text-red-400">Koneksi AI Worker Gagal</p>
          <p className="text-xs text-slate-300 max-w-[80%] text-center">{workerError || "Periksa log backend atau RunPod."}</p>
        </div>
      )}

      {/* ── VIGNETTE OVERLAY (premium depth) ── */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#07050f]/70 via-transparent to-black/30 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/20 pointer-events-none" />

      {/* ── GPU LIVE BADGE (top-right) ── */}
      {isGpuLive && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/40 backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="text-[9px] font-black text-emerald-300 uppercase tracking-widest">
            GPU Live
          </span>
        </div>
      )}

      {/* ── LIVE WATERMARK (top-left, only when truly live) ── */}
      {isLiveActive && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 border border-red-400/50 backdrop-blur-md shadow-[0_0_20px_rgba(239,68,68,0.4)]">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-ping shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
          <span className="text-[9px] font-black text-red-300 uppercase tracking-widest">
            Live
          </span>
        </div>
      )}

      {/* ── SPEAKING WAVEFORM OVERLAY (Floating safely above bottom e-commerce card) ── */}
      {isSpeaking && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-full bg-[#0c1024]/90 backdrop-blur-xl border border-purple-500/50 shadow-[0_0_30px_rgba(124,58,237,0.5)] animate-fadeIn">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
          <div className="flex items-center gap-0.5 h-4">
            <span className="w-1 bg-purple-400 rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-2 shadow-[0_0_6px_rgba(168,85,247,0.6)]" />
            <span className="w-1 bg-purple-300 rounded-full animate-[pulse_0.3s_ease-in-out_infinite_0.1s] h-4 shadow-[0_0_6px_rgba(192,132,252,0.6)]" />
            <span className="w-1 bg-purple-400 rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.2s] h-3 shadow-[0_0_6px_rgba(168,85,247,0.6)]" />
            <span className="w-1 bg-purple-300 rounded-full animate-[pulse_0.35s_ease-in-out_infinite_0.3s] h-4 shadow-[0_0_6px_rgba(192,132,252,0.6)]" />
          </div>
          <span className="text-[10px] font-bold text-white tracking-wide drop-shadow-lg">
            {avatarName} sedang berbicara...
          </span>
        </div>
      )}
    </div>
  );
}
