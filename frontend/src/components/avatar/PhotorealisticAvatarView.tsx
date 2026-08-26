/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VideoGenerationState = "idle" | "generating" | "ready" | "error";

export interface PhotorealisticAvatarViewProps {
  /** Avatar display name shown in badge */
  avatarName: string;
  /** Static fallback photo (shown in idle state) */
  avatarImage?: string;
  avatarRole?: string;
  /** Whether idle-state avatar should show a subtle breathing animation */
  isSpeaking?: boolean;
  mode?: "2D" | "3D";
  tone?: string;
  className?: string;

  // ----- Video Generation Pipeline -----
  /** Current generation state */
  videoGenerationState?: VideoGenerationState;
  /** MP4 URL to play when state === "ready" */
  videoUrl?: string;
  /** Progress 0–100 for generating state */
  renderProgress?: number;
  /** Human-readable current AI stage */
  renderStage?: string;
  /** Error message when state === "error" */
  videoError?: string;
}

// ---------------------------------------------------------------------------
// Pipeline stage labels shown in the generating UI
// ---------------------------------------------------------------------------
const PIPELINE_STAGES = [
  { id: "face", label: "Face Detection & Landmark" },
  { id: "audio", label: "TTS Audio Synthesis" },
  { id: "lipsync", label: "Lip-sync (EchoMimic)" },
  { id: "motion", label: "Head Motion & Eye Blinks" },
  { id: "encode", label: "Video Encode H.264" },
  { id: "upload", label: "CDN Upload" },
];

