import { Product } from "@/app/dashboard/types";

export type ScriptBankStatus = "preparing" | "ready" | "local-only" | "empty";

export interface ScriptBankMeta {
  status: ScriptBankStatus;
  lineCount: number;
  label: string;
  colorClass: string;
}

export function getScriptBankMeta(
  product: Product,
  preparingIds: string[] = [],
): ScriptBankMeta {
  const id = product.id || "";
  const lineCount = product.scriptBank?.length || 0;

  if (id && preparingIds.includes(id)) {
    return {
      status: "preparing",
      lineCount,
      label: "Menyiapkan...",
      colorClass: "text-amber-300 bg-amber-500/15 border-amber-500/30",
    };
  }

  if (lineCount >= 40) {
    return {
      status: "ready",
      lineCount,
      label: `${lineCount} naskah`,
      colorClass: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
    };
  }

  if (lineCount > 0) {
    return {
      status: "ready",
      lineCount,
      label: `${lineCount} naskah`,
      colorClass: "text-blue-300 bg-blue-500/15 border-blue-500/30",
    };
  }

  if (product.description?.trim()) {
    return {
      status: "local-only",
      lineCount: 0,
      label: "Lokal saat live",
      colorClass: "text-slate-300 bg-slate-500/15 border-slate-500/30",
    };
  }

  return {
    status: "empty",
    lineCount: 0,
    label: "Belum siap",
    colorClass: "text-rose-300 bg-rose-500/15 border-rose-500/30",
  };
}
