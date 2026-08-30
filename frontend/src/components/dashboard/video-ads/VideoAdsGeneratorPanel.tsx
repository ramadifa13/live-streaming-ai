"use client";

import React from "react";
import Image from "next/image";
import { Sparkles, Play, Zap, Download } from "lucide-react";
import RealtimeLivePortraitView from "@/components/avatar/RealtimeLivePortraitView";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

const TIERS = [
  {
    tier: "15s" as const,
    name: "Short Hook",
    desc: "High-Impact Script + Subtitle",
    price: "Rp19.000",
    modal: "~Rp200",
    margin: "98.9%",
    badge: "⚡ Viral Hook",
  },
  {
    tier: "30s" as const,
    name: "Standard Showcase",
    desc: "Full Benefit Breakdown + CTA",
    price: "Rp35.000",
    modal: "~Rp350",
    margin: "99.0%",
    badge: "POPULAR",
  },
  {
    tier: "60s" as const,
    name: "Deep Review",
    desc: "Unboxing & Storytelling Script",
    price: "Rp59.000",
    modal: "~Rp600",
    margin: "98.9%",
    badge: "🎬 Full Review",
  },
];

export const VideoAdsGeneratorPanel: React.FC = () => {
  const showToast = useDashboardUIStore((state) => state.showToast);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const isAvatarSpeaking = useAiHostStore((state) => state.isAvatarSpeaking);
  const currentLiveVideoUrl = useAiHostStore((state) => state.currentLiveVideoUrl);
  const videoDuration = useAiHostStore((state) => state.videoDuration);
  const setVideoDuration = useAiHostStore((state) => state.setVideoDuration);
  const videoScript = useAiHostStore((state) => state.videoScript);
  const setVideoScript = useAiHostStore((state) => state.setVideoScript);
  const isGeneratingScript = useAiHostStore((state) => state.isGeneratingScript);
  const isRenderingVideo = useAiHostStore((state) => state.isRenderingVideo);
  const renderProgress = useAiHostStore((state) => state.renderProgress);
  const hasRenderedVideo = useAiHostStore((state) => state.hasRenderedVideo);
  const speakText = useAiHostStore((state) => state.speakText);
  const fetchVideoScript = useAiHostStore((state) => state.fetchVideoScript);
  const renderVideo = useAiHostStore((state) => state.renderVideo);

  const products = useProductStore((state) => state.products);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);

  const handleSelectTier = (tier: "15s" | "30s" | "60s") => {
    setVideoDuration(tier);
    fetchVideoScript(activeFeaturedProduct, tier);
  };

  const handlePlayAudio = () => {
    const full = `${videoScript.hook} ${videoScript.problem} ${videoScript.solution} ${videoScript.cta}`;
    speakText(full, { tone: "Energetic" });
  };

  const handleRenderVideoAds = async () => {
    const tierPrices = {
      "15s": "Rp19.000 (Short Hook)",
      "30s": "Rp35.000 (Standard Showcase)",
      "60s": "Rp59.000 (Deep Review)",
    };
    showToast(`⚡ Memulai render video iklan AI ${tierPrices[videoDuration]}...`);
    try {
      await renderVideo(activeFeaturedProduct);
    } catch {
      showToast("❌ Gagal render video iklan");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_0.8fr] gap-4 animate-fadeIn pb-6">
      {/* LEFT COLUMN */}
      <div className="space-y-4">
        {/* Card 1: Pricing Tiers & Duration */}
        <div className="rounded-2xl border border-purple-500/30 bg-[#0c1221] p-5 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400 text-sm font-bold border border-purple-500/30">
                1
              </span>
              <h3 className="text-base font-bold text-white">
                Pilih Paket Durasi Video Iklan
              </h3>
            </div>
            <span className="rounded bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Auto UGC Ads Format
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">
            Pilih format iklan video pendek yang siap diunggah ke TikTok Ads,
            Instagram Reels, dan YouTube Shorts.
          </p>

          {/* 3 Pricing Tiers Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {TIERS.map((tier) => (
              <div
                key={tier.tier}
                onClick={() => handleSelectTier(tier.tier)}
                className={`relative rounded-xl border p-3 cursor-pointer transition flex flex-col justify-between ${
                  videoDuration === tier.tier
                    ? "border-purple-500 bg-purple-950/40 ring-1 ring-purple-500/60 shadow-lg shadow-purple-900/30"
                    : "border-[#232c42] bg-[#111827] hover:border-slate-600"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-purple-400">
                      {tier.badge}
                    </span>
                    <span className="text-[9px] text-slate-500">
                      {tier.tier}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-white">{tier.name}</p>
                  <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">
                    {tier.desc}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-white/5 flex items-baseline justify-between">
                  <span className="text-sm font-black text-emerald-400">
                    {tier.price}
                  </span>
                  <span className="text-[8px] text-slate-500">
                    Margin: {tier.margin}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Product Selector */}
          <div className="pt-3 border-t border-[#232c42]">
            <p className="text-[11px] text-slate-400 mb-2 font-medium">
              Pilih Produk Promosi:
            </p>
            <div className="flex gap-2.5 overflow-x-auto pb-2">
              {products.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setActiveFeaturedProduct(p);
                    fetchVideoScript(p, videoDuration);
                    showToast(`Produk iklan: ${p.name}`);
                  }}
                  className={`flex items-center gap-2.5 rounded-xl border p-2 min-w-[200px] cursor-pointer transition ${
                    activeFeaturedProduct.id === p.id
                      ? "border-purple-500 bg-purple-950/40 ring-1 ring-purple-500/50"
                      : "border-[#232c42] bg-[#111827] hover:border-slate-600"
                  }`}
                >
                  <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden border border-white/10">
                    <Image
                      src={
                        p.image?.startsWith("http")
                          ? p.image
                          : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                      }
                      alt={p.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-white truncate">
                      {p.name}
                    </p>
                    <p className="text-[11px] font-black text-emerald-400">
                      {p.price}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: AI Copywriting Script Editor */}
        <div className="rounded-2xl border border-purple-500/30 bg-[#0c1221] p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-pink-500/20 text-pink-400 text-sm font-bold border border-pink-500/30">
                2
              </span>
              <h3 className="text-base font-bold text-white">
                Naskah Script Iklan (Gaya UGC Komersial)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => fetchVideoScript(activeFeaturedProduct)}
              disabled={isGeneratingScript}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-bold text-white hover:brightness-110 active:scale-95 transition cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isGeneratingScript
                  ? "⏳ Merancang Naskah..."
                  : "Generate Naskah Iklan Baru"}
              </span>
            </button>
          </div>

          <div className="space-y-3 text-xs">
            {/* Hook */}
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-950/20 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-yellow-400 uppercase tracking-wider">
                  ⚡ THE HOOK (Detik 01-05)
                </span>
                <span className="text-[9px] text-yellow-300/80 font-bold bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">
                  Wajib Menarik Perhatian
                </span>
              </div>
              <textarea
                rows={1}
                value={videoScript.hook}
                onChange={(e) =>
                  setVideoScript({ hook: e.target.value })
                }
                className="w-full bg-transparent text-yellow-100 outline-none resize-none font-bold leading-relaxed"
              />
            </div>

            {/* Problem & Solution */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3">
                <span className="block text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1">
                  🎯 PROBLEM / KELUHAN (Detik 06-15)
                </span>
                <textarea
                  rows={2}
                  value={videoScript.problem}
                  onChange={(e) =>
                    setVideoScript({ problem: e.target.value })
                  }
                  className="w-full bg-transparent text-slate-200 outline-none resize-none leading-relaxed"
                />
              </div>
              <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3">
                <span className="block text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-1">
                  ✨ KEUNGGULAN PRODUK (Detik 16-25)
                </span>
                <textarea
                  rows={2}
                  value={videoScript.solution}
                  onChange={(e) =>
                    setVideoScript({ solution: e.target.value })
                  }
                  className="w-full bg-transparent text-slate-200 outline-none resize-none leading-relaxed"
                />
              </div>
            </div>

            {/* CTA */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                  🛒 CALL TO ACTION / KERANJANG KUNING (Detik 26-30)
                </span>
                <span className="text-[9px] text-emerald-300 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">
                  Promo Urgensi
                </span>
              </div>
              <textarea
                rows={1}
                value={videoScript.cta}
                onChange={(e) =>
                  setVideoScript({ cta: e.target.value })
                }
                className="w-full bg-transparent text-emerald-200 outline-none resize-none font-bold leading-relaxed"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#232c42]">
            <button
              type="button"
              onClick={handlePlayAudio}
              className="flex items-center gap-2 rounded-lg border border-[#232c42] bg-[#111827] px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/5 active:scale-95 transition cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Putar Audio Iklan (UGC Ads Voice)</span>
            </button>

            <button
              type="button"
              onClick={handleRenderVideoAds}
              disabled={isRenderingVideo}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 px-6 py-2.5 text-xs font-black text-white shadow-xl shadow-purple-600/30 hover:brightness-110 active:scale-95 transition cursor-pointer disabled:opacity-70"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>
                {isRenderingVideo
                  ? `⏳ Rendering Video (${renderProgress}%)...`
                  : `Render Video Iklan (${videoDuration === "15s" ? "Rp19.000" : videoDuration === "30s" ? "Rp35.000" : "Rp59.000"})`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Video Phone Preview Player */}
      <div className="flex flex-col items-center justify-start mt-2">
        <div className="w-full max-w-[280px] rounded-[36px] border-4 border-[#1e293b] bg-black p-2.5 shadow-2xl relative overflow-hidden">
          {/* Phone Notch */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 h-3.5 w-24 bg-[#1e293b] rounded-full z-40" />

          {/* Video Canvas 9:16 */}
          <div className="relative aspect-[9/16] w-full rounded-[26px] overflow-hidden bg-gradient-to-b from-[#141226] to-[#0a0714] border border-white/10 flex flex-col justify-between p-3.5">
            <RealtimeLivePortraitView
              avatarName={selectedAvatar.name}
              avatarImage={selectedAvatar.image}
              avatarRole={selectedAvatar.role}
              isSpeaking={isAvatarSpeaking}
              videoUrl={currentLiveVideoUrl || undefined}
              mode="video_ads"
              className="absolute inset-0 w-full h-full"
            />

            {/* TOP COMMERCIAL AD STICKER */}
            <div className="relative z-20 space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-red-600/90 px-2.5 py-0.5 text-[8.5px] font-black text-white backdrop-blur-md shadow-lg border border-red-400/40 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                  SPONSORED ADS
                </span>
                <span className="rounded-full bg-black/60 px-2 py-0.5 text-[8.5px] font-mono text-slate-300 backdrop-blur-md">
                  00:{videoDuration.replace("s", "")}
                </span>
              </div>

              {/* Viral Headline Sticker */}
              <div className="rounded-lg bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500 px-3 py-1 text-black font-black text-[10px] text-center shadow-lg transform -rotate-1 border border-yellow-200">
                🔥 RACUN TIKTOK VIRAL! JANGAN DI-SKIP!
              </div>
            </div>

            {/* BOTTOM COMMERCIAL AD OVERLAYS */}
            <div className="relative z-20 space-y-2 mt-auto">
              <div className="rounded-xl bg-black/80 p-2.5 backdrop-blur-md border border-yellow-400/30 text-center shadow-xl animate-fadeIn">
                <p className="text-[10px] font-black text-yellow-300 leading-snug">
                  &ldquo;{videoScript.hook}&rdquo;
                </p>
              </div>

              <div
                className="rounded-2xl p-2.5 backdrop-blur-md shadow-2xl"
                style={{
                  background: "rgba(8,6,24,0.92)",
                  border: "1px solid rgba(251,191,36,0.35)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[8px] font-black uppercase tracking-widest text-yellow-400 flex items-center gap-1">
                    <span>🛒</span> Keranjang Kuning
                  </span>
                  <span className="rounded bg-red-500 text-[7px] font-black text-white px-1.5 py-0.5">
                    HEMAT 35%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative shrink-0 w-11 h-11 rounded-xl overflow-hidden bg-slate-800 border-2 border-yellow-400/50">
                    <Image
                      src={
                        activeFeaturedProduct.image?.startsWith("http")
                          ? activeFeaturedProduct.image
                          : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                      }
                      alt={activeFeaturedProduct.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold text-white truncate">
                      {activeFeaturedProduct.name}
                    </p>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-[11px] font-black text-emerald-400">
                        {activeFeaturedProduct.price}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="shrink-0 rounded-xl text-[9px] font-black text-black shadow-lg hover:brightness-110 animate-pulse bg-gradient-to-r from-yellow-400 to-amber-500 px-2 py-1.5"
                  >
                    Beli Sekarang
                  </button>
                </div>
              </div>
            </div>

            {/* Rendering Progress Overlay */}
            {isRenderingVideo && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6 backdrop-blur-sm animate-fadeIn text-center">
                <div className="h-12 w-12 rounded-full border-4 border-purple-500/30 border-t-purple-500 animate-spin mb-3" />
                <p className="text-sm font-black text-white mb-1">
                  Rendering Video Iklan AI...
                </p>
                <div className="w-full bg-[#1e293b] rounded-full h-2 overflow-hidden border border-white/10 mt-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>
                <p className="text-[10px] font-mono text-purple-300 mt-1 font-bold">
                  {renderProgress}% Selesai
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Download CTA Button */}
        {hasRenderedVideo && (
          <div className="mt-4 w-full max-w-[340px] animate-bounce">
            <a
              href={currentLiveVideoUrl || "/sample-promo.mp4"}
              download={`LiveStreamerAI_${activeFeaturedProduct.name.replace(/[^a-zA-Z0-9]/g, "_")}_${videoDuration}.mp4`}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-xs font-black text-white shadow-xl shadow-emerald-600/30 hover:brightness-110 active:scale-95 transition"
            >
              <Download className="w-4 h-4" />
              <span>Download Video Iklan Siap Upload (MP4 9:16)</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
