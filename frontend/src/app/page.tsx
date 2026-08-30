"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Bot,
  Video,
  Smile,
  CreditCard,
  BarChart3,
  ShieldCheck,
  Layers,
  User,
  PlayCircle,
  ShoppingBag,
  BarChart2,
  Check,
  Zap,
  Play,
  Heart,
  Eye,
  Sparkles,
  Code2,
  Server,
  Coins,
  MessageSquare,
  X,
  Package,
  Sparkle,
  Tv,
  Home,
  Baby,
} from "lucide-react";

const navItems = [
  { name: "Fitur", href: "#fitur" },
  { name: "Pricing", href: "#pricing" },
  { name: "Cara Kerja", href: "#workflow" },
  { name: "Demo", href: "#demo" },
  { name: "FAQ", href: "#faq" },
];

const featureCards = [
  {
    title: "AI Live Selling Otonom",
    text: "AI menjalankan live 24/7, membalas chat, menjelaskan produk, dan mendorong pembelian secara otomatis.",
    icon: <Bot className="w-6 h-6 text-blue-400" />,
  },
  {
    title: "Video Promo Otomatis",
    text: "Buat video promosi produk profesional dalam hitungan menit siap upload ke semua platform.",
    icon: <Video className="w-6 h-6 text-purple-400" />,
  },
  {
    title: "Avatar & Voice Realistis",
    text: "Pilih avatar AI 2D/3D, suara natural, ekspresi wajah, dan gaya komunikasi sesuai brand Anda.",
    icon: <Smile className="w-6 h-6 text-emerald-400" />,
  },
  {
    title: "Integrasi Checkout",
    text: "Terhubung dengan Midtrans untuk pembayaran otomatis saat live streaming.",
    icon: <CreditCard className="w-6 h-6 text-pink-400" />,
  },
  {
    title: "Data & Analitik Lengkap",
    text: "Pantau performa live & video dengan dashboard analytics real-time.",
    icon: <BarChart3 className="w-6 h-6 text-cyan-400" />,
  },
  {
    title: "Hemat Biaya Operasional",
    text: "Self-hosted open-source stack menghemat hingga 90% biaya dibanding platform lain.",
    icon: <ShieldCheck className="w-6 h-6 text-amber-400" />,
  },
];

const workflowSteps = [
  {
    id: 1,
    title: "Input Data Bisnis",
    text: "Unggah foto produk, deskripsi, stok & harga (via CSV atau API).",
    icon: <Layers className="w-6 h-6" />,
  },
  {
    id: 2,
    title: "Pilih Avatar & Mode",
    text: "Pilih avatar AI, suara, dan mode output (Live atau Video Promo).",
    icon: <User className="w-6 h-6" />,
  },
  {
    id: 3,
    title: "AI Jalankan Live / Buat Video",
    text: "AI melakukan live streaming atau membuat video promo otomatis.",
    icon: <PlayCircle className="w-6 h-6" />,
  },
  {
    id: 4,
    title: "Interaksi & Checkout",
    text: "AI berinteraksi dengan audiens & memproses pembayaran otomatis.",
    icon: <ShoppingBag className="w-6 h-6" />,
  },
  {
    id: 5,
    title: "Analitik & Laporan",
    text: "Dapatkan laporan lengkap performa live & video untuk optimasi.",
    icon: <BarChart2 className="w-6 h-6" />,
  },
];

const livePlans = [
  {
    name: "Demo Live",
    duration: "1 Jam",
    price: "Rp49.000",
    features: [
      "1 sesi demo (1 jam)",
      "Uji coba AI Host & Chat",
      "Setup presentasi klien",
    ],
    popular: false,
  },
  {
    name: "Express Live",
    duration: "2 Jam",
    price: "Rp99.000",
    features: [
      "1 sesi live (2 jam nonstop)",
      "Auto-reply chat",
      "Auto pin produk",
    ],
    popular: false,
  },
  {
    name: "Shift Live",
    duration: "8 Jam",
    price: "Rp299.000",
    features: ["1 sesi shift (8 jam)", "Cocok untuk sesi malam-pagi"],
    popular: true,
  },
  {
    name: "Marathon 24/7",
    duration: "24 Jam",
    price: "Rp699.000",
    features: [
      "Live 24 jam nonstop",
      "Full catalog rotation",
      "Priority queue",
    ],
    popular: false,
  },
];

