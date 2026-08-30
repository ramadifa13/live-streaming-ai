import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

interface DashboardUIState {
  currentStep: number;
  appMode: "LIVE_STUDIO" | "VIDEO_GENERATOR";
  toastMessage: string | null;
  toastType: ToastType;
  toastTimeout: ReturnType<typeof setTimeout> | null;

  showAddProductModal: boolean;
  showEditProductModal: boolean;
  showCsvModal: boolean;
  showScriptModal: boolean;
  showTutorialModal: boolean;
  showSettingsModal: boolean;
  showEndLiveConfirm: boolean;
  showSummaryModal: boolean;

  setCurrentStep: (step: number) => void;
  setAppMode: (mode: "LIVE_STUDIO" | "VIDEO_GENERATOR") => void;
  showToast: (msg: string, type?: ToastType) => void;
  hideToast: () => void;

  setShowAddProductModal: (show: boolean) => void;
  setShowEditProductModal: (show: boolean) => void;
  setShowCsvModal: (show: boolean) => void;
  setShowScriptModal: (show: boolean) => void;
  setShowTutorialModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowEndLiveConfirm: (show: boolean) => void;
  setShowSummaryModal: (show: boolean) => void;
}

export const useDashboardUIStore = create<DashboardUIState>((set, get) => ({
  currentStep: 1,
  appMode: "LIVE_STUDIO",
  toastMessage: null,
  toastType: "info",
  toastTimeout: null,

  showAddProductModal: false,
  showEditProductModal: false,
  showCsvModal: false,
  showScriptModal: false,
  showTutorialModal: false,
  showSettingsModal: false,
  showEndLiveConfirm: false,
  showSummaryModal: false,

  setCurrentStep: (step) => set({ currentStep: step }),
  setAppMode: (mode) => set({ appMode: mode }),

  showToast: (msg, type) => {
    const prevTimeout = get().toastTimeout;
    if (prevTimeout) clearTimeout(prevTimeout);

    let resolvedType: ToastType = type || "info";
    if (!type) {
      const lower = msg.toLowerCase();
      if (
        lower.includes("berhasil") ||
        lower.includes("disimpan") ||
        lower.includes("terhubung")
      ) {
        resolvedType = "success";
      } else if (
        lower.includes("gagal") ||
        lower.includes("error") ||
        lower.includes("ditolak")
      ) {
        resolvedType = "error";
      } else if (
        lower.includes("terkunci") ||
        lower.includes("perlu paket") ||
        lower.includes("peringatan")
      ) {
        resolvedType = "warning";
      }
    }

    const timeout = setTimeout(() => {
      set({ toastMessage: null, toastTimeout: null });
    }, 3500);

    set({
      toastMessage: msg,
      toastType: resolvedType,
      toastTimeout: timeout,
    });
  },

  hideToast: () => {
    const prevTimeout = get().toastTimeout;
    if (prevTimeout) clearTimeout(prevTimeout);
    set({ toastMessage: null, toastTimeout: null });
  },

  setShowAddProductModal: (show) => set({ showAddProductModal: show }),
  setShowEditProductModal: (show) => set({ showEditProductModal: show }),
  setShowCsvModal: (show) => set({ showCsvModal: show }),
  setShowScriptModal: (show) => set({ showScriptModal: show }),
  setShowTutorialModal: (show) => set({ showTutorialModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowEndLiveConfirm: (show) => set({ showEndLiveConfirm: show }),
  setShowSummaryModal: (show) => set({ showSummaryModal: show }),
}));
