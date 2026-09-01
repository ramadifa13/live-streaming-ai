export const PRODUCT_CATEGORIES = [
  "Umum",
  "Skincare",
  "Beauty & Makeup",
  "Fashion & Pakaian",
  "Hijab & Muslim",
  "Kesehatan & Herbal",
  "Elektronik & Gadget",
  "Makanan & Minuman",
  "Ibu & Bayi",
  "Perlengkapan Rumah",
  "Aksesoris & Sepatu",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(PRODUCT_CATEGORIES);

/** Normalisasi kategori legacy (General/Lainnya) ke kategori valid. */
export function normalizeProductCategory(raw?: string | null): ProductCategory {
  const value = String(raw || "").trim();
  if (CATEGORY_SET.has(value)) return value as ProductCategory;
  if (/^general$/i.test(value) || /^lainnya$/i.test(value)) return "Umum";
  return "Umum";
}