const promoPlans = [
  {
    name: "Short Hook",
    duration: "15 Detik",
    price: "Rp19.000",
    features: ["15s video siap upload", "Viral script + subtitle", "1x revisi"],
    popular: false,
  },
  {
    name: "Standard Showcase",
    duration: "30 Detik",
    price: "Rp35.000",
    features: [
      "30s video showcase",
      "Benefit breakdown + CTA",
      "2x revisi",
    ],
    popular: true,
  },
  {
    name: "Deep Review",
    duration: "60 Detik",
    price: "Rp59.000",
    features: [
      "60s full review video",
      "Unboxing / storytelling script",
      "Unlimited revisi",
    ],
    popular: false,
  },
];

function AccentBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-400">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      {title}
    </span>
  );
}

export default function HomeLanding() {
  const [showDemoModal, setShowDemoModal] = useState(false);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 selection:bg-blue-600 selection:text-white font-sans">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="py-6">
          <nav className="flex items-center justify-between border-b border-[#1f2638] pb-6">
            <Link
              href="/"
              className="text-2xl font-black tracking-tight text-white hover:opacity-90 transition"
            >
              LiveStreamer<span className="text-blue-500">AI</span>
            </Link>

            <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
              {navItems.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  className="hover:text-blue-400 transition"
                >
                  {item.name}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/30 hover:bg-blue-500 transition active:scale-95 flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Mulai Sekarang</span>
              </Link>
            </div>
          </nav>
        </header>

        <main className="pt-4">
            <section className="mb-12">
            <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
              <div className="space-y-6 pt-8">
                <AccentBadge title="AI LIVE SELLING OTONOM & VIDEO PROMO OTOMATIS" />

                <h1 className="max-w-xl text-[3.5rem] font-bold leading-[1.1] tracking-tight text-white">
                  Live Selling &amp; Video{" "}
                  <span className="block text-blue-400">
                    Promosi, 100% Otonom
                  </span>{" "}
                  oleh AI
                </h1>

                <p className="max-w-xl text-[1.05rem] leading-7 text-slate-300">
                  Platform AI yang menjalankan live streaming interaktif,
                  membalas chat, dan membuat video promosi produk otomatis –
                  tanpa perlu host manusia.
                </p>

                <div className="flex flex-wrap gap-4 pt-2">
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-95"
                  >
                    <Zap className="w-4 h-4" />
                    Mulai Live Otomatis
                  </Link>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg border border-[#2c3140] bg-transparent px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5 active:scale-95"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                    Buat Video Promosi
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-6 text-[11px] font-medium text-slate-400">
                  <div className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Self-Hosted Open-Source
                  </div>
                  <span className="text-slate-600">•</span>
                  <div className="inline-flex items-center">
                    Hemat hingga 90% biaya operasional
                  </div>
                </div>
              </div>

              <Link
                href="/dashboard"
                className="group block relative h-[550px] w-full rounded-2xl border border-[#2c3140] overflow-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#41295a] to-[#2F0743] shadow-2xl transition hover:border-blue-500/50"
              >
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-90 mix-blend-screen transition-transform duration-700 group-hover:scale-105"
                  style={{
                    backgroundImage:
                      "url('https://images.unsplash.com/photo-1580489944761-15a19d654956?w=800&h=600&fit=crop')",
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
                <div className="absolute left-4 top-4 flex items-center gap-3 rounded bg-black/50 px-2 py-1 backdrop-blur-sm border border-white/10">
                  <span className="flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <div className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />{" "}
                    LIVE
                  </span>
                  <span className="text-[11px] font-bold text-white flex items-center gap-1">
                    <Eye className="w-3 h-3" /> 1.238
                  </span>
                </div>

                <div className="absolute left-4 top-32 flex flex-col gap-3">
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-blue-400">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">
                          AI
                        </span>{" "}
                        AI Assistant
                      </p>
                      <span className="text-[8px] text-slate-400">10:21</span>
                    </div>
                    <p className="text-[10px] text-slate-200">
                      Halo! Selamat datang 😊
                      <br />
                      Ada yang bisa saya bantu?
                    </p>
                  </div>
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-slate-300">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-pink-500 text-[8px] text-white">
                          R
                        </span>{" "}
                        Rina
                      </p>
                      <span className="text-[8px] text-slate-400">10:21</span>
                    </div>
                    <p className="text-[10px] text-slate-200">
                      Manfaat produk ini apa?
                    </p>
                  </div>
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-blue-400">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">
                          AI
                        </span>{" "}
                        AI Assistant
                      </p>
                      <span className="text-[8px] text-slate-400">10:22</span>
                    </div>
                    <p className="text-[10px] text-slate-200">
                      Produk ini membantu melembapkan kulit dan mencerahkan
                      wajah
                    </p>
                  </div>
                </div>

                <div className="absolute right-4 bottom-28 flex flex-col gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg animate-bounce text-white">
                    <Heart className="w-3.5 h-3.5 fill-current" />
                  </div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg translate-x-2 text-white">
                    <Heart className="w-3 h-3 fill-current" />
                  </div>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg text-white">
                    <Heart className="w-3.5 h-3.5 fill-current" />
                  </div>
                </div>

                <div className="absolute bottom-4 right-4 flex items-center justify-between rounded-xl bg-black/60 p-2.5 backdrop-blur-md border border-white/10 shadow-2xl">
                  <div className="flex items-center gap-3">
                    <Image
                      src="https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                      alt="Serum Brightening Premium"
                      width={48}
                      height={56}
                      unoptimized
                      className="h-14 w-12 rounded object-cover border border-white/10 shadow"
                    />
                    <div className="pr-12">
                      <p className="text-[11px] font-bold text-white mb-0.5">
                        Serum Brightening Premium
                      </p>
                      <div className="flex items-baseline gap-1.5">
                        <p className="text-[13px] font-bold text-white">
                          Rp99.000
                        </p>
                        <p className="text-[9px] text-slate-400 line-through">
                          Rp149.000
                        </p>
                      </div>
                    </div>
                  </div>
                  <span className="rounded-lg bg-blue-600 px-4 py-2 text-[10px] font-bold text-white group-hover:bg-blue-500">
                    Beli Sekarang
                  </span>
                  <div className="absolute right-3 top-3 text-slate-400">
                    <Heart className="w-3 h-3" />
                  </div>
                </div>
              </Link>
            </div>
          </section>

          <section className="py-12">
            <p className="mb-8 text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
              Digunakan untuk berbagai kebutuhan bisnis
            </p>
            <div className="flex flex-wrap justify-center gap-8 md:justify-between px-10 text-center text-sm font-bold text-slate-400">
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <span>SkincareCo</span>
              </div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer">
                <Package className="w-5 h-5 text-blue-400" />
                <span>FASHION HUB</span>
              </div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer">
                <Sparkle className="w-5 h-5 text-emerald-400" />
                <span>Herbalife Store</span>
              </div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer">
                <Tv className="w-5 h-5 text-pink-400" />
                <span>TechLife</span>
              </div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer">
                <Home className="w-5 h-5 text-amber-400" />
                <span>SmartHome</span>
              </div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer">
                <Baby className="w-5 h-5 text-cyan-400" />
                <span>BabyCare</span>
              </div>
            </div>
          </section>

          <section id="fitur" className="py-16 text-center scroll-mt-10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
              SEMUA DALAM SATU PLATFORM AI
            </p>
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              Fitur Unggulan{" "}
              <span className="text-blue-500">LiveStreamerAI</span>
            </h2>

            <div className="mt-12 grid gap-4 text-left md:grid-cols-2 xl:grid-cols-3">
              {featureCards.map((card) => (
                <article
                  key={card.title}
                  className="rounded-xl border border-[#1f2638] bg-[#0c1221] p-6 hover:border-blue-500/50 transition-colors"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a233a]">
                    {card.icon}
                  </div>
                  <h3 className="mb-2 text-base font-bold text-white">
                    {card.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-slate-400">
                    {card.text}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section id="workflow" className="py-16 scroll-mt-10">
            <div className="text-center mb-12">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
                ALUR KERJA SEDERHANA
              </p>
              <h2 className="text-3xl font-bold text-white">
                Bagaimana <span className="text-blue-500">LiveStreamerAI</span>{" "}
                Bekerja
              </h2>
            </div>

            <div className="flex flex-col items-center justify-between gap-4 xl:flex-row xl:items-stretch">
              {workflowSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className="flex flex-1 items-center relative w-full xl:w-auto"
                >
                  <div className="z-10 flex h-full flex-col items-center rounded-xl border border-[#1f2638] bg-[#0c1221] p-6 text-center w-full transition hover:border-blue-500/40">
                    <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#1a233a] text-blue-400">
                      <div className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                        {step.id}
                      </div>
                      {step.icon}
                    </div>
                    <h3 className="mb-2 text-sm font-bold text-white">
                      {step.title}
                    </h3>
                    <p className="text-[11px] leading-relaxed text-slate-400 px-2">
                      {step.text}
                    </p>
                  </div>
                  {idx < 4 && (
                    <div className="hidden xl:flex items-center justify-center w-8 text-slate-500 font-bold -mr-8 z-0">
                      →
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section id="pricing" className="pb-20 pt-10 scroll-mt-10">
            <div className="text-center mb-12">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
                PILIH SESUAI KEBUTUHAN ANDA
              </p>
              <h2 className="text-3xl font-bold text-white">
                Paket Live Streaming &amp; Video Promo
              </h2>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-2xl border border-[#1f2638] bg-[#0c1221] p-6">
                <h3 className="mb-6 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  AI LIVE STREAMING (OTONOM &amp; INTERAKTIF)
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {livePlans.map((plan) => (
                    <article
                      key={plan.name}
                      className={`flex flex-col rounded-xl border p-4 ${plan.popular ? "border-blue-500/50 bg-[#162038]" : "border-[#1f2638] bg-[#0f1525]"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white">
                          {plan.name}
                        </h3>
                      </div>
                      <p className="mb-3 text-[10px] text-slate-400">
                        {plan.duration}
                      </p>
                      {plan.popular && (
                        <span className="mb-3 inline-block self-start rounded bg-blue-600 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">
                          POPULAR
                        </span>
                      )}
                      <p className="mb-4 text-xl font-bold text-white">
                        {plan.price}
                      </p>
                      <ul className="mb-6 space-y-2 text-[10px] text-slate-400 flex-1">
                        {plan.features.map((feature) => (
                          <li
                            key={feature}
                            className="flex items-start gap-1.5"
                          >
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <Link
                        href="/dashboard"
                        className={`mt-auto block text-center w-full rounded-lg px-3 py-2 text-[10px] font-bold transition ${plan.popular ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-[#1a233a] text-slate-300 hover:bg-[#25304a]"}`}
                      >
                        Pilih Paket
                      </Link>
                    </article>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[#1f2638] bg-[#0c1221] p-6">
                <h3 className="mb-6 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  SHORT VIDEO PROMO (SIAP UPLOAD MP4)
                </h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  {promoPlans.map((plan) => (
                    <article
                      key={plan.name}
                      className={`flex flex-col rounded-xl border p-4 ${plan.popular ? "border-purple-500/50 bg-[#1e1738]" : "border-[#1f2638] bg-[#0f1525]"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white">
                          {plan.name}
                        </h3>
                      </div>
                      <p className="mb-3 text-[10px] text-slate-400">
                        {plan.duration}
                      </p>
                      {plan.popular && (
                        <span className="mb-3 inline-block self-start rounded bg-purple-600 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">
                          POPULAR
                        </span>
                      )}
                      <p className="mb-4 text-xl font-bold text-white">
                        {plan.price}
                      </p>
                      <ul className="mb-6 space-y-2 text-[10px] text-slate-400 flex-1">
                        {plan.features.map((feature) => (
                          <li
                            key={feature}
                            className="flex items-start gap-1.5"
                          >
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-purple-400" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <Link
                        href="/dashboard"
                        className={`mt-auto block text-center w-full rounded-lg px-3 py-2 text-[10px] font-bold transition ${plan.popular ? "bg-purple-600 text-white hover:bg-purple-500" : "bg-[#1a233a] text-slate-300 hover:bg-[#25304a]"}`}
                      >
                        Pilih Paket
                      </Link>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/dashboard"
                className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                Lihat semua paket &amp; detail lengkap →
              </Link>
            </div>
          </section>

          <section
            id="demo"
            className="mt-4 rounded-2xl bg-gradient-to-r from-[#170936] to-[#071638] p-8 md:flex md:items-center md:justify-between border border-blue-500/20 scroll-mt-10"
          >
            <div>
              <h3 className="text-2xl font-bold text-white">
                Siap Otomatiskan Live Selling &amp; Promosi Anda?
              </h3>
              <p className="mt-2 text-[13px] text-slate-300">
                Hemat waktu, kurangi biaya, dan tingkatkan penjualan dengan AI.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-4 md:mt-0">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white transition active:scale-95"
              >
                Kenapa masih disini? buruan mulai dari sekarang!
              </Link>
            </div>
          </section>

          <section
            id="faq"
            className="mt-12 grid grid-cols-2 gap-6 border-t border-[#1f2638] pt-8 sm:grid-cols-4 px-4 pb-8 scroll-mt-10"
          >
            <div className="flex items-center gap-3">
              <div className="text-2xl text-emerald-400">
                <Code2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-white">Open Source</p>
                <p className="text-[11px] text-slate-400">
                  Transparan &amp; Bisa Custom
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl text-emerald-400">
                <Server className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-white">Self-Hosted</p>
                <p className="text-[11px] text-slate-400">
                  Data Aman &amp; Terkontrol
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl text-blue-400">
                <Coins className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-white">
                  Hemat 90% Biaya
                </p>
                <p className="text-[11px] text-slate-400">
                  Dibanding Platform Lain
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl text-purple-400">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-white">
                  Support Komunitas
                </p>
                <p className="text-[11px] text-slate-400">
                  Aktif &amp; Responsif
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>

      {showDemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-2xl border border-blue-500/30 bg-[#0c1221] p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setShowDemoModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Live Demo Simulation
                </h3>
                <p className="text-xs text-slate-400">
                  Jalankan live streaming AI otonom langsung di Dashboard
                </p>
              </div>
            </div>
            <p className="mb-6 text-xs leading-relaxed text-slate-300">
              Anda dapat mencoba langsung alur 5 langkah setup live streaming:
              upload produk, pilih avatar 2D/3D (Nana, Namira), atur durasi, uji
              preview chat respons AI, dan lihat Control Center real-time.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDemoModal(false)}
                className="rounded-lg border border-[#2c3140] px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 cursor-pointer"
              >
                Tutup
              </button>
              <Link
                href="/dashboard"
                className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 transition"
              >
                Buka Dashboard Live →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
