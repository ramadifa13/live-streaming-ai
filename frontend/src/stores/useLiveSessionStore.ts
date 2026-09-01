import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { ChatMessage, SessionSummaryData } from "@/app/dashboard/types";
import { ConnectedAccount } from "@/services/oauthService";
import { liveSessionService } from "@/services/liveSessionService";

export interface LiveMetrics {
  viewers: number;
  comments: number;
  clicks: number;
  sales: number;
  activeProductClicks: number;
  activeProductSold: number;
}

export interface PipelineStatus {
  ready: boolean;
  generationCount: number;
  videosQueued: number;
  pendingCount: number;
  isLive?: boolean;
  isBroadcasting?: boolean;
  isRtmpConnected?: boolean;
  rtmpError?: string;
  stageIndex?: number;
  stageText?: string;
  podReady?: boolean;
  podBooting?: boolean;
  podFailed?: boolean;
}

interface LiveSessionState {

  currentLiveSessionId: string | null;
  liveSessionPhase: "idle" | "pending" | "live" | "ended";
  isLiveActive: boolean;
  isLivePaused: boolean;
  isConnectingLive: boolean;
  isWaitingForGoLive: boolean;
  isSubmittingGoLive: boolean;
  hasConfirmedBroadcast: boolean;
  connectAttemptId: number;
  connectAbortController: AbortController | null;
  connectingStageIndex: number;
  connectingStageText: string;

  selectedDuration: number;
  liveSeconds: number;

  selectedPlatform: string;
  connectMode: "1CLICK" | "MANUAL";
  customRtmpUrl: string;
  streamKey: string;
  connectedAccount: ConnectedAccount | null;
  oauthConfigStatus: Record<string, boolean>;

  automations: {
    autoReply: boolean;
    autoPin: boolean;
    autoPromo: boolean;
    autoModeration: boolean;
  };

  chatMessages: ChatMessage[];
  inputChat: string;
  isAiAutoReplyOn: boolean;

  metrics: LiveMetrics;
  sessionSummary: SessionSummaryData | null;
  pipelineStatus: PipelineStatus | null;

  setSelectedDuration: (hours: number) => void;
  setSelectedPlatform: (plat: string) => void;
  setConnectMode: (mode: "1CLICK" | "MANUAL") => void;
  setCustomRtmpUrl: (url: string) => void;
  setStreamKey: (key: string) => void;
  setConnectedAccount: (acc: ConnectedAccount | null) => void;
  setOauthConfigStatus: (status: Record<string, boolean>) => void;
  setAutomations: (
    auto:
      | {
          autoReply: boolean;
          autoPin: boolean;
          autoPromo: boolean;
          autoModeration: boolean;
        }
      | ((prev: {
          autoReply: boolean;
          autoPin: boolean;
          autoPromo: boolean;
          autoModeration: boolean;
        }) => {
          autoReply: boolean;
          autoPin: boolean;
          autoPromo: boolean;
          autoModeration: boolean;
        }),
  ) => void;
  setInputChat: (chat: string) => void;
  setIsAiAutoReplyOn: (on: boolean) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setMetrics: (metrics: LiveMetrics | ((prev: LiveMetrics) => LiveMetrics)) => void;
  setLiveSeconds: (secs: number | ((prev: number) => number)) => void;
  setSessionSummary: (sum: SessionSummaryData | null) => void;
  setPipelineStatus: (status: PipelineStatus | null) => void;
  setIsLiveActive: (active: boolean) => void;
  setIsLivePaused: (paused: boolean) => void;
  setLiveSessionPhase: (phase: "idle" | "pending" | "live" | "ended") => void;
  handlePlatformSelect: (platName: string) => void;
  cancelInitialization: () => Promise<void>;
  endLiveSession: () => Promise<SessionSummaryData>;
}

