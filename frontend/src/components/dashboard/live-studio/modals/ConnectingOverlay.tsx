"use client";

import React, { useEffect, useRef } from "react";
import { Wifi, Loader2, Radio, AlertTriangle, Check } from "lucide-react";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { liveSessionService } from "@/services/liveSessionService";
import { isDeferredGoLivePlatform } from "@/lib/rtmpPlatform";

const PREP_STEPS = [
  { id: 0, label: "Menyalakan cloud" },
  { id: 1, label: "Menyiapkan host AI" },
  { id: 2, label: "Menyiapkan kata pembuka" },
  { id: 3, label: "Menyambung ke platform" },
  { id: 4, label: "Siap siaran" },
] as const;

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
  const autoArmedRef = useRef(false);

  const deferredPlatform = isDeferredGoLivePlatform(selectedPlatform);
  const stageIndex = pipelineStatus?.stageIndex ?? connectingStageIndex;
  const isRealtimeWorker =
    pipelineStatus?.broadcastMode === "ai_worker" ||
    pipelineStatus?.broadcastMode === "ai-worker" ||
    pipelineStatus?.visualWorkerRunning === true;
  const minUtterances = pipelineStatus?.goLiveMinUtterances ?? 3;
  const bufferCount = isRealtimeWorker
    ? Math.max(
        pipelineStatus?.readyUtteranceCount ?? 0,
        pipelineStatus?.utteranceQueueCount ?? 0,
      )
    : pipelineStatus?.videosQueued ?? 0;
  const videosReady = bufferCount >= minUtterances;
  const rtmpConnected = pipelineStatus?.isRtmpConnected === true;
  const podBooting = pipelineStatus?.podBooting === true;
  const initializing =
    pipelineStatus?.visualWorkerInitializing === true ||
    pipelineStatus?.broadcastBootState === "starting";
  const rtmpFailed =
    pipelineStatus?.rtmpFatal === true ||
    (pipelineStatus?.rtmpState === "failed" && Boolean(pipelineStatus?.rtmpError));
  const workerFailed = Boolean(pipelineStatus?.workerError);
  const connectionFailed = rtmpFailed || workerFailed;
  const canGoLive =
    !connectionFailed &&
    !podBooting &&
    pipelineStatus?.podReady !== false &&
    rtmpConnected &&
    videosReady &&
    pipelineStatus?.ready === true;

  const activeStep = Math.min(4, Math.max(0, canGoLive ? 4 : stageIndex));
  const progressPct = canGoLive
    ? 100
    : Math.min(95, Math.max(8, ((activeStep + 1) / PREP_STEPS.length) * 100));

  const statusLine =
    connectingStageText ||
    pipelineStatus?.rtmpHint ||
    (canGoLive
      ? deferredPlatform
        ? "Siap. Tekan Siarkan di app, lalu tombol hijau di bawah."
        : "Siaran terhubung — host mulai otomatis…"
      : "Mohon tunggu, sistem sedang bekerja…");

  const finishGoLiveLocal = () => {
    useLiveSessionStore.setState({
      isConnectingLive: false,
      isWaitingForGoLive: false,
      isLiveActive: true,
      isLivePaused: false,
      liveSessionPhase: "live",
      liveSeconds: 0,
      connectAbortController: null,
      isSubmittingGoLive: false,
    });
  };

  const handleConfirmGoLive = async () => {
    if (!currentLiveSessionId || isSubmittingGoLive || !canGoLive) return;

    useLiveSessionStore.setState({ isSubmittingGoLive: true });
    try {
      await liveSessionService.confirmGoLive(currentLiveSessionId);
      // Poll singkat sampai playback_armed (max ~3s) agar host langsung bicara.
      const armedDeadline = Date.now() + 3000;
      while (Date.now() < armedDeadline) {
        const st = await liveSessionService.fetchPipelineStatus(currentLiveSessionId);
        if (st?.playbackArmed || st?.isLive) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      finishGoLiveLocal();
      showToast("AI Host aktif! Siaran live dimulai.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error koneksi saat konfirmasi.");
      useLiveSessionStore.setState({ isSubmittingGoLive: false });
    }
  };

  // Immediate platforms (YT/TikTok/dll): auto-arm begitu canGoLive.
  useEffect(() => {
    if (!isConnectingLive) {
      autoArmedRef.current = false;
      return;
    }
    if (deferredPlatform || !canGoLive || !currentLiveSessionId) return;
    if (isSubmittingGoLive || autoArmedRef.current) return;
    autoArmedRef.current = true;
    void handleConfirmGoLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arm once when ready
  }, [
    isConnectingLive,
    deferredPlatform,
    canGoLive,
    currentLiveSessionId,
    isSubmittingGoLive,
  ]);

  if (!isConnectingLive) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md max-h-[90vh] rounded-3xl border border-indigo-500/30 bg-[#0a0f1d] text-center shadow-2xl shadow-indigo-500/25 flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-br from-blue-600/25 via-indigo-600/15 to-purple-600/25 blur-3xl rounded-full z-0" />

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 z-10 custom-scrollbar relative">
          <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
            {connectionFailed ? (
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
            ) : canGoLive && !deferredPlatform ? (
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
              </div>
            ) : canGoLive ? (
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
                <Check className="w-6 h-6 text-emerald-400" />
              </div>
            ) : (
              <>
                <div className="absolute inset-0 rounded-full border border-indigo-500/30 animate-ping opacity-60" />
                <div className="absolute inset-0 rounded-full border-2 border-t-indigo-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin" />
                <Wifi className="relative w-6 h-6 text-indigo-400" />
              </>
            )}
          </div>

          <h3 className="text-base sm:text-lg font-extrabold text-white tracking-wide mb-0.5">
            {workerFailed
              ? "Ada gangguan di cloud"
              : rtmpFailed
                ? "Siaran belum tersambung"
                : canGoLive && !deferredPlatform
                  ? "Memulai host…"
                  : canGoLive
                    ? "Siap Go Live!"
                    : "Sedang menyiapkan siaran"}
          </h3>
          <p className="text-[11px] text-slate-400 mb-3 flex items-center justify-center gap-2 flex-wrap">
            Host{" "}
            <span className="text-indigo-300 font-semibold">{selectedAvatar.name}</span> ·{" "}
            <span className="inline-flex items-center gap-1.5 text-indigo-300 font-semibold">
              <PlatformIcon platformName={selectedPlatform} size="sm" />
              {selectedPlatform}
            </span>
          </p>

          {!connectionFailed && (
            <p className="text-[12px] text-slate-300 leading-relaxed mb-3 px-1">
              {canGoLive && deferredPlatform
                ? "Tekan Siarkan di aplikasi live, lalu tekan tombol hijau di bawah."
                : canGoLive && !deferredPlatform
                  ? "Platform sudah live — host AI mulai bicara otomatis."
                  : initializing || podBooting
                    ? "Pertama kali bisa 2–5 menit. Jangan tutup halaman ini."
                    : "Sistem bekerja otomatis. Anda cukup menunggu."}
            </p>
          )}

          <div className="w-full bg-[#1e293b] rounded-full h-2 overflow-hidden mb-2">
            <div
              className={`h-full transition-all duration-700 ${
                connectionFailed
                  ? "bg-red-500"
                  : canGoLive
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-blue-500 to-indigo-500"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[11px] text-indigo-200/90 font-medium mb-4 px-1 leading-snug">
            {statusLine}
          </p>

          {!connectionFailed && (
            <div className="mb-4 rounded-xl bg-black/30 border border-white/10 p-3 text-left space-y-2">
              {PREP_STEPS.map((step) => {
                const done = activeStep > step.id || (canGoLive && step.id <= 4);
                const current = !canGoLive && activeStep === step.id;
                return (
                  <div key={step.id} className="flex items-center gap-2.5 text-[11px]">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                        done
                          ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                          : current
                            ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-200"
                            : "border-white/10 bg-white/5 text-slate-500"
                      }`}
                    >
                      {done ? (
                        <Check className="w-3 h-3" />
                      ) : current ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        step.id + 1
                      )}
                    </span>
                    <span
                      className={
                        done
                          ? "text-emerald-200/90"
                          : current
                            ? "text-white font-semibold"
                            : "text-slate-500"
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-left">
              <p className="text-slate-500 mb-0.5">Host AI</p>
              <p
                className={
                  workerFailed
                    ? "text-red-300 font-semibold"
                    : initializing
                      ? "text-amber-300"
                      : "text-emerald-300 font-semibold"
                }
              >
                {workerFailed ? "Gangguan" : initializing ? "Menyiapkan…" : "Siap"}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-left">
              <p className="text-slate-500 mb-0.5">Siaran platform</p>
              <p
                className={
                  rtmpFailed
                    ? "text-red-300 font-semibold"
                    : rtmpConnected
                      ? "text-emerald-300 font-semibold"
                      : "text-amber-300"
                }
              >
                {rtmpFailed ? "Gagal" : rtmpConnected ? "Terhubung" : "Menyambung…"}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-left col-span-2">
              <p className="text-slate-500 mb-0.5">Kata pembuka</p>
              <p className={videosReady ? "text-emerald-300 font-semibold" : "text-amber-300"}>
                {bufferCount}/{minUtterances} siap
              </p>
            </div>
          </div>

          {workerFailed && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left">
              <p className="text-[11px] font-semibold text-red-200 leading-relaxed">
                Cloud AI sedang bermasalah. Tutup, tunggu sebentar, lalu Connect lagi.
              </p>
            </div>
          )}

          {rtmpFailed && !workerFailed && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left">
              <p className="text-[11px] font-semibold text-red-200 leading-relaxed">
                Stream Key hanya berlaku sekali. Buat siaran baru di aplikasi live,
                salin key baru, lalu Connect lagi.
              </p>
            </div>
          )}

          {canGoLive && deferredPlatform && (
            <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-left">
              <p className="text-[10px] font-bold text-yellow-400 mb-2 uppercase tracking-wide">
                Lakukan berurutan
              </p>
              <ol className="list-decimal pl-4 text-[10px] text-slate-300 space-y-1">
                <li>Lihat preview host di sebelah kiri aplikasi live.</li>
                <li>
                  Tekan <strong>Siarkan</strong> di aplikasi live.
                </li>
                <li>Kembali ke sini, tekan tombol hijau di bawah.</li>
              </ol>
            </div>
          )}

          {canGoLive && deferredPlatform ? (
            <button
              type="button"
              onClick={handleConfirmGoLive}
              disabled={isSubmittingGoLive}
              className="w-full mb-2 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-green-600 to-emerald-500 hover:brightness-110 active:scale-95 shadow-[0_0_20px_rgba(34,197,94,0.4)] transition cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmittingGoLive ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memulai siaran…
                </>
              ) : (
                <>
                  <Radio className="w-4 h-4" />
                  Mulai Siaran Sekarang
                </>
              )}
            </button>
          ) : connectionFailed ? (
            <button
              type="button"
              onClick={cancelInitialization}
              className="w-full mb-2 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-600 to-rose-500 hover:brightness-110 active:scale-95 transition cursor-pointer"
            >
              {workerFailed ? "Tutup & coba lagi" : "Tutup & ganti Stream Key"}
            </button>
          ) : (
            <div className="mb-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-3 text-center">
              <div className="flex items-center justify-center gap-2 text-[12px] text-indigo-100 font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-300 shrink-0" />
                {canGoLive && !deferredPlatform
                  ? "Menyalakan suara host…"
                  : "Mohon tunggu…"}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400 leading-snug">
                {rtmpConnected
                  ? "Hampir selesai — menyiapkan kata pembuka host."
                  : "Jangan tutup halaman. Progress akan berlanjut otomatis."}
              </p>
            </div>
          )}

          {!connectionFailed && (
            <button
              type="button"
              onClick={cancelInitialization}
              disabled={isSubmittingGoLive}
              className="w-full py-2.5 rounded-xl border border-slate-700 bg-[#111827] text-xs font-semibold text-slate-400 hover:text-white hover:border-slate-500 transition cursor-pointer disabled:opacity-50"
            >
              Batalkan
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
