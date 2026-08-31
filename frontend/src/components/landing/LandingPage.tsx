"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronDown,
  Monitor,
  Users,
  MessageCircle,
  Radio,
  Check,
  X,
} from "lucide-react";
import {
  navLinks,
  featureBlocks,
  howItWorksSteps,
  withoutLivio,
  withLivio,
  faqItems,
  footerLinks,
  avatarGridImages,
  platformIcons,
  supportedPlatforms,
  footerSocialPlatforms,
} from "./landing-data";
import { Reveal } from "./Reveal";
import { LivioLogo } from "@/components/shared/LivioLogo";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import type { PlatformKey } from "@/lib/brand-assets";

const HERO_PARTICLES = [
  { left: "12%", top: "30%", size: 6, delay: 0 },
  { left: "78%", top: "25%", size: 8, delay: 1.2 },
  { left: "45%", top: "55%", size: 5, delay: 2.4 },
  { left: "88%", top: "48%", size: 4, delay: 0.6 },
  { left: "22%", top: "62%", size: 7, delay: 3.1 },
];

function PlatformLogo({ name }: { name: PlatformKey }) {
  const platform = platformIcons[name];
  if (!platform) return null;

  return (
    <div className="livio-platform-logo flex flex-col items-center gap-2.5">
      <PlatformIcon name={name} size="lg" />
      <span className="livio-subhead text-xs text-slate-500">{platform.label}</span>
    </div>
  );
}

function PinkButton({
  children,
  href = "/dashboard",
  className = "",
  size = "md",
}: {
  children: React.ReactNode;
  href?: string;
  className?: string;
  size?: "md" | "lg";
}) {
  const sizeClass =
    size === "lg"
      ? "px-8 py-3.5 text-[15px] rounded-xl"
      : "px-5 py-2.5 text-sm rounded-lg";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center font-medium text-white bg-gradient-to-r from-[#ff006b] via-[#ff3388] to-[#e91e8c] livio-btn-shimmer shadow-[0_4px_24px_rgba(255,0,107,0.35)] hover:brightness-110 hover:shadow-[0_6px_32px_rgba(255,0,107,0.5)] hover:scale-[1.03] active:scale-[0.98] transition-all duration-300 ${sizeClass} ${className}`}
    >
      {children}
    </Link>
  );
}

function GhostButton({ children, href = "#" }: { children: React.ReactNode; href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg border border-white/25 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/5 transition"
    >
      {children}
    </Link>
  );
}

function SectionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-[#ff006b]/40 bg-[#ff006b]/10 px-4 py-1 text-[11px] font-semibold tracking-wide text-[#ff6eb4]">
      {children}
    </span>
  );
}

function PhoneMockup({
  className,
  image,
  rotate = 0,
  scale = 1,
  animDelay = "livio-phone-delay-1",
}: {
  className?: string;
  image: string;
  rotate?: number;
  scale?: number;
  animDelay?: string;
}) {
  return (
    <div
      className={`livio-phone ${animDelay} absolute overflow-hidden rounded-[28px] border-[3px] border-[#2a2a2a] bg-black shadow-2xl shadow-pink-500/20 transition-shadow duration-500 hover:shadow-pink-500/40 hover:border-[#ff006b]/30 ${className ?? ""}`}
      style={
        {
          "--phone-rotate": `${rotate}deg`,
          "--phone-scale": scale,
        } as React.CSSProperties
      }
    >
      <div className="relative h-full w-full bg-[#111]">
        <Image src={image} alt="Livio app preview" fill unoptimized className="object-cover" />
        <div className="absolute inset-x-0 top-0 h-6 bg-black/60 flex items-center justify-center">
          <div className="h-1 w-10 rounded-full bg-white/30" />
        </div>
      </div>
    </div>
  );
}

function FeatureIcon({ id }: { id: string }) {
  const icons: Record<string, React.ReactNode> = {
    studio: <Monitor className="h-5 w-5 text-[#ff006b]" />,
    avatars: <Users className="h-5 w-5 text-[#ff006b]" />,
    comments: <MessageCircle className="h-5 w-5 text-[#ff006b]" />,
    multi: <Radio className="h-5 w-5 text-[#ff006b]" />,
  };
  return (
    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff006b]/10 border border-[#ff006b]/20">
      {icons[id]}
    </div>
  );
}

