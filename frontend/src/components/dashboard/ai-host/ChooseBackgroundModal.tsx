"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  ChevronDown,
  ChevronUp,
  Crop,
  Check,
  Sparkles,
  RotateCcw,
  Image as ImageIcon,
} from "lucide-react";
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

  // Accordion state
  const [isDefaultCollapsed, setIsDefaultCollapsed] = useState(false);

  // Image Cropper states
  const [rawUploadSrc, setRawUploadSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Cropper box coordinates relative to original image size (target aspect ratio 9:16)
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

  if (!show) return null;

  const handleClose = () => {
    setRawUploadSrc(null);
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

          // Inisialisasi kotak crop 9:16 terbesar yang muat di dalam gambar
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

      ctx.drawImage(
        img,
        cropBox.x,
        cropBox.y,
        cropBox.width,
        cropBox.height,
        0,
        0,
        outW,
        outH,
      );

      const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.88);
      addCustomBackground(croppedDataUrl);
      setRawUploadSrc(null);
      showToast("Background custom (9:16) berhasil dipotong & dipilih!", "success");
    };
    img.src = rawUploadSrc;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-fadeIn"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-[#22314e] bg-[#0c1221] shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3.5 border-b border-[#1e293b] shrink-0 bg-[#0c1221]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Pilih Background Siaran Live
              </h3>
              <p className="text-[11px] text-slate-400">
                Pilih studio bawaan atau upload background custom portrait (rasio wajib 9:16).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition active:scale-95 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4 custom-modal-scrollbar">
          {/* SECTION 1: Background Bawaan (Collapse / Accordion) */}
          <div className="rounded-xl border border-[#22314e] bg-[#0f172a]/80 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsDefaultCollapsed(!isDefaultCollapsed)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-white">Background Bawaan Siaran</span>
                <span className="text-[10px] text-slate-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">
                  {DEFAULT_BACKGROUNDS.length} Pilihan
                </span>
              </div>
              {isDefaultCollapsed ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {!isDefaultCollapsed && (
              <div className="p-3 pt-0 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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
                      className={`group relative aspect-[9/16] rounded-xl overflow-hidden border text-left transition cursor-pointer ${
                        isSelected
                          ? "border-blue-400 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/20"
                          : "border-[#2a3754] hover:border-slate-400"
                      }`}
                    >
                      <img
                        src={bg.preview}
                        alt={bg.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-2">
                        <p className="text-[10px] font-bold text-white leading-tight truncate">
                          {bg.name}
                        </p>
                        <p className="text-[8px] text-slate-300">{bg.category}</p>
                      </div>
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: Custom Background & Crop Editor */}
          <div className="rounded-xl border border-[#22314e] bg-[#0f172a]/80 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crop className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-white">Custom Background (Wajib Rasio 9:16)</span>
              </div>
              <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded font-medium">
                Sesuaikan area 9:16 sebelum simpan
              </span>
            </div>

            {/* Jika BELUM ada gambar yang sedang di-crop */}
            {!rawUploadSrc ? (
              <div className="space-y-3">
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
                  className="w-full flex flex-col items-center justify-center p-5 border-2 border-dashed border-[#2a3b5c] hover:border-blue-400/70 bg-[#080d1a] rounded-xl transition cursor-pointer group"
                >
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 group-hover:bg-blue-500/20 text-blue-400 flex items-center justify-center mb-2 transition">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-white group-hover:text-blue-300 transition">
                    Klik untuk Upload Background Custom
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Format gambar bebas (JPG/PNG). Gambar wajib dipotong ke rasio 9:16 sebelum disimpan.
                  </p>
                </button>

                {/* Riwayat Custom Background yang sudah disimpan */}
                {customBackgrounds.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[10px] font-semibold text-slate-400">
                      Background Custom Tersimpan:
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {customBackgrounds.map((bgUrl, i) => {
                        const isSelected = selectedBackground === bgUrl;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setSelectedBackground(bgUrl);
                              showToast("Background custom dipilih!", "success");
                            }}
                            className={`group relative aspect-[9/16] rounded-lg overflow-hidden border transition cursor-pointer ${
                              isSelected
                                ? "border-indigo-400 ring-2 ring-indigo-500/40"
                                : "border-[#2a3754] hover:border-slate-400"
                            }`}
                          >
                            <img src={bgUrl} alt={`Custom ${i}`} className="w-full h-full object-cover" />
                            {isSelected && (
                              <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow">
                                <Check className="w-2.5 h-2.5" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Cropper Mode */
              <div className="space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between bg-blue-950/40 border border-blue-500/20 px-3 py-2 rounded-lg text-[11px] text-blue-200">
                  <span>
                    Geser kotak vertikal untuk memilih area siaran terbaik (Rasio 9:16).
                  </span>
                  <button
                    type="button"
                    onClick={() => setRawUploadSrc(null)}
                    className="text-slate-400 hover:text-white flex items-center gap-1 text-[10px] cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> Ganti Gambar
                  </button>
                </div>

                {/* Canvas Cropper Box */}
                <div
                  ref={containerRef}
                  className="relative w-full h-[290px] bg-black/80 rounded-xl overflow-hidden border border-[#2a3754] flex items-center justify-center select-none"
                >
                  <img
                    ref={imagePreviewRef}
                    src={rawUploadSrc}
                    alt="To Crop"
                    className="max-h-full max-w-full object-contain pointer-events-none"
                    draggable={false}
                  />

                  {imagePreviewRef.current && naturalSize.width > 0 && (
                    <div
                      onMouseDown={handleMouseDown}
                      className="absolute border-2 border-indigo-400 bg-indigo-500/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] cursor-move transition-shadow"
                      style={{
                        left: `${
                          imagePreviewRef.current.offsetLeft +
                          (cropBox.x / naturalSize.width) * imagePreviewRef.current.clientWidth
                        }px`,
                        top: `${
                          imagePreviewRef.current.offsetTop +
                          (cropBox.y / naturalSize.height) * imagePreviewRef.current.clientHeight
                        }px`,
                        width: `${
                          (cropBox.width / naturalSize.width) * imagePreviewRef.current.clientWidth
                        }px`,
                        height: `${
                          (cropBox.height / naturalSize.height) * imagePreviewRef.current.clientHeight
                        }px`,
                      }}
                    >
                      <div className="absolute top-1 left-1.5 bg-black/75 backdrop-blur-xs text-[9px] text-indigo-300 font-bold px-1.5 py-0.5 rounded border border-indigo-500/30">
                        9:16 Live Canvas
                      </div>
                      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none border border-white/20 divide-x divide-y divide-white/15" />
                    </div>
                  )}
                </div>

                {/* Tombol Aksi Crop */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setRawUploadSrc(null)}
                    className="px-3.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyCropAndSave}
                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-xs font-bold text-white shadow-lg shadow-blue-500/25 hover:brightness-110 active:scale-95 transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" /> Simpan &amp; Pilih Background
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3 border-t border-[#1e293b] bg-[#0c1221] shrink-0">
          <div className="text-[11px] text-slate-400 truncate max-w-[320px]">
            Dipilih:{" "}
            <span className="text-white font-medium">
              {selectedBackground.startsWith("data:")
                ? "Custom Background (9:16)"
                : selectedBackground.split("/").pop()}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition active:scale-95 shadow-md shadow-blue-600/30 cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
