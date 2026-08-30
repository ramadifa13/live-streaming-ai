"use client";

import React, { useMemo } from "react";
import { Search } from "lucide-react";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { ProductCard } from "./ProductCard";

export const ProductList: React.FC = () => {
  const products = useProductStore((state) => state.products);
  const searchQuery = useProductStore((state) => state.searchQuery);
  const productCategoryFilter = useProductStore((state) => state.productCategoryFilter);
  const setSearchQuery = useProductStore((state) => state.setSearchQuery);
  const setProductCategoryFilter = useProductStore((state) => state.setProductCategoryFilter);

  const setShowAddProductModal = useDashboardUIStore((state) => state.setShowAddProductModal);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCat =
        productCategoryFilter === "ALL" ||
        (p.tag &&
          p.tag.toLowerCase().includes(productCategoryFilter.toLowerCase()));
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.tag && p.tag.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [products, productCategoryFilter, searchQuery]);

  if (filteredProducts.length === 0) {
    return (
      <div className="py-8 text-center rounded-xl border border-dashed border-[#232c42] bg-[#111827]/40 p-4">
        <Search className="w-8 h-8 mx-auto mb-2 text-slate-500" />
        <p className="text-xs font-bold text-slate-300">
          Tidak ada produk ditemukan
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {searchQuery
            ? `Tidak ada hasil untuk pencarian "${searchQuery}"`
            : "Kategori ini belum memiliki produk."}
        </p>
        <button
          type="button"
          onClick={() => {
            setSearchQuery("");
            setProductCategoryFilter("ALL");
            setShowAddProductModal(true);
          }}
          className="mt-2.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-500 transition cursor-pointer"
        >
          + Tambah Produk Baru
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 max-h-[290px] overflow-y-auto pr-1.5 custom-scrollbar">
      {filteredProducts.map((p) => (
        <ProductCard key={p.id || p.name} product={p} />
      ))}
    </div>
  );
};
