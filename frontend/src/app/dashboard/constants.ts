import { Avatar } from "./types";

export const avatars: Avatar[] = [
  {
    id: "1",
    name: "Nana",
    role: "Warm & Friendly",
    type: "2D",
    language: "Bahasa Indonesia",
    voice: "id-ID-GadisNeural",
    image: "/avatars/host_2d_statis_nana.png",
    specialty: "Skincare & Beauty",
  },
  {
    id: "2",
    name: "Namira",
    role: "Energetic Live Host",
    type: "3D",
    language: "Bahasa Indonesia",
    voice: "id-ID-GadisNeural",
    image: "/avatars/host_3d_dinamis_namira.png",
    modelUrl3d: "/models/TufrillaVRM.vrm",
    specialty: "Hard-Selling TikTok Live",
  }
];

export const defaultProducts = [
  {
    id: "prod_01_serum_brightening",
    name: "Serum Brightening Premium",
    description: "Serum pencerah wajah dengan Niacinamide 10% dan Collagen untuk kulit glowing dan kenyal.",
    price: "Rp99.000",
    stock: 120,
    sku: "SKU-SERUM-001",
    tag: "Skincare",
    image: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80",
    link: "https://shopee.co.id/serum-brightening-premium",
  },
  {
    id: "prod_02_moisturizer_glow",
    name: "Moisturizer Glow Natural",
    description: "Pelembab wajah harian dengan Ceramide dan Hyaluronic Acid untuk hidrasi 24 jam.",
    price: "Rp129.000",
    stock: 85,
    sku: "SKU-MOIST-002",
    tag: "Skincare",
    image: "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400&h=400&fit=crop&q=80",
    link: "https://shopee.co.id/moisturizer-glow-natural",
  },
  {
    id: "prod_03_sunscreen_daily",
    name: "Sunscreen Daily Protection",
    description: "Tabir surya SPF 50+ PA++++ tekstur ringan tanpa whitecast, aman untuk kulit berjerawat.",
    price: "Rp79.000",
    stock: 200,
    sku: "SKU-SUN-003",
    tag: "Skincare",
    image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop&q=80",
    link: "https://tiktok.com/@toko/sunscreen-daily",
  },
  {
    id: "prod_04_paket_glowing",
    name: "Paket Glowing Ultimate",
    description: "Paket lengkap 4 in 1: Facial Wash, Toner, Serum, dan Moisturizer harga hemat.",
    price: "Rp199.000",
    stock: 60,
    sku: "SKU-PAKET-004",
    tag: "Paket",
    image: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&fit=crop&q=80",
    link: "https://shopee.co.id/paket-glowing-ultimate",
  }
];
