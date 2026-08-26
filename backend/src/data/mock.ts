export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  sku: string;
  category: string;
  imageUrl: string;
  featured: boolean;
};

export const products: Product[] = [
  {
    id: "prod-1",
    name: "Serum Brightening Premium",
    description:
      "Brightening serum with niacinamide and hydration boost for daily glow.",
    price: 99000,
    stock: 120,
    sku: "SBP-001",
    category: "Skincare",
    imageUrl: "/product-serum.png",
    featured: true,
  },
  {
    id: "prod-2",
    name: "Moisturizer Glow Natural",
    description:
      "Lightweight moisturizer designed for a healthy and hydrated skin barrier.",
    price: 129000,
    stock: 80,
    sku: "MGN-002",
    category: "Skincare",
    imageUrl: "/product-cream.png",
    featured: false,
  },
  {
    id: "prod-3",
    name: "Sunscreen Day Protection",
    description:
      "Daily SPF protection with anti-blue-light and longwear finish.",
    price: 79000,
    stock: 200,
    sku: "SDP-003",
    category: "Skincare",
    imageUrl: "/product-sunscreen.png",
    featured: true,
  },
  {
    id: "prod-4",
    name: "Hydrating Essence",
    description:
      "Hydrating essence with fermented ingredients and deep moisture retention.",
    price: 110000,
    stock: 70,
    sku: "HE-004",
    category: "Beauty",
    imageUrl: "/product-essence.png",
    featured: false,
  },
];

export const avatars = [
  {
    id: "host_2d_statis_nana",
    name: "Nana",
    style: "Friendly",
    language: "Indonesia",
    voice: "Wanita Natural",
  },
  {
    id: "host_3d_dinamis_namira",
    name: "Namira",
    style: "Energetic",
    language: "Indonesia",
    voice: "Energetic Promo",
  },
  {
    id: "cinta",
    name: "Cinta",
    style: "Professional",
    language: "Indonesia",
    voice: "Soft Professional",
  },
];

export const pricing = {
  live: [
    {
      id: "express-live",
      title: "Express Live",
      duration: "2 Jam",
      price: 99000,
      specs: [
        "1 live session",
        "2 jam nonstop",
        "auto-reply chat",
        "auto-pin product",
      ],
      popular: false,
    },
    {
      id: "shift-live",
      title: "Shift Live",
      duration: "8 Jam",
      price: 299000,
      specs: [
        "1 live session",
        "8 jam nonstop",
        "cocok untuk malam-pagi",
        "full automation",
      ],
      popular: true,
    },
    {
      id: "marathon-live",
      title: "Marathon 24/7",
      duration: "24 Jam",
      price: 699000,
      specs: ["24 jam live", "full catalog rotation", "priority queue"],
      popular: false,
    },
  ],
  video: [
    {
      id: "short-hook",
      title: "Short Hook",
      duration: "15 Detik",
      price: 19000,
      specs: ["vertical 9:16", "high-impact script", "voiceover", "subtitle"],
      popular: false,
    },
    {
      id: "standard-showcase",
      title: "Standard Showcase",
      duration: "30 Detik",
      price: 35000,
      specs: ["vertical 9:16", "benefit breakdown", "CTA promotion"],
      popular: true,
    },
    {
      id: "deep-review",
      title: "Deep Review",
      duration: "60 Detik",
      price: 59000,
      specs: ["vertical 9:16", "unboxing/storytelling", "review script"],
      popular: false,
    },
  ],
};

export const dashboardSummary = {
  totalProducts: 0,
  activeAvatar: "",
  sessions: 0,
  totalRevenue: 0,
  estimatedCost: 0,
  liveViewers: 0,
  comments: 0,
  conversion: 0,
};

export const liveWorkflowSteps = [
  {
    id: 1,
    title: "Data Produk",
    description: "Unggah foto produk, deskripsi, stok, dan harga.",
  },
  {
    id: 2,
    title: "AI Host",
    description: "Pilih avatar, voice, bahasa, dan gaya bicara.",
  },
  {
    id: 3,
    title: "Atur Live",
    description: "Pilih produk, durasi, platform, dan automation.",
  },
  {
    id: 4,
    title: "Preview & Test",
    description: "Simulasi komentar, script, dan preview sebelum live.",
  },
  {
    id: 5,
    title: "Go Live",
    description: "Jalankan pipeline dan monitor performa real-time.",
  },
];

export const inventoryRows = [
];

export const hostOptions = [
  {
    id: "host_2d_statis_nana",
    name: "Nana",
    role: "Friendly",
    language: "Indonesia",
    voice: "Wanita Natural",
  },
  {
    id: "host_3d_dinamis_namira",
    name: "Namira",
    role: "Energetic",
    language: "Indonesia",
    voice: "Energetic Promo",
  },
  {
    id: "cinta",
    name: "Cinta",
    role: "Professional",
    language: "Indonesia",
    voice: "Soft Professional",
  },
];
