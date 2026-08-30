"use client";

import React from "react";
import Image from "next/image";
import { X, Download, BarChart2, Tag, Sparkles } from "lucide-react";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

export const SessionSummaryModal: React.FC = () => {
  const showSummaryModal = useDashboardUIStore((state) => state.showSummaryModal);
  const setShowSummaryModal = useDashboardUIStore((state) => state.setShowSummaryModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const sessionSummary = useLiveSessionStore((state) => state.sessionSummary);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const setLiveSeconds = useLiveSessionStore((state) => state.setLiveSeconds);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const selectedTone = useAiHostStore((state) => state.selectedTone);

  const products = useProductStore((state) => state.products);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);

  if (!showSummaryModal || !sessionSummary) return null;

  const handleDownloadCsv = () => {
    const nowStr = new Date().toLocaleString("id-ID");
    const headers = "LAPORAN LENGKAP HASIL SIARAN LIVE STREAMING AI\n\n";
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
      const sold = isMain ? sessionSummary.totalProductSold : Math.floor(sessionSummary.totalProductSold * 0.2);
      const clicks = isMain ? sessionSummary.totalClicks : Math.floor(sessionSummary.totalClicks * 0.25);
      productSection += `"${p.name}","${p.tag || "Umum"}","${p.price}","${isMain ? "Produk Utama Live" : "Katalog Tambahan"}",${clicks},${sold}\n`;
    });

    const fullCsv = headers + summarySection + productSection;
    const blob = new Blob([fullCsv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Laporan_Live_${selectedPlatform.replace(/\s+/g, "_")}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("📥 Laporan Analitik CSV Lengkap berhasil di-download!");
  };

  const handleStartNewSession = () => {
    setShowSummaryModal(false);
    setLiveSeconds(0);
    showToast("✨ Siap untuk memulai sesi siaran live baru!");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl border border-emerald-500/40 bg-[#0b101e] p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <button
          type="button"
          onClick={() => setShowSummaryModal(false)}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white text-2xl shadow-lg shadow-emerald-600/30">
            <BarChart2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white">Laporan Hasil Siaran Live Streaming</h3>
            <p className="text-xs text-slate-400">
              Host AI: <strong className="text-slate-200">{selectedAvatar.name}</strong> • Platform:{" "}
              <strong className="text-blue-400">{selectedPlatform}</strong> • Selesai: {new Date().toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">Durasi Siaran</p>
            <p className="text-lg font-black text-white font-mono">{sessionSummary.durationFormatted}</p>
            <span className="text-[9px] text-emerald-400 font-medium">100% Otonom AI</span>
          </div>
          <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">Total Penonton</p>
            <p className="text-lg font-black text-cyan-400 font-mono">
              {sessionSummary.totalViewers.toLocaleString("id-ID")}
            </p>
            <span className="text-[9px] text-slate-400">
              Peak: {sessionSummary.peakViewers.toLocaleString("id-ID")}
            </span>
          </div>
          <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">Interaksi Komentar</p>
            <p className="text-lg font-black text-purple-400 font-mono">{sessionSummary.totalComments}</p>
            <span className="text-[9px] text-emerald-400">{sessionSummary.aiRepliesCount} Dibalas AI</span>
          </div>
          <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">Produk Terjual</p>
            <p className="text-lg font-black text-yellow-400 font-mono">{sessionSummary.totalProductSold} pcs</p>
            <span className="text-[9px] text-emerald-400">{sessionSummary.totalClicks} Klik Keranjang</span>
          </div>
        </div>

        {/* Financial Performance Box */}
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-[#0e192c] to-[#0c1221] p-4 mb-5">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3">
            Ringkasan Finansial &amp; Profitabilitas
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-slate-400 text-[11px]">Total Omzet Kotor (GMV):</p>
              <p className="text-xl font-black text-white mt-0.5">{sessionSummary.grossRevenueFormatted}</p>
            </div>
            <div>
              <p className="text-slate-400 text-[11px]">Biaya Server GPU Cloud:</p>
              <p className="text-lg font-bold text-red-400 mt-0.5">- {sessionSummary.estimatedGpuCostFormatted}</p>
              <span className="text-[9px] text-slate-500">~Rp12.500 / jam siaran</span>
            </div>
            <div>
              <p className="text-slate-400 text-[11px]">Estimasi Laba Bersih (Net Profit):</p>
              <p className="text-2xl font-black text-emerald-400 mt-0.5">{sessionSummary.netProfitFormatted}</p>
              <span className="text-[10px] font-bold text-emerald-300">ROI: {sessionSummary.roiPercentage}</span>
            </div>
          </div>
        </div>

        {/* Product Performance Breakdown Table */}
        <div className="rounded-xl border border-[#232c42] bg-[#111827] p-3 mb-5">
          <p className="text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-blue-400" />
            <span>Rincian Penjualan per Produk:</span>
          </p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-[10.5px]">
            {products.map((p, idx) => (
              <div
                key={p.id || idx}
                className="flex items-center justify-between p-2 rounded-lg bg-[#0c1221] border border-[#232c42]/60"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="relative h-7 w-7 rounded overflow-hidden shrink-0 border border-white/10">
                    <Image
                      src={
                        p.image?.startsWith("http") || p.image?.startsWith("/") || p.image?.startsWith("data:")
                          ? p.image
                          : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                      }
                      alt={p.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate max-w-[180px]">{p.name}</p>
                    <p className="text-[9px] text-emerald-400">{p.price}</p>
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
            onClick={handleDownloadCsv}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-[#232c42] bg-[#111827] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/5 hover:text-white transition active:scale-95 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Laporan Lengkap (CSV)</span>
          </button>

          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleStartNewSession}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/30 hover:brightness-110 transition active:scale-95 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Mulai Sesi Baru</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