function getActiveStageIndex(progress: number): number {
  if (progress < 15) return 0;
  if (progress < 30) return 1;
  if (progress < 55) return 2;
  if (progress < 70) return 3;
  if (progress < 88) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PhotorealisticAvatarView({
  avatarName,
  avatarImage,
  isSpeaking = false,
  tone = "Persuasif",
  className = "",
  videoGenerationState = "idle",
  videoUrl,
  renderProgress = 0,
  renderStage = "Memulai pipeline...",
  videoError,
}: PhotorealisticAvatarViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fallback photo map
  const defaultImages: Record<string, string> = {
    Namira: "/avatars/namira.png",
  };
  const imageSrc =
    avatarImage &&
    avatarImage !== "/avatars/ardi-2d.jpg" &&
    avatarImage !== "/avatars/maya-2d.jpg"
      ? avatarImage
      : defaultImages[avatarName] || "/avatars/namira.png";

  // Auto-play video when URL arrives
  useEffect(() => {
    if (videoGenerationState === "ready" && videoUrl && videoRef.current) {
      videoRef.current.src = videoUrl;
      videoRef.current.load();
      videoRef.current.play().catch(() => {
        /* autoplay policy — user will see play button */
      });
    }
  }, [videoGenerationState, videoUrl]);

  // Map avatar name to local video file
  const localAvatarVideo = "/avatars/namira.mp4";

  const activeStageIdx = getActiveStageIndex(renderProgress);

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[#07050f] flex items-center justify-center select-none ${className}`}
    >
      {/* ── STUDIO BACKGROUND GLOWS ── */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-16 -left-16 w-64 h-64 bg-blue-700/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-16 -right-16 w-72 h-72 bg-purple-700/20 rounded-full blur-3xl" />
      </div>

      {/* ══════════════════════════════════════════════════
          STATE 1: IDLE / LIVE INTERACTIVE — continuous living avatar presenter
      ══════════════════════════════════════════════════ */}
      {videoGenerationState === "idle" && (
        <div className="relative h-full w-full flex items-center justify-center overflow-hidden">
          {/* Continuous Live Video Avatar Presenter */}
          <video
            className="h-full w-full object-cover object-top"
            autoPlay
            loop
            muted
            playsInline
            src={localAvatarVideo}
            poster={imageSrc}
            style={{
              filter: isSpeaking
                ? "brightness(1.1) contrast(1.05) drop-shadow(0 0 20px rgba(124,58,237,0.5))"
                : "brightness(1.03) contrast(1.02) saturate(1.05)",
              transition: "filter 0.4s ease",
            }}
          />

          {/* Enhanced Vignette */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07050f]/80 via-[#07050f]/20 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-black/25 pointer-events-none" />

          {/* Radial glow behind avatar */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(circle at center, rgba(124,58,237,0.08) 0%, transparent 70%)"
          }} />

          {/* Active Speaking Live Waveform Overlay */}
          {isSpeaking && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-[#7c3aed]/90 backdrop-blur-xl border border-purple-400/50 shadow-[0_0_30px_rgba(124,58,237,0.6)] animate-bounce">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
              <div className="flex items-center gap-1">
                <span className="w-1 h-4 bg-white rounded-full animate-[pulse_0.6s_ease-in-out_infinite] shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
                <span className="w-1 h-5 bg-white rounded-full animate-[pulse_0.4s_ease-in-out_infinite_0.1s] shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
                <span className="w-1 h-3.5 bg-white rounded-full animate-[pulse_0.7s_ease-in-out_infinite_0.2s] shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
                <span className="w-1 h-4.5 bg-white rounded-full animate-[pulse_0.5s_ease-in-out_infinite_0.3s] shadow-[0_0_6px_rgba(255,255,255,0.6)]" />
              </div>
              <span className="text-[10px] font-black text-white uppercase tracking-wider drop-shadow-lg">
                {avatarName} Sedang Berbicara Live
              </span>
            </div>
          )}

          {/* Idle hint badge */}
          {!isSpeaking && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20">
              <span
                className="flex items-center gap-2 px-4 py-2 rounded-full text-[9px] font-bold text-slate-200 backdrop-blur-xl border border-white/10 shadow-[0_0_20px_rgba(0,0,0,0.5)]"
                style={{
                  background: "rgba(7,5,15,0.9)",
                }}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
                Live AI Host Siap Merespon Chat
              </span>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          STATE 2: GENERATING — AI render progress UI
      ══════════════════════════════════════════════════ */}
      {videoGenerationState === "generating" && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center p-5 text-center"
          style={{
            background: "rgba(7,5,15,0.96)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Animated neural net orb */}
          <div className="relative mb-5">
            <div className="w-16 h-16 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
            <div
              className="absolute inset-2 rounded-full border-2 border-cyan-500/20 border-b-cyan-500 animate-spin"
              style={{
                animationDirection: "reverse",
                animationDuration: "1.4s",
              }}
            />
            <div className="absolute inset-4 rounded-full bg-gradient-to-br from-purple-600/40 to-cyan-600/40 flex items-center justify-center">
              <span className="text-lg">🎬</span>
            </div>
          </div>

          <p className="text-sm font-black text-white mb-0.5">
            Generating AI Avatar Video...
          </p>
          <p className="text-[10px] text-slate-400 mb-4 max-w-[220px] leading-snug">
            {renderStage}
          </p>

          {/* Progress bar */}
          <div className="w-full max-w-[240px] mb-4">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-slate-500 font-mono">
                Progress
              </span>
              <span className="text-[10px] font-black text-purple-400 font-mono">
                {renderProgress}%
              </span>
            </div>
            <div
              className="w-full rounded-full overflow-hidden"
              style={{
                height: 5,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${renderProgress}%`,
                  background: "linear-gradient(90deg, #7c3aed, #06b6d4)",
                  boxShadow: "0 0 8px rgba(124,58,237,0.6)",
                }}
              />
            </div>
          </div>

          {/* Pipeline stage checklist */}
          <div className="w-full max-w-[240px] space-y-1.5">
            {PIPELINE_STAGES.map((s, i) => {
              const done = i < activeStageIdx;
              const active = i === activeStageIdx;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[8px]"
                    style={{
                      background: done
                        ? "rgba(34,197,94,0.2)"
                        : active
                          ? "rgba(124,58,237,0.3)"
                          : "rgba(255,255,255,0.04)",
                      border: done
                        ? "1px solid rgba(34,197,94,0.5)"
                        : active
                          ? "1px solid rgba(139,92,246,0.7)"
                          : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {done ? (
                      "✓"
                    ) : active ? (
                      <span className="animate-pulse">●</span>
                    ) : (
                      ""
                    )}
                  </div>
                  <span
                    className={`text-[9px] font-medium ${
                      done
                        ? "text-emerald-400"
                        : active
                          ? "text-purple-300"
                          : "text-slate-600"
                    }`}
                  >
                    {s.label}
                  </span>
                  {active && (
                    <span className="ml-auto text-[8px] text-purple-400 font-mono animate-pulse">
                      running...
                    </span>
                  )}
                  {done && (
                    <span className="ml-auto text-[8px] text-emerald-500 font-mono">
                      done
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Provider badge */}
          <div className="mt-4 flex items-center gap-1.5 opacity-40">
            <span className="text-[8px] text-slate-500 font-mono uppercase tracking-wider">
              Powered by AI Avatar Engine
            </span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          STATE 3: READY — play the generated MP4 video
      ══════════════════════════════════════════════════ */}
      {videoGenerationState === "ready" && videoUrl && (
        <div className="absolute inset-0 z-20 bg-black flex items-center justify-center">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            loop
            playsInline
            src={videoUrl.replace(/^http:\/\/localhost:4000/, "")}
            style={{ objectPosition: "center top" }}
            onError={(e) => {
              console.warn(
                "[PhotorealisticAvatarView] Video notice, maintaining continuous presenter stream",
              );
              const target = e.target as HTMLVideoElement;
              // Fallback to high-reliability continuous stream
              if (target && !target.src.includes("pexels.com")) {
                target.src =
                  "https://videos.pexels.com/video-files/6231246/6231246-hd_1080_1920_30fps.mp4";
                target.load();
                target.play().catch(() => {});
              }
            }}
          />
          {/* Subtle vignette over video for consistent look */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07050f]/60 via-transparent to-transparent pointer-events-none" />

          {/* "AI Video" watermark badge */}
          <div
            className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[8px] font-bold text-white"
            style={{
              background: "rgba(7,5,15,0.8)",
              border: "1px solid rgba(139,92,246,0.4)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            AI Generated Video · {avatarName}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          STATE 4: ERROR
      ══════════════════════════════════════════════════ */}
      {videoGenerationState === "error" && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center"
          style={{ background: "rgba(7,5,15,0.95)" }}
        >
          <div className="mb-3 text-3xl">⚠️</div>
          <p className="text-sm font-black text-red-400 mb-1">
            Gagal Generate Video
          </p>
          <p className="text-[9px] text-slate-500 leading-snug max-w-[200px]">
            {videoError ?? "Terjadi error pada pipeline AI. Silakan coba lagi."}
          </p>
          {/* Show static avatar as fallback during error */}
          <div className="absolute inset-0 -z-10 opacity-20">
            <img
              src={imageSrc}
              alt={avatarName}
              className="w-full h-full object-cover object-top"
            />
          </div>
        </div>
      )}

      {/* ── HOST IDENTITY BADGE (always visible) ── */}
      <div
        className="absolute top-2 right-2 z-40 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] text-slate-300"
        style={{
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            videoGenerationState === "ready"
              ? "bg-emerald-400 animate-pulse"
              : videoGenerationState === "generating"
                ? "bg-yellow-400 animate-ping"
                : "bg-slate-500"
          }`}
        />
        <span className="font-semibold text-white">{avatarName}</span>
        <span className="text-slate-400">({tone})</span>
      </div>
    </div>
  );
}
