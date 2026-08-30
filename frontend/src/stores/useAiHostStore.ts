import { create } from "zustand";
import { Avatar, LiveSalesScript, Product } from "@/app/dashboard/types";
import { avatars } from "@/app/dashboard/constants";
import { aiService, VideoScriptData } from "@/services/aiService";

interface AiHostState {
  selectedAvatar: Avatar;
  selectedTone: string;
  selectedVoice: string;
  selectedLang: string;
  speechSpeed: number;

  isPlayingAudio: boolean;
  isSynthesizingAudio: boolean;
  isAvatarSpeaking: boolean;
  currentLiveVideoUrl: string | null;

  liveSalesScriptData: LiveSalesScript | null;
  isLoadingLiveScript: boolean;

  videoDuration: "15s" | "30s" | "60s";
  videoScript: VideoScriptData;
  isGeneratingScript: boolean;
  isRenderingVideo: boolean;
  renderProgress: number;
  hasRenderedVideo: boolean;

  setSelectedAvatar: (avatar: Avatar) => void;
  setSelectedTone: (tone: string) => void;
  setSelectedVoice: (voice: string) => void;
  setSelectedLang: (lang: string) => void;
  setSpeechSpeed: (speed: number) => void;
  setCurrentLiveVideoUrl: (url: string | null) => void;
  setVideoDuration: (dur: "15s" | "30s" | "60s") => void;
  setVideoScript: (script: VideoScriptData | Partial<VideoScriptData>) => void;
  setLiveSalesScriptData: (data: LiveSalesScript | null) => void;

  speakText: (
    text: string,
    opts?: {
      voice?: string;
      lang?: string;
      tone?: string;
      avatar?: string;
      speed?: number;
    },
  ) => Promise<void>;
  stopAudio: () => void;
  fetchLiveSalesScript: (activeProduct: Product) => Promise<void>;
  fetchVideoScript: (product: Product, duration?: "15s" | "30s" | "60s") => Promise<void>;
  renderVideo: (activeProduct: Product) => Promise<void>;
}

let activeAudio: HTMLAudioElement | null = null;
let videoPollingInterval: ReturnType<typeof setInterval> | null = null;

