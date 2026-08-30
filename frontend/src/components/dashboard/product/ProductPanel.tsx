"use client";

import React from "react";
import { Upload, Plus, FileSpreadsheet, Lightbulb } from "lucide-react";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { ProductFilter } from "./ProductFilter";
import { ProductList } from "./ProductList";

export const ProductPanel: React.FC = () => {
  const currentStep = useDashboardUIStore((state) => state.currentStep);
  const setShowCsvModal = useDashboardUIStore((state) => state.setShowCsvModal);
  const setShowAddProductModal = useDashboardUIStore((state) => state.setShowAddProductModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const products = useProductStore((state) => state.products);
  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const setActiveFeaturedProduct = useProductStore((state) => state.setActiveFeaturedProduct);
  const setProducts = useProductStore((state) => state.setProducts);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          const uploadedUri = String(ev.target.result);
          setActiveFeaturedProduct((prev) => ({
            ...prev,
            image: uploadedUri,
          }));
          setProducts((prev) =>
            prev.map((p) => (p.id === activeFeaturedProduct.id ? { ...p, image: uploadedUri } : p)),
          );
          showToast(` Foto ${file.name} berhasil diterapkan ke ${activeFeaturedProduct.name}!`);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div
      className={`flex flex-col rounded-xl border p-4 transition ${
        currentStep === 1
          ? "border-blue-500/60 bg-[#0c1428] ring-1 ring-blue-500/30 shadow-lg shadow-blue-900/10"
          : "border-[#232c42] bg-[#0c1221]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
            STEP 1
          </span>
          <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            RAG Knowledge Active
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-medium">{products.length} Produk Terdaftar</span>
      </div>

      <div className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>Data Bisnis &amp; Produk</span>
            <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20 font-mono">
              {products.length} Item
            </span>
          </h3>
          <p className="text-[11px] text-slate-400">
            Data diolah ke <strong>RAG Knowledge Base</strong> agar AI Host mahir menjawab live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCsvModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[#232c42] bg-[#111827] px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-blue-500 hover:text-white transition active:scale-95 shadow-sm cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddProductModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:brightness-110 transition active:scale-95 shadow-md shadow-blue-600/30 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Produk</span>
          </button>
        </div>
      </div>

      <ProductFilter />

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex-1 min-w-0">
          <ProductList />
        </div>

        <div className="w-full lg:w-[155px] flex-shrink-0 flex flex-col justify-between gap-2">
          <label className="flex min-h-[120px] lg:h-full w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-500/50 bg-[#111827] text-center text-xs cursor-pointer hover:border-blue-400 hover:bg-[#162038] transition p-2.5 shadow-inner group">
            <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center mb-1 text-blue-400 group-hover:scale-110 transition">
              <Upload className="h-4 w-4" />
            </div>
            <p className="font-bold text-slate-200 text-[11px]">Upload Foto Produk</p>
            <p className="text-[8.5px] text-slate-400 mt-0.5">Terapkan ke produk aktif</p>
            <p className="mt-1 text-[7.5px] text-blue-400/80 font-mono">JPG, PNG, WebP</p>
            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          </label>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2.5 text-xs">
            <div className="mb-1 flex items-center gap-1 text-blue-400 text-[10.5px]">
              <Lightbulb className="w-3.5 h-3.5" />
              <span className="font-bold">Tips RAG Host</span>
            </div>
            <p className="text-[9.5px] text-slate-400 leading-tight">
              Klik produk untuk menjadikannya produk aktif live promo &amp; video iklan.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
