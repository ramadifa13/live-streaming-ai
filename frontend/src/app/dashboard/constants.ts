import { Avatar } from "./types";

export type TtsLangCode = "id" | "en";

export const TTS_LANGS: Array<{
  code: TtsLangCode;
  short: string;
  label: string;
}> = [
  { code: "id", short: "ID", label: "Indonesia" },
  { code: "en", short: "EN", label: "English" },
];

export type HostVoiceGender = "female" | "male";

export interface HostVoiceOption {
  id: string;
  label: string;
  gender: HostVoiceGender;
  style: string;
}

/** Suara VoxCPM2 untuk host perempuan (pre-live = sample lokal). */
export const FEMALE_HOST_VOICES: HostVoiceOption[] = [
  {
    id: "girl_cute_kids",
    label: "girl - cute kids",
    gender: "female",
    style: "Cute Kids",
  },
  {
    id: "girl_warm_youthful",
    label: "girl - warm & youthful",
    gender: "female",
    style: "Warm & Youthful",
  },
  {
    id: "girl_warm_friendly",
    label: "girl - warm & friendly",
    gender: "female",
    style: "Warm & Friendly",
  },
  {
    id: "girl_calm_professional",
    label: "girl - calm & professional",
    gender: "female",
    style: "Calm & Professional",
  },
];

export const DEFAULT_VOICE_ID = FEMALE_HOST_VOICES[0].id;

export function voicesForAvatarGender(gender?: string | null): HostVoiceOption[] {
  const g = (gender || "female").toLowerCase();
  if (g === "male") {
    // Belum ada katalog pria ΓÇö kosong agar UI tidak menampilkan suara perempuan.
    return [];
  }
  return FEMALE_HOST_VOICES;
}

/** Sample pre-live (statis) ΓÇö tidak hit pod. */
export function localVoicePreviewUrl(voiceId: string, lang: TtsLangCode = "id"): string {
  const id = (voiceId || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID;
  const code = lang === "en" ? "en" : "id";
  return `/voices/${id}/preview_${code}.wav`;
}

export function avatarIdleVideoPath(avatarId: string): string {
  const id = (avatarId || "namira").toLowerCase();
  return `/avatars/${id}_idle.mp4`;
}

export const avatars: Avatar[] = [
  {
    id: "namira",
    name: "Namira",
    role: "Energetic Live Host",
    type: "3D",
    language: "Bahasa Indonesia",
    gender: "female",
    voice: DEFAULT_VOICE_ID,
    image: "/avatars/namira.png",
    modelUrl3d: "",
    specialty: "Hard-Selling TikTok Live",
  },
];

export interface DefaultBackground {
  id: string;
  name: string;
  category: string;
  url: string;
  preview: string;
}

export const DEFAULT_BACKGROUNDS: DefaultBackground[] = [
  {
    id: "studio-modern",
    name: "Studio Modern Neon",
    category: "Live Studio",
    url: "/banner_studio_live_streaming.jpg",
    preview: "/banner_studio_live_streaming.jpg",
  },
  {
    id: "cozy-room",
    name: "Cozy Room Studio",
    category: "Room",
    url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=720&h=1280&fit=crop&q=80",
    preview: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=200&h=355&fit=crop&q=80",
  },
  {
    id: "clean-minimalist",
    name: "Minimalist Soft White",
    category: "Minimalist",
    url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=720&h=1280&fit=crop&q=80",
    preview: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=200&h=355&fit=crop&q=80",
  },
  {
    id: "retail-shop",
    name: "Boutique Retail",
    category: "Store",
    url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=720&h=1280&fit=crop&q=80",
    preview: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=200&h=355&fit=crop&q=80",
  },
];
