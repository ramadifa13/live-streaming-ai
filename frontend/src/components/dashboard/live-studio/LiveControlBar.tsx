"use client";

import React, { useRef } from "react";
import Image from "next/image";
import {
  Radio,
  Pause,
  Play,
  RotateCw,
  Copy,
  Loader2,
  BookOpen,
  User,
  Clock,
  ShoppingBag,
  Tag,
} from "lucide-react";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useProductStore } from "@/stores/useProductStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { liveSessionService, toLiveProductSnapshot } from "@/services/liveSessionService";
import { oauthService } from "@/services/oauthService";
import { copyToClipboard } from "@/utils/clipboard";
import { formatTime } from "@/utils/formatters";
import { isValidRtmpUrl, normalizeRtmpInput } from "@/utils/rtmp";
import { LiveMetricsBar } from "@/components/dashboard/LiveMetricsBar";
import { ChatMessage } from "@/app/dashboard/types";

export const LiveControlBar: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);
  const showToast = useDashboardUIStore((state) => state.showToast);
  const setShowTutorialModal = useDashboardUIStore((state) => state.setShowTutorialModal);
  const setShowEndLiveConfirm = useDashboardUIStore((state) => state.setShowEndLiveConfirm);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const selectedTone = useAiHostStore((state) => state.selectedTone);

  const products = useProductStore((state) => state.products);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);

  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const isLivePaused = useLiveSessionStore((state) => state.isLivePaused);
  const setIsLivePaused = useLiveSessionStore((state) => state.setIsLivePaused);
  const isConnectingLive = useLiveSessionStore((state) => state.isConnectingLive);
  const liveSeconds = useLiveSessionStore((state) => state.liveSeconds);
  const selectedDuration = useLiveSessionStore((state) => state.selectedDuration);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const connectMode = useLiveSessionStore((state) => state.connectMode);
  const setConnectMode = useLiveSessionStore((state) => state.setConnectMode);
  const customRtmpUrl = useLiveSessionStore((state) => state.customRtmpUrl);
  const setCustomRtmpUrl = useLiveSessionStore((state) => state.setCustomRtmpUrl);
  const streamKey = useLiveSessionStore((state) => state.streamKey);
  const setStreamKey = useLiveSessionStore((state) => state.setStreamKey);
  const connectedAccount = useLiveSessionStore((state) => state.connectedAccount);
  const setConnectedAccount = useLiveSessionStore((state) => state.setConnectedAccount);
  const oauthConfigStatus = useLiveSessionStore((state) => state.oauthConfigStatus);
  const automations = useLiveSessionStore((state) => state.automations);
  const metrics = useLiveSessionStore((state) => state.metrics);
  const connectingStageText = useLiveSessionStore((state) => state.connectingStageText);
  const addChatMessage = useLiveSessionStore((state) => state.addChatMessage);
  const currentLiveSessionId = useLiveSessionStore((state) => state.currentLiveSessionId);

  const connectingAbortRef = useRef<AbortController | null>(null);

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) showToast(`${label} berhasil disalin ke clipboard!`);
  };

  const handleSwitchNextProduct = async () => {
    if (products.length === 0) return;
    const nextIdx = (products.findIndex((p) => p.id === activeFeaturedProduct.id) + 1) % products.length;
    const nextProd = products[nextIdx];
    if (!nextProd) return;
    setActiveFeaturedProduct(nextProd);
    showToast(`Produk aktif siaran diubah ke: ${nextProd.name}`);

    const switchMsg: ChatMessage = {
      id: String(Date.now()),
      sender: `AI Host (${selectedAvatar.name})`,
      isAi: true,
      avatarColor: "bg-[#4148e2]",
      text: `Sekarang kita beralih ke ${nextProd.name} ya kakak! Harganya spesial cuma ${nextProd.price}! Yuk langsung diamankan di keranjang kuning ya!`,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    addChatMessage(switchMsg);

    await liveSessionService.switchProduct(
      nextProd.id || "1",
      nextProd.name,
      toLiveProductSnapshot(nextProd, true),
      currentLiveSessionId || undefined,
    );
  };

  const handleStartLive = async () => {
    if (useLiveSessionStore.getState().isConnectingLive) return;
    if (!activeFeaturedProduct?.name || activeFeaturedProduct.id === "loading") {
      showToast("Tambah produk dulu (minimal nama + deskripsi) sebelum Go Live.");
      return;
    }
    if (!activeFeaturedProduct.description?.trim()) {
      showToast("Isi deskripsi produk dulu. Manfaat/cara pakai/FAQ bisa dilengkapi AI saat simpan.");
      return;
    }

    const attemptId = Date.now();
    const controller = new AbortController();
    const { rtmpUrl: normalizedUrl, streamKey: normalizedKey } = normalizeRtmpInput(
      customRtmpUrl !== ""
        ? customRtmpUrl
        : selectedPlatform.includes("Instagram")
          ? "rtmps://live-upload.instagram.com:443/rtmp/"
          : selectedPlatform.includes("YouTube")
            ? "rtmp://a.rtmp.youtube.com/live2"
            : selectedPlatform.includes("Shopee")
              ? "rtmp://live.shopee.co.id/live/"
              : selectedPlatform.includes("TikTok")
                ? "rtmp://live.tiktok.com/live/"
                : "rtmp://live.livestreamer.ai/live",
      streamKey,
    );

    if (!normalizedKey) {
      showToast(
        "Tempel Stream Key dari platform dulu. Di Instagram, key lama yang sudah putus tidak bisa dipakai ulang — buat siaran baru.",
      );
      return;
    }
    if (!isValidRtmpUrl(normalizedUrl)) {
      showToast("RTMP URL tidak valid. Harus diawali rtmp:// atau rtmps://");
      return;
    }
    if (normalizedUrl !== customRtmpUrl || normalizedKey !== streamKey) {
      setCustomRtmpUrl(normalizedUrl);
      setStreamKey(normalizedKey);
    }

    useLiveSessionStore.setState({
      isConnectingLive: true,
      hasConfirmedBroadcast: false,
      connectAttemptId: attemptId,
      connectAbortController: controller,
      pipelineStatus: null,
    });
    showToast(`Menghubungkan ke server ${selectedPlatform}... Memverifikasi RTMP Ingest Handshake...`);

    let createdSessionId: string | null = null;
    try {
      connectingAbortRef.current = controller;

      const sessionJson = await liveSessionService.startSession(
        {
          productId: activeFeaturedProduct.id || "1",
          avatarId: selectedAvatar.id || "1",
          platform: selectedPlatform,
          durationHours: selectedDuration,
          autoReply: automations.autoReply,
          autoPin: automations.autoPin,
          autoPromotion: automations.autoPromo,
          autoModeration: automations.autoModeration,
          avatarName: selectedAvatar.name,
          tone: selectedTone,
          accessToken: connectedAccount?.accessToken,
          liveChatId: connectedAccount?.liveChatId,
          liveVideoId: connectedAccount?.liveVideoId,
          product: toLiveProductSnapshot(activeFeaturedProduct, true),
          products: products.map((item) =>
            toLiveProductSnapshot(item, item.id === activeFeaturedProduct.id),
          ),
        },
        controller.signal,
      );

      const sessionId = sessionJson.data?.id;
      if (!sessionId) {
        throw new Error("Sesi live tidak dibuat oleh server");
      }
      createdSessionId = sessionId;

      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) {
        await liveSessionService.teardownSession(sessionId);
        return;
      }

      useLiveSessionStore.setState({
        currentLiveSessionId: sessionId,
        liveSessionPhase: "pending",
        connectingStageText: "Mengalokasikan Cloud GPU RTX 4090...",
      });

      await liveSessionService.waitForPodReady(sessionId, {
        signal: controller.signal,
        onProgress: (text) => {
          if (useLiveSessionStore.getState().connectAttemptId !== attemptId) return;
          useLiveSessionStore.setState({ connectingStageText: text });
        },
      });

      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) {
        await liveSessionService.teardownSession(sessionId);
        return;
      }

      useLiveSessionStore.setState({
        connectingStageText: "Menghubungkan RTMP ke platform...",
      });

      const bcastJson = await liveSessionService.startBroadcast(
        {
          rtmpUrl: normalizedUrl,
          streamKey: normalizedKey,
          sessionId,
          avatarImage: selectedAvatar.image,
          avatarVideo: "/avatars/namira.mp4",
          productName: activeFeaturedProduct.name,
          productPrice: String(activeFeaturedProduct.price).replace(/\D/g, ""),
          productImageUrl: activeFeaturedProduct.image,
          bannerImageUrl: activeFeaturedProduct.bannerImage,
          platform: selectedPlatform,
          stockCount: activeFeaturedProduct.stock,
          ctaLabel: selectedPlatform === "Instagram Live" ? "DM Sekarang" : "Beli Sekarang",
        },
        controller.signal,
      );

      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) {
        await liveSessionService.teardownSession(sessionId);
        return;
      }

      if (bcastJson.success) {
        useLiveSessionStore.setState({
          currentLiveSessionId: sessionId,
          liveSessionPhase: "pending",
          hasConfirmedBroadcast: true,
          isWaitingForGoLive: Boolean(bcastJson.waitingForGoLive),
          connectingStageText:
            bcastJson.waitingForGoLive !== false
              ? "Memuat model AI Host ke Cloud GPU..."
              : "Menunggu platform memulai live...",
          // Tetap buka overlay sampai user konfirmasi Go Live atau pipeline siap.
          isConnectingLive: bcastJson.waitingForGoLive !== false,
          isLiveActive: bcastJson.waitingForGoLive === false,
          isLivePaused: false,
          liveSeconds: 0,
        });
        showToast(
          bcastJson.message ||
            (bcastJson.waitingForGoLive !== false
              ? "RTMP terhubung! Sedang menggenerate Video AI..."
              : `RTMP terhubung! Menunggu ${selectedPlatform} memulai live...`),
        );
      } else {
        await liveSessionService.teardownSession(sessionId);
        useLiveSessionStore.setState({
          isConnectingLive: false,
          isWaitingForGoLive: false,
          currentLiveSessionId: null,
          liveSessionPhase: "idle",
          pipelineStatus: null,
        });
        showToast(`Gagal terhubung ke ${selectedPlatform}: ${bcastJson.error || "Server RTMP menolak koneksi."}`);
      }
    } catch (err) {
      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) return;
      if (connectingAbortRef.current?.signal.aborted) return;
      const message =
        err instanceof Error ? err.message : "Error koneksi: Pastikan server backend online.";
      await liveSessionService.teardownSession(createdSessionId);
      useLiveSessionStore.setState({
        isConnectingLive: false,
        isWaitingForGoLive: false,
        currentLiveSessionId: null,
        liveSessionPhase: "idle",
        pipelineStatus: null,
      });
      showToast(message);
    }
  };

  const handleOAuthConnect = async () => {
    showToast(`Menghubungkan ke ${selectedPlatform} via OAuth 2.0...`);
    try {
      const json = await oauthService.getAuthorizeUrl(selectedPlatform);
      if (json?.authUrl) {
        window.location.href = json.authUrl;
        return;
      }
      if (json?.missingEnvKey) {
        showToast(`Gagal: ${json.error} (${json.missingEnvKey})`);
      }
    } catch {
      showToast("Tidak dapat terhubung ke backend. Pastikan server berjalan.");
    }
  };

  if (!isLiveActive) {
    return (
      <div
        className={`flex flex-col rounded-xl border p-4 transition ${
          currentStep === 5
            ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30"
            : "border-[#232c42] bg-[#0c1221]"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">STEP 5</span>
          <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            Siap Siaran Langsung
          </span>
        </div>
        <h3 className="mb-1 mt-1 text-lg font-bold text-white">Go Live</h3>
        <p className="mb-4 text-xs text-slate-400">Semua siap! Mulai live dan AI akan bekerja otonom untuk Anda.</p>

        <div className="flex flex-col sm:flex-row gap-4 border-b border-[#232c42] pb-4 mb-4">
          <div className="flex-1 space-y-3">
            <p className="text-[11px] font-semibold text-slate-200">Ringkasan Siap Live</p>
            <div className="space-y-2 text-[10px]">
              <div className="flex items-center gap-2">
                <span className="text-blue-400 w-4 flex justify-center">
                  <User className="w-3.5 h-3.5" />
                </span>
                <div>
                  <p className="text-slate-500 leading-none">AI Host</p>
                  <p className="font-medium text-slate-200 mt-1">
                    {selectedAvatar.name} ({selectedTone})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 w-4 flex justify-center">
                  <Clock className="w-3.5 h-3.5" />
                </span>
                <div>
                  <p className="text-slate-500 leading-none">Durasi Live</p>
                  <p className="font-medium text-slate-200 mt-1">{selectedDuration} Jam (Terkunci)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-purple-400 w-4 flex justify-center">
                  <ShoppingBag className="w-3.5 h-3.5" />
                </span>
                <div>
                  <p className="text-slate-500 leading-none">Produk</p>
                  <p className="font-medium text-slate-200 mt-1">
                    {products.length} Produk ({activeFeaturedProduct.name})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <PlatformIcon platformName={selectedPlatform} size="sm" className="shrink-0" />
                <div>
                  <p className="text-slate-500 leading-none">Platform Target</p>
                  <p className="font-medium text-slate-200 mt-1">{selectedPlatform}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden sm:block w-[1px] bg-[#232c42]" />

          <div className="flex-[1.2] min-w-0">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[11px] font-semibold text-slate-200 whitespace-nowrap truncate">
                {selectedPlatform.toLowerCase().includes("custom")
                  ? "Konfigurasi Server RTMP Custom"
                  : `Metode Koneksi (${selectedPlatform})`}
              </p>
              {!selectedPlatform.toLowerCase().includes("custom") && (
                <div className="flex w-full rounded-lg bg-[#111827] p-0.5 border border-[#232c42]">
                  <button
                    type="button"
                    onClick={() => setConnectMode("1CLICK")}
                    className={`flex-1 rounded-md px-2.5 py-1 text-[9px] font-bold transition cursor-pointer ${
                      connectMode === "1CLICK"
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    1 Klik Connect
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectMode("MANUAL")}
                    className={`flex-1 rounded-md px-2.5 py-1 text-[9px] font-bold transition cursor-pointer ${
                      connectMode === "MANUAL"
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Manual RTMP
                  </button>
                </div>
              )}
            </div>

            {!selectedPlatform.toLowerCase().includes("custom") && connectMode === "1CLICK" ? (
              <div className="rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-950/30 via-[#0f172a] to-[#0c1221] p-3 animate-fadeIn">
                {connectedAccount && connectedAccount.isConnected ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Akun Terverifikasi
                      </span>
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-400 border border-emerald-500/20">
                        OAuth 2.0 Connected
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 rounded-xl bg-[#111827] p-2.5 border border-[#232c42] mb-2.5 shadow-md">
                      <div className="relative shrink-0 w-10 h-10">
                        <Image
                          src={
                            connectedAccount.avatarUrl ||
                            "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=300&fit=crop&q=80"
                          }
                          alt={connectedAccount.displayName}
                          fill
                          unoptimized
                          className="rounded-full object-cover border-2 border-emerald-400/80 shadow-md"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-white truncate">{connectedAccount.displayName}</p>
                        <div className="flex items-center gap-2 text-[9px] text-slate-400 mt-0.5">
                          <span className="text-cyan-300 font-mono">@{connectedAccount.username}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await oauthService.disconnect(selectedPlatform);
                          setConnectedAccount(null);
                          showToast("Koneksi akun diputuskan.");
                        }}
                        className="rounded-lg px-2 py-1 text-[8.5px] font-bold text-red-400 hover:bg-red-500/10 border border-red-500/20 transition active:scale-95 shrink-0 cursor-pointer"
                      >
                        Putuskan
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-2.5">
                    <p className="text-[10px] text-slate-200 font-bold mb-1">Hubungkan Akun {selectedPlatform}</p>
                    <p className="text-[8.5px] text-slate-400 mb-3">
                      Hubungkan akun resmi toko Anda via OAuth 2.0 untuk auto-streaming tanpa input Stream Key manual.
                    </p>

                    {oauthConfigStatus[selectedPlatform] === false && (
                      <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-[8px] text-amber-300 text-left leading-relaxed">
                        <span className="font-bold text-amber-400">[!] OAuth belum dikonfigurasi</span>
                        <br />
                        Tambahkan credentials {selectedPlatform} ke file .env backend.
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleOAuthConnect}
                      className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[10.5px] font-bold text-white shadow-md active:scale-95 transition bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:brightness-110 cursor-pointer"
                    >
                      <span>Login & Hubungkan Akun {selectedPlatform}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5 animate-fadeIn">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[9px] text-slate-400">Server / Stream URL ({selectedPlatform})</p>
                  </div>
                  <div className="flex rounded border border-[#232c42] bg-[#111827]">
                    <input
                      type="text"
                      value={customRtmpUrl}
                      onChange={(e) => setCustomRtmpUrl(e.target.value)}
                      placeholder="Masukkan Server RTMP URL..."
                      className="w-full bg-transparent p-1.5 text-[10px] text-slate-300 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(customRtmpUrl, "RTMP URL")}
                      className="border-l border-[#232c42] px-2.5 py-1.5 text-[9px] font-medium text-slate-300 hover:text-white bg-[#161f30] transition active:scale-95 shrink-0 cursor-pointer"
                    >
                      Salin
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[9px] text-slate-400">Stream Key</p>
                  </div>
                  <div className="flex rounded border border-[#232c42] bg-[#111827]">
                    <input
                      type="password"
                      autoComplete="off"
                      value={streamKey}
                      onChange={(e) => setStreamKey(e.target.value)}
                      placeholder={`Tempel Stream Key dari ${selectedPlatform}...`}
                      className="w-full bg-transparent p-1.5 text-[10px] text-slate-300 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(streamKey, "Stream Key")}
                      className="border-l border-[#232c42] px-2.5 py-1.5 text-[9px] font-medium text-slate-300 hover:text-white bg-[#161f30] transition active:scale-95 shrink-0 cursor-pointer"
                    >
                      Salin
                    </button>
                  </div>
                  {selectedPlatform.includes("Instagram") && (
                    <p className="mt-1 text-[8.5px] text-amber-400/90 leading-relaxed">
                      Stream key Instagram sekali pakai. Kalau siaran putus, buat live baru di Instagram lalu tempel key yang baru.
                    </p>
                  )}
                </div>

                {!selectedPlatform.toLowerCase().includes("custom") && (
                  <button
                    type="button"
                    onClick={() => setShowTutorialModal(true)}
                    className="flex items-center justify-between w-full text-[9px] text-blue-400 hover:underline pt-1 cursor-pointer"
                  >
                    <span className="flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      Cara cari RTMP &amp; Stream Key di {selectedPlatform}
                    </span>
                    <span>Tutorial &gt;</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={isConnectingLive}
          onClick={handleStartLive}
          className={`w-full flex flex-col items-center justify-center rounded-xl py-3 text-center text-sm font-bold text-white transition active:scale-98 shadow-[0_4px_14px_0_rgba(0,180,219,0.39)] cursor-pointer ${
            isConnectingLive
              ? "bg-slate-700 cursor-not-allowed opacity-90"
              : "bg-gradient-to-r from-[#00b4db] to-[#0083b0] hover:brightness-110"
          }`}
        >
          {isConnectingLive ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{connectingStageText}</span>
            </div>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <Radio className="w-4 h-4" />
                Mulai Live Sekarang
              </span>
              <span className="text-[9px] font-normal text-white/80 mt-0.5">
                AI akan mulai streaming otomatis di platform {selectedPlatform}
              </span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-red-500/40 bg-[#0e1222] ring-1 ring-red-500/20 p-5 relative overflow-hidden transition animate-fadeIn shadow-2xl shadow-red-900/10">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 via-red-400 to-red-600 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.6)]" />

      <div className="mb-4 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping shadow-[0_0_12px_rgba(239,68,68,0.9)]" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest text-red-400">Live Control Center</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            GPU Active
          </span>
          <span className="text-[9px] font-bold text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center gap-1.5">
            <PlatformIcon platformName={selectedPlatform} size="sm" />
            {selectedPlatform}
          </span>
        </div>
      </div>

      <div className="mb-3 border-b border-[#232c42] pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[9px] font-bold tracking-widest text-white ${
                !isLivePaused ? "bg-red-500 animate-pulse" : "bg-amber-600"
              }`}
            >
              {isLivePaused ? "PAUSED" : "LIVE"}
            </span>
            <span className="text-[12px] font-bold text-slate-100 tracking-wider font-mono">
              {formatTime(liveSeconds)}{" "}
              <span className="text-[9px] font-normal text-slate-400 font-sans">/ {selectedDuration} Jam</span>
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold">
            {Math.min(100, Math.round((liveSeconds / (selectedDuration * 3600)) * 100))}%
          </span>
        </div>

        <div className="w-full h-1.5 rounded-full bg-[#1c2438] overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              liveSeconds / (selectedDuration * 3600) > 0.9
                ? "bg-gradient-to-r from-amber-500 to-red-500 animate-pulse"
                : "bg-gradient-to-r from-blue-500 to-emerald-400"
            }`}
            style={{
              width: `${Math.min(100, (liveSeconds / (selectedDuration * 3600)) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="mb-3">
        <LiveMetricsBar
          viewers={metrics.viewers}
          comments={metrics.comments}
          clicks={metrics.clicks}
          sales={metrics.sales}
        />
      </div>

      <div className="mb-3 rounded-xl border border-blue-500/20 bg-[#111827] p-2.5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-bold text-slate-300 flex items-center gap-1.5">
            <Tag className="w-3 h-3 text-blue-400" />
            <span>Produk Aktif di Siaran</span>
          </p>
          <button
            type="button"
            onClick={handleSwitchNextProduct}
            className="text-[8.5px] font-bold text-blue-400 hover:underline cursor-pointer"
          >
            Ganti Produk
          </button>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative h-10 w-10 shrink-0 rounded-lg overflow-hidden border border-white/20 shadow">
            <Image
              src={
                activeFeaturedProduct.image?.startsWith("http") ||
                activeFeaturedProduct.image?.startsWith("/") ||
                activeFeaturedProduct.image?.startsWith("data:")
                  ? activeFeaturedProduct.image
                  : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
              }
              alt={activeFeaturedProduct.name}
              fill
              unoptimized
              className="object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-white truncate">{activeFeaturedProduct.name}</p>
            <p className="text-[11px] font-bold text-emerald-400">{activeFeaturedProduct.price}</p>
          </div>
          <div className="text-right border-l border-[#232c42] pl-2">
            <p className="text-[7.5px] text-slate-500">Klik</p>
            <p className="text-[9.5px] font-bold text-white">{metrics.activeProductClicks}</p>
          </div>
          <div className="text-right border-l border-[#232c42] pl-2">
            <p className="text-[7.5px] text-slate-500">Terjual</p>
            <p className="text-[9.5px] font-bold text-emerald-400">{metrics.activeProductSold} ↑</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSwitchNextProduct}
          className="mt-2 w-full rounded-lg bg-[#4148e2] py-1.5 text-[9px] font-bold text-white hover:bg-blue-600 transition active:scale-95 flex items-center justify-center gap-1 shadow-sm cursor-pointer"
        >
          <RotateCw className="w-3 h-3" />
          <span>Pin &amp; Sorot Produk Berikutnya</span>
        </button>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowEndLiveConfirm(true)}
          className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-700 py-2.5 text-[11px] font-bold text-white hover:brightness-110 transition active:scale-95 shadow-md shadow-red-600/30 cursor-pointer"
        >
          [STOP] Akhiri Live Streaming
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              const nextPause = !isLivePaused;
              try {
                if (nextPause) {
                  await liveSessionService.pauseStream();
                } else {
                  await liveSessionService.resumeStream();
                }
                setIsLivePaused(nextPause);
                showToast(nextPause ? "Live Streaming dijeda" : "Live Streaming dilanjutkan");
              } catch (err) {
                showToast(err instanceof Error ? err.message : "Gagal mengubah status streaming");
              }
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[#232c42] bg-[#111827] py-2 text-[9.5px] font-medium text-slate-300 hover:bg-white/5 transition cursor-pointer"
          >
            {isLivePaused ? (
              <>
                <Play className="w-3 h-3" />
                <span>Lanjutkan Live</span>
              </>
            ) : (
              <>
                <Pause className="w-3 h-3" />
                <span>Jeda Siaran</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleCopy(customRtmpUrl || "rtmp://live.livestreamer.ai/live", "RTMP URL")}
            className="flex items-center justify-center gap-1 rounded-lg border border-[#232c42] bg-[#111827] px-3 py-2 text-[9.5px] font-medium text-slate-300 hover:bg-white/5 transition cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            <span>Salin URL</span>
          </button>
        </div>
      </div>
    </div>
  );
};
