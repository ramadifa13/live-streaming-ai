import {
  platformIcons,
  resolvePlatformKey,
  type PlatformKey,
} from "@/lib/brand-assets";

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
    <img
      src={platform.src}
      alt={platform.label}
      className={`object-contain ${sizeClasses[size]} ${className}`}
    />
  );
}
