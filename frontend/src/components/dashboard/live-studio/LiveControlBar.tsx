"use client";

import React, { useRef } from "react";
import Image from "next/image";
import { Radio, Pause, Play, Copy, Loader2, BookOpen, User, Clock, ShoppingBag } from "lucide-react";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useProductStore } from "@/stores/useProductStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { liveSessionService, toLiveProductSnapshot } from "@/services/liveSessionService";
import { isDeadOrderStatus, orderService, type OrderTicket } from "@/services/orderService";
import { avatarIdleVideoPath } from "@/app/dashboard/constants";
import { oauthService } from "@/services/oauthService";
import { copyToClipboard } from "@/utils/clipboard";
import { LiveRuntimePanel } from "@/components/dashboard/live-studio/LiveRuntimePanel";
import { PaymentModal } from "@/components/dashboard/live-studio/modals/PaymentModal";
import { ResumeOrderModal } from "@/components/dashboard/live-studio/modals/ResumeOrderModal";
import { isValidRtmpUrl, normalizeRtmpInput } from "@/utils/rtmp";
import { validateLivePreparation } from "@/lib/live-validation";
import { toClientCopy } from "@/lib/client-copy";
import { readStoredResumeCode, storeResumeCode } from "@/lib/api";

export const LiveControlBar: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);
  const showToast = useDashboardUIStore((state) => state.showToast);
  const setShowTutorialModal = useDashboardUIStore((state) => state.setShowTutorialModal);
  const setShowEndLiveConfirm = useDashboardUIStore((state) => state.setShowEndLiveConfirm);
  const setShowPaymentModal = useDashboardUIStore((state) => state.setShowPaymentModal);
  const setShowResumeOrderModal = useDashboardUIStore((state) => state.setShowResumeOrderModal);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const selectedTone = useAiHostStore((state) => state.selectedTone);
  const selectedVoice = useAiHostStore((state) => state.selectedVoice);
  const selectedLang = useAiHostStore((state) => state.selectedLang);
  const selectedBackground = useAiHostStore((state) => state.selectedBackground);

  const products = useProductStore((state) => state.products);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);

  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const isLivePaused = useLiveSessionStore((state) => state.isLivePaused);
  const setIsLivePaused = useLiveSessionStore((state) => state.setIsLivePaused);
  const isConnectingLive = useLiveSessionStore((state) => state.isConnectingLive);
  const selectedDuration = useLiveSessionStore((state) => state.selectedDuration);
  const orderId = useLiveSessionStore((state) => state.orderId);
  const resumeCode = useLiveSessionStore((state) => state.resumeCode);
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
  const connectingStageText = useLiveSessionStore((state) => state.connectingStageText);
  const addChatMessage = useLiveSessionStore((state) => state.addChatMessage);
  const currentLiveSessionId = useLiveSessionStore((state) => state.currentLiveSessionId);

  const connectingAbortRef = useRef<AbortController | null>(null);

  const handleCopy = async (text: string, label: string) => {
    if (!text?.trim()) {
      showToast(`${label} masih kosong — salin dari aplikasi live Anda.`);
      return;
    }
    const ok = await copyToClipboard(text);
    if (ok) showToast(`${label} berhasil disalin ke clipboard!`);
  };

  const rtmpUrlPlaceholder = selectedPlatform.includes("Instagram")
    ? "Salin Server URL dari Instagram Live Producer / Professional Dashboard..."
    : selectedPlatform.includes("YouTube")
      ? "Salin Server URL dari YouTube Studio → Go Live..."
      : selectedPlatform.includes("TikTok")
        ? "Salin Server URL dari TikTok LIVE Studio..."
        : selectedPlatform.includes("Shopee")
          ? "Salin Server URL dari Shopee Live Center..."
          : selectedPlatform.includes("Facebook")
            ? "Salin Server URL dari Meta Live Producer..."
            : "Salin Server / Stream URL dari dashboard platform live Anda...";

  const handleSwitchNextProduct = async () => {
    if (products.length === 0) return;
    const previous = activeFeaturedProduct;
    const nextIdx = (products.findIndex((p) => p.id === previous.id) + 1) % products.length;
    const nextProd = products[nextIdx];
    if (!nextProd || nextProd.id === previous.id) return;
    setActiveFeaturedProduct(nextProd);
    try {
      await liveSessionService.switchProduct(
        nextProd.id || "1",
        nextProd.name,
        toLiveProductSnapshot(nextProd, { includeMedia: true, includeScriptBank: true }),
        currentLiveSessionId || undefined,
      );
      showToast(`Produk aktif siaran diubah ke: ${nextProd.name}`);
      addChatMessage({
        id: String(Date.now()),
        sender: `AI Host (${selectedAvatar.name})`,
        isAi: true,
        avatarColor: "bg-[#4148e2]",
        text: `Sekarang kita beralih ke ${nextProd.name} ya kakak! Harganya spesial cuma ${nextProd.price}! Yuk langsung diamankan di keranjang kuning ya!`,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    } catch (err) {
      setActiveFeaturedProduct(previous);
      showToast(err instanceof Error ? err.message : "Gagal ganti produk di siaran.", "error");
    }
  };

  const rememberTicket = (ticket: OrderTicket) => {
    useLiveSessionStore.setState({
      orderId: ticket.orderId,
      resumeCode: ticket.resumeCode,
      selectedDuration: ticket.durationHours,
      selectedPlanId: ticket.planId,
      ...(ticket.automations ? { automations: ticket.automations } : {}),
    });
  };

  const reconnectRunningLive = (ticket: OrderTicket) => {
    rememberTicket(ticket);
    const live = ticket.sessionState === "live" || ticket.status === "live";
    useLiveSessionStore.setState({
      currentLiveSessionId: ticket.sessionId,
      liveSessionPhase: live ? "live" : "pending",
      isLiveActive: live,
      isConnectingLive: !live,
      isWaitingForGoLive: !live,
    });
    showToast(live ? "Menyambungkan kembali ke siaran yang sedang berjalan." : "Melanjutkan persiapan siaran yang belum selesai.");
  };

  const handleTicketResolved = async (ticket: OrderTicket) => {
    rememberTicket(ticket);
    if (ticket.canReconnect) {
      reconnectRunningLive(ticket);
      return;
    }
    if (ticket.canPrepare) {
      await beginPrepareAfterPaid(ticket);
    }
  };

  const handleStartLive = async () => {
    if (useLiveSessionStore.getState().isConnectingLive) return;
    const validation = validateLivePreparation({
      products,
      activeProduct: activeFeaturedProduct,
      avatar: selectedAvatar,
      voice: selectedVoice,
      language: selectedLang,
      background: selectedBackground,
      platform: selectedPlatform,
      duration: selectedDuration,
    });
    if (!validation.valid) {
      showToast(validation.message || "Lengkapi pengaturan live terlebih dahulu.", "warning");
      return;
    }

    const { rtmpUrl: previewUrl, streamKey: previewKey } = normalizeRtmpInput(customRtmpUrl, streamKey);
    if (!previewUrl.trim() || !previewKey || !isValidRtmpUrl(previewUrl)) {
      showToast("Tempel alamat server dan kode siaran dari aplikasi live Anda.", "warning");
      return;
    }

    try {
      const existingCode = resumeCode || readStoredResumeCode();
      const existing = existingCode ? await orderService.lookup(existingCode).catch(() => null) : await orderService.lookupMine().catch(() => null);
      if (existing?.canReconnect) {
        reconnectRunningLive(existing);
        return;
      }
      if (existing?.canPrepare) {
        await beginPrepareAfterPaid(existing);
        return;
      }
      if (existing?.status === "pending_payment") {
        rememberTicket(existing);
        setShowPaymentModal(true);
        return;
      }
      if (existing && isDeadOrderStatus(existing.status)) {
        storeResumeCode(null);
        useLiveSessionStore.setState({ orderId: null, resumeCode: null });
      }
    } catch {
      // lanjut ke pembayaran baru
    }

    setShowPaymentModal(true);
  };

  const beginPrepareAfterPaid = async (ticket: OrderTicket) => {
    if (useLiveSessionStore.getState().isConnectingLive) return;
    rememberTicket(ticket);
    if (ticket.canReconnect) {
      reconnectRunningLive(ticket);
      return;
    }

    const attemptId = Date.now();
    const controller = new AbortController();
    const { rtmpUrl: normalizedUrl, streamKey: normalizedKey } = normalizeRtmpInput(customRtmpUrl, streamKey);

    if (!normalizedUrl.trim()) {
      showToast(
        "Tempel alamat server siaran dari aplikasi live Anda.",
      );
      return;
    }
    if (!normalizedKey) {
      showToast(
        "Tempel kode siaran dari aplikasi live. Di Instagram, kode lama tidak bisa dipakai ulang — buat siaran baru.",
      );
      return;
    }
    if (!isValidRtmpUrl(normalizedUrl)) {
      showToast("Alamat server siaran tidak valid. Salin persis dari aplikasi live Anda.");
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
    showToast(`Menyiapkan siaran ke ${selectedPlatform}… Mohon tunggu, jangan tutup halaman.`);

    let createdSessionId: string | null = null;
    try {
      connectingAbortRef.current = controller;

      const sessionJson = await liveSessionService.startSession(
        {
          productId: activeFeaturedProduct.id || "1",
          avatarId: selectedAvatar.id || "1",
          platform: selectedPlatform,
          durationHours: ticket.durationHours || selectedDuration,
          orderId: ticket.orderId,
          resumeCode: ticket.resumeCode,
          autoReply: automations.autoReply,
          autoPin: automations.autoPin,
          autoPromotion: automations.autoPromo,
          autoModeration: automations.autoModeration,
          avatarName: selectedAvatar.name,
          tone: selectedTone,
          voice: selectedVoice || selectedAvatar.voice || "girl_cute_kids",
          voiceId: selectedVoice || selectedAvatar.voice || "girl_cute_kids",
          lang: selectedLang,
          backgroundImage: selectedBackground || undefined,
          liveChatId: connectedAccount?.liveChatId,
          liveVideoId: connectedAccount?.liveVideoId,
          product: toLiveProductSnapshot(activeFeaturedProduct, {
            includeMedia: true,
            includeScriptBank: true,
          }),
          products: products.map((item) =>
            toLiveProductSnapshot(item, {
              includeMedia: item.id === activeFeaturedProduct.id,
              includeScriptBank: item.id === activeFeaturedProduct.id,
            }),
          ),
        },
        controller.signal,
      );

      const sessionId = sessionJson.data?.id;
      if (!sessionId) {
        throw new Error("Siaran belum bisa dimulai. Coba lagi.");
      }
      createdSessionId = sessionId;

      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) {
        await liveSessionService.teardownSession(sessionId);
        return;
      }

      useLiveSessionStore.setState({
        currentLiveSessionId: sessionId,
        liveSessionPhase: "pending",
        connectingStageText: "Menyiapkan host AI… Mohon tunggu.",
      });

      await liveSessionService.waitForPodReady(sessionId, {
        signal: controller.signal,
        onProgress: (text) => {
          if (useLiveSessionStore.getState().connectAttemptId !== attemptId) return;
          useLiveSessionStore.setState({ connectingStageText: toClientCopy(text) });
        },
      });

      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) {
        await liveSessionService.teardownSession(sessionId);
        return;
      }

      useLiveSessionStore.setState({
        connectingStageText: `Menyambungkan siaran ke ${selectedPlatform}…`,
      });

      // http(s), data:image, atau path relatif publik (/banner_atas_tengah.png)
      const liveOverlayMedia = (url?: string) => {
        const u = (url || "").trim();
        if (!u) return undefined;
        // Biarkan path relatif (seperti /banner_atas_tengah.png) tetap relatif
        // agar backend mengubahnya jadi base64 Data URL yang bisa dibaca worker remote RunPod
        if (u.startsWith("/")) return u;
        if (/^data:image\//i.test(u)) return u;
        if (/^https?:\/\//i.test(u)) {
          // Jika mengarah ke localhost browser saat dev, kirim path-nya saja
          try {
            const parsed = new URL(u);
            if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
              return parsed.pathname;
            }
          } catch {}
          return u;
        }
        return u;
      };

      let bcastJson: {
        success?: boolean;
        waitingForGoLive?: boolean;
        message?: string;
        error?: string;
      };
      try {
        bcastJson = await liveSessionService.startBroadcast(
          {
            rtmpUrl: normalizedUrl,
            streamKey: normalizedKey,
            sessionId,
            avatarImage: selectedAvatar.image,
            avatarVideo: avatarIdleVideoPath(selectedAvatar.id),
            backgroundImage: selectedBackground || undefined,
            productName: activeFeaturedProduct.name,
            productPrice: String(activeFeaturedProduct.price).replace(/\D/g, ""),
            productImageUrl: liveOverlayMedia(activeFeaturedProduct.image),
            bannerImageUrl: liveOverlayMedia(activeFeaturedProduct.bannerImage),
            platform: selectedPlatform,
            stockCount: activeFeaturedProduct.stock,
            ctaLabel: selectedPlatform === "Instagram Live" ? "DM Sekarang" : "Beli Sekarang",
            avatarName: selectedAvatar.name,
          },
          controller.signal,
        );
      } catch (broadcastErr) {
        const msg = broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr);
        const looksLikeTimeout = /timeout|504|502|gateway/i.test(msg);
        if (looksLikeTimeout && sessionId) {
          useLiveSessionStore.setState({
            connectingStageText: "Masih menyiapkan siaran… Jangan tutup halaman, kami cek otomatis.",
          });
          await liveSessionService.waitForRtmpConnected(sessionId, {
            signal: controller.signal,
            maxWaitMs: 10 * 60_000,
            onProgress: (text) => {
              if (useLiveSessionStore.getState().connectAttemptId !== attemptId) return;
              useLiveSessionStore.setState({ connectingStageText: toClientCopy(text) });
            },
          });
          bcastJson = {
            success: true,
            waitingForGoLive: true,
            message: "Siaran tersambung. Menyiapkan kata pembuka host…",
          };
        } else {
          throw broadcastErr;
        }
      }

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
              ? "Menyiapkan host AI… Pertama kali bisa 2–5 menit."
              : `Menunggu ${selectedPlatform} siap siaran…`,
          // Tetap buka overlay sampai user konfirmasi Go Live atau pipeline siap.
          isConnectingLive: bcastJson.waitingForGoLive !== false,
          isLiveActive: bcastJson.waitingForGoLive === false,
          isLivePaused: false,
          liveSeconds: 0,
          liveStartedAtMs: Date.now(),
        });
        showToast(
          toClientCopy(
            bcastJson.message ||
              (bcastJson.waitingForGoLive !== false
                ? "Siaran tersambung. Menyiapkan host AI — tunggu tombol hijau."
                : `Tersambung! Menunggu ${selectedPlatform} siap siaran…`),
          ),
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
        showToast(`Belum berhasil ke ${selectedPlatform}. Periksa kode siaran (sekali pakai), lalu coba lagi.`);
      }
    } catch (err) {
      if (useLiveSessionStore.getState().connectAttemptId !== attemptId) return;
      if (connectingAbortRef.current?.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Koneksi gagal. Pastikan internet stabil dan coba lagi.";
      await liveSessionService.teardownSession(createdSessionId);
      useLiveSessionStore.setState({
        isConnectingLive: false,
        isWaitingForGoLive: false,
        currentLiveSessionId: null,
        liveSessionPhase: "idle",
        pipelineStatus: null,
      });
      showToast(toClientCopy(message), "error");
    }
  };

  const orderModals = (
    <>
      <PaymentModal onPaid={(paid) => void handleTicketResolved(paid)} />
      <ResumeOrderModal onResolved={(paid) => void handleTicketResolved(paid)} />
    </>
  );

  const handleOAuthConnect = async () => {
    showToast(`Menghubungkan akun ${selectedPlatform}…`);
    try {
      const json = await oauthService.getAuthorizeUrl(selectedPlatform);
      if (json?.authUrl) {
        window.location.href = json.authUrl;
        return;
      }
      if (json?.missingEnvKey) {
        showToast("Koneksi akun belum tersedia. Gunakan isi manual, atau hubungi tim Livio.");
      }
    } catch {
      showToast("Tidak dapat terhubung ke server. Coba muat ulang halaman.");
    }
  };

  if (!isLiveActive) {
    return (
      <>
      {orderModals}
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
                  <p className="text-slate-500 leading-none">AI Host &amp; Suara</p>
                  <p className="font-medium text-slate-200 mt-1">
                    {selectedAvatar.name} · {selectedVoice || selectedAvatar.voice} · {selectedLang.toUpperCase()}
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
                  ? "Pengaturan server siaran"
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
                    Isi manual
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
                        Akun terhubung
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
                      Hubungkan akun toko Anda agar siaran bisa dimulai tanpa mengisi kode secara manual.
                    </p>

                    {oauthConfigStatus[selectedPlatform] === false && (
                      <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-[8px] text-amber-300 text-left leading-relaxed">
                        <span className="font-bold text-amber-400">Koneksi cepat belum tersedia</span>
                        <br />
                        Gunakan isi manual, atau hubungi tim Livio untuk mengaktifkan login akun.
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
                    <p className="text-[9px] text-slate-400">Alamat server siaran ({selectedPlatform})</p>
                    <p className="text-[8px] text-amber-400/90">Wajib salin dari platform</p>
                  </div>
                  <div className="flex rounded border border-[#232c42] bg-[#111827]">
                    <input
                      type="text"
                      value={customRtmpUrl}
                      onChange={(e) => setCustomRtmpUrl(e.target.value)}
                      placeholder={rtmpUrlPlaceholder}
                      className="w-full bg-transparent p-1.5 text-[10px] text-slate-300 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(customRtmpUrl, "Alamat server")}
                      className="border-l border-[#232c42] px-2.5 py-1.5 text-[9px] font-medium text-slate-300 hover:text-white bg-[#161f30] transition active:scale-95 shrink-0 cursor-pointer"
                    >
                      Salin
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[9px] text-slate-400">Kode siaran</p>
                  </div>
                  <div className="flex rounded border border-[#232c42] bg-[#111827]">
                    <input
                      type="password"
                      autoComplete="off"
                      value={streamKey}
                      onChange={(e) => setStreamKey(e.target.value)}
                      placeholder={`Tempel kode siaran dari ${selectedPlatform}...`}
                      className="w-full bg-transparent p-1.5 text-[10px] text-slate-300 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(streamKey, "Kode siaran")}
                      className="border-l border-[#232c42] px-2.5 py-1.5 text-[9px] font-medium text-slate-300 hover:text-white bg-[#161f30] transition active:scale-95 shrink-0 cursor-pointer"
                    >
                      Salin
                    </button>
                  </div>
                  {selectedPlatform.includes("Instagram") && (
                    <p className="mt-1 text-[8.5px] text-amber-400/90 leading-relaxed">
                      Kode siaran Instagram sekali pakai. Kalau siaran putus, buat live baru di Instagram lalu tempel
                      kode yang baru.
                    </p>
                  )}
                </div>

              </div>
            )}
            <button
              type="button"
              onClick={() => setShowTutorialModal(true)}
              className="mt-2 flex w-full items-center justify-between rounded-lg border border-blue-500/25 bg-blue-500/8 px-2.5 py-2 text-left text-[10px] text-blue-200 hover:bg-blue-500/15 cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 shrink-0" />
                Belum tahu situs mana yang dibuka? Ikuti panduan klik demi klik untuk {selectedPlatform}
              </span>
              <span className="shrink-0 font-bold">Buka &gt;</span>
            </button>
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
              <span>{toClientCopy(connectingStageText)}</span>
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
        <button
          type="button"
          disabled={isConnectingLive}
          onClick={() => setShowResumeOrderModal(true)}
          className="mt-2 w-full rounded-lg border border-blue-500/25 bg-blue-500/8 px-3 py-2 text-[11px] font-semibold text-blue-100 hover:bg-blue-500/15 cursor-pointer disabled:opacity-60"
        >
          Lanjutkan siaran tanpa bayar ulang
        </button>
        {(resumeCode || orderId) && (
          <p className="mt-2 text-center font-mono text-[10px] tracking-wider text-slate-500">
            Kode tersimpan: {resumeCode || "cookie browser"}
          </p>
        )}
      </div>
      </>
    );
  }

  return (
    <>
    {orderModals}
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
            Host AI Aktif
          </span>
          <span className="text-[9px] font-bold text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30 flex items-center gap-1.5">
            <PlatformIcon platformName={selectedPlatform} size="sm" />
            {selectedPlatform}
          </span>
        </div>
      </div>

      <LiveRuntimePanel activeFeaturedProduct={activeFeaturedProduct} onSwitchProduct={handleSwitchNextProduct} />

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
                  await liveSessionService.pauseStream(currentLiveSessionId);
                } else {
                  await liveSessionService.resumeStream(currentLiveSessionId);
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
            onClick={() => handleCopy(customRtmpUrl, "Alamat server")}
            className="flex items-center justify-center gap-1 rounded-lg border border-[#232c42] bg-[#111827] px-3 py-2 text-[9.5px] font-medium text-slate-300 hover:bg-white/5 transition cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            <span>Salin URL</span>
          </button>
        </div>
      </div>
    </div>
    </>
  );
};
