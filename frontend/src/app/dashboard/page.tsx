"use client";

import React, { useEffect, useRef } from "react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useProductStore, PRODUCT_STORAGE_QUOTA_EVENT } from "@/stores/useProductStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { oauthService } from "@/services/oauthService";
import { liveSessionService, toLiveProductSnapshot } from "@/services/liveSessionService";
import { ChatMessage } from "./types";

import { ToastNotification } from "@/components/dashboard/shared/ToastNotification";
import { DashboardHeader } from "@/components/dashboard/header/DashboardHeader";
import { ProductPanel } from "@/components/dashboard/product/ProductPanel";
import { AiHostPanel } from "@/components/dashboard/ai-host/AiHostPanel";
import { BroadcastSettingsPanel } from "@/components/dashboard/broadcast/BroadcastSettingsPanel";
import { LivePreviewBoard } from "@/components/dashboard/live-studio/LivePreviewBoard";
import { LiveControlBar } from "@/components/dashboard/live-studio/LiveControlBar";
import { VideoAdsGeneratorPanel } from "@/components/dashboard/video-ads/VideoAdsGeneratorPanel";
import { DashboardModals } from "@/components/dashboard/DashboardModals";

export default function Dashboard() {
  const appMode = useDashboardUIStore((state) => state.appMode);
  const showToast = useDashboardUIStore((state) => state.showToast);
  const setShowSummaryModal = useDashboardUIStore((state) => state.setShowSummaryModal);
  const loadProducts = useProductStore((state) => state.loadProducts);
  const products = useProductStore((state) => state.products);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);
  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const stopAudio = useAiHostStore((state) => state.stopAudio);
  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const setIsLiveActive = useLiveSessionStore((state) => state.setIsLiveActive);
  const isLivePaused = useLiveSessionStore((state) => state.isLivePaused);
  const setIsLivePaused = useLiveSessionStore((state) => state.setIsLivePaused);
  const selectedDuration = useLiveSessionStore((state) => state.selectedDuration);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const setSelectedPlatform = useLiveSessionStore((state) => state.setSelectedPlatform);
  const automations = useLiveSessionStore((state) => state.automations);
  const currentLiveSessionId = useLiveSessionStore((state) => state.currentLiveSessionId);
  const isConnectingLive = useLiveSessionStore((state) => state.isConnectingLive);
  const liveSessionPhase = useLiveSessionStore((state) => state.liveSessionPhase);
  const setLiveSessionPhase = useLiveSessionStore((state) => state.setLiveSessionPhase);
  const setLiveSeconds = useLiveSessionStore((state) => state.setLiveSeconds);
  const setMetrics = useLiveSessionStore((state) => state.setMetrics);
  const addChatMessage = useLiveSessionStore((state) => state.addChatMessage);
  const setConnectedAccount = useLiveSessionStore((state) => state.setConnectedAccount);
  const setStreamKey = useLiveSessionStore((state) => state.setStreamKey);
  const setOauthConfigStatus = useLiveSessionStore((state) => state.setOauthConfigStatus);
  const setPipelineStatus = useLiveSessionStore((state) => state.setPipelineStatus);
  const setSessionSummary = useLiveSessionStore((state) => state.setSessionSummary);

  const isMountedRef = useRef(false);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    const onQuota = () => {
      showToast(
        "Penyimpanan browser penuh. Hapus beberapa produk lama atau refresh setelah deploy terbaru. Data tetap dipakai sampai halaman ditutup.",
        "warning",
      );
    };
    window.addEventListener(PRODUCT_STORAGE_QUOTA_EVENT, onQuota);
    return () => window.removeEventListener(PRODUCT_STORAGE_QUOTA_EVENT, onQuota);
  }, [showToast]);

  // Reconcile persisted session state with backend after reload.
  useEffect(() => {
    const sid = useLiveSessionStore.getState().currentLiveSessionId;
    if (!sid) return;

    void liveSessionService.fetchMetrics(sid).then((json) => {
      const sessionStatus = json?.data?.sessionStatus as string | undefined;
      const backendSid = (json?.data?.sessionId as string | undefined) || sid;
      const dead =
        !sessionStatus ||
        sessionStatus === "ended" ||
        sessionStatus === "error" ||
        sessionStatus === "idle";

      if (dead) {
        useLiveSessionStore.setState({
          isLiveActive: false,
          isConnectingLive: false,
          isWaitingForGoLive: false,
          liveSessionPhase: "idle",
          currentLiveSessionId: null,
          pipelineStatus: null,
        });
        return;
      }

      if (sessionStatus === "starting" || sessionStatus === "pending") {
        useLiveSessionStore.setState({
          currentLiveSessionId: backendSid,
          liveSessionPhase: "pending",
          isConnectingLive: true,
          isWaitingForGoLive: true,
          isLiveActive: false,
        });
        return;
      }

      if (sessionStatus === "live") {
        useLiveSessionStore.setState({
          currentLiveSessionId: backendSid,
          liveSessionPhase: "live",
          isLiveActive: true,
          isConnectingLive: false,
          isWaitingForGoLive: false,
        });
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  useEffect(() => {
    if (typeof window === "undefined" || isMountedRef.current) return;
    isMountedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthDisplay = params.get("display");
    const oauthError = params.get("oauth_error");

    if (oauthSuccess) {
      const decodedPlat = decodeURIComponent(oauthSuccess);
      showToast(`${decodedPlat} berhasil terhubung — ${decodeURIComponent(oauthDisplay || "")}`);
      oauthService.fetchProfile(decodedPlat).then((acc) => {
        if (acc?.isConnected) {
          setConnectedAccount(acc);
          // Hanya isi stream key nyata — jangan overwrite dengan key kosong/palsu OAuth.
          const key = (acc.streamKey || "").trim();
          if (key && !key.startsWith("live_")) setStreamKey(key);
          setSelectedPlatform(decodedPlat);
        }
      });
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (oauthError) {
      const errMessages: Record<string, string> = {
        invalid_state: "Sesi OAuth tidak valid atau kadaluarsa. Coba lagi.",
        token_exchange_failed: "Gagal menukar kode otorisasi. Periksa Client ID/Secret di .env.",
        missing_params: "Platform tidak mengirim kode otorisasi.",
        server_error: "Server error saat proses OAuth. Cek backend log.",
        access_denied: "Akses ditolak oleh pengguna.",
      };
      const msg = errMessages[oauthError] || `OAuth error: ${oauthError}`;
      showToast(`Gagal: ${msg}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [setConnectedAccount, setSelectedPlatform, setStreamKey, showToast]);

  useEffect(() => {
    oauthService.fetchConfigStatus().then(setOauthConfigStatus);
  }, [setOauthConfigStatus]);

  useEffect(() => {
    oauthService.fetchProfile(selectedPlatform).then((acc) => {
      if (acc?.isConnected) {
        setConnectedAccount(acc);
        const key = (acc.streamKey || "").trim();
        if (key && !key.startsWith("live_")) setStreamKey(key);
      } else {
        setConnectedAccount(null);
      }
    });
  }, [selectedPlatform, setConnectedAccount, setStreamKey]);

  useEffect(() => {
    if (!isLiveActive || products.length <= 1 || !automations.autoPin) return;

    const interval = setInterval(
      () => {
        setActiveFeaturedProduct((current) => {
          const nextIdx = (products.findIndex((p) => p.id === current.id) + 1) % products.length;
          const nextProd = products[nextIdx];

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

          liveSessionService.switchProduct(
            nextProd.id || "1",
            nextProd.name,
            toLiveProductSnapshot(nextProd, { includeMedia: true, includeScriptBank: true }),
            useLiveSessionStore.getState().currentLiveSessionId || undefined,
          );

          return nextProd;
        });
      },
      10 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [isLiveActive, products, automations.autoPin, selectedAvatar.name, setActiveFeaturedProduct, addChatMessage]);

  useEffect(() => {
    if (!isLiveActive || isLivePaused) return;
    const maxAllowedSeconds = selectedDuration * 3600;

    const timer = setInterval(() => {
      setLiveSeconds((prev) => {
        const nextSec = prev + 1;
        if (nextSec >= maxAllowedSeconds) {
          setIsLiveActive(false);
          setIsLivePaused(false);
          setLiveSessionPhase("ended");
          setShowSummaryModal(true);
          showToast(`Waktu siaran telah mencapai batas durasi ${selectedDuration} jam. Live streaming selesai!`);

          liveSessionService
            .stopSession({
              sessionId: currentLiveSessionId,
              durationSeconds: maxAllowedSeconds,
            })
            .then((res) => {
              if (res?.summary) setSessionSummary(res.summary);
            });

          return maxAllowedSeconds;
        }
        return nextSec;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [
    isLiveActive,
    isLivePaused,
    selectedDuration,
    currentLiveSessionId,
    setIsLiveActive,
    setIsLivePaused,
    setLiveSessionPhase,
    setShowSummaryModal,
    showToast,
    setSessionSummary,
    setLiveSeconds,
  ]);

  useEffect(() => {
    if (!isLiveActive || isLivePaused) return;

    const interval = setInterval(async () => {
      const json = await liveSessionService.fetchMetrics(currentLiveSessionId);
      if (!json) return;

      const backendMetrics = json.data?.metrics;
      const sessionStatus = json.data?.sessionStatus;

      if (sessionStatus === "live" && liveSessionPhase !== "live") {
        setLiveSessionPhase("live");
      } else if (sessionStatus === "pending" && liveSessionPhase !== "pending") {
        setLiveSessionPhase("pending");
      } else if (!sessionStatus && liveSessionPhase !== "idle" && liveSessionPhase !== "ended") {
        setLiveSessionPhase("ended");
        setIsLiveActive(false);
        setIsLivePaused(false);
      }

      if (backendMetrics) {
        setMetrics({
          viewers: Number(backendMetrics.viewers || 0),
          comments: Number(backendMetrics.comments || 0),
          clicks: Number(backendMetrics.clicks || 0),
          sales: Number(backendMetrics.sales || 0),
          activeProductClicks: Number(backendMetrics.clicks || 0),
          activeProductSold: Number(backendMetrics.orders || 0),
        });

        const recent = backendMetrics.recentComments as
          | Array<{ id: string; sender: string; text: string; time: string; aiReply?: string }>
          | undefined;
        if (recent?.length) {
          const existing = useLiveSessionStore.getState().chatMessages;
          const known = new Set(existing.map((m) => m.id));
          for (const c of recent) {
            if (!known.has(c.id)) {
              addChatMessage({
                id: c.id,
                sender: c.sender || "Penonton",
                isAi: false,
                avatarColor: "bg-amber-600",
                text: c.text,
                time: c.time,
              });
              known.add(c.id);
            }
            if (c.aiReply && !known.has(`${c.id}-ai`)) {
              addChatMessage({
                id: `${c.id}-ai`,
                sender: `AI Host`,
                isAi: true,
                avatarColor: "bg-[#4148e2]",
                text: c.aiReply,
                time: c.time,
              });
              known.add(`${c.id}-ai`);
            }
          }
        }
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isLiveActive, isLivePaused, liveSessionPhase, currentLiveSessionId, setIsLiveActive, setIsLivePaused, setLiveSessionPhase, setMetrics, addChatMessage]);

  useEffect(() => {
    if (!isConnectingLive || !currentLiveSessionId) return;

    const pollPipeline = async () => {
      const json = await liveSessionService.fetchPipelineStatus(currentLiveSessionId);
      if (!json) return;
      setPipelineStatus(json);
      if (json.stageText) {
        useLiveSessionStore.setState({ connectingStageText: String(json.stageText) });
      }
    };

    void pollPipeline();
    const interval = setInterval(pollPipeline, 2000);
    return () => clearInterval(interval);
  }, [isConnectingLive, currentLiveSessionId, setPipelineStatus]);

  useEffect(() => {
    if (!isLiveActive || isLivePaused || !currentLiveSessionId) return;

    const pollPipeline = async () => {
      const json = await liveSessionService.fetchPipelineStatus(currentLiveSessionId);
      if (!json) return;
      setPipelineStatus(json);
    };

    void pollPipeline();
    const interval = setInterval(pollPipeline, 5000);
    return () => clearInterval(interval);
  }, [isLiveActive, isLivePaused, currentLiveSessionId, setPipelineStatus]);

  return (
    <div className="min-h-screen bg-[#060a14] text-white p-4 font-sans selection:bg-blue-500/30">
      <ToastNotification />

      <div className="mx-auto w-full max-w-[1600px]">
        <DashboardHeader />
        {appMode === "LIVE_STUDIO" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-stretch">
              <div className="min-h-0 min-w-0 xl:h-full">
                <ProductPanel />
              </div>
              <div className="min-h-0 min-w-0 xl:h-full">
                <AiHostPanel />
              </div>
              <div className="min-h-0 min-w-0 xl:h-full">
                <BroadcastSettingsPanel />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1.1fr]">
              <LivePreviewBoard />
              <LiveControlBar />
            </div>
          </div>
        ) : (
          <VideoAdsGeneratorPanel />
        )}

        <DashboardModals />
      </div>
    </div>
  );
}