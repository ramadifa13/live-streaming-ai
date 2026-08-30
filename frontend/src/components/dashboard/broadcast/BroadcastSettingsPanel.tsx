"use client";

import React from "react";
import Image from "next/image";
import { MessageSquare, Pin, Gift, Shield, Sparkles, Bot, Lock } from "lucide-react";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useProductStore } from "@/stores/useProductStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";

const DURATIONS = [
  { hours: 2, label: "2 Jam", tag: "Express", price: "Rp99.000 (Express)" },
  { hours: 8, label: "8 Jam", tag: "Shift", price: "Rp299.000 (Shift)" },
  { hours: 24, label: "24 Jam", tag: "24/7", price: "Rp699.000 (Marathon)" },
];

export const BroadcastSettingsPanel: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);
  const setShowScriptModal = useDashboardUIStore((state) => state.setShowScriptModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const selectedDuration = useLiveSessionStore((state) => state.selectedDuration);
  const setSelectedDuration = useLiveSessionStore((state) => state.setSelectedDuration);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const handlePlatformSelect = useLiveSessionStore((state) => state.handlePlatformSelect);
  const automations = useLiveSessionStore((state) => state.automations);
  const setAutomations = useLiveSessionStore((state) => state.setAutomations);

  const products = useProductStore((state) => state.products);
  const pinnedProductIds = useProductStore((state) => state.pinnedProductIds);
  const setPinnedProductIds = useProductStore((state) => state.setPinnedProductIds);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);

  const fetchLiveSalesScript = useAiHostStore((state) => state.fetchLiveSalesScript);

  const automationItems = [
    {
      key: "autoReply" as const,
      label: "Auto-Reply Chat",
      desc: "Menjawab live chat",
      icon: <MessageSquare className="w-3.5 h-3.5 text-pink-400" />,
      color: "bg-pink-500/20",
      minHours: 1,
    },
    {
      key: "autoPin" as const,
      label: "Auto-Pin Produk",
      desc: "Sematkan katalog",
      icon: <Pin className="w-3.5 h-3.5 text-purple-400" />,
      color: "bg-purple-500/20",
      minHours: 2,
    },
    {
      key: "autoPromo" as const,
      label: "Auto-Promo Diskon",
      desc: "CTA promo berkala",
      icon: <Gift className="w-3.5 h-3.5 text-emerald-400" />,
      color: "bg-emerald-500/20",
      minHours: 8,
    },
    {
      key: "autoModeration" as const,
      label: "Auto Moderasi",
      desc: "Filter kata negatif",
      icon: <Shield className="w-3.5 h-3.5 text-amber-400" />,
      color: "bg-amber-500/20",
      minHours: 8,
    },
  ];

  const handleFetchScript = async () => {
    setShowScriptModal(true);
    try {
      await fetchLiveSalesScript(activeFeaturedProduct);
      showToast("Naskah promosi AI Host berhasil dibuat!");
    } catch (err) {
      showToast(`Gagal: ${(err as Error)?.message || "AI Host tidak dapat dijangkau. Pastikan backend aktif."}`);
    }
  };

  return (
    <div
      className={`flex flex-col rounded-xl border p-4 transition ${
        currentStep === 3
          ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10"
          : "border-[#232c42] bg-[#0c1221]"
      }`}
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

      <h3 className="mb-1 mt-2 text-lg font-bold text-white">Atur Live &amp; Otomatisasi AI</h3>
      <p className="mb-3 text-[11px] text-slate-400">
        Atur platform target, durasi siaran, katalog produk, dan sistem otomatisasi.
      </p>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[10.5px] font-semibold text-slate-300">Katalog Produk Siaran Live</label>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-400 font-mono">
              {pinnedProductIds.length > 0 ? `${pinnedProductIds.length} Pinned` : `Semua (${products.length})`}
            </span>
            <button
              type="button"
              onClick={() => {
                if (pinnedProductIds.length === products.length) {
                  setPinnedProductIds([]);
                  showToast("Mode rotasi: Semua produk toko aktif");
                } else {
                  setPinnedProductIds(products.map((p) => p.id || p.name));
                  showToast("Semua produk disematkan untuk rotasi");
                }
              }}
              className="text-[9px] text-blue-400 hover:text-blue-300 font-semibold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30 transition cursor-pointer"
            >
              {pinnedProductIds.length === products.length ? "Reset" : "Pilih Semua"}
            </button>
          </div>
        </div>

        <div className="relative flex items-center rounded-xl border border-[#232c42] bg-[#111827] p-1.5">
          <div className="flex gap-2 overflow-x-auto px-1 py-0.5 w-full">
            {products.map((prod) => {
              const prodId = prod.id || prod.name;
              const isPinned = pinnedProductIds.includes(prodId);
              const isFeatured = (activeFeaturedProduct.id || activeFeaturedProduct.name) === prodId;
              const hasValidImg =
                prod.image?.startsWith("http") || prod.image?.startsWith("/") || prod.image?.startsWith("data:");

              return (
                <div
                  key={prodId}
                  onClick={() => {
                    setActiveFeaturedProduct(prod);
                    setPinnedProductIds((prev) =>
                      prev.includes(prodId) ? prev.filter((id) => id !== prodId) : [...prev, prodId],
                    );
                    showToast(`Produk sorotan: ${prod.name}`);
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
                  {hasValidImg ? (
                    <Image src={prod.image || ""} alt={prod.name} fill unoptimized className="object-cover" />
                  ) : (
                    <div className={`h-full w-full ${prod.image || "bg-[#e8c6b9]"}`} />
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

      <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10.5px] font-semibold text-slate-300">Durasi Live Siaran</label>
            <span className="text-[9px] font-mono text-cyan-400">
              {DURATIONS.find((d) => d.hours === selectedDuration)?.price}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((item) => (
              <button
                key={item.hours}
                type="button"
                disabled={isLiveActive}
                onClick={() => {
                  if (isLiveActive) {
                    showToast("Peringatan: Durasi tidak dapat diubah saat siaran sedang aktif!");
                    return;
                  }
                  setSelectedDuration(item.hours);
                  if (item.hours === 2) {
                    setAutomations({
                      autoReply: true,
                      autoPin: true,
                      autoPromo: false,
                      autoModeration: false,
                    });
                    showToast("Paket Express (2 Jam): Auto-Reply & Auto-Pin aktif");
                  } else {
                    setAutomations({
                      autoReply: true,
                      autoPin: true,
                      autoPromo: true,
                      autoModeration: true,
                    });
                    showToast(
                      `Paket ${item.hours === 8 ? "Shift (8 Jam)" : "Marathon (24 Jam)"}: Semua otomatisasi aktif`,
                    );
                  }
                }}
                className={`rounded-lg py-1 text-[10px] font-semibold border transition active:scale-95 flex flex-col items-center justify-center cursor-pointer ${
                  selectedDuration === item.hours
                    ? "border-blue-500 bg-blue-500/25 text-white shadow-sm font-bold ring-1 ring-blue-500/50"
                    : "border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200 hover:border-slate-600"
                } ${isLiveActive ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <span>{item.label}</span>
                <span className="text-[8px] text-slate-400 font-normal">{item.tag}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10.5px] font-semibold text-slate-300">Platform Siaran</label>
          <select
            value={selectedPlatform}
            disabled={isLiveActive}
            onChange={(e) => handlePlatformSelect(e.target.value)}
            className={`w-full rounded-lg border border-[#232c42] bg-[#111827] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500 font-medium ${
              isLiveActive ? "cursor-not-allowed opacity-70" : "cursor-pointer"
            }`}
          >
            <option value="Instagram Live">Instagram Live</option>
            <option value="Facebook Live">Facebook Live</option>
            <option value="TikTok LIVE">TikTok LIVE</option>
            <option value="Shopee Live">Shopee Live</option>
            <option value="YouTube">YouTube Live</option>
            <option value="Custom RTMP">Custom RTMP Server</option>
          </select>
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[10.5px] font-semibold text-slate-300">Sistem Otomatisasi AI Otonom</label>
          {isLiveActive ? (
            <span className="text-[8.5px] text-amber-400 font-medium bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" />
              Terkunci saat Live Aktif
            </span>
          ) : (
            <span className="text-[8.5px] text-slate-400">Fitur disesuaikan dengan durasi paket</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          {automationItems.map((item) => {
            const isAllowed = selectedDuration >= item.minHours;
            const isActive = isAllowed && automations[item.key];
            return (
              <div
                key={item.key}
                onClick={() => {
                  if (isLiveActive) {
                    showToast("Peringatan: Pengaturan otomatisasi dikunci selama live streaming!");
                    return;
                  }
                  if (!isAllowed) {
                    showToast(`${item.label} terkunci (Minimal paket ${item.minHours} Jam).`);
                    return;
                  }
                  setAutomations((prev) => ({
                    ...prev,
                    [item.key]: !isActive,
                  }));
                  showToast(`${item.label}: ${!isActive ? "Diaktifkan" : "Dinonaktifkan"}`);
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
                <div className={`flex h-5 w-5 items-center justify-center rounded-md ${item.color}`}>{item.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="font-semibold text-slate-200 truncate">{item.label}</p>
                    {!isAllowed && <span className="text-[8px] text-amber-400 font-mono">🔒 {item.minHours}J</span>}
                  </div>
                  <p className="text-[8px] text-slate-500 truncate">
                    {!isAllowed ? `Perlu paket ≥${item.minHours} Jam` : item.desc}
                  </p>
                </div>
                <div
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    isActive ? "bg-emerald-400" : isAllowed ? "bg-slate-600" : "bg-slate-800"
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto rounded-xl bg-[#0e1628] p-3 border border-blue-500/30 shadow-inner">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5 truncate">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>AI Copywriting &amp; CTA Pitch</span>
            </p>
            <p className="text-[9px] text-slate-400 truncate mt-0.5">
              Sumber data: <strong className="text-blue-300">{activeFeaturedProduct.name}</strong> (
              {activeFeaturedProduct.tag || "General"})
            </p>
          </div>
          <button
            type="button"
            onClick={handleFetchScript}
            className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-3 py-1.5 text-[10px] font-bold text-white hover:brightness-110 transition active:scale-95 shrink-0 shadow-md shadow-blue-600/30 cursor-pointer"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Generate from AI</span>
          </button>
        </div>
      </div>
    </div>
  );
};
