import { dashboardPlatforms } from "@/lib/brand-assets";
import { Avatar, Product } from "@/app/dashboard/types";
import { TtsLangCode } from "@/app/dashboard/constants";

export interface LiveValidationContext {
  products: Product[];
  activeProduct: Product;
  avatar: Avatar;
  voice: string;
  language: TtsLangCode;
  background: string;
  platform: string;
  duration: number;
}

export interface LiveValidationResult {
  valid: boolean;
  message?: string;
}

const validDurations = new Set([1, 2, 8, 24]);

export function validateLiveStep(step: 1 | 2 | 3, context: LiveValidationContext): LiveValidationResult {
  if (step === 1) {
    if (context.products.length === 0 || context.activeProduct.id === "loading") {
      return { valid: false, message: "Tambahkan minimal satu produk sebelum lanjut ke AI Host." };
    }
    if (!context.activeProduct.name?.trim()) {
      return { valid: false, message: "Nama produk wajib diisi sebelum lanjut." };
    }
    if (!context.activeProduct.description?.trim()) {
      return { valid: false, message: "Deskripsi produk wajib diisi sebelum lanjut." };
    }
    return { valid: true };
  }

  if (step === 2) {
    if (!context.avatar?.id || !context.avatar.name?.trim()) {
      return { valid: false, message: "Pilih AI Host terlebih dahulu." };
    }
    if (!context.voice?.trim()) {
      return { valid: false, message: "Pilih suara AI Host terlebih dahulu." };
    }
    if (!context.language) {
      return { valid: false, message: "Pilih bahasa AI Host terlebih dahulu." };
    }
    if (!context.background?.trim()) {
      return { valid: false, message: "Pilih background untuk siaran terlebih dahulu." };
    }
    return { valid: true };
  }

  if (!dashboardPlatforms.some((item) => item.value === context.platform)) {
    return { valid: false, message: "Pilih platform siaran yang valid." };
  }
  if (!validDurations.has(context.duration)) {
    return { valid: false, message: "Pilih durasi live yang tersedia sebelum lanjut." };
  }
  if (context.products.length === 0) {
    return { valid: false, message: "Katalog siaran belum memiliki produk." };
  }

  return { valid: true };
}

export function validateLivePreparation(context: LiveValidationContext): LiveValidationResult {
  for (const step of [1, 2, 3] as const) {
    const result = validateLiveStep(step, context);
    if (!result.valid) return result;
  }
  return { valid: true };
}
