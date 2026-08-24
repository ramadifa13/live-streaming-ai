/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useState } from "react";
import Link from "next/link";

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
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h.01M15 12h.01M12 2a4 4 0 00-4 4v2H7a3 3 0 00-3 3v2a3 3 0 003 3h10a3 3 0 003-3v-2a3 3 0 00-3-3h-1V6a4 4 0 00-4-4z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 18v2a2 2 0 002 2h4a2 2 0 002-2v-2" /></svg>
    ),
  },
  {
    title: "Video Promo Otomatis",
    text: "Buat video promosi produk profesional dalam hitungan menit siap upload ke semua platform.",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>
    ),
  },
  {
    title: "Avatar & Voice Realistis",
    text: "Pilih avatar AI 2D/3D, suara natural, ekspresi wajah, dan gaya komunikasi sesuai brand Anda.",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
  {
    title: "Integrasi Checkout",
    text: "Terhubung dengan Midtrans untuk pembayaran otomatis saat live streaming.",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    ),
  },
  {
    title: "Data & Analitik Lengkap",
    text: "Pantau performa live & video dengan dashboard analytics real-time.",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
    ),
  },
  {
    title: "Hemat Biaya Operasional",
    text: "Self-hosted open-source stack menghemat hingga 90% biaya dibanding platform lain.",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
];

const workflowSteps = [
  {
    id: 1,
    title: "Input Data Bisnis",
    text: "Unggah foto produk, deskripsi, stok & harga (via CSV atau API).",
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
    ),
  },
  {
    id: 2,
    title: "Pilih Avatar & Mode",
    text: "Pilih avatar AI, suara, dan mode output (Live atau Video Promo).",
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
    ),
  },
  {
    id: 3,
    title: "AI Jalankan Live / Buat Video",
    text: "AI melakukan live streaming atau membuat video promo otomatis.",
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
  {
    id: 4,
    title: "Interaksi & Checkout",
    text: "AI berinteraksi dengan audiens & memproses pembayaran otomatis.",
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    ),
  },
  {
    id: 5,
    title: "Analitik & Laporan",
    text: "Dapatkan laporan lengkap performa live & video untuk optimasi.",
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
    ),
  },
];

const livePlans = [
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
    features: [
      "1 sesi shift (8 jam)",
      "Cocok untuk sesi malam-pagi",
    ],
    popular: true,
  },
  {
    name: "Marathon 24/7",
    duration: "24 Jam",
    price: "Rp699.000",
    features: ["Live 24 jam nonstop", "Full catalog rotation", "Priority queue"],
    popular: false,
  },
];

const promoPlans = [
  {
    name: "Short Hook",
    duration: "15 Detik",
    price: "Rp19.000",
    features: ["Video vertical (9:16)", "High-impact script", "Voiceover + subtitle"],
    popular: false,
  },
  {
    name: "Standard Showcase",
    duration: "30 Detik",
    price: "Rp35.000",
    features: ["Full benefit breakdown", "CTA promos", "Video vertical (9:16)"],
    popular: true,
  },
  {
    name: "Deep Review",
    duration: "60 Detik",
    price: "Rp59.000",
    features: ["Unboxing & storytelling", "Review script", "Video vertical (9:16)"],
    popular: false,
  },
];

function AccentBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#2c3140] bg-transparent px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-slate-300">
      <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
      {title}
    </span>
  );
}

