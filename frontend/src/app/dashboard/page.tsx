/* eslint-disable react-hooks/immutability */
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import RealtimeLivePortraitView from "@/components/avatar/RealtimeLivePortraitView";
import { LiveMetricsBar } from "@/components/dashboard/LiveMetricsBar";

import {
  Product,
  BackendProduct,
  CsvRawItem,
  LiveSalesScript,
  SessionSummaryData,
  Avatar,
  ChatMessage,
} from "./types";
import { avatars } from "./constants";

export default function Dashboard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("ALL");

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCat =
        productCategoryFilter === "ALL" ||
        (p.tag &&
          p.tag.toLowerCase().includes(productCategoryFilter.toLowerCase()));
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.tag && p.tag.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [products, productCategoryFilter, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: products.length };
    products.forEach((p) => {
      const tag = p.tag || "General";
      counts[tag] = (counts[tag] || 0) + 1;
    });
    return counts;
  }, [products]);

  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showEditProductModal, setShowEditProductModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [productModalTab, setProductModalTab] = useState<"BASIC" | "RAG">(
    "BASIC",
  );
  const [editModalTab, setEditModalTab] = useState<"BASIC" | "RAG">("BASIC");
  const [selectedProductForEdit, setSelectedProductForEdit] =
    useState<Product | null>(null);
  const [newProductForm, setNewProductForm] = useState({
    name: "",
    price: "",
    stock: 0,
    tag: "",
    sku: "",
    image: "",
    link: "",
    description: "",
    benefits: "",
    usage: "",
    faq: "",
    targetAudience: "",
  });
  const [csvText, setCsvText] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar>(avatars[0]);
  const [selectedTone, setSelectedTone] = useState<string>("Energetic");
  const [selectedVoice, setSelectedVoice] =
    useState<string>("id-ID-SitiNeural");
  const [selectedLang, setSelectedLang] = useState<string>("Bahasa Indonesia");
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isSynthesizingAudio, setIsSynthesizingAudio] = useState(false);
  const avatarCarouselRef = useRef<HTMLDivElement>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(1);
  const [selectedPlatform, setSelectedPlatform] =
    useState<string>("Shopee Live");
  const [automations, setAutomations] = useState({
    autoReply: true,
    autoPin: true,
    autoPromo: true,
    autoModeration: true,
  });
  const [pinnedProductIds, setPinnedProductIds] = useState<string[]>([]);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [liveSalesScriptData, setLiveSalesScriptData] =
    useState<LiveSalesScript | null>(null);
  const [isLoadingLiveScript, setIsLoadingLiveScript] = useState(false);
  const [activeFeaturedProduct, setActiveFeaturedProduct] = useState<Product>(
    products[0] || {
      id: "loading",
      name: "Memuat Produk...",
      price: "Rp0",
      stock: 0,
      tag: "Loading",
      image: "",
      link: "",
    },
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem("ai_host_products");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          setProducts(parsed);
          setActiveFeaturedProduct(parsed[0]);
          return;
        }
      }
    } catch (err) {
      console.error("Failed to load products from local storage:", err);
      setProducts([]);
      setActiveFeaturedProduct({} as Product);
    }
  }, []);

  useEffect(() => {
    if (products.length > 0) {
      localStorage.setItem("ai_host_products", JSON.stringify(products));
    }
  }, [products]);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [currentLiveVideoUrl, setCurrentLiveVideoUrl] = useState<string | null>(
    null,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputChat, setInputChat] = useState("");
  const [isAiAutoReplyOn, setIsAiAutoReplyOn] = useState(true);
  const [connectMode, setConnectMode] = useState<"1CLICK" | "MANUAL">("1CLICK");
  const [connectedAccount, setConnectedAccount] = useState<{
    platform: string;
    isConnected: boolean;
    username: string;
    displayName: string;
    storeName: string;
    avatarUrl: string;
    followers: number;
    rating: number;
    status: string;
    ingestUrl?: string;
    streamKey?: string;
    accessToken?: string;
    liveChatId?: string;
    liveVideoId?: string;
  } | null>(null);
  const [customRtmpUrl, setCustomRtmpUrl] = useState("");
  const [streamKey, setStreamKey] = useState("live_sec_892348a7b9c1e2f");
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [isConnectingLive, setIsConnectingLive] = useState(false);
  const [hasConfirmedBroadcast, setHasConfirmedBroadcast] = useState(false);
  const [isWaitingForGoLive, setIsWaitingForGoLive] = useState(false);
  const [connectingStageIndex, setConnectingStageIndex] = useState(0);
  const [connectingStageText, setConnectingStageText] = useState(
    "Mengalokasikan Cloud GPU RTX 4090...",
  );
  const connectingAbortRef = useRef<AbortController | null>(null);
  const [currentLiveSessionId, setCurrentLiveSessionId] = useState<
    string | null
  >(null);
  const [pipelineStatus, setPipelineStatus] = useState<{
    ready: boolean;
    generationCount: number;
    videosQueued: number;
    pendingCount: number;
    isLive?: boolean;
    stageIndex?: number;
    stageText?: string;
  } | null>(null);

  useEffect(() => {
    if (!isConnectingLive) {
      setConnectingStageIndex(0);
      setConnectingStageText("Mengalokasikan Cloud GPU RTX 4090...");
      return;
    }
    if (pipelineStatus?.stageText) {
      setConnectingStageText(pipelineStatus.stageText);
    }
    if (typeof pipelineStatus?.stageIndex === "number") {
      setConnectingStageIndex(pipelineStatus.stageIndex);
    }
  }, [isConnectingLive, pipelineStatus]);
  const [liveSessionPhase, setLiveSessionPhase] = useState<
    "idle" | "pending" | "live" | "ended"
  >("idle");
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEndLiveConfirm, setShowEndLiveConfirm] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [sessionSummary, setSessionSummary] =
    useState<SessionSummaryData | null>(null);
  const [oauthConfigStatus, setOauthConfigStatus] = useState<
    Record<string, boolean>
  >({});
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthDisplay = params.get("display");
    const oauthError = params.get("oauth_error");

    if (oauthSuccess) {
      showToast(
        `✅ ${decodeURIComponent(oauthSuccess)} berhasil terhubung — ${decodeURIComponent(oauthDisplay || "")}`,
      );
      fetch(
        `/api/oauth/profile/${encodeURIComponent(decodeURIComponent(oauthSuccess))}`,
      )
        .then((r) => r.json())
        .then((json) => {
          if (json.data?.isConnected) {
            setConnectedAccount(json.data);
            if (json.data.streamKey) setStreamKey(json.data.streamKey);
            setSelectedPlatform(decodeURIComponent(oauthSuccess));
          }
        })
        .catch(() => {});
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (oauthError) {
      const errMessages: Record<string, string> = {
        invalid_state: "Sesi OAuth tidak valid atau kadaluarsa. Coba lagi.",
        token_exchange_failed:
          "Gagal menukar kode otorisasi. Periksa Client ID/Secret di .env.",
        missing_params: "Platform tidak mengirim kode otorisasi.",
        server_error: "Server error saat proses OAuth. Cek backend log.",
        access_denied: "Akses ditolak oleh pengguna.",
      };
      const msg = errMessages[oauthError] || `OAuth error: ${oauthError}`;
      showToast(`❌ ${msg}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetch("/api/oauth/config-status")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          const map: Record<string, boolean> = {};
          (json.data as { platform: string; configured: boolean }[]).forEach(
            (p) => {
              map[p.platform] = p.configured;
            },
          );
          setOauthConfigStatus(map);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/oauth/profile/${encodeURIComponent(selectedPlatform)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data && json.data.isConnected) {
          setConnectedAccount(json.data);
          if (json.data.streamKey) setStreamKey(json.data.streamKey);
        } else {
          setConnectedAccount(null);
        }
      })
      .catch(() => {});
  }, [selectedPlatform]);
  const [appMode, setAppMode] = useState<"LIVE_STUDIO" | "VIDEO_GENERATOR">(
    "LIVE_STUDIO",
  );
  const [videoDuration, setVideoDuration] = useState<"15s" | "30s" | "60s">(
    "30s",
  );
  const [videoScript, setVideoScript] = useState({
    hook: "Kaitkan perhatian penonton di sini!",
    problem: "Jelaskan masalah yang dialami penonton.",
    solution: "Tawarkan produk Anda sebagai solusinya.",
    cta: "Ajak penonton untuk membeli sekarang!",
    fullVoiceover:
      "Naskah lengkap akan muncul di sini setelah Anda menekan tombol Generate Script.",
  });
  const [tutorialPlatformTab, setTutorialPlatformTab] =
    useState<string>("TikTok LIVE");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [hasRenderedVideo, setHasRenderedVideo] = useState(false);
  const videoPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [metrics, setMetrics] = useState({
    viewers: 0,
    comments: 0,
    clicks: 0,
    sales: 0,
    activeProductClicks: 0,
    activeProductSold: 0,
  });

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (videoPollingRef.current) {
        clearInterval(videoPollingRef.current);
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  const speakText = async (
    text: string,
    opts?: {
      voice?: string;
      lang?: string;
      tone?: string;
      avatar?: string;
      speed?: number;
    },
  ) => {
    if (isPlayingAudio) {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      setIsPlayingAudio(false);
      setIsAvatarSpeaking(false);
      setIsSynthesizingAudio(false);
      return;
    }

    setIsSynthesizingAudio(true);
    setIsAvatarSpeaking(true);
    try {
      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: opts?.voice || selectedVoice,
          avatarName: opts?.avatar || selectedAvatar.name,
          speed: opts?.speed ?? speechSpeed,
          tone: opts?.tone || selectedTone,
        }),
      });

      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const json = await res.json();
          setIsPlayingAudio(false);
          setIsAvatarSpeaking(false);
          setIsSynthesizingAudio(false);
          showToast(`⚠️ TTS: ${json.error || "Gagal memproses suara"}`);
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        setIsPlayingAudio(true);
        setIsSynthesizingAudio(false);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setIsPlayingAudio(false);
          setIsAvatarSpeaking(false);
        };
        audio.onerror = () => {
          setIsPlayingAudio(false);
          setIsAvatarSpeaking(false);
          setIsSynthesizingAudio(false);
        };
        await audio.play().catch(() => {});
      } else {
        const errJson = await res.json().catch(() => null);
        setIsPlayingAudio(false);
        setIsAvatarSpeaking(false);
        setIsSynthesizingAudio(false);
        showToast(
          errJson?.error
            ? `⚠️ TTS: ${errJson.error}`
            : "⚠️ Gagal memproses audio dari backend.",
        );
      }
    } catch (err) {
      console.warn("[speakText] Audio playback notice:", err);
      setIsPlayingAudio(false);
      setIsAvatarSpeaking(false);
      setIsSynthesizingAudio(false);
    }
  };

  const handleGenerateAvatarVideo = async (scriptText?: string) => {
    if (videoPollingRef.current) clearInterval(videoPollingRef.current);
    const script =
      scriptText ??
      `Halo semuanya! Selamat datang di sesi live streaming kami. Perkenalkan saya ${selectedAvatar.name}, AI presenter Anda. Hari ini kami mempersembahkan produk ${activeFeaturedProduct.name} dengan kualitas terbaik dan promo spesial. Silakan melihat penawaran di keranjang sekarang ya!`;

    setIsRenderingVideo(true);
    setRenderProgress(0);

    try {
      const createRes = await fetch("/api/avatar/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarImageUrl: selectedAvatar.image?.startsWith("http")
            ? selectedAvatar.image
            : `http://localhost:3000${selectedAvatar.image}`,
          productImageUrl: activeFeaturedProduct.image?.startsWith("http")
            ? activeFeaturedProduct.image
            : undefined,
          scriptText: script,
          avatarName: selectedAvatar.id,
          tone: selectedTone,
        }),
      });

      if (!createRes.ok) {
        throw new Error(`Backend error: ${createRes.status}`);
      }

      const createData = await createRes.json();
      const jobId: string = createData.data?.jobId;
      if (!jobId) throw new Error("No jobId returned from backend");

      showToast(`🎬 AI Video job started (${createData.data.provider})`);

      videoPollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/avatar/video-status/${jobId}`);
          const statusData = await statusRes.json();
          const { status, progress, videoUrl: url } = statusData.data ?? {};

          if (progress) setRenderProgress(progress);

          if (status === "done" && url) {
            if (videoPollingRef.current) clearInterval(videoPollingRef.current);
            setIsRenderingVideo(false);
            setHasRenderedVideo(true);
            setCurrentLiveVideoUrl(url);
            setIsAvatarSpeaking(false);
            showToast("✅ AI Avatar Video siap diputar!");
          } else if (status === "error") {
            if (videoPollingRef.current) clearInterval(videoPollingRef.current);
            setIsRenderingVideo(false);
            showToast("❌ Gagal generate video AI");
          }
        } catch {
          // Network hiccup — keep polling
        }
      }, 1500);
    } catch {
      setIsRenderingVideo(false);
      showToast("❌ Gagal terhubung ke backend");
    }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isLiveActive && !isLivePaused) {
      const maxAllowedSeconds = selectedDuration * 3600;

      timer = setInterval(() => {
        setLiveSeconds((prev) => {
          const nextSec = prev + 1;
          if (nextSec >= maxAllowedSeconds) {
            setIsLiveActive(false);
            setIsLivePaused(false);
            setLiveSessionPhase("ended");
            setShowSummaryModal(true);
            showToast(
              `⏱️ Waktu siaran telah mencapai batas durasi ${selectedDuration} Jam. Live streaming selesai!`,
            );
            try {
              fetch("/api/live-session/stop", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId: currentLiveSessionId,
                  durationSeconds: maxAllowedSeconds,
                  viewers: metrics.viewers,
                  comments: metrics.comments,
                  clicks: metrics.clicks,
                  sales: metrics.sales,
                }),
              })
                .then((res) => res.json())
                .then((json) => {
                  if (json.summary) setSessionSummary(json.summary);
                });
            } catch {}
            try {
              fetch("/api/live-stream/stop-broadcast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
            } catch {}

            return maxAllowedSeconds;
          }
          return nextSec;
        });
        if (Math.random() > 0.55) {
          const deltaViewers = Math.floor(Math.random() * 7) - 2;
          const hasNewComment = Math.random() > 0.7;
          const hasClick = Math.random() > 0.75;
          const hasPurchase = Math.random() > 0.88;

          setMetrics((prev) => {
            const newViewers = Math.max(120, prev.viewers + deltaViewers);
            const newComments = hasNewComment
              ? prev.comments + 1
              : prev.comments;
            const newClicks = hasClick ? prev.clicks + 1 : prev.clicks;
            const activeProductPriceNum =
              typeof activeFeaturedProduct.price === "number"
                ? activeFeaturedProduct.price
                : parseInt(
                    String(activeFeaturedProduct.price).replace(/[^0-9]/g, ""),
                  ) || 99000;
            const newSales = hasPurchase
              ? prev.sales + activeProductPriceNum
              : prev.sales;
            const newActiveClicks = hasClick
              ? prev.activeProductClicks + 1
              : prev.activeProductClicks;
            const newActiveSold = hasPurchase
              ? prev.activeProductSold + 1
              : prev.activeProductSold;

            return {
              viewers: newViewers,
              comments: newComments,
              clicks: newClicks,
              sales: newSales,
              activeProductClicks: newActiveClicks,
              activeProductSold: newActiveSold,
            };
          });
        }
      }, 1000);
    }
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveActive, isLivePaused, selectedDuration, activeFeaturedProduct]);

  // Synchronize Live Platform Metrics & Comments from Backend
  useEffect(() => {
    if (!isLiveActive || isLivePaused) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/live-session/metrics");
        if (res.ok) {
          const json = await res.json();
          const backendMetrics = json.data?.metrics;
          const sessionStatus = json.data?.sessionStatus;

          if (sessionStatus === "live" && liveSessionPhase !== "live") {
            setLiveSessionPhase("live");
          } else if (
            sessionStatus === "pending" &&
            liveSessionPhase !== "pending"
          ) {
            setLiveSessionPhase("pending");
          } else if (
            !sessionStatus &&
            liveSessionPhase !== "idle" &&
            liveSessionPhase !== "ended"
          ) {
            setLiveSessionPhase("ended");
            setIsLiveActive(false);
            setIsLivePaused(false);
          }

          if (
            backendMetrics &&
            (backendMetrics.viewers > 0 ||
              backendMetrics.comments > 0 ||
              backendMetrics.sales > 0)
          ) {
            setMetrics((prev) => ({
              viewers:
                backendMetrics.viewers > 0
                  ? backendMetrics.viewers
                  : prev.viewers,
              comments: Math.max(prev.comments, backendMetrics.comments),
              clicks: Math.max(prev.clicks, backendMetrics.clicks),
              sales: Math.max(prev.sales, backendMetrics.sales),
              activeProductClicks: Math.max(
                prev.activeProductClicks,
                backendMetrics.clicks,
              ),
              activeProductSold: Math.max(
                prev.activeProductSold,
                backendMetrics.orders,
              ),
            }));

            // Sync recent comments from live stream if any
            if (
              backendMetrics.recentComments &&
              backendMetrics.recentComments.length > 0
            ) {
              setChatMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const newItems: ChatMessage[] = [];
                for (const rc of backendMetrics.recentComments) {
                  if (!existingIds.has(rc.id)) {
                    newItems.push({
                      id: rc.id,
                      sender: rc.sender,
                      isAi: false,
                      avatarColor: "bg-blue-500",
                      text: rc.text,
                      time: rc.time,
                    });
                    if (rc.aiReply) {
                      newItems.push({
                        id: `${rc.id}-reply`,
                        sender: "AI Host",
                        isAi: true,
                        avatarColor: "bg-[#4148e2]",
                        text: rc.aiReply,
                        time: rc.time,
                      });
                    }
                  }
                }
                return newItems.length > 0 ? [...prev, ...newItems] : prev;
              });
            }
          }
        }
      } catch {}
    }, 2500);

    return () => clearInterval(interval);
  }, [isLiveActive, isLivePaused]);

  // Poll Pipeline Status when waiting for Go Live
  useEffect(() => {
    if ((!isWaitingForGoLive && !isConnectingLive) || !currentLiveSessionId)
      return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/live-stream/pipeline-status?sessionId=${currentLiveSessionId}`,
        );
        if (res.ok) {
          const json = await res.json();
          setPipelineStatus(json);
        }
      } catch (err) {}
    }, 2000);

    return () => clearInterval(interval);
  }, [isWaitingForGoLive, isConnectingLive, currentLiveSessionId]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Format Time
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((secs % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(secs % 60)
      .toString()
      .padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const handlePlayAudioPreview = async (
    voice: string = selectedVoice,
    _lang: string = selectedLang,
    tone: string = selectedTone,
    speed: number = speechSpeed,
  ) => {
    const previewText =
      tone === "FOMO"
        ? `Halo kak! Khusus promo hari ini, stok ${activeFeaturedProduct?.name && activeFeaturedProduct.name !== "Memuat Produk..." ? activeFeaturedProduct.name : "produk ini"} terbatas ya, yuk buruan checkout sekarang juga!`
        : tone === "Professional"
          ? `Halo semuanya, selamat datang. Saya ${selectedAvatar.name}. Hari ini kami mereview spesifikasi dan keunggulan ${activeFeaturedProduct?.name && activeFeaturedProduct.name !== "Memuat Produk..." ? activeFeaturedProduct.name : "produk unggulan kami"}.`
          : `Halo semuanya! Selamat datang di live streaming. Saya ${selectedAvatar.name}. Yuk langsung cek penawaran dan voucher spesial hari ini ya!`;

    showToast(
      `🔊 Memutar suara ${selectedAvatar.name} (${tone} • ${speed}x)...`,
    );
    await speakText(previewText, {
      voice,
      tone,
      speed,
      avatar: selectedAvatar.name,
    });
  };

  const scrollAvatars = (direction: "left" | "right") => {
    if (avatarCarouselRef.current) {
      const scrollAmount = 140;
      avatarCarouselRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const handlePlatformSelect = (platName: string) => {
    setSelectedPlatform(platName);
    if (platName.toLowerCase().includes("custom")) {
      setConnectMode("MANUAL");
      setCustomRtmpUrl("");
    } else if (platName.includes("Instagram")) {
      setCustomRtmpUrl("rtmps://live-upload.instagram.com:443/rtmp/");
    } else if (platName.includes("YouTube")) {
      setCustomRtmpUrl("rtmp://a.rtmp.youtube.com/live2");
    } else if (platName.includes("TikTok")) {
      setCustomRtmpUrl("rtmp://live.tiktok.com/live/");
    } else if (platName.includes("Shopee")) {
      setCustomRtmpUrl("rtmp://live.shopee.co.id/live/");
    } else if (platName.includes("Facebook")) {
      setCustomRtmpUrl("rtmps://live-api-s.facebook.com:443/rtmp/");
    } else {
      setCustomRtmpUrl("rtmp://live.livestreamer.ai/live");
    }
    showToast(`🎯 Platform siaran dipilih: ${platName}`);
  };

  const handleFetchLiveSalesScript = async () => {
    setShowScriptModal(true);
    setIsLoadingLiveScript(true);
    try {
      const res = await fetch("/api/ai/live-sales-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeProduct: activeFeaturedProduct,
          avatarName: selectedAvatar.name,
          tone: selectedTone,
          productName: activeFeaturedProduct.name,
          productPrice: String(activeFeaturedProduct.price),
          category: activeFeaturedProduct.tag,
          productDescription: activeFeaturedProduct.description || "",
          productBenefits: activeFeaturedProduct.benefits || "",
          productUsage: activeFeaturedProduct.usage || "",
          productFaq: activeFeaturedProduct.faq || "",
          productStock: activeFeaturedProduct.stock,
        }),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          res.ok
            ? "Format data AI tidak valid"
            : `Backend error (${res.status}): ${text.slice(0, 80) || "Internal Server Error"}`,
        );
      }

      if (res.ok && json?.data) {
        setLiveSalesScriptData(json.data);
        showToast("✨ Naskah promosi AI Host berhasil dibuat dari RAG produk!");
      } else {
        throw new Error(json?.error || "AI service offline");
      }
    } catch (err: unknown) {
      console.error("Failed to load live sales script:", err);
      setLiveSalesScriptData(null);
      showToast(
        `❌ ${(err as Error)?.message || "AI Host tidak dapat dijangkau. Pastikan backend aktif."}`,
      );
    } finally {
      setIsLoadingLiveScript(false);
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !newProductForm.name ||
      !newProductForm.price ||
      !newProductForm.stock ||
      !newProductForm.tag
    ) {
      showToast("❌ Nama, harga, stok, dan kategori wajib diisi.");
      return;
    }

    const numPrice =
      parseInt(String(newProductForm.price).replace(/[^0-9]/g, "")) || 99000;
    let createdId = `prod_${Date.now()}`;

    const payload = {
      name: newProductForm.name.trim(),
      price: numPrice,
      stock: Number(newProductForm.stock) || 50,
      category: newProductForm.tag || "Skincare",
      sku: newProductForm.sku || `SKU-${Date.now()}`,
      image:
        newProductForm.image ||
        "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
      link: newProductForm.link || "",
      description: newProductForm.description || "",
      benefits: newProductForm.benefits || "",
      usage: newProductForm.usage || "",
      faq: newProductForm.faq || "",
      targetAudience: newProductForm.targetAudience || "",
    };
    let savedProduct: BackendProduct;

    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Gagal menyimpan produk");
      }
      savedProduct = result.data as BackendProduct;
      createdId = savedProduct.id;
      Object.assign(payload, {
        description: savedProduct.description || payload.description,
        benefits: savedProduct.benefits || payload.benefits,
        usage: savedProduct.usage || payload.usage,
        faq: savedProduct.faq || payload.faq,
        targetAudience: savedProduct.targetAudience || payload.targetAudience,
      });
      showToast(
        "✨ AI berhasil membuat knowledge produk dan copywriting host!",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Gagal menyimpan produk",
      );
      return;
    }

    const newProd: Product = {
      id: createdId,
      name: payload.name,
      price: `Rp${numPrice.toLocaleString("id-ID")}`,
      stock: payload.stock,
      tag: payload.category,
      sku: payload.sku,
      image: payload.image,
      link: payload.link,
      description: payload.description,
      benefits: payload.benefits,
      usage: payload.usage,
      faq: payload.faq,
      targetAudience: payload.targetAudience,
      copywriting: savedProduct.copywriting,
    };

    setProducts((prev) => [newProd, ...prev]);
    setActiveFeaturedProduct(newProd);
    setShowAddProductModal(false);
    setNewProductForm({
      name: "",
      price: "",
      stock: 50,
      tag: "Skincare",
      sku: "",
      image: "",
      link: "",
      description: "",
      benefits: "",
      usage: "",
      faq: "",
      targetAudience: "",
    });
    showToast("✨ Produk & RAG Knowledge Base berhasil disimpan ke Database!");
  };

  const handleSaveEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductForEdit) return;

    const numPrice =
      typeof selectedProductForEdit.price === "number"
        ? selectedProductForEdit.price
        : parseInt(
            String(selectedProductForEdit.price).replace(/[^0-9]/g, ""),
          ) || 99000;

    const formattedProduct: Product = {
      ...selectedProductForEdit,
      name: selectedProductForEdit.name.trim(),
      price: `Rp${numPrice.toLocaleString("id-ID")}`,
      stock: Number(selectedProductForEdit.stock) || 0,
      tag: selectedProductForEdit.tag || "General",
      image:
        selectedProductForEdit.image ||
        "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
      link: selectedProductForEdit.link || "",
      description: selectedProductForEdit.description || "",
      benefits: selectedProductForEdit.benefits || "",
      usage: selectedProductForEdit.usage || "",
      faq: selectedProductForEdit.faq || "",
      targetAudience: selectedProductForEdit.targetAudience || "",
    };

    setProducts((prev) =>
      prev.map((p) =>
        p.id === selectedProductForEdit.id ? formattedProduct : p,
      ),
    );
    if (activeFeaturedProduct.id === selectedProductForEdit.id) {
      setActiveFeaturedProduct(formattedProduct);
    }
    setShowEditProductModal(false);
    showToast("✅ RAG Knowledge Base produk berhasil diperbarui!");
  };

  const handleDeleteProduct = async (id?: string) => {
    if (!id) return;
    if (
      confirm(
        "Apakah Anda yakin ingin menghapus produk ini secara permanen dari RAG Knowledge Base & Database?",
      )
    ) {
      setProducts((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (activeFeaturedProduct.id === id && next.length > 0) {
          setActiveFeaturedProduct(next[0]);
        }
        return next;
      });
      showToast("Produk telah dihapus dari database");
      // Database delete call removed
    }
  };

  // Handle CSV Import with Bulk API
  const handleImportCsv = async () => {
    if (!csvText.trim()) return;
    const lines = csvText.trim().split("n");
    const rawItems: CsvRawItem[] = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      if (!line || (idx === 0 && line.toLowerCase().startsWith("nama")))
        continue;

      const parts = line
        .split(",")
        .map((p) => p.trim().replace(/^["']|["']$/g, ""));
      if (parts.length >= 2) {
        const name = parts[0];
        const priceNum = parseInt(parts[1].replace(/[^0-9]/g, "")) || 99000;
        const stock = parseInt(parts[2]) || 50;
        const category = parts[3] || "Skincare";
        const description = parts[4] || "";
        const link = parts[5] || "";

        rawItems.push({
          name,
          price: priceNum,
          stock,
          category,
          description,
          link,
          image:
            "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
          benefits: "Kualitas premium dan terbukti aman",
          usage: "Gunakan secara teratur sesuai petunjuk",
          faq: "Original BPOM resmi & garansi uang kembali",
        });
      }
    }

    if (rawItems.length === 0) {
      showToast("❌ Tidak ada data CSV yang valid!");
      return;
    }

    const imported = rawItems.map(
      (p: CsvRawItem) =>
        ({
          id: `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          name: p.name || "",
          price:
            typeof p.price === "number"
              ? `Rp${p.price.toLocaleString("id-ID")}`
              : `Rp${p.price || 0}`,
          stock: Number(p.stock) || 0,
          tag: p.category || "General",
          image: p.image || "",
          link: p.link || "",
          description: p.description,
          benefits: p.benefits,
          usage: p.usage,
          faq: p.faq,
        }) as Product,
    );
    setProducts((prev) => [...imported, ...prev]);
    if (imported.length > 0) setActiveFeaturedProduct(imported[0] as any);
    setShowCsvModal(false);
    setCsvText("");
    showToast(
      `✅ ${imported.length} produk berhasil diimpor ke RAG Knowledge Base!`,
    );
  };

  // Handle AI Script Generation for Video Ads with Tier & Duration Sync
  const handleGenerateVideoScript = async (
    dur?: "15s" | "30s" | "60s",
    prod?: Product,
  ) => {
    const targetDuration = dur || videoDuration;
    const targetProduct = prod || activeFeaturedProduct;
    setIsGeneratingScript(true);
    showToast(`AI sedang merancang naskah copywriting (${targetDuration})...`);
    try {
      const res = await fetch("/api/ai/video-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: targetProduct.name,
          productPrice: targetProduct.price,
          productCategory: targetProduct.tag,
          durationType: targetDuration,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data?.script) {
          setVideoScript(json.data.script);
          showToast(
            `✨ Naskah copywriting ${targetDuration} berhasil disinkronkan!`,
          );
          setIsGeneratingScript(false);
          return;
        }
      }
    } catch {}

    setIsGeneratingScript(false);
    showToast("Naskah AI siap dipratinjau!");
  };

  // Handle Render Video Ads (Full End-to-End Pipeline Synced with AI Worker & Pricing Tier)
  const handleRenderVideo = async () => {
    const fullScript = `${videoScript.hook} ${videoScript.problem} ${videoScript.solution} ${videoScript.cta}`;
    const tierPrices: Record<string, string> = {
      "15s": "Rp19.000 (Short Hook)",
      "30s": "Rp35.000 (Standard Showcase)",
      "60s": "Rp59.000 (Deep Review)",
    };
    showToast(
      `⚡ Memulai render video iklan AI ${tierPrices[videoDuration]}...`,
    );
    await handleGenerateAvatarVideo(fullScript);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputChat.trim()) return;

    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Tampilkan komen yang diketik
    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: "Anda (Penonton)",
      isAi: false,
      avatarColor: "bg-blue-500",
      text: inputChat,
      time: now,
    };

    setChatMessages((prev) => [...prev, userMsg]);

    setInputChat("");

    if (!isAiAutoReplyOn) return;

    const prodName =
      activeFeaturedProduct?.name &&
      activeFeaturedProduct.name !== "Memuat Produk..."
        ? activeFeaturedProduct.name
        : "produk kami";
    const replyText = `Halo kak! Terima kasih atas pertanyaannya. Mengenai ${prodName}, produk ini sudah ready stock dan ada diskon spesial buat yang langsung checkout sekarang juga ya!`;

    const aiMsg: ChatMessage = {
      id: String(Date.now() + 1),
      sender: `AI Host (${selectedAvatar.name})`,
      isAi: true,
      avatarColor: "bg-[#4148e2]",
      text: replyText,
      time: now,
    };

    setChatMessages((prev) => [...prev, aiMsg]);
    speakText(replyText, {
      avatar: selectedAvatar.name,
      tone: selectedTone,
      voice: selectedVoice,
      speed: speechSpeed,
    });
  };

  // Handle Copy Clipboard
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} disalin ke clipboard!`);
  };

  // Filtered Avatars
  const filteredAvatars = avatars.filter((a) => a.type === "3D");

  return (
    <div className="min-h-screen bg-[#060a14] text-white p-4 font-sans selection:bg-blue-500/30">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-blue-500/40 bg-[#0f172a] px-4 py-3 text-xs font-semibold text-blue-300 shadow-2xl shadow-blue-500/20 animate-bounce">
          <span>✨</span>
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1600px]">
        {/* HEADER */}
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-[#1f2638] pb-4">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-2xl font-black tracking-tight text-white hover:opacity-90 transition"
            >
              LiveStreamer<span className="text-blue-500">AI</span>
            </Link>

            {/* Top Mode Switcher */}
            <div className="flex items-center rounded-xl bg-[#111827] p-1 border border-[#232c42] shadow-inner">
              <button
                onClick={() => setAppMode("LIVE_STUDIO")}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition active:scale-95 ${
                  appMode === "LIVE_STUDIO"
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${isLiveActive ? "bg-red-500 animate-ping" : "bg-blue-400"}`}
                />
                <span>🔴 24/7 Live Stream Studio</span>
              </button>
              <button
                onClick={() => {
                  setAppMode("VIDEO_GENERATOR");
                  handleGenerateVideoScript();
                }}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition active:scale-95 ${
                  appMode === "VIDEO_GENERATOR"
                    ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md shadow-purple-600/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>🎬 AI Video Ads Generator</span>
                <span className="rounded bg-pink-500/20 text-[9px] text-pink-300 px-1.5 py-0.2 border border-pink-500/30">
                  Hot
                </span>
              </button>
            </div>
          </div>

          {/* Progress Bar for Live Stream Studio */}
          {appMode === "LIVE_STUDIO" ? (
            <div className="flex items-center gap-2 sm:gap-3 text-xs text-slate-400 overflow-x-auto py-1">
              {[
                { num: 1, label: "Data Produk" },
                { num: 2, label: "AI Host" },
                { num: 3, label: "Atur Live" },
                { num: 4, label: "Preview & Test" },
                { num: 5, label: "Go Live" },
              ].map((step, idx) => (
                <React.Fragment key={step.num}>
                  <button
                    onClick={() => setCurrentStep(step.num)}
                    className="flex items-center gap-1.5 focus:outline-none transition group"
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold transition ${
                        currentStep === step.num
                          ? "bg-[#4148e2] text-white shadow-[0_0_12px_rgba(65,72,226,0.6)]"
                          : "border border-white/10 bg-[#161d2d] text-slate-400 group-hover:border-blue-500"
                      }`}
                    >
                      {step.num}
                    </span>
                    <span
                      className={`${
                        currentStep === step.num
                          ? "text-blue-400 font-bold"
                          : "text-slate-400 group-hover:text-slate-200"
                      }`}
                    >
                      {step.label}
                    </span>
                  </button>
                  {idx < 4 && <span className="h-px w-6 sm:w-10 bg-white/10" />}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                Format:{" "}
                <strong className="text-white">
                  Vertical 9:16 (TikTok / Reels / Shorts)
                </strong>
              </span>
            </div>
          )}
        </header>

        {/* MODE 1: LIVE STREAM STUDIO */}
        {appMode === "LIVE_STUDIO" ? (
          <div className="flex flex-col gap-4">
            {/* ROW 1: Step 1, Step 2, Step 3 with Equal Width */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {/* STEP 1: Data Produk & RAG Knowledge Base */}
              <div
                className={`flex flex-col rounded-xl border p-4 transition ${currentStep === 1 ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10" : "border-[#232c42] bg-[#0c1221]"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                      STEP 1
                    </span>
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      RAG Knowledge Active
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {products.length} Produk Terdaftar
                  </span>
                </div>
                <div className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Data Bisnis &amp; Produk</span>
                      <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20 font-mono">
                        {products.length} Item
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Data diolah ke <strong>RAG Knowledge Base</strong> agar AI
                      Host mahir menjawab live.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCsvModal(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#232c42] bg-[#111827] px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-blue-500 hover:text-white transition active:scale-95 shadow-sm"
                    >
                      <span>Import CSV</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        setProductModalTab("BASIC");
                        setShowAddProductModal(true);
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:brightness-110 transition active:scale-95 shadow-md shadow-blue-600/30"
                    >
                      <span>+ Tambah Produk</span>
                    </button>
                  </div>
                </div>

                {/* Search & Category Filter Row */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[160px]">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                      <svg
                        className="h-3.5 w-3.5 text-slate-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        ></path>
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="block w-full rounded-lg border border-[#232c42] bg-[#111827] py-1.5 pl-8 pr-7 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
                      placeholder="Cari produk berdasarkan nama, SKU, atau kategori..."
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-500 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Category Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[10px]">
                    {["ALL", "Skincare", "Beauty", "Fashion", "General"].map(
                      (cat) => {
                        const count = categoryCounts[cat] ?? 0;
                        const isActive = productCategoryFilter === cat;
                        return (
                          <button
                            key={cat}
                            onClick={() => setProductCategoryFilter(cat)}
                            className={`px-2.5 py-1.5 rounded-lg border transition shrink-0 font-medium flex items-center gap-1.5 ${
                              isActive
                                ? "border-blue-500 bg-blue-500/20 text-white font-bold shadow-sm"
                                : "border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200 hover:bg-[#162038]"
                            }`}
                          >
                            <span>{cat === "ALL" ? "Semua" : cat}</span>
                            <span
                              className={`text-[9px] px-1 py-0.2 rounded-full font-mono ${
                                isActive
                                  ? "bg-blue-600 text-white"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                {/* Main Content Layout: Product List + Upload Box */}
                <div className="flex flex-col lg:flex-row gap-3">
                  {/* Product Cards Container */}
                  <div className="flex-1 min-w-0">
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1.5">
                      {filteredProducts.map((p) => {
                        const isSelected =
                          activeFeaturedProduct.id === p.id ||
                          activeFeaturedProduct.name === p.name;
                        const hasRag = Boolean(
                          p.benefits ||
                          p.usage ||
                          p.faq ||
                          (p.description && p.description.length > 20),
                        );
                        const stockNumber = Number(p.stock) || 0;

                        return (
                          <div
                            key={p.id || p.name}
                            onClick={() => {
                              setActiveFeaturedProduct(p);
                              showToast(
                                `🎯 Produk live dialihkan ke: ${p.name}`,
                              );
                            }}
                            className={`group relative rounded-xl border p-2.5 cursor-pointer transition-all duration-200 ${
                              isSelected
                                ? "border-blue-500/80 bg-gradient-to-r from-blue-950/40 via-[#0d172e] to-[#0c1221] ring-1 ring-blue-500/30 shadow-md shadow-blue-950/40"
                                : "border-[#232c42]/60 bg-[#111827]/70 hover:border-slate-700 hover:bg-[#162038]/50"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Product Image Thumbnail */}
                              <div className="h-12 w-12 rounded-xl overflow-hidden flex-shrink-0 bg-[#162038] border border-white/10 shadow-md relative">
                                {p.image?.startsWith("http") ||
                                p.image?.startsWith("/") ||
                                p.image?.startsWith("data:") ? (
                                  <img
                                    src={p.image}
                                    alt={p.name}
                                    className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                                  />
                                ) : (
                                  <div
                                    className={`h-full w-full ${p.image || "bg-[#e5cbbb]"}`}
                                  />
                                )}
                                {isSelected && (
                                  <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-blue-400 ring-2 ring-blue-900" />
                                )}
                              </div>

                              {/* Details Column */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p
                                    className={`text-xs font-bold truncate ${isSelected ? "text-blue-200 font-extrabold" : "text-slate-100 group-hover:text-white"}`}
                                  >
                                    {p.name}
                                  </p>
                                  <span className="text-xs font-black text-emerald-400 shrink-0 font-mono">
                                    {p.price}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <span className="text-[9px] font-medium text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded border border-white/5">
                                    {p.tag || "General"}
                                  </span>
                                  {p.sku && (
                                    <span className="text-[8.5px] font-mono text-slate-400 bg-[#0c1221] px-1.5 py-0.5 rounded border border-slate-800">
                                      {p.sku}
                                    </span>
                                  )}
                                  {hasRag ? (
                                    <span className="text-[8.5px] font-semibold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                                      <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                                      🧠 RAG Ready
                                    </span>
                                  ) : (
                                    <span className="text-[8.5px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                      📝 Info Standar
                                    </span>
                                  )}
                                </div>

                                {p.description && (
                                  <p className="text-[10px] text-slate-400 truncate mt-1 line-clamp-1">
                                    {p.benefits || p.description}
                                  </p>
                                )}
                              </div>

                              {/* Stock & Action Buttons */}
                              <div className="flex flex-col items-end justify-between self-stretch shrink-0 pl-1">
                                <div>
                                  {stockNumber > 20 ? (
                                    <span className="text-[9.5px] font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-500/20">
                                      ● {stockNumber} pcs
                                    </span>
                                  ) : stockNumber > 0 ? (
                                    <span className="text-[9.5px] font-bold text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-500/20">
                                      ⚠️ {stockNumber} pcs
                                    </span>
                                  ) : (
                                    <span className="text-[9.5px] font-bold text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded-md border border-rose-500/20">
                                      ✕ Habis
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 mt-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedProductForEdit(p);
                                      setEditModalTab("BASIC");
                                      setShowEditProductModal(true);
                                    }}
                                    className="p-1 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition"
                                    title="Edit Produk & RAG Knowledge"
                                  >
                                    <svg
                                      width="13"
                                      height="13"
                                      fill="currentColor"
                                      viewBox="0 0 16 16"
                                    >
                                      <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteProduct(p.id);
                                    }}
                                    className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition"
                                    title="Hapus Produk"
                                  >
                                    <svg
                                      width="13"
                                      height="13"
                                      fill="currentColor"
                                      viewBox="0 0 16 16"
                                    >
                                      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                                      <path
                                        fillRule="evenodd"
                                        d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {filteredProducts.length === 0 && (
                        <div className="py-8 text-center rounded-xl border border-dashed border-[#232c42] bg-[#111827]/40 p-4">
                          <span className="text-2xl mb-1 block">🔍</span>
                          <p className="text-xs font-bold text-slate-300">
                            Tidak ada produk ditemukan
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {searchQuery
                              ? `Tidak ada hasil untuk pencarian "${searchQuery}"`
                              : "Kategori ini belum memiliki produk."}
                          </p>
                          <button
                            onClick={() => {
                              setSearchQuery("");
                              setProductCategoryFilter("ALL");
                              setShowAddProductModal(true);
                            }}
                            className="mt-2.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-500 transition"
                          >
                            + Tambah Produk Baru
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Upload Drag & Drop Box */}
                  <div className="w-full lg:w-[155px] flex-shrink-0 flex flex-col justify-between gap-2">
                    <label className="flex min-h-[120px] lg:h-full w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-500/50 bg-[#111827] text-center text-xs cursor-pointer hover:border-blue-400 hover:bg-[#162038] transition p-2.5 shadow-inner group">
                      <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center mb-1 text-blue-400 group-hover:scale-110 transition">
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          ></path>
                        </svg>
                      </div>
                      <p className="font-bold text-slate-200 text-[11px]">
                        Upload Foto Produk
                      </p>
                      <p className="text-[8.5px] text-slate-400 mt-0.5">
                        Terapkan ke produk aktif
                      </p>
                      <p className="mt-1 text-[7.5px] text-blue-400/80 font-mono">
                        JPG, PNG, WebP
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            const file = e.target.files[0];
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              if (ev.target?.result) {
                                const uploadedUri = String(ev.target.result);
                                setActiveFeaturedProduct((prev) => ({
                                  ...prev,
                                  image: uploadedUri,
                                }));
                                setProducts((prev) =>
                                  prev.map((p) =>
                                    p.id === activeFeaturedProduct.id
                                      ? { ...p, image: uploadedUri }
                                      : p,
                                  ),
                                );
                                showToast(
                                  `✅ Foto ${file.name} berhasil diterapkan ke ${activeFeaturedProduct.name}!`,
                                );
                              }
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2.5 text-xs">
                      <div className="mb-1 flex items-center gap-1 text-blue-400 text-[10.5px]">
                        <span>💡</span>
                        <span className="font-bold">Tips RAG Host</span>
                      </div>
                      <p className="text-[9.5px] text-slate-400 leading-tight">
                        Klik produk untuk menjadikannya produk aktif live promo
                        &amp; video iklan.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* STEP 2: Pilih AI Host */}
              <div
                className={`flex flex-col rounded-xl border p-4 transition ${currentStep === 2 ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10" : "border-[#232c42] bg-[#0c1221]"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                      STEP 2
                    </span>
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Host Siap Live
                    </span>
                  </div>
                  <span className="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                    Aktif: {selectedAvatar.name} ({selectedAvatar.type})
                  </span>
                </div>
                <div className="mb-2 mt-2 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Pilih AI Host &amp; Suara TTS</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      AI Host 3D dengan suara neural, tempo bicara, dan persona
                      host.
                    </p>
                  </div>
                </div>

                <div className="mb-3 flex items-center justify-between border-b border-[#232c42] pb-2 text-xs font-medium">
                  <span className="text-blue-400 font-semibold">
                    3D VRM AI Host
                  </span>
                  <span className="text-[9.5px] text-slate-400 font-mono">
                    Mode demo aktif
                  </span>
                </div>

                {/* Avatar Carousel with Left/Right Navigation Buttons (Max 3 Avatars Visible) */}
                <div className="relative mb-3.5 group">
                  {filteredAvatars.length > 3 && (
                    <button
                      type="button"
                      onClick={() => scrollAvatars("left")}
                      className="absolute -left-2 top-1/2 -translate-y-1/2 z-30 h-7 w-7 rounded-full bg-[#0c1221]/95 border border-blue-500/50 text-blue-300 flex items-center justify-center hover:bg-blue-600 hover:text-white transition shadow-xl backdrop-blur-sm active:scale-90 font-black text-sm"
                      title="Geser Host ke Kiri"
                    >
                      ‹
                    </button>
                  )}

                  <div
                    ref={avatarCarouselRef}
                    className="flex gap-2 overflow-x-hidden scroll-smooth py-1 px-0.5"
                  >
                    {filteredAvatars.map((av) => {
                      const isSelected = selectedAvatar.id === av.id;
                      return (
                        <div
                          key={av.id || av.name}
                          onClick={() => {
                            setSelectedAvatar(av);
                            if (av.voice) setSelectedVoice(av.voice);
                            showToast(
                              `Avatar dipilih: ${av.name} (${av.role})`,
                            );
                          }}
                          className={`group/card relative h-[155px] w-[calc(33.333%-6px)] min-w-[95px] flex-shrink-0 overflow-hidden rounded-xl cursor-pointer transition-all duration-300 transform hover:-translate-y-1 ${
                            isSelected
                              ? "border-2 border-blue-500 shadow-[0_0_18px_rgba(59,130,246,0.4)] ring-2 ring-blue-500/30"
                              : "border border-[#232c42] opacity-80 hover:opacity-100 hover:border-slate-600"
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 z-20 rounded-full bg-blue-600 p-0.5 text-white shadow">
                              <svg
                                width="10"
                                height="10"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="3"
                                  d="M5 13l4 4L19 7"
                                ></path>
                              </svg>
                            </div>
                          )}
                          <div className="absolute top-1.5 left-1.5 z-20 rounded bg-black/70 px-1 py-0.2 text-[7.5px] font-extrabold text-blue-300 backdrop-blur-sm border border-white/10">
                            {av.type}
                          </div>
                          <div
                            className="absolute inset-0 bg-contain bg-bottom bg-no-repeat transition-transform duration-500 group-hover/card:scale-110"
                            style={{ backgroundImage: `url('${av.image}')` }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent z-10 flex flex-col justify-end p-2">
                            <p className="text-xs font-bold text-white line-clamp-1">
                              {av.name}
                            </p>
                            <p className="text-[8.5px] text-blue-300 font-medium line-clamp-1">
                              {av.role}
                            </p>
                            {av.specialty && (
                              <span className="text-[7px] text-slate-300 bg-white/10 px-1 py-0.2 rounded mt-0.5 truncate">
                                {av.specialty}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {filteredAvatars.length > 3 && (
                    <button
                      type="button"
                      onClick={() => scrollAvatars("right")}
                      className="absolute -right-2 top-1/2 -translate-y-1/2 z-30 h-7 w-7 rounded-full bg-[#0c1221]/95 border border-blue-500/50 text-blue-300 flex items-center justify-center hover:bg-blue-600 hover:text-white transition shadow-xl backdrop-blur-sm active:scale-90 font-black text-sm"
                      title="Geser Host ke Kanan"
                    >
                      ›
                    </button>
                  )}
                </div>

                {/* Voice & Language Dropdowns */}
                <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold text-slate-300">
                      Bahasa Utama
                    </label>
                    <select
                      value={selectedLang}
                      onChange={(e) => {
                        const newLang = e.target.value;
                        setSelectedLang(newLang);
                        handlePlayAudioPreview(
                          selectedVoice,
                          newLang,
                          selectedTone,
                          speechSpeed,
                        );
                      }}
                      className="w-full rounded-lg border border-[#232c42] bg-[#111827] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500 font-medium"
                    >
                      <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 flex items-center justify-between text-[10.5px] font-semibold text-slate-300">
                      <span>Tempo Bicara</span>
                      <span className="text-blue-400 font-mono">
                        {speechSpeed}x
                      </span>
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { val: 0.85, label: "0.85x" },
                        { val: 1.0, label: "1.0x" },
                        { val: 1.15, label: "1.15x" },
                        { val: 1.3, label: "1.3x" },
                      ].map((sp) => (
                        <button
                          key={sp.val}
                          type="button"
                          onClick={() => {
                            setSpeechSpeed(sp.val);
                            handlePlayAudioPreview(
                              selectedVoice,
                              selectedLang,
                              selectedTone,
                              sp.val,
                            );
                          }}
                          className={`rounded-lg py-1 text-[10px] font-medium border transition ${
                            speechSpeed === sp.val
                              ? "border-blue-500 bg-blue-500/20 text-white font-bold"
                              : "border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {sp.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Tempo / Speech Speed & Tone */}
                <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold text-slate-300">
                      Gaya Bicara / Persona
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {["Energetic", "FOMO", "Professional"].map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => {
                            setSelectedTone(tone);
                            handlePlayAudioPreview(
                              selectedVoice,
                              selectedLang,
                              tone,
                              speechSpeed,
                            );
                          }}
                          className={`rounded-lg py-1 text-[10px] font-medium transition ${
                            selectedTone === tone
                              ? "bg-purple-900/60 border border-purple-500 text-white font-bold shadow-inner"
                              : "border border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {tone === "Energetic"
                            ? "Energetik"
                            : tone === "Professional"
                              ? "Profesional"
                              : tone}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-auto rounded-xl border border-blue-500/30 bg-[#111827] p-3 shadow-inner">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          handlePlayAudioPreview(
                            selectedVoice,
                            selectedLang,
                            selectedTone,
                            speechSpeed,
                          )
                        }
                        disabled={isSynthesizingAudio}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:brightness-110 transition active:scale-95 shrink-0 shadow-md shadow-blue-600/30 disabled:opacity-60 disabled:cursor-wait"
                      >
                        {isSynthesizingAudio ? (
                          <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        ) : isPlayingAudio ? (
                          <span className="text-[11px]">⏸</span>
                        ) : (
                          <svg
                            width="10"
                            height="10"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
                          </svg>
                        )}
                      </button>

                      <div className="flex-1 h-5 flex items-center gap-[2.5px] overflow-hidden">
                        {Array.from({ length: 42 }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-1 rounded-full transition-all duration-150 ${
                              isSynthesizingAudio
                                ? "bg-slate-600 animate-pulse"
                                : isPlayingAudio || isAvatarSpeaking
                                  ? "bg-gradient-to-t from-blue-500 to-emerald-400 animate-pulse"
                                  : i < 16
                                    ? "bg-blue-600"
                                    : "bg-slate-700"
                            }`}
                            style={{
                              height:
                                isPlayingAudio || isAvatarSpeaking
                                  ? `${((i * 19 + 23) % 75) + 25}%`
                                  : isSynthesizingAudio
                                    ? "35%"
                                    : `${(i % 6) * 15 + 20}%`,
                              animationDelay: `${(i % 8) * 0.12}s`,
                            }}
                          />
                        ))}
                      </div>
                      <span className="text-[9.5px] font-mono text-slate-400 shrink-0">
                        {isSynthesizingAudio
                          ? "..."
                          : isPlayingAudio
                            ? "00:04"
                            : "00:00"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div
                className={`flex flex-col rounded-xl border p-4 transition ${currentStep === 3 ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10" : "border-[#232c42] bg-[#0c1221]"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                      STEP 3
                    </span>
                    <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Auto-Config Sync
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {selectedPlatform} • {selectedDuration} Jam
                  </span>
                </div>
                <h3 className="mb-1 mt-2 text-lg font-bold text-white">
                  Atur Live &amp; Otomatisasi AI
                </h3>
                <p className="mb-3 text-[11px] text-slate-400">
                  Atur platform target, durasi siaran, katalog produk, dan
                  sistem otomatisasi.
                </p>

                {/* Multi-Product Catalog Selection (Marathon Rotation) */}
                <div className="mb-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-[10.5px] font-semibold text-slate-300">
                      Katalog Produk Siaran Live
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-400 font-mono">
                        {pinnedProductIds.length > 0
                          ? `${pinnedProductIds.length} Pinned`
                          : `Semua (${products.length})`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (pinnedProductIds.length === products.length) {
                            setPinnedProductIds([]);
                            showToast("Mode rotasi: Semua produk toko aktif");
                          } else {
                            setPinnedProductIds(
                              products.map((p) => p.id || p.name),
                            );
                            showToast("Semua produk disematkan untuk rotasi");
                          }
                        }}
                        className="text-[9px] text-blue-400 hover:text-blue-300 font-semibold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30 transition"
                      >
                        {pinnedProductIds.length === products.length
                          ? "Reset"
                          : "Pilih Semua"}
                      </button>
                    </div>
                  </div>

                  <div className="relative flex items-center rounded-xl border border-[#232c42] bg-[#111827] p-1.5">
                    <div className="flex gap-2 overflow-x-auto px-1 py-0.5 w-full">
                      {products.map((prod) => {
                        const prodId = prod.id || prod.name;
                        const isPinned = pinnedProductIds.includes(prodId);
                        const isFeatured =
                          (activeFeaturedProduct.id ||
                            activeFeaturedProduct.name) === prodId;
                        return (
                          <div
                            key={prodId}
                            onClick={() => {
                              setActiveFeaturedProduct(prod);
                              setPinnedProductIds((prev) =>
                                prev.includes(prodId)
                                  ? prev.filter((id) => id !== prodId)
                                  : [...prev, prodId],
                              );
                              showToast(`🎯 Produk sorotan: ${prod.name}`);
                            }}
                            className={`relative h-11 w-11 flex-shrink-0 rounded-lg overflow-hidden border cursor-pointer transition-all duration-200 ${
                              isFeatured
                                ? "border-blue-500 ring-2 ring-blue-500/50 scale-105 shadow-md shadow-blue-500/30"
                                : isPinned
                                  ? "border-emerald-500 ring-1 ring-emerald-500/40 opacity-100"
                                  : "border-white/20 opacity-70 hover:opacity-100"
                            }`}
                            title={`${prod.name} (${prod.price}) - Klik untuk pilih/rotasi`}
                          >
                            {prod.image?.startsWith("http") ||
                            prod.image?.startsWith("/") ||
                            prod.image?.startsWith("data:") ? (
                              <img
                                src={prod.image}
                                alt={prod.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div
                                className={`h-full w-full ${prod.image || "bg-[#e8c6b9]"}`}
                              />
                            )}
                            {isFeatured && (
                              <div className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-blue-400 ring-1 ring-blue-900 animate-pulse" />
                            )}
                            {isPinned && !isFeatured && (
                              <div className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-emerald-900" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Durasi Live & Platform Grid */}
                <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Durasi Live */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-[10.5px] font-semibold text-slate-300">
                        Durasi Live Siaran
                      </label>
                      <span className="text-[9px] font-mono text-cyan-400">
                        {selectedDuration === 1
                          ? "Rp49.000 (Demo)"
                          : selectedDuration === 2
                            ? "Rp99.000 (Express)"
                            : selectedDuration === 8
                              ? "Rp299.000 (Shift)"
                              : "Rp699.000 (Marathon)"}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { hours: 1, label: "1 Jam", tag: "Demo" },
                        { hours: 2, label: "2 Jam", tag: "Express" },
                        { hours: 8, label: "8 Jam", tag: "Shift" },
                        { hours: 24, label: "24 Jam", tag: "24/7" },
                      ].map((item) => (
                        <button
                          key={item.hours}
                          type="button"
                          disabled={isLiveActive}
                          onClick={() => {
                            if (isLiveActive) {
                              showToast(
                                "⚠️ Durasi tidak dapat diubah saat siaran sedang aktif!",
                              );
                              return;
                            }
                            setSelectedDuration(item.hours);
                            if (item.hours === 1) {
                              setAutomations({
                                autoReply: true,
                                autoPin: false,
                                autoPromo: false,
                                autoModeration: false,
                              });
                              showToast(
                                "⏱️ Paket Demo (1 Jam): Auto-Reply aktif (Auto-Pin & Promo terkunci)",
                              );
                            } else if (item.hours === 2) {
                              setAutomations({
                                autoReply: true,
                                autoPin: true,
                                autoPromo: false,
                                autoModeration: false,
                              });
                              showToast(
                                "⏱️ Paket Express (2 Jam): Auto-Reply & Auto-Pin aktif",
                              );
                            } else {
                              setAutomations({
                                autoReply: true,
                                autoPin: true,
                                autoPromo: true,
                                autoModeration: true,
                              });
                              showToast(
                                `⏱️ Paket ${item.hours === 8 ? "Shift (8 Jam)" : "Marathon (24 Jam)"}: Semua otomatisasi aktif`,
                              );
                            }
                          }}
                          className={`rounded-lg py-1 text-[10px] font-semibold border transition active:scale-95 flex flex-col items-center justify-center ${
                            selectedDuration === item.hours
                              ? "border-blue-500 bg-blue-500/25 text-white shadow-sm font-bold ring-1 ring-blue-500/50"
                              : "border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200 hover:border-slate-600"
                          } ${isLiveActive ? "cursor-not-allowed opacity-70" : ""}`}
                        >
                          <span>{item.label}</span>
                          <span className="text-[8px] text-slate-400 font-normal">
                            {item.tag}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Platform Target */}
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold text-slate-300">
                      Platform Siaran
                    </label>
                    <select
                      value={selectedPlatform}
                      disabled={isLiveActive}
                      onChange={(e) => handlePlatformSelect(e.target.value)}
                      className={`w-full rounded-lg border border-[#232c42] bg-[#111827] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500 font-medium ${
                        isLiveActive ? "cursor-not-allowed opacity-70" : ""
                      }`}
                    >
                      <option value="TikTok LIVE">♪ TikTok LIVE</option>
                      <option value="Shopee Live">🛍️ Shopee Live</option>
                      <option value="Instagram Live">📸 Instagram Live</option>
                      <option value="YouTube">▶ YouTube Live</option>
                      <option value="Facebook Live">f Facebook Live</option>
                      <option value="Custom RTMP">🔗 Custom RTMP Server</option>
                    </select>
                  </div>
                </div>

                {/* Otomatisasi AI (4 Toggles) */}
                <div className="mb-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-[10.5px] font-semibold text-slate-300">
                      Sistem Otomatisasi AI Otonom
                    </label>
                    {isLiveActive ? (
                      <span className="text-[8.5px] text-amber-400 font-medium bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                        🔒 Terkunci saat Live Aktif
                      </span>
                    ) : (
                      <span className="text-[8.5px] text-slate-400">
                        Fitur disesuaikan dengan durasi paket
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {[
                      {
                        key: "autoReply" as const,
                        label: "Auto-Reply Chat",
                        desc: "Menjawab live chat",
                        icon: "💬",
                        color: "text-pink-400 bg-pink-500/20",
                        minHours: 1,
                      },
                      {
                        key: "autoPin" as const,
                        label: "Auto-Pin Produk",
                        desc: "Sematkan katalog",
                        icon: "📌",
                        color: "text-purple-400 bg-purple-500/20",
                        minHours: 2,
                      },
                      {
                        key: "autoPromo" as const,
                        label: "Auto-Promo Diskon",
                        desc: "CTA promo berkala",
                        icon: "🎁",
                        color: "text-emerald-400 bg-emerald-500/20",
                        minHours: 8,
                      },
                      {
                        key: "autoModeration" as const,
                        label: "Auto Moderasi",
                        desc: "Filter kata negatif",
                        icon: "🛡️",
                        color: "text-amber-400 bg-amber-500/20",
                        minHours: 8,
                      },
                    ].map((item) => {
                      const isAllowed = selectedDuration >= item.minHours;
                      const isActive = isAllowed && automations[item.key];
                      return (
                        <div
                          key={item.key}
                          onClick={() => {
                            if (isLiveActive) {
                              showToast(
                                "⚠️ Pengaturan otomatisasi dikunci selama live streaming!",
                              );
                              return;
                            }
                            if (!isAllowed) {
                              showToast(
                                `🔒 ${item.label} terkunci (Minimal paket ${item.minHours} Jam).`,
                              );
                              return;
                            }
                            setAutomations((prev) => ({
                              ...prev,
                              [item.key]: !isActive,
                            }));
                            showToast(
                              `${item.label}: ${!isActive ? "Diaktifkan" : "Dinonaktifkan"}`,
                            );
                          }}
                          className={`flex items-center gap-2 rounded-lg border p-2 transition ${
                            isLiveActive
                              ? "cursor-not-allowed opacity-75"
                              : !isAllowed
                                ? "cursor-not-allowed opacity-50 bg-[#0f1422] border-slate-800"
                                : "cursor-pointer"
                          } ${
                            isActive
                              ? "border-blue-500/40 bg-[#141d33] shadow-sm"
                              : "border-[#232c42] bg-[#111827] opacity-60 hover:opacity-90"
                          }`}
                        >
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-md ${item.color}`}
                          >
                            {item.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="font-semibold text-slate-200 truncate">
                                {item.label}
                              </p>
                              {!isAllowed && (
                                <span className="text-[8px] text-amber-400 font-mono">
                                  🔒{item.minHours}J
                                </span>
                              )}
                            </div>
                            <p className="text-[8px] text-slate-500 truncate">
                              {!isAllowed
                                ? `Perlu paket ≥${item.minHours} Jam`
                                : item.desc}
                            </p>
                          </div>
                          <div
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              isActive
                                ? "bg-emerald-400"
                                : isAllowed
                                  ? "bg-slate-600"
                                  : "bg-slate-800"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AI Sales Script Generator Box */}
                <div className="mt-auto rounded-xl bg-[#0e1628] p-3 border border-blue-500/30 shadow-inner">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5 truncate">
                        <span>✨</span>
                        <span>AI Copywriting &amp; CTA Pitch</span>
                      </p>
                      <p className="text-[9px] text-slate-400 truncate mt-0.5">
                        Sumber data:{" "}
                        <strong className="text-blue-300">
                          {activeFeaturedProduct.name}
                        </strong>{" "}
                        ({activeFeaturedProduct.tag || "General"})
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleFetchLiveSalesScript}
                      className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-3 py-1.5 text-[10px] font-bold text-white hover:brightness-110 transition active:scale-95 shrink-0 shadow-md shadow-blue-600/30"
                    >
                      <span>🤖</span>
                      <span>Generate from AI</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1.1fr]">
              <div
                className={`flex flex-col rounded-2xl border p-5 transition-all duration-300 ${
                  currentStep === 4
                    ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-xl shadow-blue-950/20"
                    : "border-[#232c42] bg-[#0c1221]"
                }`}
              >
                {/* Header Step 4 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232c42]/80 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-400 border border-blue-500/20">
                      STEP 4
                    </span>
                    <span className="text-xs font-bold text-white">
                      Preview &amp; Test Live
                    </span>
                  </div>

                  <div className="flex items-center gap-2 rounded-full border border-[#232c42] bg-[#111827] px-3 py-1 text-[11px] font-medium text-slate-300">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isAvatarSpeaking
                          ? "bg-emerald-400 animate-ping"
                          : "bg-blue-400"
                      }`}
                    />
                    <span>
                      Host:{" "}
                      <strong className="text-white">
                        {selectedAvatar.name}
                      </strong>{" "}
                      ({selectedAvatar.role || selectedAvatar.type})
                    </span>
                  </div>
                </div>

                <p className="mt-2 mb-4 text-xs text-slate-400">
                  Pratinjau interaktif avatar AI, simulasi live chat, dan
                  estimasi performa siaran langsung Anda.
                </p>

                {/* 3-Column Layout: Chat Simulation | Video Preview Player | Summary & Revenue */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch min-h-[360px]">
                  {/* 1. Kolom Kiri: Simulasi Live Chat */}
                  <div className="md:col-span-4 flex flex-col rounded-xl border border-[#232c42] bg-[#111827]/80 p-3">
                    <div className="mb-2 flex items-center justify-between border-b border-[#232c42] pb-2">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <span>💬</span> Live Chat
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAiAutoReplyOn(!isAiAutoReplyOn);
                          showToast(
                            `Auto-Reply: ${!isAiAutoReplyOn ? "ON" : "OFF"}`,
                          );
                        }}
                        className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold transition border ${
                          isAiAutoReplyOn
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-slate-800 text-slate-400 border-slate-700"
                        }`}
                      >
                        Auto-Reply: {isAiAutoReplyOn ? "ON" : "OFF"}
                      </button>
                    </div>

                    {/* Chat Message Stream */}
                    <div
                      ref={chatContainerRef}
                      className="flex-1 space-y-2 overflow-y-auto pr-1 max-h-[250px] md:max-h-none scrollbar-thin scrollbar-thumb-slate-700"
                    >
                      {chatMessages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center py-8 text-center text-slate-500 text-[11px]">
                          <span>👋 Belum ada chat simulasi</span>
                          <span className="text-[10px] text-slate-600 mt-0.5">
                            Ketik pesan di bawah untuk uji respons AI
                          </span>
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`rounded-xl p-2 border transition ${
                              msg.isAi
                                ? "bg-blue-950/40 border-blue-500/30 text-blue-100 ml-1"
                                : "bg-[#161f30] border-[#232c42]/60 text-slate-200 mr-1"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-0.5 text-[10px]">
                              <span
                                className={`font-bold truncate max-w-[120px] ${
                                  msg.isAi ? "text-blue-300" : "text-amber-300"
                                }`}
                              >
                                {msg.sender}
                              </span>
                              <span className="text-[9px] text-slate-500 font-mono">
                                {msg.time}
                              </span>
                            </div>
                            <p className="text-[11px] leading-snug break-words">
                              {msg.text}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Input Chat */}
                    <form onSubmit={handleSendChat} className="mt-2.5 relative">
                      <input
                        type="text"
                        placeholder="Ketik komentar simulasi..."
                        value={inputChat}
                        onChange={(e) => setInputChat(e.target.value)}
                        className="w-full rounded-xl bg-[#0b101e] py-2 pl-3 pr-9 text-xs text-slate-200 placeholder-slate-500 outline-none border border-[#232c42] focus:border-blue-500 transition shadow-inner"
                      />
                      <button
                        type="submit"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition text-xs active:scale-95"
                        title="Kirim Komentar"
                      >
                        ➤
                      </button>
                    </form>
                  </div>

                  {/* 2. Kolom Tengah: 9:16 Video Player Preview */}
                  <div className="md:col-span-4 flex justify-center">
                    <div className="relative aspect-[9/16] w-full max-w-[210px] h-full min-h-[340px] overflow-hidden rounded-2xl border-2 border-[#232c42] bg-[#0c0919] shadow-2xl">
                      <RealtimeLivePortraitView
                        avatarName={selectedAvatar.name}
                        avatarImage={selectedAvatar.image}
                        avatarRole={selectedAvatar.role}
                        isSpeaking={isAvatarSpeaking}
                        videoUrl={currentLiveVideoUrl || undefined}
                        onVideoEnded={() => setCurrentLiveVideoUrl(null)}
                        isLiveActive={isLiveActive}
                        className="w-full h-full object-cover"
                      />

                      {/* Top Header Badge Overlay */}
                      <div className="absolute top-2.5 left-2 right-2 z-20 flex items-center justify-between gap-1 pointer-events-none">
                        {/* Live / Preview Tag */}
                        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/80 px-2.5 py-1 text-[9px] font-bold text-white backdrop-blur-md border border-white/10 shadow-lg">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isLiveActive && !isLivePaused
                                ? "bg-red-500 animate-ping"
                                : "bg-cyan-400 animate-pulse"
                            }`}
                          />
                          <span
                            className={`font-mono tracking-wider ${
                              isLiveActive ? "text-red-300" : "text-cyan-300"
                            }`}
                          >
                            {isLiveActive
                              ? isLivePaused
                                ? "PAUSED"
                                : "LIVE"
                              : "PREVIEW"}
                          </span>
                        </div>

                        {/* Avatar Worker Status */}
                        <div
                          className={`pointer-events-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-semibold backdrop-blur-md border`}
                        >
                          <span className="truncate max-w-[70px]">
                            {selectedAvatar.name}
                          </span>
                        </div>
                      </div>

                      {/* Bottom Product Card Overlay */}
                      {activeFeaturedProduct?.name &&
                        activeFeaturedProduct.name !== "Memuat Produk..." && (
                          <div
                            className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none p-2.5 pt-6"
                            style={{
                              background:
                                "linear-gradient(to top, rgba(5,3,15,0.95) 0%, rgba(5,3,15,0.75) 65%, transparent 100%)",
                            }}
                          >
                            {/* Platform Pill & Stock */}
                            <div className="flex items-center justify-between mb-1.5">
                              <span
                                className={`text-[8.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                                  selectedPlatform === "TikTok LIVE"
                                    ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/40"
                                    : selectedPlatform === "Shopee Live"
                                      ? "bg-orange-500/20 text-orange-300 border-orange-400/40"
                                      : "bg-blue-500/20 text-blue-300 border-blue-400/40"
                                }`}
                              >
                                {selectedPlatform === "TikTok LIVE"
                                  ? "🛒 Keranjang"
                                  : selectedPlatform === "Shopee Live"
                                    ? "🏷️ Flash Sale"
                                    : "🛒 Toko Live"}
                              </span>
                              <span className="text-[9px] font-mono text-slate-300 bg-black/50 px-1.5 py-0.2 rounded border border-white/10">
                                Sisa: {activeFeaturedProduct.stock || 0} pcs
                              </span>
                            </div>

                            {/* Product Info Row */}
                            <div className="flex items-center gap-2 rounded-xl bg-black/60 p-1.5 border border-white/10 backdrop-blur-md">
                              <img
                                src={
                                  activeFeaturedProduct.image?.startsWith(
                                    "http",
                                  ) ||
                                  activeFeaturedProduct.image?.startsWith("/")
                                    ? activeFeaturedProduct.image
                                    : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                                }
                                alt={activeFeaturedProduct.name}
                                className="h-9 w-9 shrink-0 rounded-lg object-cover border border-white/20"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold text-white truncate leading-tight">
                                  {activeFeaturedProduct.name}
                                </p>
                                <p className="text-[10.5px] font-black text-emerald-400 mt-0.5 leading-none">
                                  {typeof activeFeaturedProduct.price ===
                                  "number"
                                    ? `Rp${activeFeaturedProduct.price.toLocaleString("id-ID")}`
                                    : activeFeaturedProduct.price}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                    </div>
                  </div>

                  {/* 3. Kolom Kanan: Ringkasan Siaran & Estimasi Omzet */}
                  <div className="md:col-span-4 flex flex-col justify-between rounded-xl border border-[#232c42] bg-[#111827]/80 p-3.5">
                    <div>
                      <p className="text-xs font-bold text-white mb-3 flex items-center gap-1.5 border-b border-[#232c42] pb-2">
                        <span>📋</span> Ringkasan Konfigurasi
                      </p>

                      <div className="space-y-2.5 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 flex items-center gap-1">
                            ⏱️ Durasi
                          </span>
                          <span className="font-semibold text-white">
                            {selectedDuration} Jam
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 flex items-center gap-1">
                            🛍️ Total Produk
                          </span>
                          <span className="font-semibold text-white">
                            {products.length} Item
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 flex items-center gap-1">
                            📱 Platform
                          </span>
                          <span className="font-semibold text-blue-400">
                            {selectedPlatform}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 flex items-center gap-1">
                            👤 AI Host
                          </span>
                          <span className="font-semibold text-slate-200">
                            {selectedAvatar.name}{" "}
                            <span className="text-purple-300 font-normal">
                              ({selectedTone})
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Estimasi Hasil Live (Viewers & Omzet) */}
                    <div className="mt-4 pt-3 border-t border-[#232c42] rounded-xl bg-gradient-to-br from-blue-950/30 to-[#0c1221] p-3 border border-blue-500/20">
                      <p className="text-xs font-bold text-slate-200 mb-2 flex items-center gap-1.5">
                        <span>📊</span> Proyeksi Hasil Siaran
                      </p>

                      <div className="space-y-2 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Est. Penonton:</span>
                          <span className="font-mono font-bold text-blue-300">
                            {selectedDuration <= 2
                              ? "850 - 1.600"
                              : selectedDuration <= 8
                                ? "3.200 - 6.500"
                                : "12.000 - 28.000"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Potensi Omzet:</span>
                          <span className="font-mono font-black text-emerald-400 text-xs">
                            {(() => {
                              const numP =
                                typeof activeFeaturedProduct.price === "number"
                                  ? activeFeaturedProduct.price
                                  : parseInt(
                                      String(
                                        activeFeaturedProduct.price,
                                      ).replace(/[^0-9]/g, ""),
                                    ) || 99000;
                              const minU =
                                selectedDuration <= 2
                                  ? 12
                                  : selectedDuration <= 8
                                    ? 45
                                    : 160;
                              const maxU =
                                selectedDuration <= 2
                                  ? 30
                                  : selectedDuration <= 8
                                    ? 110
                                    : 420;
                              return `Rp${((numP * minU) / 1000000).toFixed(1)}jt - Rp${((numP * maxU) / 1000000).toFixed(1)}jt`;
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {!isLiveActive && !isWaitingForGoLive ? (
                <div
                  className={`flex flex-col rounded-xl border p-4 transition ${currentStep === 5 ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30" : "border-[#232c42] bg-[#0c1221]"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                      STEP 5
                    </span>
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Siap Siaran Langsung
                    </span>
                  </div>
                  <h3 className="mb-1 mt-1 text-lg font-bold text-white">
                    Go Live
                  </h3>
                  <p className="mb-4 text-xs text-slate-400">
                    Semua siap! Mulai live dan AI akan bekerja otonom untuk
                    Anda.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 border-b border-[#232c42] pb-4 mb-4">
                    <div className="flex-1 space-y-3">
                      <p className="text-[11px] font-semibold text-slate-200">
                        Ringkasan Siap Live
                      </p>
                      <div className="space-y-2 text-[10px]">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 w-4 text-center">
                            👤
                          </span>
                          <div>
                            <p className="text-slate-500 leading-none">
                              AI Host
                            </p>
                            <p className="font-medium text-slate-200 mt-1">
                              {selectedAvatar.name} ({selectedTone})
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 w-4 text-center">
                            ⏱️
                          </span>
                          <div>
                            <p className="text-slate-500 leading-none">
                              Durasi Live
                            </p>
                            <p className="font-medium text-slate-200 mt-1">
                              {selectedDuration} Jam (Terkunci)
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 w-4 text-center">
                            🛍️
                          </span>
                          <div>
                            <p className="text-slate-500 leading-none">
                              Produk
                            </p>
                            <p className="font-medium text-slate-200 mt-1">
                              {products.length} Produk (
                              {activeFeaturedProduct.name})
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 w-4 text-center">
                            📱
                          </span>
                          <div>
                            <p className="text-slate-500 leading-none">
                              Platform Target
                            </p>
                            <p className="font-medium text-slate-200 mt-1">
                              {selectedPlatform}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 w-4 text-center">
                            ⚙️
                          </span>
                          <div>
                            <p className="text-slate-500 leading-none">
                              Otomatisasi
                            </p>
                            <p className="font-medium text-slate-200 mt-1">
                              4 Fitur Aktif
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="hidden sm:block w-[1px] bg-[#232c42]"></div>

                    <div className="flex-[1.2]">
                      {/* Connection Mode Tabs (Hidden for Custom RTMP) */}
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-semibold text-slate-200">
                          {selectedPlatform.toLowerCase().includes("custom")
                            ? "Konfigurasi Server RTMP Custom"
                            : `Metode Koneksi (${selectedPlatform})`}
                        </p>
                        {selectedPlatform.toLowerCase().includes("custom") ? (
                          <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[8.5px] font-bold text-amber-400 border border-amber-500/20">
                            🔗 Manual RTMP Ingest
                          </span>
                        ) : (
                          <div className="flex rounded-lg bg-[#111827] p-0.5 border border-[#232c42]">
                            <button
                              type="button"
                              onClick={() => setConnectMode("1CLICK")}
                              className={`rounded-md px-2.5 py-1 text-[9px] font-bold transition ${
                                connectMode === "1CLICK"
                                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow"
                                  : "text-slate-400 hover:text-white"
                              }`}
                            >
                              ⚡ 1-Klik Connect
                            </button>
                            <button
                              type="button"
                              onClick={() => setConnectMode("MANUAL")}
                              className={`rounded-md px-2.5 py-1 text-[9px] font-bold transition ${
                                connectMode === "MANUAL"
                                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow"
                                  : "text-slate-400 hover:text-white"
                              }`}
                            >
                              🔗 Manual RTMP
                            </button>
                          </div>
                        )}
                      </div>

                      {/* TAB 1: 1-Click OAuth Connect (Hidden when Custom RTMP is selected) */}
                      {!selectedPlatform.toLowerCase().includes("custom") &&
                      connectMode === "1CLICK" ? (
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
                                <div className="relative shrink-0">
                                  <img
                                    src={
                                      connectedAccount.avatarUrl ||
                                      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=300&fit=crop&q=80"
                                    }
                                    alt={connectedAccount.displayName}
                                    className="h-10 w-10 rounded-full object-cover border-2 border-emerald-400/80 shadow-md"
                                  />
                                  <span className="absolute -bottom-1 -right-1 bg-blue-500 text-white text-[8px] rounded-full px-1 shadow border border-[#0c1221]">
                                    ✓
                                  </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-[11px] font-bold text-white truncate">
                                      {connectedAccount.displayName}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 text-[9px] text-slate-400 mt-0.5">
                                    <span className="text-cyan-300 font-mono">
                                      @{connectedAccount.username}
                                    </span>
                                    <span>•</span>
                                    <span className="text-slate-300">
                                      👥{" "}
                                      {connectedAccount.followers?.toLocaleString(
                                        "id-ID",
                                      ) || "48.2K"}
                                    </span>
                                    <span>•</span>
                                    <span className="text-amber-400">
                                      ⭐ {connectedAccount.rating || 4.9}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await fetch("/api/oauth/disconnect", {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          platform: selectedPlatform,
                                        }),
                                      });
                                    } catch {}
                                    setConnectedAccount(null);
                                    showToast("Koneksi akun diputuskan.");
                                  }}
                                  className="rounded-lg px-2 py-1 text-[8.5px] font-bold text-red-400 hover:bg-red-500/10 border border-red-500/20 transition active:scale-95 shrink-0"
                                >
                                  Putuskan
                                </button>
                              </div>

                              <div className="flex items-start gap-1.5 text-[8.5px] text-slate-400 bg-blue-500/5 p-2 rounded-lg border border-blue-500/10">
                                <span className="text-blue-400 text-xs">
                                  ✨
                                </span>
                                <p className="leading-tight">
                                  <strong>1-Klik Auto Connect Aktif:</strong>{" "}
                                  Server Ingest &amp; Stream Key telah
                                  disinkronkan otomatis. Tinggal klik{" "}
                                  <strong>Mulai Live Sekarang</strong>!
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="text-center py-2.5">
                              <p className="text-[10px] text-slate-200 font-bold mb-1">
                                Hubungkan Akun {selectedPlatform}
                              </p>
                              <p className="text-[8.5px] text-slate-400 mb-3">
                                Hubungkan akun resmi toko Anda via OAuth 2.0
                                untuk auto-streaming tanpa input Stream Key
                                manual.
                              </p>

                              {/* Show env-missing warning if credentials not configured */}
                              {oauthConfigStatus[selectedPlatform] ===
                                false && (
                                <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-[8px] text-amber-300 text-left leading-relaxed">
                                  <span className="font-bold text-amber-400">
                                    ⚠️ OAuth belum dikonfigurasi
                                  </span>
                                  <br />
                                  Tambahkan credentials {selectedPlatform} ke
                                  file{" "}
                                  <code className="font-mono bg-amber-500/10 px-1 rounded">
                                    .env
                                  </code>{" "}
                                  backend. Lihat{" "}
                                  <code className="font-mono">
                                    .env.example
                                  </code>{" "}
                                  untuk daftarnya.
                                </div>
                              )}

                              {/* Real OAuth 2.0 button */}
                              <button
                                type="button"
                                onClick={async () => {
                                  showToast(
                                    `🔗 Menghubungkan ke ${selectedPlatform} via OAuth 2.0...`,
                                  );
                                  try {
                                    // Step 1: Get real authorization URL from backend (with PKCE)
                                    const res = await fetch(
                                      `/api/oauth/authorize?platform=${encodeURIComponent(selectedPlatform)}`,
                                    );
                                    const json = await res.json();

                                    if (res.ok && json.data?.authUrl) {
                                      // Step 2: Redirect user to platform OAuth page
                                      window.location.href = json.data.authUrl;
                                      return;
                                    }

                                    if (!res.ok && json.missingEnvKey) {
                                      showToast(
                                        `❌ ${json.error} (${json.missingEnvKey})`,
                                      );
                                      return;
                                    }
                                  } catch {
                                    showToast(
                                      `❌ Tidak dapat terhubung ke backend. Pastikan server berjalan.`,
                                    );
                                    return;
                                  }
                                }}
                                className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[10.5px] font-bold text-white shadow-md active:scale-95 transition ${
                                  oauthConfigStatus[selectedPlatform] === false
                                    ? "bg-gradient-to-r from-slate-600 to-slate-700 opacity-70 cursor-not-allowed"
                                    : "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:brightness-110"
                                }`}
                              >
                                <span>
                                  🔗 Login & Hubungkan Akun {selectedPlatform}
                                </span>
                                {oauthConfigStatus[selectedPlatform] && (
                                  <span className="rounded bg-emerald-500/20 text-[8px] text-emerald-300 px-1.5 py-0.5 border border-emerald-500/30">
                                    OAuth 2.0 Ready
                                  </span>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* TAB 2: Manual RTMP for Pro / Agency */
                        <div className="space-y-2.5 animate-fadeIn">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[9px] text-slate-400">
                                Server / Stream URL ({selectedPlatform})
                              </p>
                              <span className="text-[8px] text-slate-500">
                                Dapat diedit
                              </span>
                            </div>
                            <div className="flex rounded border border-[#232c42] bg-[#111827]">
                              <input
                                type="text"
                                value={
                                  customRtmpUrl !== ""
                                    ? customRtmpUrl
                                    : selectedPlatform.includes("Instagram")
                                      ? "rtmps://live-upload.instagram.com:443/rtmp/"
                                      : selectedPlatform.includes("YouTube")
                                        ? "rtmp://a.rtmp.youtube.com/live2"
                                        : selectedPlatform.includes("TikTok")
                                          ? "rtmp://live.tiktok.com/live/"
                                          : selectedPlatform.includes("Shopee")
                                            ? "rtmp://live.shopee.co.id/live/"
                                            : selectedPlatform.includes(
                                                  "Facebook",
                                                )
                                              ? "rtmps://live-api-s.facebook.com:443/rtmp/"
                                              : "rtmp://live.livestreamer.ai/live"
                                }
                                onChange={(e) =>
                                  setCustomRtmpUrl(e.target.value)
                                }
                                placeholder="Masukkan Server RTMP URL..."
                                className="w-full bg-transparent p-1.5 text-[10px] text-slate-300 outline-none font-mono"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(
                                    customRtmpUrl ||
                                      (selectedPlatform.includes("Instagram")
                                        ? "rtmps://live-upload.instagram.com:443/rtmp/"
                                        : "rtmp://live.livestreamer.ai/live"),
                                    "RTMP URL",
                                  )
                                }
                                className="border-l border-[#232c42] px-2.5 py-1.5 text-[9px] font-medium text-slate-300 hover:text-white bg-[#161f30] transition active:scale-95 shrink-0"
                              >
                                Salin
                              </button>
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[9px] text-slate-400">
                                Stream Key
                              </p>
                              <span className="text-[8px] text-slate-500">
                                Dapat diedit
                              </span>
                            </div>
                            <div className="flex rounded border border-[#232c42] bg-[#111827]">
                              <input
                                type="text"
                                value={streamKey}
                                onChange={(e) => setStreamKey(e.target.value)}
                                placeholder={`Tempel Stream Key dari ${selectedPlatform}...`}
                                className="w-full bg-transparent p-1.5 text-[10px] text-slate-300 outline-none font-mono"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(streamKey, "Stream Key")
                                }
                                className="border-l border-[#232c42] px-2.5 py-1.5 text-[9px] font-medium text-slate-300 hover:text-white bg-[#161f30] transition active:scale-95 shrink-0"
                              >
                                Salin
                              </button>
                            </div>
                          </div>

                          {!selectedPlatform
                            .toLowerCase()
                            .includes("custom") && (
                            <button
                              type="button"
                              onClick={() => setShowTutorialModal(true)}
                              className="flex items-center justify-between w-full text-[9px] text-blue-400 hover:underline pt-1"
                            >
                              <span>
                                📖 Cara cari RTMP &amp; Stream Key di{" "}
                                {selectedPlatform}
                              </span>
                              <span>Tutorial &gt;</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-900/10 p-3 flex gap-3 items-center">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-900/40 text-blue-300 text-[10px] font-bold border border-blue-500/30">
                        i
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-300">
                          Estimasi Biaya Komputasi
                        </p>
                        <p className="text-[12px] font-bold text-emerald-400 mt-0.5">
                          ~Rp10.000 - Rp15.000{" "}
                          <span className="text-slate-300 font-normal">
                            / jam live
                          </span>
                        </p>
                        <p className="text-[8px] text-slate-500 mt-0.5">
                          ≈ Rp
                          {(selectedDuration * 10000).toLocaleString("id-ID")} -
                          Rp{(selectedDuration * 15000).toLocaleString("id-ID")}{" "}
                          untuk alokasi {selectedDuration} jam penuh
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isConnectingLive}
                      onClick={async () => {
                        setIsConnectingLive(true);
                        setHasConfirmedBroadcast(false);
                        showToast(
                          `⏳ Menghubungkan ke server ${selectedPlatform}... Memverifikasi RTMP Ingest Handshake...`,
                        );

                        const activeTargetRtmp =
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
                                    : "rtmp://live.livestreamer.ai/live";

                        try {
                          const backendUrl =
                            process.env.NEXT_PUBLIC_BACKEND_URL || "";
                          const controller = new AbortController();
                          connectingAbortRef.current = controller;

                          // 1. Start live session record in DB with full automation settings
                          const sessionRes = await fetch(
                            `${backendUrl}/api/live-session/start`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              signal: controller.signal,
                              body: JSON.stringify({
                                productId: activeFeaturedProduct.id || "1",
                                avatarId: selectedAvatar.id || "1",
                                platform: selectedPlatform,
                                durationHours: 1,
                                autoReply: automations.autoReply,
                                autoPin: automations.autoPin,
                                autoPromotion: automations.autoPromo,
                                autoModeration: automations.autoModeration,
                                avatarName: selectedAvatar.name,
                                tone: selectedTone,
                                accessToken: connectedAccount?.accessToken,
                                liveChatId: connectedAccount?.liveChatId,
                                liveVideoId: connectedAccount?.liveVideoId,
                              }),
                            },
                          );

                          if (!sessionRes.ok) {
                            const sessionError = await sessionRes
                              .json()
                              .catch(() => ({}));
                            throw new Error(
                              sessionError.error || "Gagal membuat sesi live",
                            );
                          }
                          const sessionJson = await sessionRes.json();

                          // 2. Trigger real FFmpeg RTMP broadcast transmission & verify handshake
                          const bcastRes = await fetch(
                            `${backendUrl}/api/live-stream/broadcast`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              signal: controller.signal,
                              body: JSON.stringify({
                                rtmpUrl: activeTargetRtmp,
                                streamKey: streamKey,
                                sessionId: sessionJson.data?.id,
                                avatarImage: selectedAvatar.image,
                                avatarVideo: "/avatars/namira.mp4",
                                productName: activeFeaturedProduct.name,
                                productPrice: String(
                                  activeFeaturedProduct.price,
                                ).replace(/[^0-9]/g, ""),
                                productImageUrl: activeFeaturedProduct.image,
                                platform: selectedPlatform,
                                stockCount: activeFeaturedProduct.stock,
                                ctaLabel:
                                  selectedPlatform === "Instagram Live"
                                    ? "DM Sekarang"
                                    : "Beli Sekarang",
                              }),
                            },
                          );

                          const bcastJson = await bcastRes.json();

                          if (bcastRes.ok && bcastJson.success) {
                            if (bcastJson.waitingForGoLive) {
                              // We DO NOT close the loading modal (isConnectingLive stays true)
                              // Set this to true to trigger polling and keep internal state correct
                              setIsWaitingForGoLive(true);
                              setCurrentLiveSessionId(sessionJson.data?.id);
                              showToast(
                                bcastJson.message ||
                                  "RTMP terhubung! Sedang mengenerate Video AI...",
                              );
                            } else {
                              // Legacy flow
                              setIsConnectingLive(false);
                              setIsLiveActive(true);
                              setIsLivePaused(false);
                              setLiveSessionPhase("pending");
                              setLiveSeconds(0);
                              showToast(
                                `📡 RTMP terhubung! Menunggu ${selectedPlatform} memulai live...`,
                              );
                            }
                          } else {
                            await fetch("/api/live-session/stop", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({}),
                            }).catch(() => {});
                            setIsConnectingLive(false);
                            showToast(
                              `❌ Gagal terhubung ke ${selectedPlatform}: ${bcastJson.error || "Server RTMP menolak koneksi. Periksa Stream Key Anda."}`,
                            );
                          }
                        } catch {
                          await fetch("/api/live-session/stop", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({}),
                          }).catch(() => {});
                          setIsConnectingLive(false);
                          showToast(
                            `❌ Error koneksi: Pastikan server backend online dan Stream Key valid.`,
                          );
                        }
                      }}
                      className={`w-full flex flex-col items-center justify-center rounded-xl py-3 text-center text-sm font-bold text-white transition active:scale-98 shadow-[0_4px_14px_0_rgba(0,180,219,0.39)] ${
                        isConnectingLive
                          ? "bg-slate-700 cursor-not-allowed opacity-90"
                          : "bg-gradient-to-r from-[#00b4db] to-[#0083b0] hover:brightness-110"
                      }`}
                    >
                      {isConnectingLive ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>
                              Memverifikasi Ingest Stream ke {selectedPlatform}
                              ...
                            </span>
                          </div>
                          <span className="text-[9px] font-normal text-white/80 mt-0.5">
                            Memvalidasi RTMP Handshake &amp; Inisialisasi AI
                            Video Stream
                          </span>
                        </>
                      ) : (
                        <>
                          <span>🚀 Mulai Live Sekarang</span>
                          <span className="text-[9px] font-normal text-white/80 mt-0.5">
                            AI akan mulai streaming otomatis di platform{" "}
                            {selectedPlatform}
                          </span>
                        </>
                      )}
                    </button>
                    <p className="mt-2 text-center text-[9px] text-slate-500">
                      🔒 Anda dapat menghentikan live kapan saja
                    </p>
                  </div>
                </div>
              ) : isWaitingForGoLive ? (
                /* MENUNGGU KONFIRMASI GO LIVE DARI USER */
                <div className="flex flex-col rounded-xl border border-yellow-500/40 bg-[#0e1222] p-5 shadow-2xl shadow-yellow-900/10">
                  <div className="mb-4 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500 animate-pulse" />
                    <p className="text-[11px] font-black uppercase tracking-widest text-yellow-400">
                      Menunggu Siaran
                    </p>
                  </div>
                  <h3 className="text-sm font-bold text-white mb-2">
                    Tindakan Diperlukan:
                  </h3>
                  <ol className="list-decimal pl-4 text-xs text-slate-300 space-y-2 mb-6">
                    <li>
                      Buka aplikasi <strong>{selectedPlatform}</strong> di
                      HP/Web Anda.
                    </li>
                    <li>
                      Pastikan preview kamera menampilkan video idle Avatar.
                    </li>
                    <li>
                      Klik tombol{" "}
                      <strong>"Siarkan Langsung" / "Go Live"</strong> di dalam
                      aplikasi tersebut.
                    </li>
                    <li>
                      Setelah siaran berjalan, tekan tombol konfirmasi di bawah
                      ini.
                    </li>
                  </ol>

                  {/* Status Persiapan Video AI */}
                  <div className="mb-6 rounded-xl bg-black/40 p-4 border border-white/10">
                    <p className="text-[10px] text-slate-400 font-semibold mb-2 uppercase tracking-wider">
                      Status Render Video AI
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {pipelineStatus?.ready ? (
                          <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            Video AI Siap ({pipelineStatus.generationCount || 1}
                            /2)
                          </span>
                        ) : (
                          <span className="text-amber-400 text-xs font-semibold flex items-center gap-2 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30">
                            <span className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                            Merender Video AI di GPU (
                            {pipelineStatus?.generationCount || 0}/2)...
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Antrean: {pipelineStatus?.pendingCount ?? 0}
                      </span>
                    </div>

                    {!pipelineStatus?.ready && (
                      <p className="mt-2.5 text-[11px] text-amber-300/80 leading-relaxed">
                        ⏳ GPU sedang memproses gerakan bibir & suara. Tombol
                        siaran akan muncul otomatis saat video pembuka selesai.
                      </p>
                    )}
                  </div>

                  {/* Tombol Konfirmasi Siaran HANYA MUNCUL KETIKA VIDEO SUDAH READY */}
                  {pipelineStatus?.ready ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!currentLiveSessionId) return;
                        setIsConnectingLive(true);
                        try {
                          const res = await fetch(
                            "/api/live-stream/go-live-confirm",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                sessionId: currentLiveSessionId,
                              }),
                            },
                          );
                          const json = await res.json();
                          if (res.ok && json.success) {
                            setIsWaitingForGoLive(false);
                            setIsLiveActive(true);
                            setIsLivePaused(false);
                            setLiveSessionPhase("live");
                            setLiveSeconds(0);
                            showToast("✅ AI Host aktif! Siaran live dimulai.");
                          } else {
                            showToast(`❌ Gagal konfirmasi: ${json.error}`);
                          }
                        } catch {
                          showToast("❌ Error koneksi saat konfirmasi.");
                        } finally {
                          setIsConnectingLive(false);
                        }
                      }}
                      disabled={isConnectingLive}
                      className={`w-full py-3.5 rounded-lg text-sm font-bold text-white transition ${
                        isConnectingLive
                          ? "bg-slate-700 cursor-not-allowed opacity-80"
                          : "bg-green-600 hover:bg-green-500 active:scale-95 shadow-[0_0_20px_rgba(34,197,94,0.45)]"
                      }`}
                    >
                      {isConnectingLive
                        ? "Menyambungkan..."
                        : "✅ Konfirmasi Siaran Dimulai"}
                    </button>
                  ) : (
                    <div className="w-full py-3 px-4 rounded-lg bg-slate-800/80 border border-slate-700/50 text-center flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-slate-300 font-medium">
                        Menunggu Render Video AI Selesai...
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch("/api/live-stream/stop-broadcast", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sessionId: currentLiveSessionId,
                        }),
                      }).catch(() => {});
                      setIsWaitingForGoLive(false);
                      setCurrentLiveSessionId(null);
                      showToast("Siaran dibatalkan.");
                    }}
                    className="mt-3 w-full py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                /* LIVE CONTROL CENTER (Appears dynamically when isLiveActive === true) */
                <div className="flex flex-col rounded-2xl border border-red-500/40 bg-[#0e1222] ring-1 ring-red-500/20 p-5 relative overflow-hidden transition animate-fadeIn shadow-2xl shadow-red-900/10">
                  {/* Animated top gradient line */}
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 via-red-400 to-red-600 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.6)]" />

                  {/* Subtle animated background glow */}
                  <div className="absolute -top-20 -right-20 w-40 h-40 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

                  {/* Header */}
                  <div className="mb-4 flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping shadow-[0_0_12px_rgba(239,68,68,0.9)]" />
                        <span
                          className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-red-500/40 animate-ping"
                          style={{ animationDelay: "0.3s" }}
                        />
                      </div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                        Live Control Center
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        GPU Active
                      </span>
                      <span className="text-[9px] font-bold text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
                        {selectedPlatform}
                      </span>
                    </div>
                  </div>

                  {/* Duration Cap & Timer Progress Bar */}
                  <div className="mb-3 border-b border-[#232c42] pb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[9px] font-bold tracking-widest text-white ${!isLivePaused ? "bg-red-500 animate-pulse" : "bg-amber-600"}`}
                        >
                          {isLivePaused ? "PAUSED" : "LIVE"}
                        </span>
                        <span className="text-[12px] font-bold text-slate-100 tracking-wider font-mono">
                          {formatTime(liveSeconds)}{" "}
                          <span className="text-[9px] font-normal text-slate-400 font-sans">
                            / {selectedDuration} Jam
                          </span>
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold">
                        {Math.min(
                          100,
                          Math.round(
                            (liveSeconds / (selectedDuration * 3600)) * 100,
                          ),
                        )}
                        %
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

                  {/* Live Real-Time Metrics Grid (Atomic Memoized Component) */}
                  <div className="mb-3">
                    <LiveMetricsBar
                      viewers={metrics.viewers}
                      comments={metrics.comments}
                      clicks={metrics.clicks}
                      sales={metrics.sales}
                    />
                  </div>

                  {/* Active Live Product Controller */}
                  <div className="mb-3 rounded-xl border border-blue-500/20 bg-[#111827] p-2.5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[9px] font-bold text-slate-300 flex items-center gap-1">
                        <span>🏷️</span>
                        <span>Produk Aktif di Siaran</span>
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          const nextIdx =
                            (products.findIndex(
                              (p) => p.id === activeFeaturedProduct.id,
                            ) +
                              1) %
                            products.length;
                          const nextProd = products[nextIdx];
                          setActiveFeaturedProduct(nextProd);
                          showToast(
                            `🎯 Produk aktif siaran diubah ke: ${nextProd.name}`,
                          );

                          // Announce switch in chat simulation and speech
                          const switchMsg: ChatMessage = {
                            id: String(Date.now()),
                            sender: `AI Host (${selectedAvatar.name})`,
                            isAi: true,
                            avatarColor: "bg-[#4148e2]",
                            text: `Sekarang kita beralih ke ${nextProd.name} ya kakak! Harganya spesial cuma ${nextProd.price}! Yuk langsung diamankan di keranjang kuning ya! ✨`,
                            time: new Date().toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          };
                          setChatMessages((prev) => [...prev, switchMsg]);

                          // Sync with backend API
                          try {
                            await fetch("/api/live-session/switch-product", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                productId: nextProd.id || "1",
                                productName: nextProd.name,
                              }),
                            });
                          } catch {}
                        }}
                        className="text-[8.5px] font-bold text-blue-400 hover:underline"
                      >
                        Ganti Produk
                      </button>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <img
                        src={
                          activeFeaturedProduct.image?.startsWith("http") ||
                          activeFeaturedProduct.image?.startsWith("/") ||
                          activeFeaturedProduct.image?.startsWith("data:")
                            ? activeFeaturedProduct.image
                            : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                        }
                        alt={activeFeaturedProduct.name}
                        className="h-10 w-10 shrink-0 rounded-lg object-cover border border-white/20 shadow"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-white truncate">
                          {activeFeaturedProduct.name}
                        </p>
                        <p className="text-[11px] font-bold text-emerald-400">
                          {activeFeaturedProduct.price}
                        </p>
                      </div>
                      <div className="text-right border-l border-[#232c42] pl-2">
                        <p className="text-[7.5px] text-slate-500">Klik</p>
                        <p className="text-[9.5px] font-bold text-white">
                          {metrics.activeProductClicks}
                        </p>
                      </div>
                      <div className="text-right border-l border-[#232c42] pl-2">
                        <p className="text-[7.5px] text-slate-500">Terjual</p>
                        <p className="text-[9.5px] font-bold text-emerald-400">
                          {metrics.activeProductSold} ↑
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const nextIdx =
                          (products.findIndex(
                            (p) => p.id === activeFeaturedProduct.id,
                          ) +
                            1) %
                          products.length;
                        const nextProd = products[nextIdx];
                        setActiveFeaturedProduct(nextProd);
                        showToast(`📌 Pin & Sorot: ${nextProd.name}`);

                        // Announce switch in chat simulation and speech
                        const switchMsg: ChatMessage = {
                          id: String(Date.now()),
                          sender: `AI Host (${selectedAvatar.name})`,
                          isAi: true,
                          avatarColor: "bg-[#4148e2]",
                          text: `Sekarang kita sematkan dan sorot ${nextProd.name} ya kakak! Harganya spesial ${nextProd.price}! Yuk dicek keranjangnya! ✨`,
                          time: new Date().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        };
                        setChatMessages((prev) => [...prev, switchMsg]);

                        // Sync with backend API
                        try {
                          await fetch("/api/live-session/switch-product", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              productId: nextProd.id || "1",
                              productName: nextProd.name,
                            }),
                          });
                        } catch {}
                      }}
                      className="mt-2 w-full rounded-lg bg-[#4148e2] py-1 text-[8.5px] font-bold text-white hover:bg-blue-600 transition active:scale-95"
                    >
                      Pin &amp; Sorot Produk Berikutnya
                    </button>
                  </div>

                  {/* Automations Badges */}
                  <div className="mb-3 rounded-lg bg-[#111827] p-2 border border-[#232c42]">
                    <p className="text-[8.5px] text-slate-400 font-semibold mb-1.5">
                      AI Automations Running:
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-[8px]">
                      <div className="flex items-center gap-1 text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Auto-Reply Komentar</span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Auto-Pin Promo</span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Auto-Sales Pitch (RAG)</span>
                      </div>
                      <div className="flex items-center gap-1 text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Auto-Moderasi Chat</span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-auto flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setShowEndLiveConfirm(true)}
                      className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-700 py-2.5 text-[11px] font-bold text-white hover:brightness-110 transition active:scale-95 shadow-md shadow-red-600/30"
                    >
                      🛑 Akhiri Live Streaming
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const nextPause = !isLivePaused;
                          try {
                            const pauseRes = await fetch(
                              nextPause
                                ? "/api/live-stream/pause"
                                : "/api/live-stream/resume",
                              {
                                method: "POST",
                              },
                            );
                            const pauseJson = await pauseRes.json();
                            if (!pauseRes.ok || !pauseJson.success) {
                              throw new Error(
                                pauseJson.data?.message ||
                                  "Perubahan status stream gagal",
                              );
                            }
                            setIsLivePaused(nextPause);
                            showToast(
                              nextPause
                                ? "⏸️ Live Streaming Dijeda"
                                : "▶️ Live Streaming Dilanjutkan",
                            );
                          } catch (error) {
                            showToast(
                              error instanceof Error
                                ? error.message
                                : "Perubahan status stream gagal",
                            );
                          }
                        }}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[#232c42] bg-[#111827] py-2 text-[9.5px] font-medium text-slate-300 hover:bg-white/5 transition"
                      >
                        <span>
                          {isLivePaused
                            ? "▶️ Lanjutkan Live"
                            : "⏸️ Jeda Siaran"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleCopy(
                            customRtmpUrl ||
                              (selectedPlatform.includes("Instagram")
                                ? "rtmps://live-upload.instagram.com:443/rtmp/"
                                : "rtmp://live.livestreamer.ai/live"),
                            "Link Siaran",
                          );
                        }}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[#232c42] bg-[#111827] py-2 text-[9.5px] font-medium text-slate-300 hover:bg-white/5 transition"
                      >
                        <span>📋 Salin Ingest URL</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* MODE 2: AI SHORT VIDEO ADS GENERATOR (Based on specification-pricing.png) */
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_0.8fr] gap-4 animate-fadeIn pb-6">
            {/* LEFT COLUMN: Controls, Pricing Tiers & Script Editor */}
            <div className="space-y-4">
              {/* Card 1: Pricing Tiers & Duration (from specification-pricing.png Option B) */}
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
                  <span className="rounded bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                    ⚡ Auto UGC Ads Format
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">
                  Pilih format iklan video pendek yang siap diunggah ke TikTok
                  Ads, Instagram Reels, dan YouTube Shorts.
                </p>

                {/* 3 Pricing Tiers Cards from specification-pricing.png */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  {[
                    {
                      tier: "15s",
                      name: "Short Hook",
                      desc: "High-Impact Script + Subtitle",
                      price: "Rp19.000",
                      modal: "~Rp200",
                      margin: "98.9%",
                      badge: "⚡ Viral Hook",
                    },
                    {
                      tier: "30s",
                      name: "Standard Showcase",
                      desc: "Full Benefit Breakdown + CTA",
                      price: "Rp35.000",
                      modal: "~Rp350",
                      margin: "99.0%",
                      badge: "POPULAR",
                    },
                    {
                      tier: "60s",
                      name: "Deep Review",
                      desc: "Unboxing & Storytelling Script",
                      price: "Rp59.000",
                      modal: "~Rp600",
                      margin: "98.9%",
                      badge: "🎬 Full Review",
                    },
                  ].map((tier) => (
                    <div
                      key={tier.tier}
                      onClick={() => {
                        const t = tier.tier as "15s" | "30s" | "60s";
                        setVideoDuration(t);
                        handleGenerateVideoScript(t);
                      }}
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
                        <p className="text-xs font-bold text-white">
                          {tier.name}
                        </p>
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
                          handleGenerateVideoScript(videoDuration, p);
                          showToast(`Produk iklan: ${p.name}`);
                        }}
                        className={`flex items-center gap-2.5 rounded-xl border p-2 min-w-[200px] cursor-pointer transition ${
                          activeFeaturedProduct.id === p.id
                            ? "border-purple-500 bg-purple-950/40 ring-1 ring-purple-500/50"
                            : "border-[#232c42] bg-[#111827] hover:border-slate-600"
                        }`}
                      >
                        <img
                          src={
                            p.image?.startsWith("http")
                              ? p.image
                              : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                          }
                          alt={p.name}
                          className="h-10 w-10 rounded-lg object-cover border border-white/10"
                        />
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
                    onClick={() => handleGenerateVideoScript()}
                    disabled={isGeneratingScript}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-bold text-white hover:brightness-110 active:scale-95 transition"
                  >
                    <span>
                      {isGeneratingScript
                        ? "⏳ Merancang Naskah..."
                        : "✨ Generate Naskah Iklan Baru"}
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
                        setVideoScript({ ...videoScript, hook: e.target.value })
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
                          setVideoScript({
                            ...videoScript,
                            problem: e.target.value,
                          })
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
                          setVideoScript({
                            ...videoScript,
                            solution: e.target.value,
                          })
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
                        setVideoScript({ ...videoScript, cta: e.target.value })
                      }
                      className="w-full bg-transparent text-emerald-200 outline-none resize-none font-bold leading-relaxed"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#232c42]">
                  <button
                    onClick={() => {
                      const full = `${videoScript.hook} ${videoScript.problem} ${videoScript.solution} ${videoScript.cta}`;
                      speakText(full, { tone: "Energetic" });
                    }}
                    className="flex items-center gap-2 rounded-lg border border-[#232c42] bg-[#111827] px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/5 active:scale-95 transition"
                  >
                    <span>▶ Putar Audio Iklan (UGC Ads Voice)</span>
                  </button>

                  <button
                    onClick={handleRenderVideo}
                    disabled={isRenderingVideo}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 px-6 py-2.5 text-xs font-black text-white shadow-xl shadow-purple-600/30 hover:brightness-110 active:scale-95 transition"
                  >
                    <span>
                      {isRenderingVideo
                        ? `⏳ Rendering Video (${renderProgress}%)...`
                        : `⚡ Render Video Iklan (${videoDuration === "15s" ? "Rp19.000" : videoDuration === "30s" ? "Rp35.000" : "Rp59.000"})`}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Video Phone Preview Player (Authentic Commercial UGC Ads Style) */}
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

                  {/* TOP COMMERCIAL AD STICKER (Neon Yellow TikTok Ads Style) */}
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

                    {/* Feature USP Badges (Scrollbar hidden) */}
                    <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                      {[
                        "✨ 100% BPOM",
                        "⚡ Cepat Glowing",
                        "💧 24H Lembap",
                      ].map((badge, idx) => (
                        <span
                          key={idx}
                          className="rounded-full bg-black/70 px-2 py-0.5 text-[7.5px] font-bold text-cyan-300 backdrop-blur-md border border-cyan-400/30 shrink-0"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* BOTTOM COMMERCIAL AD OVERLAYS */}
                  <div className="relative z-20 space-y-2 mt-auto">
                    {/* Dynamic Kinetic Subtitle Box */}
                    <div className="rounded-xl bg-black/80 p-2.5 backdrop-blur-md border border-yellow-400/30 text-center shadow-xl animate-fadeIn">
                      <p className="text-[10px] font-black text-yellow-300 leading-snug">
                        &ldquo;{videoScript.hook}&rdquo;
                      </p>
                    </div>

                    {/* TikTok / Shopee-authentic Product Card */}
                    <div
                      className="rounded-2xl p-2.5 backdrop-blur-md shadow-2xl"
                      style={{
                        background: "rgba(8,6,24,0.92)",
                        border: "1px solid rgba(251,191,36,0.35)",
                        boxShadow:
                          "0 8px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
                      }}
                    >
                      {/* Card header */}
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[8px] font-black uppercase tracking-widest text-yellow-400 flex items-center gap-1">
                          <span>🛒</span> Keranjang Kuning
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="rounded bg-red-500 text-[7px] font-black text-white px-1.5 py-0.5">
                            HEMAT 35%
                          </span>
                          <span className="text-[7px] text-slate-500 font-mono">
                            #
                            {(activeFeaturedProduct.id || "LIVE")
                              .slice(-6)
                              .toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {/* Product row */}
                      <div className="flex items-center gap-2">
                        {/* Thumbnail with discount ring */}
                        <div className="relative shrink-0">
                          <div
                            className="rounded-xl overflow-hidden bg-slate-800"
                            style={{
                              width: 44,
                              height: 44,
                              boxShadow: "0 0 0 2px rgba(251,191,36,0.5)",
                            }}
                          >
                            <img
                              src={
                                activeFeaturedProduct.image &&
                                activeFeaturedProduct.image.startsWith(
                                  "http",
                                ) &&
                                !activeFeaturedProduct.image.includes("500")
                                  ? activeFeaturedProduct.image
                                  : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                              }
                              alt={activeFeaturedProduct.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[6px] font-black px-1 py-0.5 rounded-full">
                            HOT
                          </span>
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold text-white truncate">
                            {activeFeaturedProduct.name}
                          </p>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            <span className="text-yellow-400 text-[8px]">
                              ★★★★★
                            </span>
                            <span className="text-[7.5px] text-slate-400 ml-0.5">
                              {Math.floor(
                                (activeFeaturedProduct.stock || 50) * 8,
                              )}
                              + Terjual
                            </span>
                          </div>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-[11px] font-black text-emerald-400">
                              {activeFeaturedProduct.price}
                            </span>
                            <span className="text-[8px] text-slate-500 line-through">
                              Rp149.000
                            </span>
                          </div>
                        </div>

                        {/* Buy Button */}
                        <button
                          className="shrink-0 rounded-xl text-[9px] font-black text-black shadow-lg hover:brightness-110 animate-pulse"
                          style={{
                            background:
                              "linear-gradient(135deg, #fde047 0%, #f59e0b 100%)",
                            padding: "7px 10px",
                            boxShadow: "0 4px 12px rgba(245,158,11,0.5)",
                          }}
                        >
                          Beli
                          <br />
                          Sekarang
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
                      <p className="text-[10px] text-slate-400 mb-3">
                        Menggabungkan Video Lip-Sync 60fps + Subtitle + Audio
                        TTS + Stiker Iklan
                      </p>
                      <div className="w-full bg-[#1e293b] rounded-full h-2 overflow-hidden border border-white/10">
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
                    <span>📥 Download Video Iklan Siap Upload (MP4 9:16)</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- MODALS --- */}

        {/* --- MODALS --- */}

        {/* Modal: Tambah Produk (2-Tab: Basic Info + RAG Knowledge Base) */}
        {showAddProductModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-2xl rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowAddProductModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                ✕
              </button>
              <div className="flex items-center justify-between mb-4 border-b border-[#232c42] pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🛍️</span>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Tambah Produk Baru
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Data otomatis diolah ke RAG Knowledge Base Host Live
                    </p>
                  </div>
                </div>
              </div>

              {/* Modal Tabs */}
              <div className="flex border-b border-[#232c42] mb-4 gap-2">
                <button
                  type="button"
                  onClick={() => setProductModalTab("BASIC")}
                  className={`pb-2 text-xs font-bold transition border-b-2 flex items-center gap-1.5 ${
                    productModalTab === "BASIC"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span>📦 1. Informasi Dasar Produk</span>
                </button>
                <button
                  type="button"
                  disabled
                  className={`pb-2 text-xs font-bold transition border-b-2 flex items-center gap-1.5 ${"border-transparent text-emerald-300 cursor-default"}`}
                >
                  <span>🧠 RAG Knowledge Base (AI otomatis saat simpan)</span>
                  <span className="rounded bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 text-[9px] border border-emerald-500/30">
                    Penting
                  </span>
                </button>
              </div>

              <form onSubmit={handleAddProduct} className="space-y-4 text-xs">
                {productModalTab === "BASIC" ? (
                  <>
                    {/* Image Upload & Preview Section */}
                    <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3.5">
                      <label className="block text-slate-300 font-semibold mb-2">
                        Foto / Gambar Produk
                      </label>
                      <div className="flex items-center gap-4">
                        <div className="h-16 w-16 shrink-0 rounded-xl overflow-hidden border-2 border-blue-500/50 bg-[#1a233a] shadow-inner flex items-center justify-center">
                          {newProductForm.image ? (
                            <img
                              src={newProductForm.image}
                              alt="Preview"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-2xl">📸</span>
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-500/60 bg-blue-500/10 px-3 py-2 cursor-pointer hover:bg-blue-500/20 transition">
                            <span className="text-xs text-blue-300 font-bold">
                              📁 Upload Foto dari Komputer / HP
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  const file = e.target.files[0];
                                  const reader = new FileReader();
                                  reader.onload = (uploadEvent) => {
                                    if (uploadEvent.target?.result) {
                                      setNewProductForm({
                                        ...newProductForm,
                                        image: String(
                                          uploadEvent.target.result,
                                        ),
                                      });
                                      showToast(
                                        `Foto ${file.name} berhasil diunggah!`,
                                      );
                                    }
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                            />
                          </label>
                          <input
                            type="text"
                            value={newProductForm.image}
                            onChange={(e) =>
                              setNewProductForm({
                                ...newProductForm,
                                image: e.target.value,
                              })
                            }
                            placeholder="Atau tempel URL gambar (https://...)"
                            className="w-full rounded bg-[#0b101e] border border-[#232c42] px-2.5 py-1.5 text-[11px] text-slate-300 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {/* Preset image shortcuts */}
                      <div className="mt-3 pt-2.5 border-t border-[#232c42]/60">
                        <p className="text-[10px] text-slate-400 mb-1.5">
                          Pilihan Cepat Gambar Template:
                        </p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {[
                            {
                              name: "Serum",
                              url: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
                            },
                            {
                              name: "Moisturizer",
                              url: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop&q=80",
                            },
                            {
                              name: "Sunscreen",
                              url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop&q=80",
                            },
                            {
                              name: "Glow Pack",
                              url: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&fit=crop&q=80",
                            },
                            {
                              name: "Toner",
                              url: "https://images.unsplash.com/photo-1608248597359-0d12e6900f6b?w=400&h=400&fit=crop&q=80",
                            },
                          ].map((preset) => (
                            <button
                              type="button"
                              key={preset.name}
                              onClick={() => {
                                setNewProductForm({
                                  ...newProductForm,
                                  image: preset.url,
                                });
                                showToast(`Foto ${preset.name} dipilih!`);
                              }}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-medium transition shrink-0 ${
                                newProductForm.image === preset.url
                                  ? "border-blue-500 bg-blue-500/20 text-white font-bold"
                                  : "border-[#232c42] bg-[#0c1221] text-slate-400 hover:text-white"
                              }`}
                            >
                              <img
                                src={preset.url}
                                alt={preset.name}
                                className="h-3.5 w-3.5 rounded-full object-cover"
                              />
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Nama Produk <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={newProductForm.name}
                        onChange={(e) =>
                          setNewProductForm({
                            ...newProductForm,
                            name: e.target.value,
                          })
                        }
                        placeholder="Contoh: Serum Brightening Collagen 30ml"
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Harga Jual Live (Rp){" "}
                          <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="number"
                          required
                          value={newProductForm.price}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              price: e.target.value,
                            })
                          }
                          placeholder="99000"
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Stok Tersedia (pcs)
                        </label>
                        <input
                          type="number"
                          value={newProductForm.stock}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              stock: Number(e.target.value),
                            })
                          }
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Kategori
                        </label>
                        <input
                          type="text"
                          value={newProductForm.tag}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              tag: e.target.value,
                            })
                          }
                          placeholder="Skincare / Beauty / Fashion"
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          SKU / Kode Produk
                        </label>
                        <input
                          type="text"
                          value={newProductForm.sku}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              sku: e.target.value,
                            })
                          }
                          placeholder="SKU-SBP-001 (Opsional)"
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Link Keranjang Kuning / Checkout
                        </label>
                        <input
                          type="url"
                          value={newProductForm.link || ""}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              link: e.target.value,
                            })
                          }
                          placeholder="https://shopee.co.id/... atau https://tiktok.com/..."
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 text-[11px]"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  /* TAB 2: RAG Knowledge Base */
                  <div className="space-y-3.5">
                    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-[11px] text-slate-300">
                      <p className="font-bold text-blue-300 mb-1">
                        💡 Bagaimana AI Host menggunakan RAG Knowledge Base ini?
                      </p>
                      <p className="text-slate-400">
                        Saat penonton live bertanya tentang cara pakai, khasiat,
                        perbandingan produk, atau izin BPOM, AI Host akan
                        menjawab dengan cepat &amp; akurat berdasarkan data di
                        bawah ini.
                      </p>
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Deskripsi Lengkap Produk
                      </label>
                      <textarea
                        rows={2}
                        value={newProductForm.description}
                        onChange={(e) =>
                          setNewProductForm({
                            ...newProductForm,
                            description: e.target.value,
                          })
                        }
                        placeholder="Jelaskan formula, bahan aktif, dan kelebihan umum produk..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Keunggulan &amp; Manfaat Utama (Key Selling Points)
                      </label>
                      <textarea
                        rows={2}
                        value={newProductForm.benefits}
                        onChange={(e) =>
                          setNewProductForm({
                            ...newProductForm,
                            benefits: e.target.value,
                          })
                        }
                        placeholder="Contoh: Mencerahkan noda hitam dalam 14 hari, merawat skin barrier, menghidrasi 24 jam tanpa lengket..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Petunjuk &amp; Cara Pemakaian (Usage Steps)
                      </label>
                      <textarea
                        rows={2}
                        value={newProductForm.usage}
                        onChange={(e) =>
                          setNewProductForm({
                            ...newProductForm,
                            usage: e.target.value,
                          })
                        }
                        placeholder="Contoh: Gunakan 2-3 tetes pada wajah bersih setiap pagi & malam sebelum pelembap. Oleskan merata dan tepuk lembut..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          FAQ &amp; Izin Resmi (BPOM / Halal / Keamanan)
                        </label>
                        <textarea
                          rows={2}
                          value={newProductForm.faq}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              faq: e.target.value,
                            })
                          }
                          placeholder="Contoh: 100% Original resmi BPOM, aman untuk kulit sensitif dan bumil/busui..."
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Target Audiens / Tipe Pengguna
                        </label>
                        <textarea
                          rows={2}
                          value={newProductForm.targetAudience}
                          onChange={(e) =>
                            setNewProductForm({
                              ...newProductForm,
                              targetAudience: e.target.value,
                            })
                          }
                          placeholder="Contoh: Cocok untuk pria & wanita usia 18+ dengan masalah kulit kusam atau dehidrasi..."
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-[#232c42]">
                  <div className="flex items-center gap-2">
                    {productModalTab === "BASIC" ? (
                      <button
                        type="button"
                        disabled
                        className="text-emerald-300 font-semibold cursor-default"
                      >
                        🧠 RAG akan dibuat otomatis oleh AI saat disimpan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setProductModalTab("BASIC")}
                        className="text-slate-400 hover:text-slate-300 font-semibold"
                      >
                        ← Kembali ke Info Dasar
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddProductModal(false)}
                      className="rounded-lg border border-[#232c42] px-4 py-2 text-slate-300 hover:bg-white/5"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-500 shadow-lg shadow-blue-600/30"
                    >
                      Simpan Produk &amp; RAG
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Edit Produk (2-Tab: Basic Info + RAG Knowledge Base) */}
        {showEditProductModal && selectedProductForEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-2xl rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowEditProductModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                ✕
              </button>
              <div className="flex items-center gap-2 mb-4 border-b border-[#232c42] pb-3">
                <span className="text-2xl">✏️</span>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Edit Produk &amp; RAG Knowledge
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    ID: {selectedProductForEdit.id || "N/A"}
                  </p>
                </div>
              </div>

              {/* Modal Tabs */}
              <div className="flex border-b border-[#232c42] mb-4 gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalTab("BASIC")}
                  className={`pb-2 text-xs font-bold transition border-b-2 flex items-center gap-1.5 ${
                    editModalTab === "BASIC"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span>📦 1. Informasi Dasar Produk</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditModalTab("RAG")}
                  className={`pb-2 text-xs font-bold transition border-b-2 flex items-center gap-1.5 ${
                    editModalTab === "RAG"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <span>🧠 2. RAG Knowledge Base (AI Host Brain)</span>
                </button>
              </div>

              <form
                onSubmit={handleSaveEditProduct}
                className="space-y-4 text-xs"
              >
                {editModalTab === "BASIC" ? (
                  <>
                    {/* Image Upload & Preview in Edit */}
                    <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3.5">
                      <label className="block text-slate-300 font-semibold mb-2">
                        Foto / Gambar Produk
                      </label>
                      <div className="flex items-center gap-4">
                        <div className="h-16 w-16 shrink-0 rounded-xl overflow-hidden border-2 border-blue-500/50 bg-[#1a233a] shadow-inner flex items-center justify-center">
                          {selectedProductForEdit.image?.startsWith("http") ||
                          selectedProductForEdit.image?.startsWith("/") ||
                          selectedProductForEdit.image?.startsWith("data:") ? (
                            <img
                              src={selectedProductForEdit.image}
                              alt={selectedProductForEdit.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div
                              className={`h-full w-full ${selectedProductForEdit.image || "bg-[#e5cbbb]"}`}
                            />
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-500/60 bg-blue-500/10 px-3 py-2 cursor-pointer hover:bg-blue-500/20 transition">
                            <span className="text-xs text-blue-300 font-bold">
                              📁 Ganti Foto Produk
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  const file = e.target.files[0];
                                  const reader = new FileReader();
                                  reader.onload = (uploadEvent) => {
                                    if (uploadEvent.target?.result) {
                                      setSelectedProductForEdit({
                                        ...selectedProductForEdit,
                                        image: String(
                                          uploadEvent.target.result,
                                        ),
                                      });
                                      showToast(
                                        `Foto ${file.name} berhasil diperbarui!`,
                                      );
                                    }
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                            />
                          </label>
                          <input
                            type="text"
                            value={selectedProductForEdit.image || ""}
                            onChange={(e) =>
                              setSelectedProductForEdit({
                                ...selectedProductForEdit,
                                image: e.target.value,
                              })
                            }
                            placeholder="Atau tempel URL gambar (https://...)"
                            className="w-full rounded bg-[#0b101e] border border-[#232c42] px-2.5 py-1.5 text-[11px] text-slate-300 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Nama Produk
                      </label>
                      <input
                        type="text"
                        required
                        value={selectedProductForEdit.name}
                        onChange={(e) =>
                          setSelectedProductForEdit({
                            ...selectedProductForEdit,
                            name: e.target.value,
                          })
                        }
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Harga (Rp)
                        </label>
                        <input
                          type="text"
                          value={selectedProductForEdit.price}
                          onChange={(e) =>
                            setSelectedProductForEdit({
                              ...selectedProductForEdit,
                              price: e.target.value,
                            })
                          }
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Stok (pcs)
                        </label>
                        <input
                          type="number"
                          value={selectedProductForEdit.stock}
                          onChange={(e) =>
                            setSelectedProductForEdit({
                              ...selectedProductForEdit,
                              stock: Number(e.target.value),
                            })
                          }
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Kategori
                        </label>
                        <input
                          type="text"
                          value={selectedProductForEdit.tag || ""}
                          onChange={(e) =>
                            setSelectedProductForEdit({
                              ...selectedProductForEdit,
                              tag: e.target.value,
                            })
                          }
                          className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Link Produk / URL Checkout
                      </label>
                      <input
                        type="url"
                        value={selectedProductForEdit.link || ""}
                        onChange={(e) =>
                          setSelectedProductForEdit({
                            ...selectedProductForEdit,
                            link: e.target.value,
                          })
                        }
                        placeholder="https://shopee.co.id/... atau https://tiktok.com/@toko/..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500"
                      />
                    </div>
                  </>
                ) : (
                  /* TAB 2: Edit RAG Knowledge Base */
                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Deskripsi Lengkap Produk
                      </label>
                      <textarea
                        rows={2}
                        value={selectedProductForEdit.description || ""}
                        onChange={(e) =>
                          setSelectedProductForEdit({
                            ...selectedProductForEdit,
                            description: e.target.value,
                          })
                        }
                        placeholder="Jelaskan formula, bahan aktif, dan kelebihan umum produk..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Keunggulan &amp; Manfaat Utama (Key Selling Points)
                      </label>
                      <textarea
                        rows={2}
                        value={selectedProductForEdit.benefits || ""}
                        onChange={(e) =>
                          setSelectedProductForEdit({
                            ...selectedProductForEdit,
                            benefits: e.target.value,
                          })
                        }
                        placeholder="Contoh: Mencerahkan noda hitam, merawat skin barrier alami..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Petunjuk &amp; Cara Pemakaian (Usage Steps)
                      </label>
                      <textarea
                        rows={2}
                        value={selectedProductForEdit.usage || ""}
                        onChange={(e) =>
                          setSelectedProductForEdit({
                            ...selectedProductForEdit,
                            usage: e.target.value,
                          })
                        }
                        placeholder="Contoh: Oleskan 2-3 tetes pada wajah bersih setiap pagi dan malam..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        FAQ &amp; Izin Resmi (BPOM / Halal / Keamanan)
                      </label>
                      <textarea
                        rows={2}
                        value={selectedProductForEdit.faq || ""}
                        onChange={(e) =>
                          setSelectedProductForEdit({
                            ...selectedProductForEdit,
                            faq: e.target.value,
                          })
                        }
                        placeholder="Contoh: 100% Original BPOM resmi, aman untuk kulit sensitif dan bumil/busui..."
                        className="w-full rounded-lg bg-[#111827] border border-[#232c42] p-2.5 text-white outline-none focus:border-blue-500 font-sans"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-[#232c42]">
                  <button
                    type="button"
                    onClick={() => setShowEditProductModal(false)}
                    className="rounded-lg border border-[#232c42] px-4 py-2 text-slate-300 hover:bg-white/5"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-500 shadow-lg shadow-blue-600/30"
                  >
                    Simpan Perubahan
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Import CSV with Live Preview */}
        {showCsvModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-xl rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowCsvModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                ✕
              </button>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">📊</span>
                <h3 className="text-lg font-bold text-white">
                  Import Data Produk Massal (CSV)
                </h3>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Format baris:{" "}
                <code>Nama Produk, Harga, Stok, Kategori, Deskripsi, Link</code>
              </p>

              <div className="mb-3 flex justify-between items-center text-[11px]">
                <span className="text-slate-400">
                  Tempel teks CSV atau upload file .csv:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCsvText(
                      `Toner Wajah Centella Hydrating, 85000, 100, Skincare, Toner penenang kulit kemerahan dan melembapkan, https://shopee.co.id/toner\nLip Cream Velvet Matte 03 Nude, 65000, 150, Beauty, Lip cream tahan 12 jam tidak kering di bibir, https://tiktok.com/@toko/lipcream\nSunscreen Serum SPF 50 PA++++, 95000, 75, Skincare, Perlindungan UV maksimal ringan tanpa whitecast, https://shopee.co.id/sunscreen`,
                    );
                    showToast("✨ Contoh data CSV disalin!");
                  }}
                  className="text-blue-400 hover:underline font-semibold"
                >
                  + Isi Contoh Data CSV
                </button>
              </div>

              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Contoh:&#10;Toner Wajah Centella, 85000, 100, Skincare, Menenangkan kulit kemerahan&#10;Lip Cream Velvet Matte, 65000, 150, Beauty, Tahan 12 jam"
                className="w-full rounded-xl bg-[#111827] border border-[#232c42] p-3 text-xs text-white outline-none font-mono focus:border-blue-500 mb-3"
              />

              <div className="flex justify-between items-center pt-2 border-t border-[#232c42]">
                <label className="cursor-pointer text-xs text-blue-400 hover:underline font-semibold flex items-center gap-1.5">
                  <span>📁 Pilih file .csv/.txt</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) =>
                          setCsvText(event.target?.result as string);
                        reader.readAsText(file);
                      }
                    }}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCsvModal(false)}
                    className="rounded-lg border border-[#232c42] px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
                  >
                    Batal
                  </button>
                  <button
                    onClick={handleImportCsv}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 shadow-md shadow-blue-600/30"
                  >
                    Import ke RAG Database
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Preview Script (Dynamic AI RAG Sales Script) */}
        {showScriptModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-lg rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl">
              <button
                onClick={() => setShowScriptModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                ✕
              </button>
              <div className="flex items-center gap-2 mb-2 border-b border-[#232c42] pb-3">
                <span className="text-2xl">📜</span>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    AI Generated Sales Script (RAG Engine)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Presenter:{" "}
                    <strong className="text-blue-300">
                      {selectedAvatar.name}
                    </strong>{" "}
                    • Gaya:{" "}
                    <strong className="text-purple-300">{selectedTone}</strong>{" "}
                    • Produk:{" "}
                    <strong className="text-emerald-300">
                      {activeFeaturedProduct.name}
                    </strong>
                  </p>
                </div>
              </div>

              {isLoadingLiveScript ? (
                <div className="py-12 text-center space-y-3">
                  <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-300 font-semibold">
                    AI Host sedang menganalisis deskripsi &amp; manfaat
                    produk...
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Menyusun Hook, Problem-Solution, dan Call To Action...
                  </p>
                </div>
              ) : liveSalesScriptData ? (
                <div className="rounded-xl bg-[#111827] border border-[#232c42] p-4 text-xs text-slate-200 space-y-3 font-sans max-h-72 overflow-y-auto pr-1.5 shadow-inner">
                  <div className="rounded-lg bg-blue-950/30 border border-blue-500/20 p-2.5">
                    <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">
                      🎣 [1. HOOK PEMBUKA &amp; SAPAAN]
                    </p>
                    <p className="text-slate-200 leading-relaxed">
                      &ldquo;{liveSalesScriptData.hook}&rdquo;
                    </p>
                  </div>

                  <div className="rounded-lg bg-purple-950/30 border border-purple-500/20 p-2.5">
                    <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1">
                      💡 [2. BEDAH MANFAAT &amp; SELLING POINTS]
                    </p>
                    <p className="text-slate-200 leading-relaxed">
                      &ldquo;{liveSalesScriptData.showcase}&rdquo;
                    </p>
                  </div>

                  <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/20 p-2.5">
                    <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                      ⚡ [3. CALL TO ACTION &amp; URGENCY PROMO]
                    </p>
                    <p className="text-slate-200 leading-relaxed">
                      &ldquo;{liveSalesScriptData.cta}&rdquo;
                    </p>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center space-y-2">
                  <span className="text-2xl">⚠️</span>
                  <p className="text-xs text-amber-300 font-semibold">
                    Belum ada naskah yang digenerate oleh AI.
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Klik tombol di bawah untuk membuat naskah otomatis dari AI
                    Host.
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-[#232c42]">
                <button
                  type="button"
                  onClick={handleFetchLiveSalesScript}
                  disabled={isLoadingLiveScript}
                  className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3.5 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 transition active:scale-95 flex items-center gap-1.5"
                >
                  <span>🔄</span>
                  <span>Regenerate Script</span>
                </button>

                <div className="flex items-center gap-2">
                  {liveSalesScriptData?.fullScript && (
                    <button
                      type="button"
                      onClick={() => {
                        handleCopy(
                          liveSalesScriptData.fullScript || "",
                          "Script promosi live",
                        );
                      }}
                      className="rounded-lg border border-[#232c42] bg-[#111827] px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:border-blue-500 transition active:scale-95 shadow-sm"
                    >
                      📋 Salin Naskah
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowScriptModal(false)}
                    className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:brightness-110 shadow-md shadow-blue-600/30"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Tutorial RTMP Lengkap Multi-Platform (Dengan Syarat & Ketentuan Live) */}
        {showTutorialModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-2xl rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowTutorialModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                ✕
              </button>

              <div className="flex items-center gap-3 mb-3 border-b border-[#232c42] pb-3">
                <span className="text-2xl">📡</span>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Panduan Koneksi &amp; Syarat Live Siaran
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Pilih platform tujuan untuk melihat syarat kelayakan dan
                    cara mengambil Stream Key.
                  </p>
                </div>
              </div>

              {/* Platform Selection Tabs */}
              <div className="flex flex-wrap gap-1.5 mb-4 p-1 rounded-xl bg-[#111827] border border-[#232c42]">
                {[
                  { name: "TikTok LIVE", icon: "♪" },
                  { name: "Shopee Live", icon: "🛍️" },
                  { name: "Instagram Live", icon: "📸" },
                  { name: "YouTube Live", icon: "▶" },
                  { name: "Facebook Live", icon: "f" },
                ].map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setTutorialPlatformTab(p.name)}
                    className={`flex-1 min-w-[100px] flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 text-[10px] font-bold transition ${
                      tutorialPlatformTab === p.name
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span>{p.icon}</span>
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>

              {/* Platform Details Content */}
              <div className="space-y-3.5 text-xs text-slate-200">
                {tutorialPlatformTab === "TikTok LIVE" && (
                  <div className="space-y-3 animate-fadeIn">
                    <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-3">
                      <p className="text-[11px] font-bold text-yellow-400 mb-1 flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>Syarat Kelayakan Live di TikTok:</span>
                      </p>
                      <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                        <li>
                          <strong>Akun Kreator:</strong> Minimal memiliki 1.000
                          Followers untuk membuka akses siaran langsung di
                          aplikasi.
                        </li>
                        <li>
                          <strong>Akun TikTok Shop (Seller):</strong>{" "}
                          <strong>
                            Tanpa batas follower (0 follower bisa live)
                          </strong>{" "}
                          asalkan akun terdaftar resmi di TikTok Shop Seller
                          Center.
                        </li>
                        <li>
                          <strong>Akses RTMP / PC:</strong> Menggunakan{" "}
                          <em>TikTok LIVE Studio</em> atau akses Stream Key dari
                          akun TikTok Shop / Agency Partner.
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                      <p className="text-[11px] font-bold text-white mb-2">
                        📋 Langkah Mengambil RTMP URL &amp; Stream Key:
                      </p>
                      <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                        <li>
                          Buka <strong>TikTok LIVE Studio</strong> di PC atau
                          buka <strong>TikTok Live Center</strong> di browser.
                        </li>
                        <li>
                          Pilih menu{" "}
                          <strong>Pancarkan dari Komputer (Custom RTMP)</strong>
                          .
                        </li>
                        <li>
                          Salin <strong>Server URL</strong> (contoh:{" "}
                          <code>rtmp://live.tiktok.com/live/</code>) ke kolom
                          Server URL di dashboard ini.
                        </li>
                        <li>
                          Salin <strong>Stream Key</strong> rahasia Anda ke
                          kolom Stream Key di dashboard ini.
                        </li>
                        <li>
                          Klik <strong>Mulai Live Sekarang</strong> di dashboard
                          ini, dan siaran AI Host langsung terhubung ke
                          keranjang kuning TikTok Anda!
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {tutorialPlatformTab === "Shopee Live" && (
                  <div className="space-y-3 animate-fadeIn">
                    <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3">
                      <p className="text-[11px] font-bold text-orange-400 mb-1 flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>Syarat Kelayakan Live di Shopee:</span>
                      </p>
                      <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                        <li>
                          Toko Shopee dalam status <strong>Aktif</strong> dan
                          tidak dalam penalti moderasi.
                        </li>
                        <li>
                          Fitur Shopee Live sudah aktif pada akun toko Anda di
                          Seller Centre.
                        </li>
                        <li>
                          Akses Streaming Komputer (RTMP) dapat diakses langsung
                          melalui Shopee Live PC di Seller Centre.
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                      <p className="text-[11px] font-bold text-white mb-2">
                        📋 Langkah Mengambil RTMP URL &amp; Stream Key:
                      </p>
                      <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                        <li>
                          Login ke <strong>Shopee Seller Centre</strong>{" "}
                          (seller.shopee.co.id) di laptop/PC Anda.
                        </li>
                        <li>
                          Masuk ke menu{" "}
                          <strong>
                            Promosi Saya ➔ Shopee Live ➔ Buat Siaran Langsung
                          </strong>
                          .
                        </li>
                        <li>
                          Pilih opsi{" "}
                          <strong>Streaming Melalui Komputer (RTMP)</strong>.
                        </li>
                        <li>
                          Salin <strong>URL RTMP</strong> dan{" "}
                          <strong>Kunci Streaming</strong> yang muncul di layar
                          Shopee.
                        </li>
                        <li>
                          Tempelkan ke dashboard ini lalu klik{" "}
                          <strong>Mulai Live Sekarang</strong>.
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {tutorialPlatformTab === "Instagram Live" && (
                  <div className="space-y-3 animate-fadeIn">
                    <div className="rounded-xl bg-pink-500/10 border border-pink-500/30 p-3">
                      <p className="text-[11px] font-bold text-pink-400 mb-1 flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>Syarat Kelayakan Live di Instagram:</span>
                      </p>
                      <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                        <li>
                          Akun Instagram bertipe{" "}
                          <strong>Profesional (Bisnis atau Kreator)</strong> —
                          Gratis dapat diubah di Pengaturan Akun IG.
                        </li>
                        <li>
                          Dapat diakses melalui browser laptop di{" "}
                          <strong>Instagram Live Producer</strong>.
                        </li>
                        <li>
                          Tanpa batas minimum followers (Akun baru yang sudah
                          profesional bisa langsung live).
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                      <p className="text-[11px] font-bold text-white mb-2">
                        📋 Langkah Mengambil RTMP URL &amp; Stream Key:
                      </p>
                      <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                        <li>
                          Buka link{" "}
                          <strong>instagram.com/live/producer/</strong> di
                          Google Chrome laptop/PC.
                        </li>
                        <li>
                          Klik <strong>Add Live Video</strong>, beri judul live
                          siaran Anda.
                        </li>
                        <li>
                          Salin <strong>Stream URL</strong> (
                          <code>
                            rtmps://live-upload.instagram.com:443/rtmp/
                          </code>
                          ) dan <strong>Stream Key</strong>.
                        </li>
                        <li>
                          Tempelkan ke form dashboard ini, lalu klik{" "}
                          <strong>Mulai Live Sekarang</strong>.
                        </li>
                        <li>
                          Kembali ke halaman web Instagram Producer, klik tombol
                          biru <strong>Go Live</strong> untuk memancarkan siaran
                          ke seluruh followers Anda!
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {tutorialPlatformTab === "YouTube Live" && (
                  <div className="space-y-3 animate-fadeIn">
                    <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3">
                      <p className="text-[11px] font-bold text-red-400 mb-1 flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>Syarat Kelayakan Live di YouTube:</span>
                      </p>
                      <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                        <li>
                          Channel YouTube telah{" "}
                          <strong>terverifikasi nomor telepon</strong>.
                        </li>
                        <li>
                          Fitur Live Streaming telah diaktifkan di YouTube
                          Studio (membutuhkan waktu 24 jam untuk channel baru).
                        </li>
                        <li>
                          Jika menggunakan Software/RTMP encoder di PC,{" "}
                          <strong>
                            tidak ada batas minimum subscriber (0 Subscriber
                            bisa live)
                          </strong>
                          .
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                      <p className="text-[11px] font-bold text-white mb-2">
                        📋 Langkah Mengambil RTMP URL &amp; Stream Key:
                      </p>
                      <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                        <li>
                          Buka <strong>YouTube Studio</strong>{" "}
                          (studio.youtube.com) lalu klik tombol{" "}
                          <strong>Buat ➔ Melakukan Live Streaming</strong> di
                          kanan atas.
                        </li>
                        <li>
                          Pilih tab <strong>Stream</strong> pada panel sebelah
                          kiri.
                        </li>
                        <li>
                          Salin <strong>URL Streaming</strong> (
                          <code>rtmp://a.rtmp.youtube.com/live2</code>) dan{" "}
                          <strong>Kunci Streaming</strong> Anda.
                        </li>
                        <li>
                          Tempelkan di form Step 5 dashboard ini, lalu klik{" "}
                          <strong>Mulai Live Sekarang</strong>.
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                {tutorialPlatformTab === "Facebook Live" && (
                  <div className="space-y-3 animate-fadeIn">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3">
                      <p className="text-[11px] font-bold text-blue-400 mb-1 flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>Syarat Kelayakan Live di Facebook:</span>
                      </p>
                      <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                        <li>
                          Dapat menggunakan{" "}
                          <strong>Halaman Facebook (Facebook Page)</strong> atau
                          Akun Pribadi dalam <strong>Mode Profesional</strong>.
                        </li>
                        <li>Tidak ada batas minimum followers.</li>
                        <li>
                          Dapat diakses melalui{" "}
                          <strong>Facebook Live Producer</strong>.
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                      <p className="text-[11px] font-bold text-white mb-2">
                        📋 Langkah Mengambil RTMP URL &amp; Stream Key:
                      </p>
                      <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                        <li>
                          Buka <strong>facebook.com/live/producer</strong> di
                          browser PC.
                        </li>
                        <li>
                          Pilih menu{" "}
                          <strong>Pancarkan Menggunakan Kunci Streaming</strong>
                          .
                        </li>
                        <li>
                          Salin <strong>URL Server</strong> (
                          <code>rtmps://live-api-s.facebook.com:443/rtmp/</code>
                          ) dan <strong>Kunci Streaming</strong>.
                        </li>
                        <li>
                          Tempelkan ke dashboard ini, klik{" "}
                          <strong>Mulai Live Sekarang</strong>, lalu klik{" "}
                          <strong>Siarkan Langsung</strong> di halaman Facebook!
                        </li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end pt-3 border-t border-[#232c42]">
                <button
                  type="button"
                  onClick={() => setShowTutorialModal(false)}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-xs font-bold text-white hover:brightness-110 shadow-md shadow-blue-600/30 transition active:scale-95"
                >
                  Mengerti &amp; Tutup Panduan
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Settings / Pengaturan */}
        {showSettingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-md rounded-2xl border border-blue-500/30 bg-[#0c1221] p-6 shadow-2xl">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white"
              >
                ✕
              </button>
              <h3 className="text-lg font-bold text-white mb-4">
                Pengaturan Live Control
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
                  <span>Resolusi Video Stream</span>
                  <span className="text-blue-400 font-bold">
                    1080x1920 (Vertical 9:16)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
                  <span>GPU Cloud Orchestrator</span>
                  <span className="text-emerald-400 font-bold">
                    NVIDIA RTX 4090 (On-Demand)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
                  <span>AI Video Engine</span>
                  <span className="text-purple-400 font-bold">
                    LivePortrait / MuseTalk Neural
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-[#111827] border border-[#232c42]">
                  <span>Voice TTS Engine</span>
                  <span className="text-cyan-400 font-bold">
                    Chatterbox-TTS-Indonesian (Voice Clone)
                  </span>
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500"
                >
                  Simpan &amp; Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Konfirmasi Akhiri Live */}
        {showEndLiveConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
            <div className="relative w-full max-w-sm rounded-2xl border border-red-500/30 bg-[#0c1221] p-6 shadow-2xl text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-400 text-2xl">
                ⚠️
              </div>
              <h3 className="text-base font-bold text-white mb-2">
                Akhiri Live Streaming?
              </h3>
              <p className="text-xs text-slate-400 mb-6">
                AI Host akan menghentikan siaran di platform {selectedPlatform}.
                Seluruh ringkasan analitik dan omzet penjualan akan dihitung
                otomatis.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setShowEndLiveConfirm(false)}
                  className="rounded-lg border border-[#232c42] px-4 py-2 text-xs text-slate-300 hover:bg-white/5"
                >
                  Batal
                </button>
                <button
                  onClick={async () => {
                    setIsLiveActive(false);
                    setLiveSessionPhase("ended");
                    setShowEndLiveConfirm(false);
                    showToast("Menghitung Laporan Analitik Live...");

                    // Stop RTMP transmission on backend
                    try {
                      await fetch("/api/live-stream/stop-broadcast", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sessionId: currentLiveSessionId,
                        }),
                      });
                    } catch {}

                    try {
                      const res = await fetch("/api/live-session/stop", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sessionId: currentLiveSessionId,
                          durationSeconds: liveSeconds,
                          viewers: metrics.viewers,
                          comments: metrics.comments,
                          clicks: metrics.clicks,
                          sales: metrics.sales,
                          productSold: metrics.activeProductSold,
                        }),
                      });

                      if (res.ok) {
                        const json = await res.json();
                        if (json.summary) {
                          setSessionSummary(json.summary);
                          setShowSummaryModal(true);
                          return;
                        }
                      }
                    } catch {}

                    // Fallback calculation
                    const estGpuCost = Math.round((liveSeconds / 3600) * 12500);
                    const net = Math.max(0, metrics.sales - estGpuCost);
                    setSessionSummary({
                      durationSeconds: liveSeconds,
                      durationFormatted: formatTime(liveSeconds),
                      totalViewers: metrics.viewers,
                      peakViewers: Math.round(metrics.viewers * 1.25),
                      totalComments: metrics.comments,
                      aiRepliesCount: Math.round(metrics.comments * 0.95),
                      totalClicks: metrics.clicks,
                      totalProductSold: metrics.activeProductSold,
                      grossRevenue: metrics.sales,
                      grossRevenueFormatted: `Rp${metrics.sales.toLocaleString("id-ID")}`,
                      estimatedGpuCost: estGpuCost,
                      estimatedGpuCostFormatted: `Rp${estGpuCost.toLocaleString("id-ID")}`,
                      netProfit: net,
                      netProfitFormatted: `Rp${net.toLocaleString("id-ID")}`,
                      roiPercentage: `${estGpuCost > 0 ? Math.round((net / estGpuCost) * 100) : 0}%`,
                      endedAt: new Date().toISOString(),
                    });
                    setShowSummaryModal(true);
                  }}
                  className="rounded-lg bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-500 shadow-lg shadow-red-600/30"
                >
                  Ya, Akhiri Live
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Ringkasan Analitik Performa Live Streaming Selesai (Laporan Hasil Siaran) */}
        {showSummaryModal && sessionSummary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fadeIn">
            <div className="relative w-full max-w-2xl rounded-2xl border border-emerald-500/40 bg-[#0b101e] p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="absolute right-4 top-4 text-slate-400 hover:text-white"
              >
                ✕
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white text-2xl shadow-lg shadow-emerald-600/30">
                  📊
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">
                    Laporan Hasil Siaran Live Streaming
                  </h3>
                  <p className="text-xs text-slate-400">
                    Host AI:{" "}
                    <strong className="text-slate-200">
                      {selectedAvatar.name}
                    </strong>{" "}
                    • Platform:{" "}
                    <strong className="text-blue-400">
                      {selectedPlatform}
                    </strong>{" "}
                    • Selesai: {new Date().toLocaleTimeString()}
                  </p>
                </div>
              </div>

              {/* Metric Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
                  <p className="text-[10px] text-slate-400 mb-1">
                    Durasi Siaran
                  </p>
                  <p className="text-lg font-black text-white font-mono">
                    {sessionSummary.durationFormatted}
                  </p>
                  <span className="text-[9px] text-emerald-400 font-medium">
                    100% Otonom AI
                  </span>
                </div>
                <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
                  <p className="text-[10px] text-slate-400 mb-1">
                    Total Penonton
                  </p>
                  <p className="text-lg font-black text-cyan-400 font-mono">
                    {sessionSummary.totalViewers.toLocaleString("id-ID")}
                  </p>
                  <span className="text-[9px] text-slate-400">
                    Peak: {sessionSummary.peakViewers.toLocaleString("id-ID")}
                  </span>
                </div>
                <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
                  <p className="text-[10px] text-slate-400 mb-1">
                    Interaksi Komentar
                  </p>
                  <p className="text-lg font-black text-purple-400 font-mono">
                    {sessionSummary.totalComments}
                  </p>
                  <span className="text-[9px] text-emerald-400">
                    {sessionSummary.aiRepliesCount} Dibalas AI
                  </span>
                </div>
                <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
                  <p className="text-[10px] text-slate-400 mb-1">
                    Produk Terjual
                  </p>
                  <p className="text-lg font-black text-yellow-400 font-mono">
                    {sessionSummary.totalProductSold} pcs
                  </p>
                  <span className="text-[9px] text-emerald-400">
                    {sessionSummary.totalClicks} Klik Keranjang
                  </span>
                </div>
              </div>

              {/* Financial Performance Box */}
              <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-[#0e192c] to-[#0c1221] p-4 mb-5">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3">
                  Ringkasan Finansial &amp; Profitabilitas
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-slate-400 text-[11px]">
                      Total Omzet Kotor (GMV):
                    </p>
                    <p className="text-xl font-black text-white mt-0.5">
                      {sessionSummary.grossRevenueFormatted}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[11px]">
                      Biaya Server GPU Cloud:
                    </p>
                    <p className="text-lg font-bold text-red-400 mt-0.5">
                      - {sessionSummary.estimatedGpuCostFormatted}
                    </p>
                    <span className="text-[9px] text-slate-500">
                      ~Rp12.500 / jam siaran
                    </span>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[11px]">
                      Estimasi Laba Bersih (Net Profit):
                    </p>
                    <p className="text-2xl font-black text-emerald-400 mt-0.5">
                      {sessionSummary.netProfitFormatted}
                    </p>
                    <span className="text-[10px] font-bold text-emerald-300">
                      ROI: {sessionSummary.roiPercentage}
                    </span>
                  </div>
                </div>
              </div>

              {/* Product Performance Breakdown Table */}
              <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 mb-5">
                <p className="text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5">
                  <span>🏷️</span>
                  <span>Rincian Penjualan per Produk:</span>
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-[10.5px]">
                  {products.map((p, idx) => (
                    <div
                      key={p.id || idx}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#0c1221] border border-[#232c42]/60"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={
                            p.image?.startsWith("http") ||
                            p.image?.startsWith("/")
                              ? p.image
                              : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                          }
                          alt={p.name}
                          className="h-7 w-7 rounded object-cover border border-white/10"
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate max-w-[180px]">
                            {p.name}
                          </p>
                          <p className="text-[9px] text-emerald-400">
                            {p.price}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-200">
                          {p.id === activeFeaturedProduct.id
                            ? `${sessionSummary.totalProductSold} pcs`
                            : `${Math.floor(sessionSummary.totalProductSold * 0.2)} pcs`}
                        </p>
                        <p className="text-[9px] text-slate-500">
                          {p.id === activeFeaturedProduct.id
                            ? `${sessionSummary.totalClicks} klik`
                            : `${Math.floor(sessionSummary.totalClicks * 0.25)} klik`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons & Comprehensive CSV Exporter */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[#232c42]">
                <button
                  type="button"
                  onClick={() => {
                    const nowStr = new Date().toLocaleString("id-ID");
                    const headers =
                      "LAPORAN LENGKAP HASIL SIARAN LIVE STREAMING AI\n\n";
                    const summarySection =
                      "RINGKASAN SESI LIVE\n" +
                      `Tanggal Siaran,${nowStr}\n` +
                      `Platform Target,${selectedPlatform}\n` +
                      `AI Host Avatar,${selectedAvatar.name} (${selectedTone})\n` +
                      `Durasi Siaran,${sessionSummary.durationFormatted}\n` +
                      `Total Penonton,${sessionSummary.totalViewers}\n` +
                      `Peak Penonton,${sessionSummary.peakViewers}\n` +
                      `Total Komentar,${sessionSummary.totalComments}\n` +
                      `Balasan Chat AI,${sessionSummary.aiRepliesCount}\n` +
                      `Total Klik Keranjang,${sessionSummary.totalClicks}\n` +
                      `Total Produk Terjual,${sessionSummary.totalProductSold} pcs\n` +
                      `Total Omzet Kotor (GMV),${sessionSummary.grossRevenueFormatted}\n` +
                      `Biaya Server GPU Cloud,${sessionSummary.estimatedGpuCostFormatted}\n` +
                      `Estimasi Laba Bersih,${sessionSummary.netProfitFormatted}\n` +
                      `Return on Investment (ROI),${sessionSummary.roiPercentage}\n\n`;

                    let productSection =
                      "RINCIAN PERFORMA KATALOG PRODUK\nNama Produk,Kategori,Harga,Status,Estimasi Klik,Estimasi Terjual\n";
                    products.forEach((p) => {
                      const isMain = p.id === activeFeaturedProduct.id;
                      const sold = isMain
                        ? sessionSummary.totalProductSold
                        : Math.floor(sessionSummary.totalProductSold * 0.2);
                      const clicks = isMain
                        ? sessionSummary.totalClicks
                        : Math.floor(sessionSummary.totalClicks * 0.25);
                      productSection += `"${p.name}","${p.tag || "Umum"}","${p.price}","${isMain ? "Produk Utama Live" : "Katalog Tambahan"}",${clicks},${sold}\n`;
                    });

                    const fullCsv = headers + summarySection + productSection;
                    const blob = new Blob([fullCsv], {
                      type: "text/csv;charset=utf-8;",
                    });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.setAttribute("href", url);
                    link.setAttribute(
                      "download",
                      `Laporan_Live_${selectedPlatform.replace(/\s+/g, "_")}_${Date.now()}.csv`,
                    );
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    showToast(
                      "📥 Laporan Analitik CSV Lengkap berhasil di-download!",
                    );
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-[#232c42] bg-[#111827] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-white transition active:scale-95"
                >
                  <span>📥 Download Laporan Lengkap (CSV)</span>
                </button>

                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSummaryModal(false);
                      setLiveSeconds(0);
                      showToast("✨ Siap untuk memulai sesi siaran live baru!");
                    }}
                    className="flex-1 sm:flex-none rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/30 hover:brightness-110 transition active:scale-95"
                  >
                    🚀 Mulai Sesi Baru
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* FULL PAGE BLUR LOADING OVERLAY (AI SERVER INITIALIZATION)     */}
        {/* ============================================================ */}
        {isConnectingLive && (
          <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-300">
            <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-indigo-500/30 bg-[#0a0f1d]/95 p-8 text-center shadow-2xl shadow-indigo-500/20">
              {/* Decorative radial glows */}
              <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-80 bg-gradient-to-br from-blue-600/30 via-indigo-600/20 to-purple-600/30 blur-3xl rounded-full" />
              <div className="pointer-events-none absolute -bottom-24 left-1/2 -translate-x-1/2 w-80 h-80 bg-gradient-to-tr from-emerald-600/20 to-blue-600/20 blur-3xl rounded-full" />

              {/* Animated AI Glowing Pulse Sphere */}
              <div className="relative mx-auto mb-6 flex h-24 w-24 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20 animate-ping opacity-75" />
                <div className="absolute inset-0 rounded-full border-4 border-t-indigo-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin" />
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 shadow-xl shadow-indigo-500/40 animate-pulse">
                  <span className="text-3xl">✨</span>
                </div>
              </div>

              {/* Header Title */}
              <h3 className="text-xl font-extrabold text-white tracking-wide mb-1">
                Menyiapkan Sesi Live Streaming AI
              </h3>
              <p className="text-xs text-slate-400 mb-6">
                Host AI{" "}
                <span className="text-indigo-300 font-semibold">
                  {selectedAvatar.name}
                </span>{" "}
                sedang dipersiapkan untuk siaran live di{" "}
                <span className="text-indigo-300 font-semibold">
                  {selectedPlatform}
                </span>
                .
              </p>

              {/* Active Stage Badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-1.5 text-xs font-semibold text-indigo-300 mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                </span>
                <span>{connectingStageText}</span>
              </div>

              {/* Stepper Progress Visualizer */}
              <div className="mb-6 space-y-2.5 rounded-2xl bg-slate-900/90 border border-slate-800/80 p-4 text-left text-xs">
                <div
                  className={`flex items-center gap-3 transition-colors ${connectingStageIndex >= 0 ? "text-indigo-200 font-semibold" : "text-slate-500"}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${connectingStageIndex > 0 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "bg-indigo-600 text-white animate-pulse"}`}
                  >
                    {connectingStageIndex > 0 ? "✓" : "1"}
                  </span>
                  <span className="truncate">
                    Alokasi Cloud GPU Dedicated (NVIDIA RTX 4090)
                  </span>
                </div>
                <div
                  className={`flex items-center gap-3 transition-colors ${connectingStageIndex >= 1 ? "text-indigo-200 font-semibold" : "text-slate-500"}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${connectingStageIndex > 1 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : connectingStageIndex === 1 ? "bg-indigo-600 text-white animate-pulse" : "bg-slate-800 text-slate-500"}`}
                  >
                    {connectingStageIndex > 1 ? "✓" : "2"}
                  </span>
                  <span className="truncate">
                    Inisialisasi Neural Lipsync (MuseTalk & DWPose)
                  </span>
                </div>
                <div
                  className={`flex items-center gap-3 transition-colors ${connectingStageIndex >= 2 ? "text-indigo-200 font-semibold" : "text-slate-500"}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${connectingStageIndex > 2 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : connectingStageIndex === 2 ? "bg-indigo-600 text-white animate-pulse" : "bg-slate-800 text-slate-500"}`}
                  >
                    {connectingStageIndex > 2 ? "✓" : "3"}
                  </span>
                  <span className="truncate">
                    Menyiapkan Voice Persona & Skrip AI Selling
                  </span>
                </div>
                <div
                  className={`flex items-center gap-3 transition-colors ${connectingStageIndex >= 3 ? "text-indigo-200 font-semibold" : "text-slate-500"}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${connectingStageIndex > 3 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : connectingStageIndex === 3 ? "bg-indigo-600 text-white animate-pulse" : "bg-slate-800 text-slate-500"}`}
                  >
                    {connectingStageIndex > 3 ? "✓" : "4"}
                  </span>
                  <span className="truncate">
                    Koneksi Stream RTMP & Handshake Siaran
                  </span>
                </div>
                <div
                  className={`flex items-center gap-3 transition-colors ${connectingStageIndex >= 4 ? "text-indigo-200 font-semibold" : "text-slate-500"}`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${pipelineStatus?.ready ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : connectingStageIndex >= 4 ? "bg-indigo-600 text-white animate-pulse" : "bg-slate-800 text-slate-500"}`}
                  >
                    {pipelineStatus?.ready ? "✓" : "5"}
                  </span>
                  <span className="truncate">
                    Generate AI Host (Video{" "}
                    {Math.min(pipelineStatus?.generationCount || 0, 2)}/2
                    Selesai)
                  </span>
                </div>
              </div>

              {/* Note for RTMP & GO Button */}
              {isWaitingForGoLive && (
                <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-left animate-in fade-in slide-in-from-bottom-2">
                  <p className="text-yellow-400 font-bold text-xs mb-1">
                    ⚠️ Konfirmasi Siaran
                  </p>
                  <p className="text-slate-300 text-xs mb-3">
                    Video AI telah siap. Jika menggunakan RTMP (seperti
                    Instagram),{" "}
                    <strong>
                      mulai siaran di platform tersebut terlebih dahulu
                    </strong>
                    . Jika sudah, klik tombol <strong>GO</strong> di bawah ini
                    agar AI Live Control muncul. AI akan terus men-generate
                    video di background hingga durasi selesai (Max Queue 5).
                  </p>

                  <div className="mb-4 text-left p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-sm">
                    <p className="font-semibold text-white mb-1">
                      ⚠️ Wajib Lakukan Sebelum Klik GO:
                    </p>
                    <ol className="list-decimal pl-4 space-y-1 text-slate-300">
                      <li>
                        Pastikan Anda sudah menyalin <strong>Stream Key</strong>{" "}
                        ke platform.
                      </li>
                      <li>
                        Tekan tombol <strong>Mulai Siaran / Go Live</strong> di
                        aplikasi {selectedPlatform} Anda.
                      </li>
                    </ol>
                    <label className="mt-3 flex items-start gap-2 cursor-pointer p-2 hover:bg-white/5 rounded-md transition">
                      <input
                        type="checkbox"
                        checked={hasConfirmedBroadcast}
                        onChange={(e) =>
                          setHasConfirmedBroadcast(e.target.checked)
                        }
                        className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="text-white text-sm">
                        Saya sudah memulai siaran di {selectedPlatform} dan
                        stream siap tayang
                      </span>
                    </label>
                  </div>

                  {pipelineStatus?.ready ? (
                    <button
                      type="button"
                      disabled={!hasConfirmedBroadcast}
                      onClick={async () => {
                        if (!currentLiveSessionId) return;
                        try {
                          const res = await fetch(
                            "/api/live-stream/go-live-confirm",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                sessionId: currentLiveSessionId,
                              }),
                            },
                          );
                          const json = await res.json();
                          if (res.ok && json.success) {
                            setIsConnectingLive(false);
                            setIsWaitingForGoLive(false);
                            setIsLiveActive(true);
                            setIsLivePaused(false);
                            setLiveSessionPhase("live");
                            setLiveSeconds(0);
                            showToast("🔥 AI Host aktif! Siaran live dimulai.");
                          } else {
                            showToast(`❌ Gagal konfirmasi: ${json.error}`);
                          }
                        } catch {
                          showToast("❌ Error koneksi saat konfirmasi.");
                        }
                      }}
                      className="w-full flex items-center justify-center py-3 rounded-lg font-bold text-white shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 hover:shadow-emerald-500/25"
                    >
                      {!hasConfirmedBroadcast
                        ? "Centang konfirmasi di atas"
                        : "GO! Mulai Live Control"}
                    </button>
                  ) : (
                    <div className="w-full py-3 px-4 rounded-lg bg-slate-800/80 border border-slate-700/50 text-center flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-slate-300 font-medium">
                        Menunggu Render Video AI Selesai (
                        {pipelineStatus?.generationCount || 0}/2)...
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Cancel Button */}
              <button
                type="button"
                onClick={() => {
                  if (connectingAbortRef.current) {
                    connectingAbortRef.current.abort();
                  }
                  setIsConnectingLive(false);
                  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
                  fetch(`${backendUrl}/api/live-session/stop`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                  }).catch(() => {});
                  showToast("⚠️ Proses inisialisasi live dibatalkan.");
                }}
                className="w-full rounded-xl border border-slate-700/80 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300 transition active:scale-95 flex items-center justify-center gap-2"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                <span>Batalkan Inisialisasi</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