function StudioPreview() {
  return (
    <div className="overflow-hidden rounded-xl bg-[#0a0a0a]">
      <div className="flex border-b border-[#222] px-3 py-2 gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
      </div>
      <div className="grid grid-cols-3 gap-2 p-4">
        <div className="col-span-2 space-y-2">
          <div className="h-24 rounded-lg bg-[#1a1a1a] border border-[#333] p-2">
            <p className="text-[9px] text-slate-500 mb-1">Live Preview</p>
            <div className="relative h-14 w-full overflow-hidden rounded">
              <Image src="/avatars/namira.jpg" alt="" fill unoptimized className="object-cover object-top" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-8 rounded bg-[#1a1a1a] border border-[#333]" />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-16 rounded-lg bg-[#ff006b]/10 border border-[#ff006b]/20 p-2">
            <p className="text-[8px] font-bold text-[#ff6eb4] livio-live-badge">LIVE</p>
            <p className="text-[10px] text-white mt-1">1,238</p>
          </div>
          <div className="h-20 rounded-lg bg-[#1a1a1a] border border-[#333] p-2">
            <p className="text-[8px] text-slate-500">Chat AI</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="mt-10 overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#0d0d0d] shadow-2xl shadow-pink-500/5">
      <div className="flex border-b border-[#222]">
        <div className="hidden w-44 shrink-0 border-r border-[#222] bg-[#0a0a0a] p-4 md:block">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-[#ff006b]">Menu</p>
          {["Dashboard", "Avatar", "Template", "Komentar AI", "Analytics"].map((item, i) => (
            <p
              key={item}
              className={`mb-2 rounded-md px-2 py-1.5 text-[11px] ${i === 1 ? "bg-[#ff006b]/15 text-[#ff6eb4] font-semibold" : "text-slate-500"}`}
            >
              {item}
            </p>
          ))}
        </div>
        <div className="flex-1 p-4 md:p-6">
          <p className="mb-4 text-sm font-bold text-white">Pilih Avatar AI Host</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {avatarGridImages.map((src, i) => (
              <div
                key={src}
                className={`livio-chat-bubble relative aspect-square overflow-hidden rounded-lg border transition-transform duration-300 hover:scale-105 ${i === 2 ? "border-[#ff006b] ring-2 ring-[#ff006b]/40" : "border-[#333]"}`}
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <Image src={src} alt="" fill unoptimized className="object-cover" />
              </div>
            ))}
          </div>
        </div>
        <div className="hidden w-52 shrink-0 border-l border-[#222] bg-[#0a0a0a] p-4 lg:block">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Preview</p>
          <div className="relative mb-3 aspect-[3/4] overflow-hidden rounded-xl border border-[#333]">
            <Image
              src="/avatars/namira.jpg"
              alt="Avatar preview"
              fill
              unoptimized
              className="object-cover"
            />
            <span className="absolute left-2 top-2 livio-live-badge rounded bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white">
              LIVE
            </span>
          </div>
          <Link
            href="/dashboard"
            className="livio-live-badge flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-[#ff006b] to-[#e91e8c] py-2.5 text-xs font-bold text-white shadow-lg shadow-pink-500/30 hover:brightness-110 hover:scale-[1.02] transition-all duration-300"
          >
            Go Live
          </Link>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="livio-landing min-h-screen bg-black text-white selection:bg-[#ff006b]/40">
      {/* Header */}
      <header
        className={`sticky top-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? "border-white/10 bg-black/95 py-3 shadow-lg shadow-black/40"
            : "border-white/5 bg-black/70 py-4 backdrop-blur-xl"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <LivioLogo variant="icon-only" className="md:hidden" />
          <LivioLogo variant="primary" className="hidden md:inline-flex" />
          <nav className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-slate-300 hover:text-[#ff6eb4] transition-colors duration-200"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <GhostButton href="#demo">Book a Demo</GhostButton>
            <PinkButton href="/dashboard">Coba Gratis</PinkButton>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden pt-12 pb-8">
        <div className="livio-hero-glow pointer-events-none absolute inset-0" />
        {HERO_PARTICLES.map((p, i) => (
          <span
            key={i}
            className="livio-particle"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="livio-hero-enter livio-hero-enter-d1 mb-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold">
            <span className="text-[#ff006b]">#1 AI Live Streaming Tool</span>
            <span className="text-slate-600">|</span>
            <SectionBadge>Platform Live Streaming AI</SectionBadge>
          </div>

          <h1 className="livio-hero-enter livio-hero-enter-d2 text-[2.5rem] leading-[1.12] sm:text-5xl md:text-[3.25rem]">
            Buka Kekuatan Live Streaming
            <br />
            dengan{" "}
            <span className="bg-gradient-to-r from-[#ff006b] via-[#ff3388] to-[#ff6eb4] bg-clip-text text-transparent">
              AI Avatar
            </span>
          </h1>

          <p className="livio-hero-enter livio-hero-enter-d3 livio-subhead mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-slate-400">
            Jangkau audiens lebih luas, jual lebih banyak, dan jalankan live commerce 24/7 — semua
            otomatis dengan AI Host yang membalas komentar, menjelaskan produk, dan mendorong
            checkout tanpa host manusia.
          </p>

          <div className="livio-hero-enter livio-hero-enter-d4 mt-8 flex justify-center">
            <PinkButton href="/dashboard" size="lg">
              Coba Gratis
            </PinkButton>
          </div>
        </div>

        {/* Phone collage */}
        <div className="livio-hero-enter livio-hero-enter-d4 relative mx-auto mt-14 h-[340px] max-w-5xl sm:h-[400px]">
          <PhoneMockup
            className="left-[8%] top-8 h-[280px] w-[140px] sm:h-[320px] sm:w-[160px]"
            image="https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&h=700&fit=crop&q=80"
            rotate={-12}
            animDelay="livio-phone-delay-1"
          />
          <PhoneMockup
            className="left-1/2 top-0 z-10 h-[300px] w-[150px] -translate-x-1/2 sm:h-[360px] sm:w-[175px]"
            image="/avatars/namira.jpg"
            rotate={0}
            scale={1.05}
            animDelay="livio-phone-delay-2"
          />
          <PhoneMockup
            className="right-[8%] top-12 h-[270px] w-[135px] sm:h-[310px] sm:w-[155px]"
            image="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=700&fit=crop&q=80"
            rotate={10}
            animDelay="livio-phone-delay-3"
          />
          <PhoneMockup
            className="left-[22%] bottom-0 h-[200px] w-[100px] opacity-80 sm:h-[230px] sm:w-[115px]"
            image="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=500&fit=crop&q=80"
            rotate={-6}
            scale={0.9}
            animDelay="livio-phone-delay-4"
          />
          <PhoneMockup
            className="right-[20%] bottom-2 h-[210px] w-[105px] opacity-80 sm:h-[240px] sm:w-[120px]"
            image="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=500&fit=crop&q=80"
            rotate={8}
            scale={0.9}
            animDelay="livio-phone-delay-5"
          />
        </div>

        <p className="livio-hero-enter livio-hero-enter-d4 livio-body relative mt-6 text-center text-sm text-slate-500">
          Saksikan evolusi &apos;live commerce&apos; secara real-time.
        </p>
      </section>

      {/* Platforms */}
      <section className="border-y border-white/5 py-14">
        <Reveal className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-xl text-white sm:text-2xl">Mendukung Live Commerce Modern</h2>
          <p className="livio-subhead mt-2 text-sm text-slate-500">
            Siarkan live Anda ke platform yang paling sering digunakan audiens Anda.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-10 sm:gap-14">
            {supportedPlatforms.map((p, i) => (
              <Reveal key={p} delay={i * 80} direction="up">
                <PlatformLogo name={p} />
              </Reveal>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Features */}
      <section id="fitur" className="py-20 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff006b]">
              Keunggulan Utama
            </p>
          </Reveal>

          <div className="mt-14 space-y-16">
            {featureBlocks.map((block, idx) => (
              <Reveal
                key={block.id}
                delay={idx * 100}
                direction={block.reverse ? "right" : "left"}
              >
              <div
                className={`grid items-center gap-10 lg:grid-cols-2 ${block.reverse ? "lg:[direction:rtl]" : ""}`}
              >
                <div className={`${block.reverse ? "lg:[direction:ltr]" : ""}`}>
                  <div className="livio-card-hover overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#111] p-1 shadow-xl">
                    {block.id === "studio" && <StudioPreview />}
                    {block.id === "avatars" && (
                      <div className="grid grid-cols-5 gap-2 p-4">
                        {avatarGridImages.map((src) => (
                          <div key={src} className="relative aspect-square overflow-hidden rounded-lg">
                            <Image src={src} alt="" fill unoptimized className="object-cover" />
                          </div>
                        ))}
                      </div>
                    )}
                    {block.id === "comments" && (
                      <div className="flex gap-3 p-4">
                        <div className="relative h-48 w-36 shrink-0 overflow-hidden rounded-xl">
                          <Image src="/avatars/namira.jpg" alt="" fill unoptimized className="object-cover" />
                        </div>
                        <div className="flex-1 space-y-2 pt-2">
                          {[
                            { user: "Rina", text: "Harganya berapa kak?", delay: "0s" },
                            { user: "AI Host", text: "Harga spesial live hari ini Rp99.000 ya kak!", ai: true, delay: "0.15s" },
                            { user: "Budi", text: "Ada varian warna?", delay: "0.3s" },
                          ].map((c) => (
                            <div
                              key={c.text}
                              className={`livio-chat-bubble rounded-lg px-3 py-2 text-[11px] ${c.ai ? "bg-[#ff006b]/15 text-[#ff9fd0] border border-[#ff006b]/20" : "bg-[#1a1a1a] text-slate-300"}`}
                              style={{ animationDelay: c.delay }}
                            >
                              <span className="font-bold">{c.user}: </span>
                              {c.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {block.id === "multi" && (
                      <div className="space-y-3 p-5">
                        {[
                          { name: "TikTok Live", platform: "TikTok" as PlatformKey, on: true },
                          { name: "Shopee Live", platform: "Shopee" as PlatformKey, on: true },
                          { name: "Instagram Live", platform: "Instagram" as PlatformKey, on: false },
                          { name: "YouTube Live", platform: "YouTube" as PlatformKey, on: false },
                          { name: "Facebook Live", platform: "Facebook" as PlatformKey, on: false },
                        ].map((p) => (
                          <div
                            key={p.name}
                            className="flex items-center justify-between rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3"
                          >
                            <div className="flex items-center gap-3">
                              <PlatformIcon name={p.platform} size="sm" />
                              <span className="text-sm font-medium text-white">{p.name}</span>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${p.on ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700/50 text-slate-500"}`}
                            >
                              {p.on ? "Live" : "Off"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`${block.reverse ? "lg:[direction:ltr]" : ""}`}>
                  <FeatureIcon id={block.id} />
                  <h3 className="text-2xl leading-snug text-white sm:text-[1.65rem]">
                    {block.title}
                  </h3>
                  <p className="livio-body mt-4 text-[15px] leading-relaxed text-slate-400">{block.description}</p>
                </div>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="use-cases" className="border-t border-white/5 bg-[#050505] py-20 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <Reveal>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff006b]">Cara Kerjanya</p>
            <h2 className="mt-3 text-2xl text-white sm:text-3xl">
              Mulai live AI dalam 3 langkah
            </h2>
          </Reveal>

          <Reveal delay={150}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm">
            {howItWorksSteps.map((s, i) => (
              <React.Fragment key={s.step}>
                <div className="flex items-center gap-2 rounded-full border border-[#333] bg-[#111] px-4 py-2 transition-all duration-300 hover:border-[#ff006b]/40 hover:bg-[#ff006b]/5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff006b] text-xs font-bold">
                    {s.step}
                  </span>
                  <span className="font-medium text-slate-200">{s.label}</span>
                </div>
                {i < howItWorksSteps.length - 1 && (
                  <span className="hidden text-slate-600 sm:inline animate-pulse">→</span>
                )}
              </React.Fragment>
            ))}
          </div>
          </Reveal>

          <Reveal delay={250}>
            <DashboardMockup />
          </Reveal>

          <Reveal delay={350}>
          <div className="mt-10">
            <PinkButton href="/dashboard" size="lg">
              Coba Gratis
            </PinkButton>
          </div>
          </Reveal>
        </div>
      </section>

      {/* Comparison */}
      <section id="harga" className="py-20 scroll-mt-20">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
            <h2 className="text-center text-2xl text-white sm:text-3xl">
              Biaya Live Streaming Anda Terlalu Tinggi?
            </h2>
          </Reveal>

          <div className="relative mt-12 grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-start">
            <Reveal direction="left" delay={100}>
            <div className="livio-card-hover rounded-2xl border border-[#2a2a2a] bg-[#0d0d0d] p-6">
              <p className="mb-4 text-center text-xs font-bold uppercase tracking-widest text-slate-500">
                Tanpa Livio
              </p>
              <div className="relative mb-5 aspect-video overflow-hidden rounded-xl grayscale">
                <Image
                  src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=600&h=400&fit=crop&q=80"
                  alt="Stressed host"
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <ul className="space-y-3">
                {withoutLivio.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-400">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            </Reveal>

            <Reveal delay={200}>
            <div className="flex items-center justify-center md:pt-24">
              <div className="livio-float-slow flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#333] bg-[#111] text-sm font-black text-slate-400">
                VS
              </div>
            </div>
            </Reveal>

            <Reveal direction="right" delay={100}>
            <div className="livio-card-hover rounded-2xl border border-[#ff006b]/30 bg-[#ff006b]/5 p-6">
              <p className="mb-4 text-center text-xs font-bold uppercase tracking-widest text-[#ff6eb4]">
                Dengan Livio
              </p>
              <div className="relative mx-auto mb-5 h-[200px] w-[120px] overflow-hidden rounded-[24px] border-[3px] border-[#333]">
                <Image src="/avatars/namira.jpg" alt="Livio app" fill unoptimized className="object-cover" />
              </div>
              <ul className="space-y-3">
                {withLivio.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-200">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-white/5 bg-[#050505] py-20 scroll-mt-20">
        <div className="mx-auto max-w-3xl px-6">
          <Reveal>
            <h2 className="text-center text-2xl text-white sm:text-3xl">
              Pertanyaan yang Sering Ditanyakan
            </h2>
          </Reveal>
          <div className="mt-10 space-y-2">
            {faqItems.map((item, i) => (
              <Reveal key={item.q} delay={i * 60}>
              <div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#111] transition-colors duration-300 hover:border-[#333]">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-white hover:bg-white/[0.02] transition cursor-pointer"
                >
                  {item.q}
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300 ${openFaq === i ? "rotate-180" : ""}`}
                  />
                </button>
                <div className={`livio-faq-body ${openFaq === i ? "livio-faq-body-open" : ""}`}>
                  <div className="livio-faq-inner">
                    <div className="border-t border-[#222] px-5 py-4 text-sm leading-relaxed text-slate-400 livio-body">
                      {item.a}
                    </div>
                  </div>
                </div>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="update" className="border-t border-white/5 py-14 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <Reveal>
            <div>
              <LivioLogo variant="text-only" />
              <p className="livio-body mt-4 text-sm leading-relaxed text-slate-500">
                Platform AI live streaming untuk seller dan brand Indonesia. Otomatisasi live
                commerce dengan avatar, auto-reply, dan multi-platform RTMP.
              </p>
              <p className="mt-3 text-xs font-semibold text-[#ff6eb4]">
                Jualan lebih cerdas. Live lebih cepat.
              </p>
            </div>
            </Reveal>
            <Reveal delay={80}>
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-400">Fitur</p>
              <ul className="space-y-2">
                {footerLinks.fitur.map((l) => (
                  <li key={l}>
                    <a href="#fitur" className="text-sm text-slate-500 hover:text-white transition">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            </Reveal>
            <Reveal delay={160}>
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-400">Resources</p>
              <ul className="space-y-2">
                {footerLinks.resources.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-sm text-slate-500 hover:text-white transition">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            </Reveal>
            <Reveal delay={240}>
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-400">Perusahaan</p>
              <ul className="space-y-2">
                {footerLinks.perusahaan.map((l) => (
                  <li key={l}>
                    <a href="#harga" className="text-sm text-slate-500 hover:text-white transition">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            </Reveal>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[#222] pt-8 sm:flex-row">
            <p className="text-xs text-slate-600">
              © {new Date().getFullYear()} Livio. All rights reserved.
            </p>
            <div className="flex items-center gap-5">
              {footerSocialPlatforms.map((s) => (
                <a
                  key={s}
                  href="#"
                  aria-label={platformIcons[s]?.label ?? s}
                  className="livio-platform-logo opacity-50 transition hover:opacity-100"
                >
                  <PlatformIcon name={s} size="sm" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
