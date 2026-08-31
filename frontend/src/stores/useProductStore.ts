import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Product } from "@/app/dashboard/types";
import { parseProductCsv } from "@/utils/csvParser";
import { aiService } from "@/services/aiService";
import { normalizeProductCategory } from "@/lib/product-categories";

export interface NewProductFormData {
  name: string;
  price: string;
  stock: number;
  tag: string;
  sku: string;
  image: string;
  bannerImage: string;
  link: string;
  description: string;
  benefits: string;
  usage: string;
  faq: string;
}

const initialProductForm: NewProductFormData = {
  name: "",
  price: "",
  stock: 0,
  tag: "Skincare",
  sku: "",
  image: "",
  bannerImage: "",
  link: "",
  description: "",
  benefits: "",
  usage: "",
  faq: "",
};

const defaultFeaturedProduct: Product = {
  id: "loading",
  name: "Memuat Produk...",
  price: "Rp0",
  stock: 0,
  tag: "Loading",
  image: "",
  link: "",
};

interface ProductState {
  products: Product[];
  searchQuery: string;
  productCategoryFilter: string;
  selectedProductForEdit: Product | null;
  activeFeaturedProduct: Product;
  pinnedProductIds: string[];
  csvText: string;
  newProductForm: NewProductFormData;
  isLoadingProducts: boolean;

  setSearchQuery: (q: string) => void;
  setProductCategoryFilter: (cat: string) => void;
  setSelectedProductForEdit: (prod: Product | null) => void;
  setActiveFeaturedProduct: (prod: Product | ((prev: Product) => Product)) => void;
  setPinnedProductIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  setCsvText: (text: string) => void;
  setNewProductForm: (form: NewProductFormData | Partial<NewProductFormData>) => void;
  resetNewProductForm: () => void;
  setProducts: (products: Product[] | ((prev: Product[]) => Product[])) => void;

  loadProducts: () => Promise<void>;
  createProduct: () => Promise<Product>;
  saveEditedProduct: () => Promise<Product>;
  deleteProduct: (id?: string) => Promise<boolean>;
  importCsvProducts: () => Promise<number>;
}

function newLocalId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `local_${crypto.randomUUID()}`;
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatPrice(numPrice: number): string {
  return `Rp${numPrice.toLocaleString("id-ID")}`;
}

async function attachScriptBank(product: Product): Promise<Product> {
  try {
    const pack = await aiService.prepareProduct({
      name: product.name,
      price: product.price,
      category: product.tag,
      description: product.description,
      benefits: product.benefits,
      usage: product.usage,
      faq: product.faq,
      stock: product.stock,
      sku: product.sku,
      link: product.link,
      targetAudience: product.targetAudience,
      copywriting: product.copywriting,
      bannerImage: product.bannerImage,
    });
    return {
      ...product,
      scriptBank: pack.scriptBank,
      faqPack: pack.faqPack,
      benefits: product.benefits?.trim() || pack.enriched.benefits || product.benefits,
      usage: product.usage?.trim() || pack.enriched.usage || product.usage,
      faq: product.faq?.trim() || pack.enriched.faq || product.faq,
      targetAudience:
        product.targetAudience?.trim() ||
        pack.enriched.targetAudience ||
        product.targetAudience,
      copywriting:
        product.copywriting?.trim() ||
        pack.enriched.copywriting ||
        product.copywriting,
    };
  } catch (err) {
    console.warn("[ProductStore] Script bank LLM dilewati, pakai generator lokal saat live:", err);
    return product;
  }
}

function applyProductUpdate(
  set: (partial: Partial<ProductState> | ((s: ProductState) => Partial<ProductState>)) => void,
  updated: Product,
) {
  set((state) => ({
    products: state.products.map((p) => (p.id === updated.id ? updated : p)),
    activeFeaturedProduct:
      state.activeFeaturedProduct.id === updated.id ? updated : state.activeFeaturedProduct,
    selectedProductForEdit:
      state.selectedProductForEdit?.id === updated.id ? updated : state.selectedProductForEdit,
  }));
}

function scheduleScriptBankEnrichment(
  set: (partial: Partial<ProductState> | ((s: ProductState) => Partial<ProductState>)) => void,
  product: Product,
) {
  void attachScriptBank(product).then((enriched) => {
    applyProductUpdate(set, enriched);
  });
}

