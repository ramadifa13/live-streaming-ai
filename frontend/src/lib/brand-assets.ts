export const livioLogos = {
  primary: "/logo-livio-primary.png",
  textOnly: "/logo-livio-text-only.png",
  iconOnly: "/logo-livio-icon-only.png",
} as const;

export const platformIcons = {
  TikTok: { src: "/icon-tiktok.svg", label: "TikTok" },
  Shopee: { src: "/icon-shopee.svg", label: "Shopee" },
  Instagram: { src: "/icon-instagram.svg", label: "Instagram" },
  YouTube: { src: "/icon-youtube.svg", label: "YouTube" },
  Facebook: { src: "/icon-facebook.svg", label: "Facebook" },
} as const;

export type PlatformKey = keyof typeof platformIcons;

export const supportedPlatforms: PlatformKey[] = [
  "TikTok",
  "Shopee",
  "Instagram",
  "YouTube",
  "Facebook",
];

export const footerSocialPlatforms: PlatformKey[] = [
  "TikTok",
  "YouTube",
  "Instagram",
  "Facebook",
];

export const dashboardPlatforms = [
  { value: "Instagram Live", key: "Instagram" as PlatformKey },
  { value: "Facebook Live", key: "Facebook" as PlatformKey },
  { value: "TikTok LIVE", key: "TikTok" as PlatformKey },
  { value: "Shopee Live", key: "Shopee" as PlatformKey },
  { value: "YouTube", key: "YouTube" as PlatformKey, label: "YouTube Live" },
  { value: "Custom RTMP", key: null, label: "Custom RTMP Server" },
] as const;

export function resolvePlatformKey(platformName: string): PlatformKey | null {
  const normalized = platformName.toLowerCase();
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("shopee")) return "Shopee";
  if (normalized.includes("instagram")) return "Instagram";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("facebook")) return "Facebook";
  return null;
}
