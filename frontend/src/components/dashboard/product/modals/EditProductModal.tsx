"use client";

import React, { useState } from "react";
import Image from "next/image";
import { X, Upload, Image as ImageIcon, Pencil, Link2 } from "lucide-react";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { PRODUCT_CATEGORIES } from "@/lib/product-categories";

export const EditProductModal: React.FC = () => {
  const showEditProductModal = useDashboardUIStore((state) => state.showEditProductModal);
  const setShowEditProductModal = useDashboardUIStore((state) => state.setShowEditProductModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const selectedProductForEdit = useProductStore((state) => state.selectedProductForEdit);
  const setSelectedProductForEdit = useProductStore((state) => state.setSelectedProductForEdit);
  const saveEditedProduct = useProductStore((state) => state.saveEditedProduct);

  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!showEditProductModal || !selectedProductForEdit) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await saveEditedProduct();
      setShowEditProductModal(false);
      showToast("Produk diperbarui di perangkat ini. Script bank disiapkan ulang.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal memperbarui produk");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl border border-[#22314e] bg-[#0c1221] shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-[#1e293b] shrink-0 bg-[#0c1221]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">Edit Data Produk</h3>
              <p className="text-[11px] text-slate-400">
                Data tetap di perangkat Anda. Menyimpan akan menyiapkan ulang script bank host.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowEditProductModal(false)}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition active:scale-95 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 custom-modal-scrollbar space-y-3.5 text-xs pr-4 sm:pr-5">
            <div className="rounded-xl border border-[#22314e] bg-[#0f172a]/70 p-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-slate-200 font-bold text-[11px] flex items-center gap-1">
                  <span>1. Foto / Gambar Produk</span>
                  <span className="text-red-400">*</span>
                </label>
                {selectedProductForEdit.image ? (
                  <span className="text-[9.5px] font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    ✓ Foto Terpasang
                  </span>
                ) : (
                  <span className="text-[9.5px] font-semibold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-500/30">
                    Wajib Diupload
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="relative h-18 w-18 shrink-0 rounded-xl overflow-hidden border-2 border-blue-500/40 bg-[#090e1a] shadow-inner flex items-center justify-center">
                  {selectedProductForEdit.image ? (
                    <Image
                      src={selectedProductForEdit.image}
                      alt={selectedProductForEdit.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-500" />
                  )}
                </div>
                <div className="flex-1">
                  <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/15 hover:border-blue-400 px-3 py-2.5 cursor-pointer transition text-center group">
                    <span className="text-xs text-blue-300 font-bold flex items-center gap-1.5 group-hover:scale-105 transition">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Ganti Foto Produk</span>
                    </span>
                    <span className="text-[9.5px] text-slate-400 mt-0.5">Format JPG, PNG, WebP (Rasio 1:1)</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          const reader = new FileReader();
                          reader.onload = (uploadEvent) => {
                            if (uploadEvent.target?.result) {
                              setSelectedProductForEdit({
                                ...selectedProductForEdit,
                                image: String(uploadEvent.target.result),
                              });
                              showToast(`Foto ${file.name} berhasil diperbarui!`);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-slate-200 font-bold text-[11px] mb-1">
                2. Nama Produk <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={selectedProductForEdit.name}
                onChange={(e) =>
                  setSelectedProductForEdit({
                    ...selectedProductForEdit,
                    name: e.target.value,
                  })
                }
                className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 font-medium text-xs transition"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-200 font-bold text-[11px] mb-1">
                  3. Harga Jual Live <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-bold text-slate-400">
                    Rp
                  </span>
                  <input
                    type="text"
                    required
                    value={selectedProductForEdit.price}
                    onChange={(e) =>
                      setSelectedProductForEdit({
                        ...selectedProductForEdit,
                        price: e.target.value,
                      })
                    }
                    className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] pl-9 pr-3 py-2.5 text-emerald-400 font-mono font-bold text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:emerald-500/50 transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-200 font-bold text-[11px] mb-1">
                  4. Stok Tersedia <span className="text-slate-400 font-normal">(Opsional)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={selectedProductForEdit.stock ?? ""}
                    onChange={(e) =>
                      setSelectedProductForEdit({
                        ...selectedProductForEdit,
                        stock: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] px-3 py-2.5 text-white font-mono text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition"
                  />
                  <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-[10px] text-slate-400 pointer-events-none">
                    pcs
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-slate-200 font-bold text-[11px] mb-1">
                  5. Kategori <span className="text-red-400">*</span>
                </label>
                <select
                  value={selectedProductForEdit.tag || "Skincare"}
                  onChange={(e) =>
                    setSelectedProductForEdit({
                      ...selectedProductForEdit,
                      tag: e.target.value,
                    })
                  }
                  className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] px-3 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 text-xs cursor-pointer transition font-medium"
                >
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-200 font-bold text-[11px] mb-1">
                  6. SKU / Kode Produk <span className="text-slate-400 font-normal">(Opsional)</span>
                </label>
                <input
                  type="text"
                  value={selectedProductForEdit.sku || ""}
                  onChange={(e) =>
                    setSelectedProductForEdit({
                      ...selectedProductForEdit,
                      sku: e.target.value,
                    })
                  }
                  placeholder="Contoh: SKU-SBP-001"
                  className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] px-3 py-2.5 text-slate-200 font-mono text-[11px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition"
                />
              </div>
              <div>
                <label className="block text-slate-200 font-bold text-[11px] mb-1">
                  7. Link Keranjang Kuning / Checkout <span className="text-slate-400 font-normal">(Opsional)</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <Link2 className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="url"
                    value={selectedProductForEdit.link || ""}
                    onChange={(e) =>
                      setSelectedProductForEdit({
                        ...selectedProductForEdit,
                        link: e.target.value,
                      })
                    }
                    placeholder="https://shopee.co.id/... atau https://tiktok.com/@toko/..."
                    className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] pl-8 pr-3 py-2.5 text-slate-200 text-[11px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-slate-200 font-bold text-[11px] mb-1">
                8. Deskripsi Lengkap Produk <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={3}
                required
                value={selectedProductForEdit.description || ""}
                onChange={(e) =>
                  setSelectedProductForEdit({
                    ...selectedProductForEdit,
                    description: e.target.value,
                  })
                }
                placeholder="Jelaskan formula, bahan aktif, dan kelebihan umum produk..."
                className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] p-3 text-slate-200 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 font-sans transition"
              />
            </div>

            <div>
              <label className="block text-slate-200 font-bold text-[11px] mb-1">
                9. Keunggulan &amp; Manfaat Utama{" "}
                <span className="text-slate-400 font-normal">(Opsional — kosong = diisi AI)</span>
              </label>
              <textarea
                rows={2}
                value={selectedProductForEdit.benefits || ""}
                onChange={(e) =>
                  setSelectedProductForEdit({
                    ...selectedProductForEdit,
                    benefits: e.target.value,
                  })
                }
                placeholder="Kosongkan jika ingin AI melengkapi dari deskripsi..."
                className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] p-2.5 text-slate-200 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 font-sans transition"
              />
            </div>

            <div>
              <label className="block text-slate-200 font-bold text-[11px] mb-1">
                10. Petunjuk &amp; Cara Pemakaian{" "}
                <span className="text-slate-400 font-normal">(Opsional — kosong = diisi AI)</span>
              </label>
              <textarea
                rows={2}
                value={selectedProductForEdit.usage || ""}
                onChange={(e) =>
                  setSelectedProductForEdit({
                    ...selectedProductForEdit,
                    usage: e.target.value,
                  })
                }
                placeholder="Kosongkan jika ingin AI melengkapi dari deskripsi..."
                className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] p-2.5 text-slate-200 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 font-sans transition"
              />
            </div>

            <div>
              <label className="block text-slate-200 font-bold text-[11px] mb-1">
                10b. FAQ singkat <span className="text-slate-400 font-normal">(Opsional — kosong = diisi AI)</span>
              </label>
              <textarea
                rows={2}
                value={selectedProductForEdit.faq || ""}
                onChange={(e) =>
                  setSelectedProductForEdit({
                    ...selectedProductForEdit,
                    faq: e.target.value,
                  })
                }
                placeholder="Kosongkan jika ingin AI melengkapi dari manfaat/deskripsi/cara pakai"
                className="w-full rounded-xl bg-[#090e1a] border border-[#22314e] p-2.5 text-slate-200 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 font-sans transition"
              />
            </div>

            <div className="rounded-xl border border-[#22314e] bg-[#0f172a]/70 p-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-slate-200 font-bold text-[11px] flex items-center gap-1">
                  <span>11. Gambar Banner Promosi</span>
                  <span className="text-slate-400 font-normal">(Opsional — overlay atas &amp; bawah host)</span>
                </label>
                {selectedProductForEdit.bannerImage ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[9.5px] font-semibold text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded-full border border-purple-500/30">
                      ✓ Banner Terpasang
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProductForEdit({
                          ...selectedProductForEdit,
                          bannerImage: "",
                        });
                        showToast("Banner promosi dihapus");
                      }}
                      className="text-[9.5px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Hapus
                    </button>
                  </div>
                ) : (
                  <span className="text-[9.5px] font-medium text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full">
                    Opsional
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="relative h-16 w-32 shrink-0 rounded-xl overflow-hidden border-2 border-indigo-500/40 bg-[#090e1a] shadow-inner flex items-center justify-center">
                  {selectedProductForEdit.bannerImage ? (
                    <Image
                      src={selectedProductForEdit.bannerImage}
                      alt="Banner Preview"
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">Banner 16:9</span>
                  )}
                </div>
                <div className="flex-1">
                  <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-500/40 bg-indigo-500/5 hover:bg-indigo-500/15 hover:border-indigo-400 px-3 py-2 cursor-pointer transition text-center group">
                    <span className="text-xs text-indigo-300 font-bold flex items-center gap-1.5 group-hover:scale-105 transition">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Ganti Banner Promosi</span>
                    </span>
                    <span className="text-[9.5px] text-slate-400 mt-0.5">Format JPG, PNG, WebP (16:9 Landscape)</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          const reader = new FileReader();
                          reader.onload = (uploadEvent) => {
                            if (uploadEvent.target?.result) {
                              setSelectedProductForEdit({
                                ...selectedProductForEdit,
                                bannerImage: String(uploadEvent.target.result),
                              });
                              showToast(`Banner ${file.name} berhasil diperbarui!`);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 px-5 sm:px-6 py-3.5 border-t border-[#1e293b] bg-[#090e1a]/95 backdrop-blur shrink-0">
            <button
              type="button"
              onClick={() => setShowEditProductModal(false)}
              className="rounded-xl border border-[#22314e] bg-[#0f172a] px-4 py-2 text-slate-300 hover:bg-white/5 hover:text-white transition font-medium cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2 font-bold text-white shadow-lg shadow-blue-600/30 transition active:scale-95 cursor-pointer disabled:opacity-70"
            >
              {isSubmitting ? "Menyiapkan naskah host..." : "Simpan Perubahan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
