"use client";

import React from "react";
import { Wifi, Loader2, Radio } from "lucide-react";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { liveSessionService } from "@/services/liveSessionService";

export const ConnectingOverlay: React.FC = () => {
  const isConnectingLive = useLiveSessionStore((state) => state.isConnectingLive);
  const isSubmittingGoLive = useLiveSessionStore((state) => state.isSubmittingGoLive);
  const connectingStageText = useLiveSessionStore((state) => state.connectingStageText);
  const connectingStageIndex = useLiveSessionStore((state) => state.connectingStageIndex);
  const pipelineStatus = useLiveSessionStore((state) => state.pipelineStatus);
  const currentLiveSessionId = useLiveSessionStore((state) => state.currentLiveSessionId);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const cancelInitialization = useLiveSessionStore((state) => state.cancelInitialization);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const stageIndex = pipelineStatus?.stageIndex ?? connectingStageIndex;
  const videosReady = (pipelineStatus?.videosQueued ?? 0) >= 2;
  const podBooting = pipelineStatus?.podBooting === true;
  const canGoLive =
    !podBooting &&
    pipelineStatus?.podReady !== false &&
    pipelineStatus?.ready === true &&
    videosReady &&
    stageIndex >= 4;

  const handleConfirmGoLive = async () => {
    if (!currentLiveSessionId || isSubmittingGoLive || !canGoLive) return;

    useLiveSessionStore.setState({ isSubmittingGoLive: true });
    try {
      await liveSessionService.confirmGoLive(currentLiveSessionId);
      useLiveSessionStore.setState({
          isConnectingLive: false,
          isWaitingForGoLive: false,
          isLiveActive: true,
          isLivePaused: false,
          liveSessionPhase: "live",
          liveSeconds: 0,
        connectAbortController: null,
      });
      showToast("AI Host aktif! Siaran live dimulai.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error koneksi saat konfirmasi.");
    } finally {
      useLiveSessionStore.setState({ isSubmittingGoLive: false });
    }
  };

  if (!isConnectingLive) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md max-h-[90vh] rounded-3xl border border-indigo-500/30 bg-[#0a0f1d] text-center shadow-2xl shadow-indigo-500/25 flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-br from-blue-600/25 via-indigo-600/15 to-purple-600/25 blur-3xl rounded-full z-0" />
        <div className="pointer-events-none absolute -bottom-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-tr from-emerald-600/15 to-blue-600/15 blur-3xl rounded-full z-0" />

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 z-10 custom-scrollbar relative">
          <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-indigo-500/30 animate-ping opacity-60" />
            <div className="absolute inset-0 rounded-full border-2 border-t-indigo-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin" />
            <Wifi className="relative w-6 h-6 text-indigo-400" />
          </div>

          <h3 className="text-base sm:text-lg font-extrabold text-white tracking-wide mb-0.5">
            {canGoLive ? "Siap Go Live!" : "Menyiapkan Sesi Live AI"}
          </h3>
          <p className="text-[11px] text-slate-400 mb-2 flex items-center justify-center gap-2 flex-wrap">
            Host AI{" "}
            <span className="text-indigo-300 font-semibold">{selectedAvatar.name}</span> di{" "}
            <span className="inline-flex items-center gap-1.5 text-indigo-300 font-semibold">
              <PlatformIcon platformName={selectedPlatform} size="sm" />
              {selectedPlatform}
            </span>
          </p>

          {!canGoLive && (
            <p className="text-[12px] text-slate-300 leading-relaxed mb-3 px-1">
              {podBooting
                ? connectingStageText ||
                  "GPU RunPod sedang boot (PyTorch CUDA). Estimasi 2–6 menit — jangan tutup halaman ini."
                : "Sistem sedang menyiapkan infrastruktur siaran (GPU, avatar, dan buffer video). Estimasi waktu persiapan "}
              {!podBooting && (
                <>
                  <span className="text-amber-300 font-semibold">sekitar 5 menit</span>.
                  Harap tetap di halaman ini hingga proses selesai.
                </>
              )}
            </p>
          )}

          <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold text-indigo-300 mb-3.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
            </span>
            <span className="truncate max-w-[260px]">{connectingStageText}</span>
          </div>

          <div className="w-full bg-[#1e293b] rounded-full h-1.5 overflow-hidden mb-4">
            <div
              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-500"
              style={{
                width: `${Math.min(100, Math.max(15, (stageIndex + 1) * 20))}%`,
              }}
            />
          </div>

          <div className="mb-4 rounded-xl bg-black/30 border border-white/10 p-3 text-left space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Video AI</span>
              <span className={videosReady ? "text-emerald-400 font-semibold" : "text-amber-400"}>
                {pipelineStatus?.videosQueued ?? 0}/2
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">RTMP</span>
              <span
                className={
                  pipelineStatus?.isRtmpConnected || pipelineStatus?.isBroadcasting
                    ? "text-emerald-400 font-semibold"
                    : "text-amber-400"
                }
              >
                {pipelineStatus?.isRtmpConnected || pipelineStatus?.isBroadcasting
                  ? "Terhubung"
                  : "Menunggu..."}
              </span>
            </div>
          </div>

          {canGoLive && (
            <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-left">
              <p className="text-[10px] font-bold text-yellow-400 mb-2 uppercase tracking-wide">
                Langkah terakhir
              </p>
              <ol className="list-decimal pl-4 text-[10px] text-slate-300 space-y-1">
                <li>
                  Buka <strong>{selectedPlatform}</strong> dan klik{" "}
                  <strong>Siarkan Langsung / Go Live</strong>.
                </li>
                <li>Setelah siaran aktif di platform, tekan tombol di bawah.</li>
              </ol>
            </div>
          )}

          {canGoLive ? (
            <button
              type="button"
              onClick={handleConfirmGoLive}
              disabled={isSubmittingGoLive}
              className="w-full mb-2 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-green-600 to-emerald-500 hover:brightness-110 active:scale-95 shadow-[0_0_20px_rgba(34,197,94,0.4)] transition cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmittingGoLive ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Menyambungkan AI Host...
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4" />
                  Go Live — Konfirmasi Siaran
                </>
              )}
            </button>
          ) : (
            <div className="mb-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-center">
              <div className="flex items-center justify-center gap-2 text-[11px] text-amber-200/90 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                Pipeline sedang diproses ({pipelineStatus?.videosQueued ?? 0}/2 video siap)
              </div>
              <p className="mt-1 text-[10px] text-slate-400 leading-snug">
                Estimasi waktu: sekitar 5 menit. Durasi dapat lebih singkat jika GPU sudah aktif.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={cancelInitialization}
            disabled={isSubmittingGoLive}
            className="w-full py-2.5 rounded-xl border border-slate-700 bg-[#111827] text-xs font-semibold text-slate-400 hover:text-white hover:border-slate-500 transition cursor-pointer disabled:opacity-50"
          >
            Batalkan Inisialisasi
          </button>
        </div>
      </div>
    </div>
  );
};
