"use client";

import React, { useEffect, useRef } from "react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useProductStore, PRODUCT_STORAGE_QUOTA_EVENT } from "@/stores/useProductStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { oauthService } from "@/services/oauthService";
import { liveSessionService, parseLiveClockFromMetrics, toLiveProductSnapshot } from "@/services/liveSessionService";
import { toClientCopy } from "@/lib/client-copy";

import { ToastNotification } from "@/components/dashboard/shared/ToastNotification";
import { DashboardHeader } from "@/components/dashboard/header/DashboardHeader";
import { ProductPanel } from "@/components/dashboard/product/ProductPanel";
import { AiHostPanel } from "@/components/dashboard/ai-host/AiHostPanel";
import { BroadcastSettingsPanel } from "@/components/dashboard/broadcast/BroadcastSettingsPanel";
import { LivePreviewBoard } from "@/components/dashboard/live-studio/LivePreviewBoard";
import { LiveControlBar } from "@/components/dashboard/live-studio/LiveControlBar";
import { DashboardModals } from "@/components/dashboard/DashboardModals";

export default function Dashboard() {
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
  const setLiveSessionPhase = useLiveSessionStore((state) => state.setLiveSessionPhase);
  const setLiveSeconds = useLiveSessionStore((state) => state.setLiveSeconds);
  const applyLiveClock = useLiveSessionStore((state) => state.applyLiveClock);
  const setMetrics = useLiveSessionStore((state) => state.setMetrics);
  const addChatMessage = useLiveSessionStore((state) => state.addChatMessage);
  const setConnectedAccount = useLiveSessionStore((state) => state.setConnectedAccount);
  const setStreamKey = useLiveSessionStore((state) => state.setStreamKey);
  const setOauthConfigStatus = useLiveSessionStore((state) => state.setOauthConfigStatus);
  const setPipelineStatus = useLiveSessionStore((state) => state.setPipelineStatus);
  const endLiveSession = useLiveSessionStore((state) => state.endLiveSession);

  const isMountedRef = useRef(false);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    const onQuota = () => {
      showToast(
        "Penyimpanan browser penuh. Hapus beberapa produk lama, lalu muat ulang halaman.",
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
      const dead = !sessionStatus || sessionStatus === "ended" || sessionStatus === "error" || sessionStatus === "idle";

      if (dead) {
        useLiveSessionStore.setState({
          isLiveActive: false,
          isConnectingLive: false,
          isWaitingForGoLive: false,
          liveSessionPhase: "idle",
          currentLiveSessionId: null,
          pipelineStatus: null,
          liveSeconds: 0,
          liveStartedAtMs: 0,
        });
        return;
      }

      const clock = parseLiveClockFromMetrics(json?.data as Record<string, unknown> | undefined);

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
        if (clock) applyLiveClock(clock);
      }
    }).catch((err) => {
      showToast(err instanceof Error ? err.message : "Gagal menyambung ulang sesi live.", "warning");
    });
  }, [applyLiveClock, showToast]);

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
        invalid_state: "Sesi login kedaluwarsa. Coba hubungkan lagi.",
        token_exchange_failed: "Gagal menghubungkan akun. Coba lagi.",
        missing_params: "Platform tidak mengirim kode login. Coba lagi.",
        server_error: "Gangguan server saat menghubungkan akun.",
        access_denied: "Akses akun ditolak.",
      };
      const msg = errMessages[oauthError] || "Gagal menghubungkan akun.";
      showToast(msg);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [setConnectedAccount, setSelectedPlatform, setStreamKey, showToast]);

  useEffect(() => {
    oauthService.fetchConfigStatus().then(setOauthConfigStatus).catch((err) => {
      showToast(err instanceof Error ? err.message : "Gagal memuat status koneksi akun.", "warning");
    });
  }, [setOauthConfigStatus, showToast]);

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

    const interval = setInterval(async () => {
      const current = useProductStore.getState().activeFeaturedProduct;
      const nextIdx = (products.findIndex((p) => p.id === current.id) + 1) % products.length;
      const nextProd = products[nextIdx];
      if (!nextProd || nextProd.id === current.id) return;
      try {
        await liveSessionService.switchProduct(
          nextProd.id || "1",
          nextProd.name,
          toLiveProductSnapshot(nextProd, { includeMedia: true, includeScriptBank: true }),
          useLiveSessionStore.getState().currentLiveSessionId || undefined,
        );
        setActiveFeaturedProduct(nextProd);
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
        showToast(err instanceof Error ? err.message : "Gagal ganti produk otomatis.", "error");
      }
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isLiveActive, products, automations.autoPin, selectedAvatar.name, setActiveFeaturedProduct, addChatMessage, showToast]);

  useEffect(() => {
    if (!isLiveActive) return;
    const maxAllowedSeconds = selectedDuration * 3600;
    let expiryTriggered = false;

    const tick = () => {
      const state = useLiveSessionStore.getState();
      const nextSec = state.liveStartedAtMs
        ? Math.max(0, Math.floor((Date.now() - state.liveStartedAtMs) / 1000))
        : state.liveSeconds + 1;
      if (nextSec >= maxAllowedSeconds) {
        setLiveSeconds(maxAllowedSeconds);
        if (expiryTriggered) return;
        expiryTriggered = true;
        setShowSummaryModal(true);
        showToast(`Waktu siaran telah mencapai batas durasi ${selectedDuration} jam. Live streaming selesai!`);
        void endLiveSession().then((summary) => {
          if (summary.gpuWarning) showToast(summary.gpuWarning, "warning");
        });
        return;
      }
      setLiveSeconds(nextSec);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [
    isLiveActive,
    isLivePaused,
    selectedDuration,
    setShowSummaryModal,
    showToast,
    endLiveSession,
    setLiveSeconds,
  ]);

  useEffect(() => {
    if (!isLiveActive || isLivePaused) return;

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let failCount = 0;

    const pollMetrics = async () => {
      if (stopped) return;
      try {
        const json = await liveSessionService.fetchMetrics(currentLiveSessionId);
        if (!json || stopped) return;
        failCount = 0;

        const backendMetrics = json.data?.metrics;
        const sessionStatus = json.data?.sessionStatus;
        const currentPhase = useLiveSessionStore.getState().liveSessionPhase;

        if (sessionStatus === "live" && currentPhase !== "live") {
          setLiveSessionPhase("live");
        } else if (sessionStatus === "pending" && currentPhase !== "pending") {
          setLiveSessionPhase("pending");
        } else if (!sessionStatus && currentPhase !== "idle" && currentPhase !== "ended") {
          setLiveSessionPhase("ended");
          setIsLiveActive(false);
          setIsLivePaused(false);
        }

        const clock = parseLiveClockFromMetrics(json.data as Record<string, unknown> | undefined);
        if (clock && (sessionStatus === "live" || currentPhase === "live")) {
          applyLiveClock(clock);
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
      } catch (err) {
        failCount += 1;
        if (failCount === 3) {
          showToast(err instanceof Error ? err.message : "Gagal memuat statistik siaran.", "warning");
        }
      } finally {
        if (!stopped) timeoutId = setTimeout(() => void pollMetrics(), 2500);
      }
    };

    void pollMetrics();
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isLiveActive, isLivePaused, currentLiveSessionId, setIsLiveActive, setIsLivePaused, setLiveSessionPhase, setMetrics, addChatMessage, applyLiveClock, showToast]);

  useEffect(() => {
    if (!isConnectingLive || !currentLiveSessionId) return;

    const pollPipeline = async () => {
      try {
        const json = await liveSessionService.fetchPipelineStatus(currentLiveSessionId);
        if (!json) return;
        setPipelineStatus(json);
        if (json.rtmpFatal || json.workerError || json.broadcastBootState === "error") {
          useLiveSessionStore.setState({
            connectingStageIndex: 3,
            connectingStageText: toClientCopy(
              json.rtmpError || json.workerError || json.stageText,
              "Host AI gagal tersambung.",
            ),
          });
        } else if (json.stageText) {
          useLiveSessionStore.setState({ connectingStageText: toClientCopy(json.stageText) });
        }
      } catch {
        // Cold start: pipeline belum siap. Overlay tetap menampilkan tahap terakhir.
      }
    };

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const pollSerial = async () => {
      if (stopped) return;
      await pollPipeline();
      if (!stopped) timeoutId = setTimeout(() => void pollSerial(), 2000);
    };

    void pollSerial();
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isConnectingLive, currentLiveSessionId, setPipelineStatus]);

  useEffect(() => {
    if (!isLiveActive || isLivePaused || !currentLiveSessionId) return;

    let failCount = 0;
    const pollPipeline = async () => {
      try {
        const json = await liveSessionService.fetchPipelineStatus(currentLiveSessionId);
        if (!json) return;
        failCount = 0;
        setPipelineStatus(json);
      } catch (err) {
        failCount += 1;
        if (failCount === 3) {
          showToast(err instanceof Error ? err.message : "Gagal memuat status persiapan siaran.", "warning");
        }
      }
    };

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const pollSerial = async () => {
      if (stopped) return;
      await pollPipeline();
      if (!stopped) timeoutId = setTimeout(() => void pollSerial(), 5000);
    };

    void pollSerial();
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isLiveActive, isLivePaused, currentLiveSessionId, setPipelineStatus, showToast]);

  return (
    <div className="min-h-screen bg-[#060a14] text-white p-4 font-sans selection:bg-blue-500/30">
      <ToastNotification />

      <div className="mx-auto w-full max-w-[1600px]">
        <DashboardHeader />
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

        <DashboardModals />
      </div>
    </div>
  );
}