export const useAiHostStore = create<AiHostState>((set, get) => ({
  selectedAvatar: avatars[0],
  selectedTone: "Energetic",
  selectedVoice: "id-ID-GadisNeural",
  selectedLang: "Bahasa Indonesia",
  speechSpeed: 1.0,

  isPlayingAudio: false,
  isSynthesizingAudio: false,
  isAvatarSpeaking: false,
  currentLiveVideoUrl: null,

  liveSalesScriptData: null,
  isLoadingLiveScript: false,

  videoDuration: "30s",
  videoScript: {
    hook: "Kaitkan perhatian penonton di sini!",
    problem: "Jelaskan masalah yang dialami penonton.",
    solution: "Tawarkan produk Anda sebagai solusinya.",
    cta: "Ajak penonton untuk membeli sekarang!",
    fullVoiceover:
      "Naskah lengkap akan muncul di sini setelah Anda menekan tombol Generate Script.",
  },
  isGeneratingScript: false,
  isRenderingVideo: false,
  renderProgress: 0,
  hasRenderedVideo: false,

  setSelectedAvatar: (avatar) => set({ selectedAvatar: avatar }),
  setSelectedTone: (tone) => set({ selectedTone: tone }),
  setSelectedVoice: (voice) => set({ selectedVoice: voice }),
  setSelectedLang: (lang) => set({ selectedLang: lang }),
  setSpeechSpeed: (speed) => set({ speechSpeed: speed }),
  setCurrentLiveVideoUrl: (url) => set({ currentLiveVideoUrl: url }),
  setVideoDuration: (dur) => set({ videoDuration: dur }),
  setVideoScript: (script) =>
    set((state) => ({ videoScript: { ...state.videoScript, ...script } })),
  setLiveSalesScriptData: (data) => set({ liveSalesScriptData: data }),

  stopAudio: () => {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    set({
      isPlayingAudio: false,
      isAvatarSpeaking: false,
      isSynthesizingAudio: false,
    });
  },

  speakText: async (text, opts) => {
    if (get().isPlayingAudio) {
      get().stopAudio();
      return;
    }

    set({ isSynthesizingAudio: true, isAvatarSpeaking: true });

    const state = get();
    const ttsOptions = {
      text,
      voice: opts?.voice || state.selectedVoice,
      avatarName: opts?.avatar || state.selectedAvatar.name,
      speed: opts?.speed ?? state.speechSpeed,
      tone: opts?.tone || state.selectedTone,
    };

    try {
      const blob = await aiService.synthesizeTTS(ttsOptions);

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudio = audio;

      set({ isPlayingAudio: true, isSynthesizingAudio: false });

      audio.onended = () => {
        URL.revokeObjectURL(url);
        set({ isPlayingAudio: false, isAvatarSpeaking: false });
        activeAudio = null;
      };

      audio.onerror = () => {
        set({
          isPlayingAudio: false,
          isAvatarSpeaking: false,
          isSynthesizingAudio: false,
        });
        activeAudio = null;
      };

      await audio.play().catch(() => {});
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.warn("[speakText] Audio playback notice:", errorMessage);
      set({
        isPlayingAudio: false,
        isAvatarSpeaking: false,
        isSynthesizingAudio: false,
      });
      activeAudio = null;
      throw err;
    }
  },

  fetchLiveSalesScript: async (activeProduct: Product) => {
    set({ isLoadingLiveScript: true });
    try {
      const script = await aiService.generateLiveSalesScript({
        activeProduct,
        avatarName: get().selectedAvatar.name,
        tone: get().selectedTone,
      });
      set({ liveSalesScriptData: script });
    } catch (err) {
      set({ liveSalesScriptData: null });
      throw err;
    } finally {
      set({ isLoadingLiveScript: false });
    }
  },

  fetchVideoScript: async (product: Product, dur) => {
    const targetDuration = dur || get().videoDuration;
    set({ isGeneratingScript: true });
    try {
      const script = await aiService.generateVideoScript({
        productName: product.name,
        productPrice: product.price,
        productCategory: product.tag,
        durationType: targetDuration,
      });
      set({ videoScript: script });
    } catch (err) {
      console.error("Failed to generate video script:", err);
    } finally {
      set({ isGeneratingScript: false });
    }
  },

  renderVideo: async (activeProduct: Product) => {
    if (videoPollingInterval) clearInterval(videoPollingInterval);
    const state = get();
    const fullScript = `${state.videoScript.hook} ${state.videoScript.problem} ${state.videoScript.solution} ${state.videoScript.cta}`;

    set({ isRenderingVideo: true, renderProgress: 0 });

    try {
      const { jobId } = await aiService.generateAvatarVideo({
        avatarImageUrl: state.selectedAvatar.image?.startsWith("http")
          ? state.selectedAvatar.image
          : `http://localhost:3000${state.selectedAvatar.image}`,
        productImageUrl: activeProduct.image?.startsWith("http")
          ? activeProduct.image
          : undefined,
        scriptText: fullScript,
        avatarName: state.selectedAvatar.id,
        tone: state.selectedTone,
      });

      videoPollingInterval = setInterval(async () => {
        try {
          const statusData = await aiService.checkVideoStatus(jobId);
          const { status, progress, videoUrl } = statusData;

          if (progress !== undefined) set({ renderProgress: progress });

          if (status === "done" && videoUrl) {
            if (videoPollingInterval) clearInterval(videoPollingInterval);
            set({
              isRenderingVideo: false,
              hasRenderedVideo: true,
              currentLiveVideoUrl: videoUrl,
              isAvatarSpeaking: false,
            });
          } else if (status === "error") {
            if (videoPollingInterval) clearInterval(videoPollingInterval);
            set({ isRenderingVideo: false });
          }
        } catch {
          }
      }, 1500);
    } catch (err) {
      set({ isRenderingVideo: false });
      throw err;
    }
  },
}));