export const useProductStore = create<ProductState>()(
  persist(
    (set, get) => ({
      products: [],
      searchQuery: "",
      productCategoryFilter: "ALL",
      selectedProductForEdit: null,
      activeFeaturedProduct: defaultFeaturedProduct,
      pinnedProductIds: [],
      csvText: "",
      newProductForm: initialProductForm,
      isLoadingProducts: false,

      setSearchQuery: (q) => set({ searchQuery: q }),
      setProductCategoryFilter: (cat) => set({ productCategoryFilter: cat }),
      setSelectedProductForEdit: (prod) => set({ selectedProductForEdit: prod }),
      setActiveFeaturedProduct: (prod) =>
        set((state) => ({
          activeFeaturedProduct:
            typeof prod === "function" ? prod(state.activeFeaturedProduct) : prod,
        })),
      setPinnedProductIds: (ids) =>
        set((state) => ({
          pinnedProductIds:
            typeof ids === "function" ? ids(state.pinnedProductIds) : ids,
        })),
      setCsvText: (text) => set({ csvText: text }),
      setNewProductForm: (form) =>
        set((state) => ({
          newProductForm: { ...state.newProductForm, ...form },
        })),
      resetNewProductForm: () => set({ newProductForm: initialProductForm }),
      setProducts: (prods) =>
        set((state) => ({
          products: typeof prods === "function" ? prods(state.products) : prods,
        })),

      loadProducts: async () => {
        const { products, activeFeaturedProduct } = get();
        if (products.length > 0 && activeFeaturedProduct.id === "loading") {
          set({ activeFeaturedProduct: products[0]! });
        }
        set({ isLoadingProducts: false });
      },

      createProduct: async () => {
        const form = get().newProductForm;
        if (!form.image) throw new Error("Foto / gambar produk wajib diisi.");
        if (!form.name.trim()) throw new Error("Nama produk wajib diisi.");
        const numPrice = parseInt(String(form.price).replace(/\D/g, ""), 10) || 0;
        if (numPrice <= 0) throw new Error("Harga jual live (Rp) wajib diisi dengan angka valid.");
        if (!form.tag) throw new Error("Kategori produk wajib dipilih.");
        if (form.tag === "General" || form.tag === "Lainnya") {
          throw new Error("Pilih kategori produk yang spesifik.");
        }
        if (!form.description.trim()) throw new Error("Deskripsi lengkap produk wajib diisi.");

        const newProd: Product = {
          id: newLocalId(),
          name: form.name.trim(),
          price: formatPrice(numPrice),
          stock: Number(form.stock) || 0,
          tag: normalizeProductCategory(form.tag),
          sku: form.sku ? form.sku.trim() : "",
          image: form.image,
          bannerImage: form.bannerImage || "",
          link: form.link ? form.link.trim() : "",
          description: form.description.trim(),
          benefits: form.benefits.trim() || undefined,
          usage: form.usage.trim() || undefined,
          faq: form.faq.trim() || undefined,
        };
        set((state) => ({
          products: [newProd, ...state.products],
          activeFeaturedProduct: newProd,
          newProductForm: initialProductForm,
        }));

        scheduleScriptBankEnrichment(set, newProd);

        return newProd;
      },

      saveEditedProduct: async () => {
        const editProd = get().selectedProductForEdit;
        if (!editProd || !editProd.id) throw new Error("Produk tidak ditemukan.");
        if (!editProd.name?.trim()) throw new Error("Nama produk wajib diisi.");

        const numPrice =
          typeof editProd.price === "number"
            ? editProd.price
            : parseInt(String(editProd.price).replace(/\D/g, ""), 10) || 0;
        if (numPrice <= 0) throw new Error("Harga jual live (Rp) wajib diisi dengan angka valid.");
        if (!editProd.tag) throw new Error("Kategori produk wajib dipilih.");
        if (editProd.tag === "General" || editProd.tag === "Lainnya") {
          throw new Error("Pilih kategori produk yang spesifik.");
        }
        if (!editProd.description?.trim()) throw new Error("Deskripsi lengkap produk wajib diisi.");

        const formattedProduct: Product = {
          ...editProd,
          name: editProd.name.trim(),
          price: formatPrice(numPrice),
          stock: Number(editProd.stock) || 0,
          tag: normalizeProductCategory(editProd.tag),
          sku: editProd.sku || "",
          description: editProd.description.trim(),
          benefits: editProd.benefits?.trim() || undefined,
          usage: editProd.usage?.trim() || undefined,
          faq: editProd.faq?.trim() || undefined,
        };
        set((state) => ({
          products: state.products.map((p) =>
            p.id === editProd.id ? formattedProduct : p,
          ),
          activeFeaturedProduct:
            state.activeFeaturedProduct.id === editProd.id
              ? formattedProduct
              : state.activeFeaturedProduct,
          selectedProductForEdit: formattedProduct,
        }));

        scheduleScriptBankEnrichment(set, formattedProduct);

        return formattedProduct;
      },

      deleteProduct: async (id?: string) => {
        if (!id) return false;
        set((state) => {
          const next = state.products.filter((p) => p.id !== id);
          let newFeatured = state.activeFeaturedProduct;
          if (state.activeFeaturedProduct.id === id) {
            newFeatured = next.length > 0 ? next[0]! : defaultFeaturedProduct;
          }
          return {
            products: next,
            activeFeaturedProduct: newFeatured,
          };
        });
        return true;
      },

      importCsvProducts: async () => {
        const rawItems = parseProductCsv(get().csvText);
        if (rawItems.length === 0) throw new Error("Tidak ada data CSV yang valid!");

        const imported: Product[] = rawItems.map((item) => ({
          id: newLocalId(),
          name: item.name,
          price: formatPrice(item.price),
          stock: item.stock,
          tag: normalizeProductCategory(item.category),
          image: item.image || "",
          bannerImage: item.bannerImage || "",
          link: item.link || "",
          description: item.description || "",
          benefits: item.benefits || "",
          usage: item.usage || "",
          faq: item.faq || "",
        }));

        set((state) => ({
          products: [...imported, ...state.products],
          activeFeaturedProduct:
            imported.length > 0 ? imported[0]! : state.activeFeaturedProduct,
          csvText: "",
        }));

        return imported.length;
      },
    }),
    {
      name: "livio-pay-per-use-products",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      partialize: (state) => ({
        products: state.products,
        activeFeaturedProduct: state.activeFeaturedProduct,
        pinnedProductIds: state.pinnedProductIds,
      }),
    },
  ),
);
