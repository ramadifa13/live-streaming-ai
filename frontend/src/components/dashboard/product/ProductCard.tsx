"use client";

import React from "react";
import Image from "next/image";
import { Pencil, Trash2, ShoppingBag, RefreshCw, ScrollText } from "lucide-react";
import { Product } from "@/app/dashboard/types";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";
import { getScriptBankMeta } from "@/lib/script-bank";

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);
  const setSelectedProductForEdit = useProductStore((state) => state.setSelectedProductForEdit);
  const deleteProduct = useProductStore((state) => state.deleteProduct);
  const regenerateScriptBank = useProductStore((state) => state.regenerateScriptBank);
  const scriptBankPreparingIds = useProductStore((state) => state.scriptBankPreparingIds);
  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);

  const setShowEditProductModal = useDashboardUIStore((state) => state.setShowEditProductModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const isSelected = activeFeaturedProduct.id === product.id || activeFeaturedProduct.name === product.name;
  const bankMeta = getScriptBankMeta(product, scriptBankPreparingIds);

  const handleSelect = () => {
    setActiveFeaturedProduct(product);
    showToast(` Produk live dialihkan ke: ${product.name}`);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProductForEdit(product);
    setShowEditProductModal(true);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!product.id) return;
    if (confirm("Apakah Anda yakin ingin menghapus produk ini secara permanen dari Database & RAG Knowledge Base?")) {
      try {
        await deleteProduct(product.id);
        showToast("Produk telah dihapus dari database!");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Gagal menghapus produk");
      }
    }
  };

  const handleRegenerateBank = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!product.id || isLiveActive) return;
    try {
      await regenerateScriptBank(product.id);
      showToast(`Script bank ${product.name} disiapkan ulang.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menyiapkan script bank");
    }
  };

  const hasValidImage =
    product.image?.startsWith("http") || product.image?.startsWith("/") || product.image?.startsWith("data:");

  return (
    <div
      onClick={handleSelect}
      className={`group relative rounded-xl border px-3 py-2.5 cursor-pointer transition-all duration-200 ${
        isSelected
          ? "border-blue-500/80 bg-gradient-to-r from-blue-950/40 via-[#0d172e] to-[#0a101f] shadow-md shadow-blue-950/30 ring-1 ring-blue-500/40"
          : "border-[#1e293b]/80 bg-[#0e1628]/70 hover:border-slate-600 hover:bg-[#131d35] shadow-xs"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative h-11 w-11 rounded-lg overflow-hidden shrink-0 bg-[#162038] border border-white/10 shadow-inner">
          {hasValidImage ? (
            <Image
              src={product.image || ""}
              alt={product.name}
              fill
              unoptimized
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div
              className={`h-full w-full flex items-center justify-center text-base ${
                product.image || "bg-gradient-to-br from-slate-800 to-slate-900"
              }`}
            >
              <ShoppingBag className="w-5 h-5 text-blue-400" />
            </div>
          )}
          {isSelected && (
            <div className="absolute inset-0 bg-blue-500/20 ring-1.5 ring-inset ring-blue-500 rounded-lg flex items-start justify-end p-0.5 pointer-events-none">
              <span className="flex h-2 w-2 rounded-full bg-blue-400 shadow-xs shadow-blue-400 animate-pulse" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h4
            className={`text-xs font-semibold truncate leading-tight transition-colors ${
              isSelected ? "text-blue-200 font-bold" : "text-slate-200 group-hover:text-white"
            }`}
          >
            {product.name}
          </h4>

          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-xs font-bold text-emerald-400 font-mono tracking-tight shrink-0">
              {typeof product.price === "number" ? `Rp${product.price.toLocaleString("id-ID")}` : product.price}
            </span>
            <span
              className={`text-[8px] font-bold px-1.5 py-0.5 rounded border truncate max-w-[90px] ${bankMeta.colorClass}`}
              title="Script bank = ucapan otonom host saat live"
            >
              {bankMeta.status === "preparing" ? (
                <span className="inline-flex items-center gap-0.5">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  {bankMeta.label}
                </span>
              ) : (
                bankMeta.label
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 pl-1">
          <button
            type="button"
            onClick={handleRegenerateBank}
            disabled={isLiveActive || bankMeta.status === "preparing"}
            className="p-1.5 text-slate-400 hover:text-purple-300 hover:bg-purple-500/15 rounded-lg transition active:scale-90 cursor-pointer disabled:opacity-40"
            title="Regenerate script bank (ucapan otonom host)"
          >
            <ScrollText className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="p-1.5 text-slate-400 hover:text-blue-300 hover:bg-blue-500/15 rounded-lg transition active:scale-90 cursor-pointer"
            title="Edit Produk"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 rounded-lg transition active:scale-90 cursor-pointer"
            title="Hapus Produk"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
