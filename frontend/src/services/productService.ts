import { BackendProduct, CsvRawItem } from "@/app/dashboard/types";

export interface CreateProductPayload {
  name: string;
  price: number;
  stock: number;
  category: string;
  sku?: string;
  image: string;
  bannerImage?: string;
  link?: string;
  description: string;
  benefits?: string;
  usage?: string;
}

export const productService = {
  async fetchProducts(): Promise<BackendProduct[]> {
    const res = await fetch("/api/products");
    if (!res.ok) throw new Error("Gagal mengambil data produk");
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      return json.data;
    }
    return [];
  },

  async createProduct(payload: CreateProductPayload): Promise<BackendProduct> {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || "Gagal menyimpan produk");
    }
    return result.data as BackendProduct;
  },

  async updateProduct(
    id: string,
    payload: Partial<CreateProductPayload>,
  ): Promise<BackendProduct> {
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || "Gagal memperbarui produk");
    }
    return result.data as BackendProduct;
  },

  async deleteProduct(id: string): Promise<boolean> {
    const res = await fetch(`/api/products/${id}`, {
      method: "DELETE",
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || "Gagal menghapus produk");
    }
    return true;
  },

  async bulkImport(rawItems: CsvRawItem[]): Promise<BackendProduct[]> {
    const res = await fetch("/api/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: rawItems }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || "Gagal mengimpor produk");
    }
    return (result.data as BackendProduct[]) || [];
  },
};
