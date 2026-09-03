"use client";

import React, { useMemo, useState } from "react";
import { X, ScrollText, Loader2 } from "lucide-react";
import { useProductStore } from "@/stores/useProductStore";
import { useDashboardUIStore } from "@/stores/useDashboardUIStore";
import { getScriptBankMeta } from "@/lib/script-bank";

const TOPIC_LABELS: Record<string, string> = {
  benefit: "Manfaat",
  problem: "Masalah",
  how_to_use: "Cara pakai",
  value: "Value",
  faq: "FAQ",
  objection: "Keberatan",
  promo_pitch: "Promo",
  soft_cta: "CTA",
  social_engagement: "Engage",
  filler: "Filler",
  catalog_bridge: "Bridge",
  buyer_fit: "Cocok untuk",
  micro_tip: "Tips",
  closing_loop: "Closing",
  banner_callout: "Banner",
};

function topicLabel(topic?: string): string {
  if (!topic) return "Umum";
  return TOPIC_LABELS[topic] || topic.replace(/_/g, " ");
}

export const ScriptBankPreviewModal: React.FC = () => {
  const showScriptBankModal = useDashboardUIStore((state) => state.showScriptBankModal);
  const setShowScriptBankModal = useDashboardUIStore((state) => state.setShowScriptBankModal);

  const activeFeaturedProduct = useProductStore((state) => state.activeFeaturedProduct);
  const scriptBankPreparingIds = useProductStore((state) => state.scriptBankPreparingIds);

  const [filterTopic, setFilterTopic] = useState<string>("ALL");

  const bankMeta = getScriptBankMeta(activeFeaturedProduct, scriptBankPreparingIds);
  const lines = useMemo(
    () => activeFeaturedProduct.scriptBank || [],
    [activeFeaturedProduct.scriptBank],
  );
  const productLabel =
    activeFeaturedProduct.id === "loading" || !activeFeaturedProduct.name
      ? "Pilih produk dulu"
      : activeFeaturedProduct.name;

  const topics = useMemo(() => {
    const set = new Set(lines.map((l) => l.topic || "umum"));
    return ["ALL", ...Array.from(set).sort()];
  }, [lines]);

  const filtered = useMemo(() => {
    if (filterTopic === "ALL") return lines;
    return lines.filter((l) => (l.topic || "umum") === filterTopic);
  }, [lines, filterTopic]);

  if (!showScriptBankModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl border border-purple-500/40 bg-[#0c1221] p-5 shadow-2xl max-h-[85vh] flex flex-col">
        <button
          type="button"
          onClick={() => setShowScriptBankModal(false)}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-3 border-b border-[#232c42] pb-3 shrink-0">
          <ScrollText className="w-6 h-6 text-purple-400" />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white">Preview Script Bank Host</h3>
            <p className="text-[11px] text-slate-400 truncate">
              Ucapan otonom saat live · {productLabel} · {bankMeta.label}
            </p>
          </div>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${bankMeta.colorClass}`}>
            {lines.length} baris
          </span>
        </div>

        {topics.length > 1 && (
          <div className="flex flex-wrap gap-1 mb-3 shrink-0">
            {topics.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => setFilterTopic(topic)}
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold border transition cursor-pointer ${
                  filterTopic === topic
                    ? "border-purple-500 bg-purple-500/20 text-purple-200"
                    : "border-[#232c42] text-slate-400 hover:text-slate-200"
                }`}
              >
                {topic === "ALL" ? "Semua" : topicLabel(topic)}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-modal-scrollbar min-h-0">
          {bankMeta.status === "preparing" ? (
            <div className="py-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400 mb-2" />
              <p className="text-xs text-slate-400">Menyiapkan script bank...</p>
            </div>
          ) : filtered.length > 0 ? (
            filtered.map((line, idx) => (
              <div
                key={`${line.topic}-${idx}-${line.speech.slice(0, 12)}`}
                className="rounded-xl border border-[#232c42] bg-[#111827] p-3"
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400">
                  {topicLabel(line.topic)}
                  {line.mode ? ` · ${line.mode}` : ""}
                </span>
                <p className="text-xs text-slate-200 leading-relaxed mt-1">&ldquo;{line.speech}&rdquo;</p>
              </div>
            ))
          ) : (
            <p className="text-center text-xs text-slate-500 py-8">
              Belum ada naskah. Script bank otomatis dibuat saat tambah atau edit produk dengan deskripsi lengkap.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end pt-3 border-t border-[#232c42] shrink-0">
          <button
            type="button"
            onClick={() => setShowScriptBankModal(false)}
            className="rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:brightness-110 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
