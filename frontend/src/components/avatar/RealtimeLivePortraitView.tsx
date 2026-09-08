"use client";

import React, { useEffect, useRef, useState } from "react";

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
  className?: string;
  backgroundImage?: string;
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
  className = "",
  backgroundImage,
}: RealtimeLivePortraitViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundRef = useRef<HTMLImageElement | null>(null);
  const backgroundPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const [canvasAvailable, setCanvasAvailable] = useState(true);

  const resolvedFillerSrc = "/avatars/namira_idle.mp4";

  const resolvedImageSrc = mode === "video_ads" ? "/avatars/namira.png" : avatarImage || "/avatars/namira.png";

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      if (/^https?:\/\//i.test(videoUrl || resolvedFillerSrc)) {
        video.crossOrigin = "anonymous";
      }
      video.muted = videoUrl ? !soundOn : true;
      video.playsInline = true;
      const targetSrc = videoUrl || resolvedFillerSrc;
      if (video.src !== targetSrc && !video.src.endsWith(targetSrc)) {
        video.src = targetSrc;
        video.load();
      }
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    }
  }, [videoUrl, soundOn, resolvedFillerSrc]);

  useEffect(() => {
    if (!backgroundImage) {
      backgroundRef.current = null;
      return;
    }
    const image = new Image();
    image.onload = () => {
      backgroundRef.current = image;
      backgroundPixelsRef.current = null;
      setCanvasAvailable(true);
    };
    image.src = backgroundImage;
  }, [backgroundImage]);

  useEffect(() => {
    if (!backgroundImage || !canvasAvailable) return;
    let frameId = 0;
    let lastProcessedAt = 0;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const width = 360;
    const height = 640;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    const backgroundCanvas = backgroundCanvasRef.current || document.createElement("canvas");
    backgroundCanvas.width = width;
    backgroundCanvas.height = height;
    backgroundCanvasRef.current = backgroundCanvas;
    const backgroundContext = backgroundCanvas.getContext("2d");
    const targetFrameInterval = 1000 / 15;

    const draw = () => {
      const now = performance.now();
      if (now - lastProcessedAt < targetFrameInterval) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        frameId = requestAnimationFrame(draw);
        return;
      }
      lastProcessedAt = now;
      try {
        context.drawImage(video, 0, 0, width, height);
        const background = backgroundRef.current;
        if (
          backgroundPixelsRef.current === null &&
          background?.complete &&
          background.naturalWidth > 0 &&
          backgroundContext
        ) {
          backgroundContext.clearRect(0, 0, width, height);
          const scale = Math.max(width / background.naturalWidth, height / background.naturalHeight);
          const drawWidth = background.naturalWidth * scale;
          const drawHeight = background.naturalHeight * scale;
          backgroundContext.drawImage(
            background,
            (width - drawWidth) / 2,
            (height - drawHeight) / 2,
            drawWidth,
            drawHeight,
          );
          backgroundPixelsRef.current = backgroundContext.getImageData(0, 0, width, height).data;
        }
        if (backgroundPixelsRef.current) {
          const replacement = backgroundPixelsRef.current;
          const pixels = context.getImageData(0, 0, width, height);
          for (let index = 0; index < width * height; index += 1) {
            const pixelOffset = index * 4;
            const red = pixels.data[pixelOffset];
            const green = pixels.data[pixelOffset + 1];
            const blue = pixels.data[pixelOffset + 2];
            const greenDominance = green - Math.max(red, blue);
            const chromaDistance = Math.abs(green - red) + Math.abs(green - blue);
            const keyStrength = Math.max(0, Math.min(1, (greenDominance - 18) / 55 + (chromaDistance - 35) / 120));
            const alpha = 1 - Math.pow(keyStrength, 0.8);
            pixels.data[pixelOffset] = pixels.data[pixelOffset] * alpha + replacement[pixelOffset] * (1 - alpha);
            pixels.data[pixelOffset + 1] =
              pixels.data[pixelOffset + 1] * alpha + replacement[pixelOffset + 1] * (1 - alpha);
            pixels.data[pixelOffset + 2] =
              pixels.data[pixelOffset + 2] * alpha + replacement[pixelOffset + 2] * (1 - alpha);
          }
          context.putImageData(pixels, 0, 0);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "SecurityError") {
          setCanvasAvailable(false);
          return;
        }
        console.warn("Local background segmentation failed", error);
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frameId);
  }, [backgroundImage, canvasAvailable]);

  const isGpuLive = mode === "live" && isLiveActive && !!videoUrl;

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#07050f] select-none ${className}`}>
      {/* Dynamic Background */}
      {backgroundImage && (
        <div
          className="absolute inset-0 bg-cover bg-center pointer-events-none"
          style={{ backgroundImage: `url('${backgroundImage}')` }}
        />
      )}

      <video
        ref={videoRef}
        src={videoUrl || resolvedFillerSrc}
        autoPlay
        loop={!videoUrl}
        playsInline
        muted={videoUrl ? !soundOn : true}
        poster={resolvedImageSrc}
        onEnded={onVideoEnded}
        className={`w-full h-full object-cover transition-opacity duration-300 relative z-10 ${
          backgroundImage && canvasAvailable ? "opacity-0 pointer-events-none" : ""
        }`}
      />

      {backgroundImage && canvasAvailable && (
        <canvas
          ref={canvasRef}
          aria-label="Preview avatar dengan background terpilih"
          className="absolute inset-0 z-10 h-full w-full object-cover"
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-[#07050f]/70 via-transparent to-black/30 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/20 pointer-events-none" />

      {isGpuLive && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/40 backdrop-blur-md shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="text-[9px] font-black text-emerald-300 uppercase tracking-widest">GPU Live</span>
        </div>
      )}

      {isLiveActive && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 border border-red-400/50 backdrop-blur-md shadow-[0_0_20px_rgba(239,68,68,0.4)]">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-ping shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
          <span className="text-[9px] font-black text-red-300 uppercase tracking-widest">Live</span>
        </div>
      )}

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