export const useLiveSessionStore = create<LiveSessionState>()(
  persist(
    (set, get) => ({
      currentLiveSessionId: null,
      liveSessionPhase: "idle",
      isLiveActive: false,
      isLivePaused: false,
      isConnectingLive: false,
      isWaitingForGoLive: false,
      isSubmittingGoLive: false,
      hasConfirmedBroadcast: false,
      connectAttemptId: 0,
      connectAbortController: null,
      connectingStageIndex: 0,
      connectingStageText: "Mengalokasikan Cloud GPU RTX 4090...",
      selectedDuration: 1,
      liveSeconds: 0,
      selectedPlatform: "Instagram Live",
      connectMode: "1CLICK",
      customRtmpUrl: "",
      streamKey: "",
      connectedAccount: null,
      oauthConfigStatus: {},

      automations: {
        autoReply: true,
        autoPin: true,
        autoPromo: true,
        autoModeration: true,
      },

      chatMessages: [],
      inputChat: "",
      isAiAutoReplyOn: true,

      metrics: {
        viewers: 0,
        comments: 0,
        clicks: 0,
        sales: 0,
        activeProductClicks: 0,
        activeProductSold: 0,
      },
      sessionSummary: null,
      pipelineStatus: null,

      setSelectedDuration: (hours) => set({ selectedDuration: hours }),
      setSelectedPlatform: (plat) => set({ selectedPlatform: plat }),
      setConnectMode: (mode) => set({ connectMode: mode }),
      setCustomRtmpUrl: (url) => set({ customRtmpUrl: url }),
      setStreamKey: (key) => set({ streamKey: key }),
      setConnectedAccount: (acc) => set({ connectedAccount: acc }),
      setOauthConfigStatus: (status) => set({ oauthConfigStatus: status }),
      setAutomations: (auto) =>
        set((state) => ({
          automations:
            typeof auto === "function" ? auto(state.automations) : auto,
        })),
      setInputChat: (chat) => set({ inputChat: chat }),
      setIsAiAutoReplyOn: (on) => set({ isAiAutoReplyOn: on }),
      addChatMessage: (msg) =>
        set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
      setMetrics: (metrics) =>
        set((state) => ({
          metrics:
            typeof metrics === "function" ? metrics(state.metrics) : metrics,
        })),
      setLiveSeconds: (secs) =>
        set((state) => ({
          liveSeconds:
            typeof secs === "function" ? secs(state.liveSeconds) : secs,
        })),
      setSessionSummary: (sum) => set({ sessionSummary: sum }),
      setPipelineStatus: (status) =>
        set((state) => {
          const previousError = state.pipelineStatus?.rtmpError;
          const merged =
            status && previousError && !status.rtmpError
              ? {
                  ...status,
                  rtmpError: previousError,
                  stageText: status.stageText || previousError,
                }
              : status;
          return {
            pipelineStatus: merged,
            connectingStageIndex: merged?.stageIndex ?? state.connectingStageIndex,
            connectingStageText: merged?.stageText ?? state.connectingStageText,
          };
        }),
      setIsLiveActive: (active) => set({ isLiveActive: active }),
      setIsLivePaused: (paused) => set({ isLivePaused: paused }),
      setLiveSessionPhase: (phase) => set({ liveSessionPhase: phase }),

      handlePlatformSelect: (platName) => {
        set({ selectedPlatform: platName });
        if (platName.toLowerCase().includes("custom")) {
          set({ connectMode: "MANUAL", customRtmpUrl: "" });
        } else if (platName.includes("Instagram")) {
          set({ customRtmpUrl: "rtmps://live-upload.instagram.com:443/rtmp/" });
        } else if (platName.includes("YouTube")) {
          set({ customRtmpUrl: "rtmp://a.rtmp.youtube.com/live2" });
        } else if (platName.includes("TikTok")) {
          set({ customRtmpUrl: "rtmp://live.tiktok.com/live/" });
        } else if (platName.includes("Shopee")) {
          set({ customRtmpUrl: "rtmp://live.shopee.co.id/live/" });
        } else if (platName.includes("Facebook")) {
          set({ customRtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp/" });
        } else {
          set({ customRtmpUrl: "rtmp://live.livestreamer.ai/live" });
        }
      },

      cancelInitialization: async () => {
        const state = get();
        const sid = state.currentLiveSessionId;
        const attemptId = state.connectAttemptId;

        state.connectAbortController?.abort();
        set({
          connectAttemptId: attemptId + 1,
          connectAbortController: null,
          isConnectingLive: false,
          isWaitingForGoLive: false,
          isSubmittingGoLive: false,
          currentLiveSessionId: null,
          pipelineStatus: null,
          hasConfirmedBroadcast: false,
          liveSessionPhase: "idle",
          connectingStageIndex: 0,
          connectingStageText: "Mengalokasikan Cloud GPU RTX 4090...",
        });

        if (sid) {
          await liveSessionService.teardownSession(sid);
        }
      },

      endLiveSession: async () => {
        const state = get();
        set({
          isLiveActive: false,
          isLivePaused: false,
          isConnectingLive: false,
          isWaitingForGoLive: false,
          isSubmittingGoLive: false,
          liveSessionPhase: "ended",
          connectAbortController: null,
          pipelineStatus: null,
        });

        await liveSessionService.stopBroadcast(state.currentLiveSessionId);

        const stopRes = await liveSessionService.stopSession({
          sessionId: state.currentLiveSessionId,
          durationSeconds: state.liveSeconds,
          viewers: state.metrics.viewers,
          comments: state.metrics.comments,
          clicks: state.metrics.clicks,
          sales: state.metrics.sales,
          productSold: state.metrics.activeProductSold,
        });

        if (stopRes?.summary) {
          set({ sessionSummary: stopRes.summary });
          return stopRes.summary;
        }

        const estGpuCost = Math.round((state.liveSeconds / 3600) * 12500);
        const net = Math.max(0, state.metrics.sales - estGpuCost);
        const fallbackSummary: SessionSummaryData = {
          durationSeconds: state.liveSeconds,
          durationFormatted: `${Math.floor(state.liveSeconds / 3600).toString().padStart(2, "0")}:${Math.floor((state.liveSeconds % 3600) / 60).toString().padStart(2, "0")}:${Math.floor(state.liveSeconds % 60).toString().padStart(2, "0")}`,
          totalViewers: state.metrics.viewers,
          peakViewers: Math.round(state.metrics.viewers * 1.25),
          totalComments: state.metrics.comments,
          aiRepliesCount: Math.round(state.metrics.comments * 0.95),
          totalClicks: state.metrics.clicks,
          totalProductSold: state.metrics.activeProductSold,
          grossRevenue: state.metrics.sales,
          grossRevenueFormatted: `Rp${state.metrics.sales.toLocaleString("id-ID")}`,
          estimatedGpuCost: estGpuCost,
          estimatedGpuCostFormatted: `Rp${estGpuCost.toLocaleString("id-ID")}`,
          netProfit: net,
          netProfitFormatted: `Rp${net.toLocaleString("id-ID")}`,
          roiPercentage: `${estGpuCost > 0 ? Math.round((net / estGpuCost) * 100) : 0}%`,
          endedAt: new Date().toISOString(),
        };

        set({ sessionSummary: fallbackSummary });
        return fallbackSummary;
      },
    }),
    {
      name: "livestream-session-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentLiveSessionId: state.currentLiveSessionId,
        isLiveActive: state.isLiveActive,
        isLivePaused: state.isLivePaused,
        liveSessionPhase: state.liveSessionPhase,
        liveSeconds: state.liveSeconds,
        selectedDuration: state.selectedDuration,
        selectedPlatform: state.selectedPlatform,
        customRtmpUrl: state.customRtmpUrl,
        automations: state.automations,
        metrics: state.metrics,
      }),
    },
  ),
);

