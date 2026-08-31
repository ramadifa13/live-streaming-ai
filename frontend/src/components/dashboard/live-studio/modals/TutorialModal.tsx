"use client";

import React, { useState } from "react";
import { X, BookOpen, AlertTriangle } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { dashboardPlatforms } from "@/lib/brand-assets";
import { PlatformIcon } from "@/components/shared/PlatformIcon";

const PLATFORM_TABS = dashboardPlatforms.filter((p) => p.key !== null);

export const TutorialModal: React.FC = () => {
  const showTutorialModal = useDashboardUIStore((state) => state.showTutorialModal);
  const setShowTutorialModal = useDashboardUIStore((state) => state.setShowTutorialModal);

  const [tutorialPlatformTab, setTutorialPlatformTab] = useState(PLATFORM_TABS[0]?.value ?? "TikTok LIVE");

  if (!showTutorialModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={() => setShowTutorialModal(false)}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-3 border-b border-[#232c42] pb-3">
          <BookOpen className="w-6 h-6 text-blue-400" />
          <div>
            <h3 className="text-lg font-bold text-white">Panduan Koneksi &amp; Syarat Live Siaran</h3>
            <p className="text-[11px] text-slate-400">
              Pilih platform tujuan untuk melihat syarat kelayakan dan cara mengambil Stream Key.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4 p-1 rounded-xl bg-[#111827] border border-[#232c42]">
          {PLATFORM_TABS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setTutorialPlatformTab(p.value)}
                className={`flex-1 min-w-[100px] flex items-center justify-center gap-1.5 rounded-lg py-1.5 px-2 text-[10px] font-bold transition cursor-pointer ${
                  tutorialPlatformTab === p.value
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {p.key && <PlatformIcon name={p.key} size="sm" />}
                <span>{"label" in p ? p.label : p.value}</span>
              </button>
            ))}
        </div>

        <div className="space-y-3.5 text-xs text-slate-200">
          {tutorialPlatformTab === "TikTok LIVE" && (
            <div className="space-y-3 animate-fadeIn">
              <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-3">
                <p className="text-[11px] font-bold text-yellow-400 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Syarat Kelayakan Live di TikTok:</span>
                </p>
                <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                  <li>
                    <strong>Akun Kreator:</strong> Minimal memiliki 1.000 Followers.
                  </li>
                  <li>
                    <strong>Akun TikTok Shop (Seller):</strong>{" "}
                    <strong>Tanpa batas follower (0 follower bisa live)</strong> asalkan akun terdaftar resmi.
                  </li>
                  <li>
                    <strong>Akses RTMP / PC:</strong> Menggunakan <em>TikTok LIVE Studio</em> atau akses Stream Key dari
                    Seller Center.
                  </li>
                </ul>
              </div>
              <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                <p className="text-[11px] font-bold text-white mb-2">📋 Langkah Mengambil RTMP URL &amp; Stream Key:</p>
                <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                  <li>
                    Buka <strong>TikTok LIVE Studio</strong> di PC atau <strong>TikTok Live Center</strong> di browser.
                  </li>
                  <li>
                    Pilih menu <strong>Pancarkan dari Komputer (Custom RTMP)</strong>.
                  </li>
                  <li>
                    Salin <strong>Server URL</strong> dan <strong>Stream Key</strong> rahasia Anda ke kolom dashboard
                    ini.
                  </li>
                  <li>
                    Klik <strong>Mulai Live Sekarang</strong> di dashboard ini.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {tutorialPlatformTab === "Shopee Live" && (
            <div className="space-y-3 animate-fadeIn">
              <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 p-3">
                <p className="text-[11px] font-bold text-orange-400 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Syarat Kelayakan Live di Shopee:</span>
                </p>
                <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                  <li>
                    Toko Shopee dalam status <strong>Aktif</strong>.
                  </li>
                  <li>Fitur Shopee Live sudah aktif pada akun toko Anda.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-[#111827] border border-[#232c42] p-3.5">
                <p className="text-[11px] font-bold text-white mb-2">📋 Langkah Mengambil RTMP URL &amp; Stream Key:</p>
                <ol className="list-decimal list-inside text-[10.5px] text-slate-300 space-y-1.5">
                  <li>
                    Login ke <strong>Shopee Seller Centre</strong> (seller.shopee.co.id).
                  </li>
                  <li>
                    Masuk ke menu <strong>Promosi Saya ➔ Shopee Live ➔ Buat Siaran Langsung</strong>.
                  </li>
                  <li>
                    Pilih <strong>Streaming Melalui Komputer (RTMP)</strong>, salin URL dan Stream Key.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {tutorialPlatformTab === "Instagram Live" && (
            <div className="space-y-3 animate-fadeIn">
              <div className="rounded-xl bg-pink-500/10 border border-pink-500/30 p-3">
                <p className="text-[11px] font-bold text-pink-400 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Syarat Kelayakan Live di Instagram:</span>
                </p>
                <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                  <li>
                    Akun bertipe <strong>Profesional (Bisnis atau Kreator)</strong>.
                  </li>
                  <li>
                    Dapat diakses di <strong>instagram.com/live/producer/</strong>.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {tutorialPlatformTab === "YouTube" && (
            <div className="space-y-3 animate-fadeIn">
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3">
                <p className="text-[11px] font-bold text-red-400 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Syarat Kelayakan Live di YouTube:</span>
                </p>
                <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                  <li>Channel terverifikasi nomor telepon.</li>
                  <li>Fitur Live Streaming aktif di YouTube Studio.</li>
                </ul>
              </div>
            </div>
          )}

          {tutorialPlatformTab === "Facebook Live" && (
            <div className="space-y-3 animate-fadeIn">
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3">
                <p className="text-[11px] font-bold text-blue-400 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Syarat Kelayakan Live di Facebook:</span>
                </p>
                <ul className="list-disc list-inside text-[10px] text-slate-300 space-y-1">
                  <li>Halaman Facebook atau Mode Profesional.</li>
                  <li>
                    Akses di <strong>facebook.com/live/producer</strong>.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end pt-3 border-t border-[#232c42]">
          <button
            type="button"
            onClick={() => setShowTutorialModal(false)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-2.5 text-xs font-bold text-white hover:brightness-110 shadow-md shadow-blue-600/30 transition active:scale-95 cursor-pointer"
          >
            Mengerti &amp; Tutup Panduan
          </button>
        </div>
      </div>
    </div>
  );
};