export default function Home() {
  const [showDemoModal, setShowDemoModal] = useState(false);

  return (
    <div className="min-h-screen bg-[#070b14] text-white selection:bg-blue-500/30 font-sans scroll-smooth">
      <div className="mx-auto max-w-[1400px] px-6 pb-16 pt-4">
        {/* Navigation */}
        <header className="px-1 pb-8 pt-2">
          <nav className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="text-[1.8rem] font-bold tracking-tight">
                LiveStreamer<span className="text-blue-500">AI</span>
              </div>
            </Link>

            <div className="hidden items-center gap-8 text-[0.85rem] text-slate-400 md:flex">
              {navItems.map((item) => (
                <a key={item.name} href={item.href} className="transition hover:text-white">
                  {item.name}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-6 text-[0.85rem]">
              <Link href="/dashboard" className="hidden text-slate-300 hover:text-white md:inline-flex">
                Login
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-95"
              >
                Mulai Sekarang →
              </Link>
            </div>
          </nav>
        </header>

        <main className="pt-4">
          {/* Hero Section */}
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
                  Platform AI yang menjalankan live streaming interaktif, membalas chat, dan membuat video promosi produk otomatis – tanpa perlu host manusia.
                </p>

                <div className="flex flex-wrap gap-4 pt-2">
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-95"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
                    </svg>
                    Mulai Live Otomatis
                  </Link>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg border border-[#2c3140] bg-transparent px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5 active:scale-95"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
                    </svg>
                    Buat Video Promosi
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-6 text-[11px] font-medium text-slate-400">
                  <div className="inline-flex items-center gap-1.5">
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                    Self-Hosted Open-Source
                  </div>
                  <span className="text-slate-600">•</span>
                  <div className="inline-flex items-center">
                    Hemat hingga 90% biaya operasional
                  </div>
                </div>
              </div>

              {/* Hero Image Mockup (Clickable to Dashboard) */}
              <Link href="/dashboard" className="group block relative h-[550px] w-full rounded-2xl border border-[#2c3140] overflow-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#41295a] to-[#2F0743] shadow-2xl transition hover:border-blue-500/50">
                <div className="absolute inset-0 bg-cover bg-center opacity-90 mix-blend-screen transition-transform duration-700 group-hover:scale-105" style={{backgroundImage: "url('https://images.unsplash.com/photo-1580489944761-15a19d654956?w=800&h=600&fit=crop')"}}></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30"></div>
                
                {/* Live Badge */}
                <div className="absolute left-4 top-4 flex items-center gap-3 rounded bg-black/50 px-2 py-1 backdrop-blur-sm border border-white/10">
                  <span className="flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white"><div className="h-1.5 w-1.5 rounded-full bg-white animate-ping"></div> LIVE</span>
                  <span className="text-[11px] font-bold text-white flex items-center gap-1"><svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2a5 5 0 1 1 0 10A5 5 0 0 1 8 3z"/><path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg> 1.238</span>
                </div>

                {/* Floating Chat Bubbles */}
                <div className="absolute left-4 top-32 flex flex-col gap-3">
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-blue-400"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">AI</span> AI Assistant</p>
                      <span className="text-[8px] text-slate-400">10:21</span>
                    </div>
                    <p className="text-[10px] text-slate-200">Halo! Selamat datang 😊<br/>Ada yang bisa saya bantu?</p>
                  </div>
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-slate-300"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-pink-500 text-[8px] text-white">R</span> Rina</p>
                      <span className="text-[8px] text-slate-400">10:21</span>
                    </div>
                    <p className="text-[10px] text-slate-200">Manfaat produk ini apa?</p>
                  </div>
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-blue-400"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">AI</span> AI Assistant</p>
                      <span className="text-[8px] text-slate-400">10:22</span>
                    </div>
                    <p className="text-[10px] text-slate-200">Produk ini membantu melembapkan kulit dan mencerahkan wajah ✨</p>
                  </div>
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-slate-300"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white">B</span> Budi</p>
                      <span className="text-[8px] text-slate-400">10:22</span>
                    </div>
                    <p className="text-[10px] text-slate-200">Berapa harganya?</p>
                  </div>
                  <div className="max-w-[200px] rounded-lg border border-white/10 bg-black/40 p-2.5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="flex items-center gap-1.5 text-[9px] font-bold text-blue-400"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white">AI</span> AI Assistant</p>
                      <span className="text-[8px] text-slate-400">10:22</span>
                    </div>
                    <p className="text-[10px] text-slate-200">Harga spesial hari ini Rp99.000 + gratis ongkir 🚚</p>
                  </div>
                </div>

                {/* Floating Hearts */}
                <div className="absolute right-4 bottom-28 flex flex-col gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg animate-bounce">❤️</div>
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg translate-x-2">❤️</div>
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg">❤️</div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg -translate-x-2">❤️</div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-red-500 to-pink-500 shadow-lg translate-x-1">❤️</div>
                </div>

                {/* Product Banner */}
                <div className="absolute bottom-4 right-4 flex items-center justify-between rounded-xl bg-black/60 p-2.5 backdrop-blur-md border border-white/10 shadow-2xl">
                  <div className="flex items-center gap-3">
                    <img
                      src="https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&h=400&fit=crop&q=80"
                      alt="Serum Brightening Premium"
                      className="h-14 w-12 rounded object-cover border border-white/10 shadow"
                    />
                    <div className="pr-12">
                      <p className="text-[11px] font-bold text-white mb-0.5">Serum Brightening Premium</p>
                      <div className="flex items-baseline gap-1.5">
                        <p className="text-[13px] font-bold text-white">Rp99.000</p>
                        <p className="text-[9px] text-slate-400 line-through">Rp149.000</p>
                      </div>
                    </div>
                  </div>
                  <span className="rounded-lg bg-blue-600 px-4 py-2 text-[10px] font-bold text-white group-hover:bg-blue-500">Beli Sekarang</span>
                  <div className="absolute right-3 top-3 text-slate-400"><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg></div>
                </div>
              </Link>
            </div>
          </section>

          {/* Brands */}
          <section className="py-12">
            <p className="mb-8 text-center text-xs font-semibold uppercase tracking-widest text-slate-500">Digunakan untuk berbagai kebutuhan bisnis</p>
            <div className="flex flex-wrap justify-center gap-8 md:justify-between px-10 text-center text-sm font-bold text-slate-400">
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" /></svg> SkincareCo</div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg> FASHION HUB</div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg> Herbalife Store</div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> TechLife</div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg> SmartHome</div>
              <div className="flex items-center gap-2 opacity-80 transition hover:opacity-100 hover:text-white cursor-pointer"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> BabyCare</div>
            </div>
          </section>

          {/* Features Section */}
          <section id="fitur" className="py-16 text-center scroll-mt-10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
              SEMUA DALAM SATU PLATFORM AI
            </p>
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              Fitur Unggulan <span className="text-blue-500">LiveStreamerAI</span>
            </h2>

            <div className="mt-12 grid gap-4 text-left md:grid-cols-2 xl:grid-cols-3">
              {featureCards.map((card) => (
                <article
                  key={card.title}
                  className="rounded-xl border border-[#1f2638] bg-[#0c1221] p-6 hover:border-blue-500/50 transition-colors"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a233a] text-blue-400">
                    {card.icon}
                  </div>
                  <h3 className="mb-2 text-base font-bold text-white">
                    {card.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-slate-400">{card.text}</p>
                </article>
              ))}
            </div>
          </section>

          {/* Workflow Section */}
          <section id="workflow" className="py-16 scroll-mt-10">
            <div className="text-center mb-12">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-2">
                ALUR KERJA SEDERHANA
              </p>
              <h2 className="text-3xl font-bold text-white">
                Bagaimana <span className="text-blue-500">LiveStreamerAI</span> Bekerja
              </h2>
            </div>

            <div className="flex flex-col items-center justify-between gap-4 xl:flex-row xl:items-stretch">
              {workflowSteps.map((step, idx) => (
                <div key={step.id} className="flex flex-1 items-center relative w-full xl:w-auto">
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
                      ---&gt;
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Pricing Section */}
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
                <h3 className="mb-6 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI LIVE STREAMING (OTONOM &amp; INTERAKTIF)</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  {livePlans.map((plan) => (
                    <article
                      key={plan.name}
                      className={`flex flex-col rounded-xl border p-4 ${plan.popular ? "border-blue-500/50 bg-[#162038]" : "border-[#1f2638] bg-[#0f1525]"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white">{plan.name}</h3>
                      </div>
                      <p className="mb-3 text-[10px] text-slate-400">{plan.duration}</p>
                      {plan.popular && (
                        <span className="mb-3 inline-block self-start rounded bg-blue-600 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">POPULAR</span>
                      )}
                      <p className="mb-4 text-xl font-bold text-white">{plan.price}</p>
                      <ul className="mb-6 space-y-2 text-[10px] text-slate-400 flex-1">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-1.5">
                            <svg className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            {feature}
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
                <h3 className="mb-6 text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">SHORT VIDEO PROMO (SIAP UPLOAD MP4)</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  {promoPlans.map((plan) => (
                    <article
                      key={plan.name}
                      className={`flex flex-col rounded-xl border p-4 ${plan.popular ? "border-purple-500/50 bg-[#1e1738]" : "border-[#1f2638] bg-[#0f1525]"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white">{plan.name}</h3>
                      </div>
                      <p className="mb-3 text-[10px] text-slate-400">{plan.duration}</p>
                      {plan.popular && (
                        <span className="mb-3 inline-block self-start rounded bg-purple-600 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">POPULAR</span>
                      )}
                      <p className="mb-4 text-xl font-bold text-white">{plan.price}</p>
                      <ul className="mb-6 space-y-2 text-[10px] text-slate-400 flex-1">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-1.5">
                            <svg className="mt-0.5 h-3 w-3 shrink-0 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            {feature}
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
              <Link href="/dashboard" className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors">
                Lihat semua paket &amp; detail lengkap →
              </Link>
            </div>
          </section>

          {/* CTA Banner */}
          <section id="demo" className="mt-4 rounded-2xl bg-gradient-to-r from-[#170936] to-[#071638] p-8 md:flex md:items-center md:justify-between border border-blue-500/20 scroll-mt-10">
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
                Mulai Gratis 7 Hari
              </Link>
              <button
                onClick={() => setShowDemoModal(true)}
                className="rounded-lg border border-[#2c3140] bg-[#0c1221] hover:bg-[#151f33] px-6 py-2.5 text-sm font-semibold text-slate-200 transition active:scale-95"
              >
                Lihat Demo
              </button>
            </div>
          </section>

          {/* FAQ / Highlights */}
          <section id="faq" className="mt-12 grid grid-cols-2 gap-6 border-t border-[#1f2638] pt-8 sm:grid-cols-4 px-4 pb-8 scroll-mt-10">
            <div className="flex items-center gap-3">
              <div className="text-2xl text-emerald-400"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg></div>
              <div>
                <p className="text-[13px] font-bold text-white">Open Source</p>
                <p className="text-[11px] text-slate-400">Transparan &amp; Bisa Custom</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl text-emerald-400"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg></div>
              <div>
                <p className="text-[13px] font-bold text-white">Self-Hosted</p>
                <p className="text-[11px] text-slate-400">Data Aman &amp; Terkontrol</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl text-blue-400"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
              <div>
                <p className="text-[13px] font-bold text-white">Hemat 90% Biaya</p>
                <p className="text-[11px] text-slate-400">Dibanding Platform Lain</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl text-purple-400"><svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg></div>
              <div>
                <p className="text-[13px] font-bold text-white">Support Komunitas</p>
                <p className="text-[11px] text-slate-400">Aktif &amp; Responsif</p>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Demo Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-lg rounded-2xl border border-blue-500/30 bg-[#0c1221] p-6 shadow-2xl">
            <button
              onClick={() => setShowDemoModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white text-lg font-bold"
            >
              ✕
            </button>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 text-xl">
                🚀
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Live Demo Simulation</h3>
                <p className="text-xs text-slate-400">Jalankan live streaming AI otonom langsung di Dashboard</p>
              </div>
            </div>
            <p className="mb-6 text-xs leading-relaxed text-slate-300">
              Anda dapat mencoba langsung alur 5 langkah setup live streaming: upload produk, pilih avatar 2D/3D (Nana, Namira), atur durasi, uji preview chat respons AI, dan lihat Control Center real-time.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDemoModal(false)}
                className="rounded-lg border border-[#2c3140] px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
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
