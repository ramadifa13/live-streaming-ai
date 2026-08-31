"use client";

import Image from "next/image";
import Link from "next/link";
import { livioLogos } from "@/lib/brand-assets";

type LivioLogoVariant = "primary" | "text-only" | "icon-only";

type LivioLogoProps = {
  variant?: LivioLogoVariant;
  className?: string;
  href?: string;
};

export function LivioLogo({ variant = "primary", className = "", href = "/" }: LivioLogoProps) {
  const src =
    variant === "primary"
      ? livioLogos.primary
      : variant === "text-only"
        ? livioLogos.textOnly
        : livioLogos.iconOnly;

  const sizeClass =
    variant === "icon-only"
      ? "h-9 w-9"
      : variant === "text-only"
        ? "h-7 w-auto"
        : "h-9 w-auto sm:h-10";

  return (
    <Link href={href} className={`inline-flex shrink-0 items-center group ${className}`}>
      <Image
        src={src}
        alt="Livio"
        width={variant === "icon-only" ? 36 : 160}
        height={variant === "icon-only" ? 36 : 40}
        className={`${sizeClass} object-contain transition-opacity duration-200 group-hover:opacity-90`}
        priority={variant === "primary"}
      />
    </Link>
  );
}
