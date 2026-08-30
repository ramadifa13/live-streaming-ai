"use client";

import React, { useMemo } from "react";
import { Search, X } from "lucide-react";
import { useProductStore } from "@/stores/useProductStore";

export const ProductFilter: React.FC = () => {
  const products = useProductStore((state) => state.products);
  const searchQuery = useProductStore((state) => state.searchQuery);
  const setSearchQuery = useProductStore((state) => state.setSearchQuery);
  const productCategoryFilter = useProductStore((state) => state.productCategoryFilter);
  const setProductCategoryFilter = useProductStore((state) => state.setProductCategoryFilter);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: products.length };
    const uniqueTags = new Set<string>();
    products.forEach((p) => {
      const tag = p.tag || "General";
      uniqueTags.add(tag);
      counts[tag] = (counts[tag] || 0) + 1;
    });
    return { counts, uniqueTags: Array.from(uniqueTags).sort() };
  }, [products]);

  const CATEGORIES = ["ALL", ...categoryCounts.uniqueTags];

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[160px]">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-500">
          <Search className="h-3.5 w-3.5" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="block w-full rounded-lg border border-[#232c42] bg-[#111827] py-1.5 pl-8 pr-7 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none transition"
          placeholder="Cari produk berdasarkan nama, SKU, atau kategori..."
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-500 hover:text-white text-xs cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[10px]">
        {CATEGORIES.map((cat) => {
          const count = categoryCounts.counts[cat] ?? 0;
          const isActive = productCategoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setProductCategoryFilter(cat)}
              className={`px-2.5 py-1.5 rounded-lg border transition shrink-0 font-medium flex items-center gap-1.5 cursor-pointer ${
                isActive
                  ? "border-blue-500 bg-blue-500/20 text-white font-bold shadow-sm"
                  : "border-[#232c42] bg-[#111827] text-slate-400 hover:text-slate-200 hover:bg-[#162038]"
              }`}
            >
              <span>{cat === "ALL" ? "Semua" : cat}</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded-full font-mono ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
