"use client";

import React from "react";
import Image from "next/image";
import { ClipboardList, ShoppingBag, Smartphone, User, Users, Package, Coins } from "lucide-react";
import RealtimeLivePortraitView from "@/components/avatar/RealtimeLivePortraitView";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { getAutoOriginalPrice, formatCompactRupiah, formatNumber, parsePriceToNumber } from "@/utils/formatters";
import { LiveChatPanel } from "./LiveChatPanel";

export const LivePreviewBoard: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);

  const selectedAvatar = useAiHostStore((state) => state.selectedAvatar);
  const isAvatarSpeaking = useAiHostStore((state) => state.isAvatarSpeaking);
  const currentLiveVideoUrl = useAiHostStore((state) => state.currentLiveVideoUrl);
  const setCurrentLiveVideoUrl = useAiHostStore((state) => state.setCurrentLiveVideoUrl);

  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);
  const selectedPlatform = useLiveSessionStore((state) => state.selectedPlatform);
  const selectedDuration = useLiveSessionStore((state) => state.selectedDuration);

  const products = useProductStore((state) => state.products);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);

  const productPrice =
    parsePriceToNumber(activeFeaturedProduct?.price) ||
    (products.length > 0
      ? Math.round(products.reduce((acc, p) => acc + (parsePriceToNumber(p.price) || 99000), 0) / products.length)
      : 99000);

  const platformMultiplier = selectedPlatform.toLowerCase().includes("tiktok")
    ? 1.25
    : selectedPlatform.toLowerCase().includes("shopee")
      ? 1.1
      : selectedPlatform.toLowerCase().includes("tokopedia")
        ? 0.95
        : selectedPlatform.toLowerCase().includes("instagram")
          ? 0.85
          : 1.0;

  const durationHours = Math.max(0.5, selectedDuration || 1);
  const organicBoost = durationHours >= 4 ? 1.15 : 1.0;

  const minViewers = Math.round(durationHours * 380 * platformMultiplier * organicBoost);
  const maxViewers = Math.round(durationHours * 820 * platformMultiplier * organicBoost);

  const minOrders = Math.max(1, Math.round(minViewers * 0.018));
  const maxOrders = Math.max(minOrders + 1, Math.round(maxViewers * 0.038));

  const minOmzet = minOrders * productPrice;
  const maxOmzet = maxOrders * productPrice;

  return (
    <div
      className={`flex flex-col rounded-2xl border p-5 transition-all duration-300 ${
        currentStep === 4
          ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-xl shadow-blue-950/20"
          : "border-[#232c42] bg-[#0c1221]"
      }`}
    >
      
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232c42]/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-400 border border-blue-500/20">
            STEP 4
          </span>
          <span className="text-xs font-bold text-white">Preview &amp; Test Live</span>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-[#232c42] bg-[#111827] px-3 py-1 text-[11px] font-medium text-slate-300">
          <span
            className={`h-2 w-2 rounded-full ${isAvatarSpeaking ? "bg-emerald-400 animate-ping" : "bg-blue-400"}`}
          />
          <span>
            Host: <strong className="text-white">{selectedAvatar.name}</strong> (
            {selectedAvatar.role || selectedAvatar.type})
          </span>
        </div>
      </div>

      <p className="mt-2 mb-4 text-xs text-slate-400">
        Pratinjau interaktif avatar AI, simulasi live chat, dan estimasi performa siaran langsung Anda.
      </p>

      
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch min-h-[360px]">
        
        <div className="md:col-span-4">
          <LiveChatPanel />
        </div>

        
        <div className="md:col-span-4 flex justify-center">
          <div className="relative aspect-[9/16] w-full max-w-[235px] h-full min-h-[350px] overflow-hidden rounded-2xl border-2 border-[#232c42] bg-[#0c0919] shadow-2xl">
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

            
{activeFeaturedProduct?.bannerImage && (
               <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 pointer-events-none w-[75%] flex justify-center animate-in fade-in slide-in-from-top-2 duration-300">
                 <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/40 bg-black/60 backdrop-blur-md p-0.5 w-full relative h-20">
                   <Image
                     src={activeFeaturedProduct.bannerImage}
                     alt="Banner Promosi"
                     fill
                     unoptimized
                     className="object-cover rounded-xl shadow-sm"
                   />
                 </div>
               </div>
             )}

            
            {activeFeaturedProduct?.name && activeFeaturedProduct.name !== "Memuat Produk..." && (
              <div className="absolute bottom-[5%] left-1/2 -translate-x-1/2 z-20 pointer-events-none w-[92%] max-w-[218px] flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="w-full rounded-2xl bg-white/98 p-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.35)] border border-slate-100/90 flex items-center gap-2.5 text-slate-900 backdrop-blur-md ring-1 ring-black/5">
                  
                  <div className="relative h-11 w-11 shrink-0 rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-xs">
                    <Image
                      src={
                        activeFeaturedProduct.image?.startsWith("http") ||
                        activeFeaturedProduct.image?.startsWith("/") ||
                        activeFeaturedProduct.image?.startsWith("data:")
                          ? activeFeaturedProduct.image
                          : "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                      }
                      alt={activeFeaturedProduct.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>

                  
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-900 truncate leading-tight">
                      {activeFeaturedProduct.name}
                    </p>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-[11.5px] font-black text-rose-600 font-mono leading-none">
                        {typeof activeFeaturedProduct.price === "number"
                          ? `Rp${activeFeaturedProduct.price.toLocaleString("id-ID")}`
                          : activeFeaturedProduct.price}
                      </span>
                      {getAutoOriginalPrice(activeFeaturedProduct.price) && (
                        <span className="text-[8.5px] text-slate-400 font-mono line-through leading-none">
                          {getAutoOriginalPrice(activeFeaturedProduct.price)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        
        <div className="md:col-span-4 flex flex-col justify-between rounded-xl border border-[#232c42] bg-[#111827]/80 p-3.5">
          <div>
            <p className="text-xs font-bold text-white mb-2.5 flex items-center justify-between border-b border-[#232c42] pb-2">
              <span className="flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5 text-blue-400" />
                <span>Ringkasan Siaran</span>
              </span>
              <span className="text-[10px] text-blue-400 font-medium bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                {selectedDuration} Jam
              </span>
            </p>

            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <ShoppingBag className="w-3.5 h-3.5 text-purple-400" />
                  <span>Total Produk</span>
                </span>
                <span className="font-semibold text-white">{products.length} Item</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Platform</span>
                </span>
                <span className="font-semibold text-blue-400">{selectedPlatform}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  <span>AI Host</span>
                </span>
                <span className="font-semibold text-slate-200 truncate max-w-[140px]">{selectedAvatar.name}</span>
              </div>
            </div>
          </div>

          
          <div className="mt-3 pt-2.5 border-t border-[#232c42] space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>Est. Penonton</span>
              </span>
              <span className="font-semibold text-slate-200">
                {formatNumber(minViewers)} – {formatNumber(maxViewers)}
              </span>
            </div>

            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-slate-400" />
                <span>Est. Terjual</span>
              </span>
              <span className="font-semibold text-slate-200">
                {formatNumber(minOrders)} – {formatNumber(maxOrders)} pcs
              </span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#1f293d]">
              <span className="font-bold text-slate-300 flex items-center text-[9px] gap-1.5">
                <Coins className="w-3.5 h-3.5 text-emerald-400" />
                <span>Potensi Omzet</span>
              </span>
              <span className="font-black text-emerald-400 text-[10px] tracking-wide">
                {formatCompactRupiah(minOmzet)} – {formatCompactRupiah(maxOmzet)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


