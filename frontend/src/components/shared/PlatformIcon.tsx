import {
  platformIcons,
  resolvePlatformKey,
  type PlatformKey,
} from "@/lib/brand-assets";
import Image from "next/image";

type PlatformIconProps = {
  name?: PlatformKey;
  platformName?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClasses = {
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-12 w-12",
} as const;

const pixelSize = {
  sm: 20,
  md: 32,
  lg: 48,
} as const;

export function PlatformIcon({
  name,
  platformName,
  size = "md",
  className = "",
}: PlatformIconProps) {
  const key = name ?? (platformName ? resolvePlatformKey(platformName) : null);
  if (!key) return null;

  const platform = platformIcons[key];
  if (!platform) return null;

  return (
    <Image
      src={platform.src}
      alt={platform.label}
      width={pixelSize[size]}
      height={pixelSize[size]}
      className={`object-contain ${sizeClasses[size]} ${className}`}
    />
  );
}
