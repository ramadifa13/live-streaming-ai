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

/** Default profile id; the voice catalog itself comes from the backend. */
export const DEFAULT_VOICE_ID = "girl_cute_kids";

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
    imageProfile: "/avatars/namira_profile.png",
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
    url: "/after_livio.jpg",
    preview: "/after_livio.jpg",
  },
  {
    id: "clean-minimalist",
    name: "Minimalist Soft White",
    category: "Minimalist",
    url: "/before_livio.jpg",
    preview: "/before_livio.jpg",
  },
  {
    id: "retail-shop",
    name: "Boutique Retail",
    category: "Store",
    url: "/banner_atas_tengah.png",
    preview: "/banner_atas_tengah.png",
  },
];
