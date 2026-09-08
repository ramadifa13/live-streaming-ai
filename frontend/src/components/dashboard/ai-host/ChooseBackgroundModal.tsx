/* eslint-disable react-hooks/refs */
"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import { X, Upload, Crop, Check, Sparkles, RotateCcw, Image as ImageIcon, Layers, Trash2 } from "lucide-react";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { useAiHostStore } from "@/stores/useAiHostStore";
import { DEFAULT_BACKGROUNDS } from "@/app/dashboard/constants";

export const ChooseBackgroundModal: React.FC = () => {
  const show = useDashboardUIStore((state) => state.showChooseBackgroundModal);
  const setShow = useDashboardUIStore((state) => state.setShowChooseBackgroundModal);
  const showToast = useDashboardUIStore((state) => state.showToast);

  const selectedBackground = useAiHostStore((state) => state.selectedBackground);
  const customBackgrounds = useAiHostStore((state) => state.customBackgrounds);
  const setSelectedBackground = useAiHostStore((state) => state.setSelectedBackground);
  const addCustomBackground = useAiHostStore((state) => state.addCustomBackground);
  const removeCustomBackground = useAiHostStore((state) => state.removeCustomBackground);

  // Tab state untuk memisahkan "Default" dan "Custom / Upload" agar tidak panjang ke bawah
  const [activeTab, setActiveTab] = useState<"default" | "custom">("default");

  // Image Cropper states
  const [rawUploadSrc, setRawUploadSrc] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const TARGET_ASPECT = 9 / 16;
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dragging states
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [initialCropPos, setInitialCropPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState<{
    clientX: number;
    clientY: number;
    cropBox: typeof cropBox;
  } | null>(null);

  if (!show) return null;

  const handleClose = () => {
    setRawUploadSrc(null);
    setImageLoaded(false);
    setShow(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("File harus berupa gambar (JPG, PNG, WebP).", "warning");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (src) {
        const img = new window.Image();
        img.onload = () => {
          setNaturalSize({ width: img.width, height: img.height });

          let cropW = img.width;
          let cropH = cropW / TARGET_ASPECT;

          if (cropH > img.height) {
            cropH = img.height;
            cropW = cropH * TARGET_ASPECT;
          }

          const cropX = (img.width - cropW) / 2;
          const cropY = (img.height - cropH) / 2;

          setCropBox({
            x: Math.round(cropX),
            y: Math.round(cropY),
            width: Math.round(cropW),
            height: Math.round(cropH),
          });

          setImageLoaded(false);
          setRawUploadSrc(src);
        };
        img.src = src;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setInitialCropPos({ x: cropBox.x, y: cropBox.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !imagePreviewRef.current || naturalSize.width === 0) return;

    const displayRect = imagePreviewRef.current.getBoundingClientRect();
    const scale = naturalSize.width / displayRect.width;

    const deltaX = (e.clientX - dragStart.x) * scale;
    const deltaY = (e.clientY - dragStart.y) * scale;

    let newX = initialCropPos.x + deltaX;
    let newY = initialCropPos.y + deltaY;

    newX = Math.max(0, Math.min(newX, naturalSize.width - cropBox.width));
    newY = Math.max(0, Math.min(newY, naturalSize.height - cropBox.height));

    setCropBox((prev) => ({
      ...prev,
      x: Math.round(newX),
      y: Math.round(newY),
    }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setResizeStart(null);
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizeStart({ clientX: e.clientX, clientY: e.clientY, cropBox });
  };

  const handleResizeMove = (e: React.MouseEvent) => {
    if (!resizeStart || !imagePreviewRef.current || naturalSize.width === 0) return;

    const displayRect = imagePreviewRef.current.getBoundingClientRect();
    const scale = naturalSize.width / displayRect.width;
    const deltaX = (e.clientX - resizeStart.clientX) * scale;
    const deltaY = (e.clientY - resizeStart.clientY) * scale;
    const start = resizeStart.cropBox;
    const maxWidth = Math.min(naturalSize.width - start.x, (naturalSize.height - start.y) * TARGET_ASPECT);
    const widthFromX = start.width + deltaX;
    const widthFromY = start.width + deltaY * TARGET_ASPECT;
    const nextWidth = Math.min(maxWidth, Math.max(20, Math.max(widthFromX, widthFromY)));
    const nextHeight = nextWidth / TARGET_ASPECT;

    setCropBox((prev) => ({ ...prev, width: Math.round(nextWidth), height: Math.round(nextHeight) }));
  };

  const handleApplyCropAndSave = () => {
    if (!rawUploadSrc || naturalSize.width === 0) return;

    const img = new window.Image();
    img.onload = () => {
      const outW = 720;
      const outH = 1280;
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        showToast("Gagal memproses crop gambar.", "error");
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.drawImage(img, cropBox.x, cropBox.y, cropBox.width, cropBox.height, 0, 0, outW, outH);

      const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.88);
      addCustomBackground(croppedDataUrl);
      setSelectedBackground(croppedDataUrl);
      setRawUploadSrc(null);
      setImageLoaded(false);
      showToast("Background custom (9:16) berhasil dipotong & dipilih!", "success");
    };
    img.src = rawUploadSrc;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fadeIn select-none"
      onMouseMove={(e) => {
        handleMouseMove(e);
        handleResizeMove(e);
      }}
      onMouseUp={handleMouseUp}
    >
      {/* Modal Utama Dibuat Lebar (max-w-4xl) & Fix Tinggi Tanpa Scroll */}
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-[#0c1221] shadow-2xl flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-[#0c1221]/90 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Pengaturan Background Siaran Live
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Rasio 9:16 Portrait
                </span>
              </h3>
              <p className="text-xs text-slate-400">Pilih studio bawaan atau unggah background kustom Anda sendiri.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition active:scale-95 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs (Menggantikan Tumpukan Vertikal ke Bawah) */}
        <div className="flex items-center px-6 pt-3 border-b border-slate-800/60 bg-[#080d1a] gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab("default");
              setRawUploadSrc(null);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-t border-x transition cursor-pointer ${
              activeTab === "default"
                ? "bg-[#0c1221] border-slate-700 text-blue-400 shadow-sm"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Background Bawaan ({DEFAULT_BACKGROUNDS.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-t border-x transition cursor-pointer ${
              activeTab === "custom"
                ? "bg-[#0c1221] border-slate-700 text-indigo-400 shadow-sm"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="w-4 h-4" />
            Custom & Upload ({customBackgrounds.length})
          </button>
        </div>

        {/* Content Body (Grid Dua Kolom / Split View agar muat tanpa Scroll) */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 bg-[#0c1221] items-center">
          {/* TAB 1: BACKGROUND BAWAAN */}
          {activeTab === "default" && (
            <>
              <div className="md:col-span-8 grid grid-cols-4 gap-3">
                {DEFAULT_BACKGROUNDS.map((bg) => {
                  const isSelected = selectedBackground === bg.url;
                  return (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => {
                        setSelectedBackground(bg.url);
                        showToast(`Background dipilih: ${bg.name}`, "success");
                      }}
                      className={`group relative aspect-[9/16] rounded-xl overflow-hidden border text-left transition cursor-pointer shadow-md ${
                        isSelected
                          ? "border-blue-400 ring-2 ring-blue-500/50 scale-[1.02]"
                          : "border-slate-800 hover:border-slate-500 opacity-80 hover:opacity-100"
                      }`}
                    >
                      <Image
                        src={bg.preview}
                        alt={bg.name}
                        fill
                        unoptimized
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-2">
                        <p className="text-[11px] font-bold text-white leading-tight truncate">{bg.name}</p>
                        <p className="text-[9px] text-slate-300">{bg.category}</p>
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live Preview Panel (Kanan) */}
              <div className="md:col-span-4 bg-[#080d1a] border border-slate-800/80 rounded-2xl p-5 flex flex-col items-center justify-center text-center">
                <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-3">
                  Status Pilihan Aktif
                </p>
                <div className="relative w-32 aspect-[9/16] rounded-xl overflow-hidden border-2 border-blue-500/40 shadow-xl mb-4 bg-black">
                  <Image
                    src={
                      selectedBackground.startsWith("data:")
                        ? selectedBackground
                        : DEFAULT_BACKGROUNDS.find((b) => b.url === selectedBackground)?.preview || selectedBackground
                    }
                    alt="Active Preview"
                    fill
                    unoptimized
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-xs font-semibold text-white truncate max-w-full px-2">
                  {selectedBackground.startsWith("data:")
                    ? "Custom Background Aktif"
                    : DEFAULT_BACKGROUNDS.find((b) => b.url === selectedBackground)?.name || "Pilihan Siaran"}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Siap digunakan untuk live streaming interaktif Anda.</p>
              </div>
            </>
          )}

          {/* TAB 2: CUSTOM BACKGROUND & CROPPER */}
          {activeTab === "custom" && (
            <div className="md:col-span-12">
              {!rawUploadSrc ? (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                  {/* Upload Box */}
                  <div className="md:col-span-5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-56 flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-700 hover:border-indigo-400 bg-[#080d1a] rounded-2xl transition cursor-pointer group shadow-inner"
                    >
                      <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 group-hover:bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 transition shadow">
                        <Upload className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-bold text-white group-hover:text-indigo-300 transition">
                        Upload Background Baru
                      </p>
                      <p className="text-xs text-slate-400 mt-1 text-center px-4">
                        Format JPG/PNG. Otomatis dipandu pemotongan rasio 9:16.
                      </p>
                    </button>
                  </div>

                  {/* List Riwayat Custom */}
                  <div className="md:col-span-7 bg-[#080d1a] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-56">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-300">
                          Riwayat Custom Tersimpan ({customBackgrounds.length})
                        </span>
                        <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                          Koleksi Anda
                        </span>
                      </div>
                      {customBackgrounds.length === 0 ? (
                        <div className="h-32 flex flex-col items-center justify-center text-slate-500 text-xs text-center">
                          <Layers className="w-8 h-8 mb-2 opacity-30" />
                          Belum ada background kustom yang diunggah.
                        </div>
                      ) : (
                        <div className="grid grid-cols-5 gap-2 overflow-y-auto max-h-36 pr-1 custom-modal-scrollbar">
                          {customBackgrounds.map((bgUrl, i) => {
                            const isSelected = selectedBackground === bgUrl;
                            return (
                              <div
                                key={i}
                                className={`group relative aspect-[9/16] rounded-lg overflow-hidden border transition cursor-pointer ${
                                  isSelected
                                    ? "border-indigo-400 ring-2 ring-indigo-500/50 scale-105"
                                    : "border-slate-800 hover:border-slate-500"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedBackground(bgUrl);
                                    showToast("Background custom dipilih!", "success");
                                  }}
                                  className="absolute inset-0"
                                >
                                  <Image
                                    src={bgUrl}
                                    alt={`Custom ${i}`}
                                    fill
                                    unoptimized
                                    sizes="20vw"
                                    className="object-cover"
                                  />
                                </button>
                                {isSelected && (
                                  <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow">
                                    <Check className="w-2.5 h-2.5" />
                                  </div>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Hapus custom background ${i + 1}`}
                                  title="Hapus background"
                                  onClick={() => {
                                    removeCustomBackground(bgUrl);
                                    showToast("Background custom dihapus.", "success");
                                  }}
                                  className="absolute bottom-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-red-300/30 bg-red-950/80 text-red-200 shadow hover:bg-red-700"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Cropper Studio Mode */
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center bg-[#080d1a] border border-slate-800 p-4 rounded-2xl">
                  <div className="md:col-span-8 flex flex-col items-center">
                    <div
                      ref={containerRef}
                      className="relative w-full h-[280px] bg-black/90 rounded-xl overflow-hidden border border-slate-700 flex items-center justify-center"
                    >
                      <Image
                        ref={imagePreviewRef}
                        src={rawUploadSrc}
                        alt="To Crop"
                        width={naturalSize.width || 1}
                        height={naturalSize.height || 1}
                        unoptimized
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                          setImageLoaded(true);
                        }}
                        className="max-h-full max-w-full object-contain pointer-events-none"
                        draggable={false}
                      />

                      {imageLoaded && imagePreviewRef.current && naturalSize.width > 0 && (
                        <div
                          onMouseDown={handleMouseDown}
                          className="absolute border-2 border-indigo-400 bg-indigo-500/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] cursor-move transition-shadow"
                          style={{
                            left: `${
                              imagePreviewRef.current.offsetLeft +
                              (cropBox.x / naturalSize.width) * imagePreviewRef.current.clientWidth
                            }px`,
                            top: `${
                              imagePreviewRef.current.offsetTop +
                              (cropBox.y / naturalSize.height) * imagePreviewRef.current.clientHeight
                            }px`,
                            width: `${(cropBox.width / naturalSize.width) * imagePreviewRef.current.clientWidth}px`,
                            height: `${(cropBox.height / naturalSize.height) * imagePreviewRef.current.clientHeight}px`,
                          }}
                        >
                          <div className="absolute top-1 left-1.5 bg-black/80 text-[9px] text-indigo-300 font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">
                            Area 9:16 Live Canvas
                          </div>
                          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none border border-white/20 divide-x divide-y divide-white/15" />
                          <button
                            type="button"
                            aria-label="Perbesar atau perkecil area crop"
                            onMouseDown={handleResizeStart}
                            className="absolute bottom-[-7px] right-[-7px] h-4 w-4 rounded-full border-2 border-white bg-indigo-500 shadow-lg cursor-se-resize"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-4 flex flex-col justify-between h-full space-y-4">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5 mb-1">
                        <Crop className="w-4 h-4 text-indigo-400" /> Penyesuaian Area Gambar
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Geser kotak vertikal di sebelah kiri untuk menentukan komposisi optimal siaran Anda.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={handleApplyCropAndSave}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Check className="w-4 h-4" /> Simpan &amp; Terapkan 9:16
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRawUploadSrc(null);
                          setImageLoaded(false);
                        }}
                        className="w-full py-2 rounded-xl border border-slate-700 bg-slate-800/80 text-xs text-slate-300 hover:bg-slate-700 transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Ganti File Gambar Lain
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-[#0c1221] shrink-0">
          <div className="text-xs text-slate-400 truncate flex items-center gap-2">
            <span>Status Pilihan:</span>
            <span className="text-white font-semibold bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {selectedBackground.startsWith("data:")
                ? "Custom Background (9:16)"
                : DEFAULT_BACKGROUNDS.find((b) => b.url === selectedBackground)?.name || "Default Studio"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition active:scale-95 shadow-md shadow-blue-600/30 cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
