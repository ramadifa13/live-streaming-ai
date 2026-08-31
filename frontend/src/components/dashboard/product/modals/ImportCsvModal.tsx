"use client";

import React, { useEffect, useState } from "react";
import { X, FileSpreadsheet, Upload } from "lucide-react";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useLiveSessionStore } from "@/stores/useLiveSessionStore";

export const ImportCsvModal: React.FC = () => {
  const showCsvModal = useDashboardUIStore((state) => state.showCsvModal);
  const setShowCsvModal = useDashboardUIStore((state) => state.setShowCsvModal);
  const showToast = useDashboardUIStore((state) => state.showToast);
  const isLiveActive = useLiveSessionStore((state) => state.isLiveActive);

  const csvText = useProductStore((state) => state.csvText);
  const setCsvText = useProductStore((state) => state.setCsvText);
  const importCsvProducts = useProductStore((state) => state.importCsvProducts);

  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (showCsvModal && isLiveActive) {
      setShowCsvModal(false);
      showToast("Produk tidak bisa ditambah saat live sedang aktif. Akhiri live dulu.");
    }
  }, [showCsvModal, isLiveActive, setShowCsvModal, showToast]);

  if (!showCsvModal || isLiveActive) return null;

  const handleImport = async () => {
    if (isLiveActive) {
      showToast("Produk tidak bisa ditambah saat live sedang aktif. Akhiri live dulu.");
      return;
    }
    setIsImporting(true);
    try {
      const count = await importCsvProducts();
      setShowCsvModal(false);
      showToast(`${count} produk tersimpan di perangkat ini. Script bank lokal dipakai saat live (tanpa LLM massal).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal mengimpor produk CSV");
    } finally {
      setIsImporting(false);
    }
  };

  const handleInsertSample = () => {
    setCsvText(
      `Toner Wajah Centella Hydrating, 85000, 100, Skincare, Toner penenang kulit kemerahan dan melembapkan, https://shopee.co.id/toner\nLip Cream Velvet Matte 03 Nude, 65000, 150, Beauty, Lip cream tahan 12 jam tidak kering di bibir, https://tiktok.com/@toko/lipcream\nSunscreen Serum SPF 50 PA++++, 95000, 75, Skincare, Perlindungan UV maksimal ringan tanpa whitecast, https://shopee.co.id/sunscreen`,
    );
    showToast("Contoh data CSV disalin!");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-xl rounded-2xl border border-blue-500/40 bg-[#0c1221] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={() => setShowCsvModal(false)}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet className="w-6 h-6 text-blue-400" />
          <h3 className="text-lg font-bold text-white">Import Data Produk Massal (CSV)</h3>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Data hanya di browser Anda, tidak ke database server. Format:{" "}
          <code className="text-blue-300">Nama Produk, Harga, Stok, Kategori, Deskripsi, Link</code>
        </p>

        <div className="mb-3 flex justify-between items-center text-[11px]">
          <span className="text-slate-400">Tempel teks CSV atau upload file .csv:</span>
          <button
            type="button"
            onClick={handleInsertSample}
            className="text-blue-400 hover:underline font-semibold cursor-pointer"
          >
            + Isi Contoh Data CSV
          </button>
        </div>

        <textarea
          rows={5}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="Contoh:&#10;Toner Wajah Centella, 85000, 100, Skincare, Menenangkan kulit kemerahan&#10;Lip Cream Velvet Matte, 65000, 150, Beauty, Tahan 12 jam"
          className="w-full rounded-xl bg-[#111827] border border-[#232c42] p-3 text-xs text-white outline-none font-mono focus:border-blue-500 mb-3"
        />

        <div className="flex justify-between items-center pt-2 border-t border-[#232c42]">
          <label className="cursor-pointer text-xs text-blue-400 hover:underline font-semibold flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            <span>Pilih file .csv/.txt</span>
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => setCsvText(event.target?.result as string);
                  reader.readAsText(file);
                }
              }}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCsvModal(false)}
              className="rounded-lg border border-[#232c42] px-4 py-2 text-xs text-slate-300 hover:bg-white/5 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isImporting}
              onClick={handleImport}
              className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 shadow-md shadow-blue-600/30 cursor-pointer disabled:opacity-70"
            >
              {isImporting ? "Mengimpor..." : "Import ke RAG Database"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
