import { create } from "zustand";
import { BackendProduct, Product } from "@/app/dashboard/types";
import { productService } from "@/services/productService";
import { parseProductCsv } from "@/utils/csvParser";

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

function mapBackendProduct(p: BackendProduct): Product {
  const numPrice =
    typeof p.price === "number"
      ? p.price
      : parseInt(String(p.price).replace(/[^0-9]/g, ""), 10) || 0;
  return {
    id: p.id,
    name: p.name,
    price: `Rp${numPrice.toLocaleString("id-ID")}`,
    stock: p.stock ?? 0,
    tag: p.category || "General",
    sku: p.sku || "",
    image: p.image || "",
    bannerImage: p.bannerImage || "",
    link: p.link || "",
    description: p.description || "",
    benefits: p.benefits || "",
    usage: p.usage || "",
    faq: p.faq || "",
    targetAudience: p.targetAudience || "",
    copywriting: p.copywriting || "",
  };
}

export const useProductStore = create<ProductState>((set, get) => ({
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
    set({ isLoadingProducts: true });
    try {
      const backendProds = await productService.fetchProducts();
      const mapped = backendProds.map(mapBackendProduct);
      set({ products: mapped });
      if (mapped.length > 0 && get().activeFeaturedProduct.id === "loading") {
        set({ activeFeaturedProduct: mapped[0] });
      }
    } catch (err) {
      console.error("Failed to load products:", err);
    } finally {
      set({ isLoadingProducts: false });
    }
  },

  createProduct: async () => {
    const form = get().newProductForm;
    if (!form.image) throw new Error("Foto / gambar produk wajib diisi.");
    if (!form.name.trim()) throw new Error("Nama produk wajib diisi.");
    const numPrice = parseInt(String(form.price).replace(/\D/g, ""), 10) || 0;
    if (numPrice <= 0) throw new Error("Harga jual live (Rp) wajib diisi dengan angka valid.");
    if (!form.tag) throw new Error("Kategori produk wajib dipilih.");
    if (!form.description.trim()) throw new Error("Deskripsi lengkap produk wajib diisi.");

    const payload = {
      name: form.name.trim(),
      price: numPrice,
      stock: Number(form.stock) || 0,
      category: form.tag || "General",
      sku: form.sku ? form.sku.trim() : "",
      image: form.image,
      bannerImage: form.bannerImage || "",
      link: form.link ? form.link.trim() : "",
      description: form.description.trim(),
      benefits: form.benefits ? form.benefits.trim() : "",
      usage: form.usage ? form.usage.trim() : "",
    };

    const saved = await productService.createProduct(payload);
    const newProd = mapBackendProduct(saved);

    set((state) => ({
      products: [newProd, ...state.products],
      activeFeaturedProduct: newProd,
      newProductForm: initialProductForm,
    }));

    return newProd;
  },

  saveEditedProduct: async () => {
    const editProd = get().selectedProductForEdit;
    if (!editProd || !editProd.id) throw new Error("Produk tidak ditemukan.");
    if (!editProd.image) throw new Error("Foto / gambar produk wajib diisi.");
    if (!editProd.name?.trim()) throw new Error("Nama produk wajib diisi.");

    const numPrice =
      typeof editProd.price === "number"
        ? editProd.price
        : parseInt(String(editProd.price).replace(/\D/g, ""), 10) || 0;
    if (numPrice <= 0) throw new Error("Harga jual live (Rp) wajib diisi dengan angka valid.");
    if (!editProd.tag) throw new Error("Kategori produk wajib dipilih.");
    if (!editProd.description?.trim()) throw new Error("Deskripsi lengkap produk wajib diisi.");

    const payload = {
      name: editProd.name.trim(),
      price: numPrice,
      stock: Number(editProd.stock) || 0,
      category: editProd.tag || "General",
      sku: editProd.sku || "",
      image: editProd.image,
      bannerImage: editProd.bannerImage || "",
      link: editProd.link || "",
      description: editProd.description.trim(),
      benefits: editProd.benefits || "",
      usage: editProd.usage || "",
    };

    await productService.updateProduct(editProd.id, payload);

    const formattedProduct: Product = {
      ...editProd,
      name: payload.name,
      price: `Rp${numPrice.toLocaleString("id-ID")}`,
      stock: payload.stock,
      tag: payload.category,
      sku: payload.sku,
      image: payload.image,
      bannerImage: payload.bannerImage,
      link: payload.link,
      description: payload.description,
      benefits: payload.benefits,
      usage: payload.usage,
    };

    set((state) => ({
      products: state.products.map((p) =>
        p.id === editProd.id ? formattedProduct : p,
      ),
      activeFeaturedProduct:
        state.activeFeaturedProduct.id === editProd.id
          ? formattedProduct
          : state.activeFeaturedProduct,
      selectedProductForEdit: null,
    }));

    return formattedProduct;
  },

  deleteProduct: async (id?: string) => {
    if (!id) return false;
    await productService.deleteProduct(id);

    set((state) => {
      const next = state.products.filter((p) => p.id !== id);
      let newFeatured = state.activeFeaturedProduct;
      if (state.activeFeaturedProduct.id === id) {
        newFeatured = next.length > 0 ? next[0] : defaultFeaturedProduct;
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

    const result = await productService.bulkImport(rawItems);
    const imported = result.map(mapBackendProduct);

    set((state) => ({
      products: [...imported, ...state.products],
      activeFeaturedProduct:
        imported.length > 0 ? imported[0] : state.activeFeaturedProduct,
      csvText: "",
    }));

    return imported.length;
  },
}));

