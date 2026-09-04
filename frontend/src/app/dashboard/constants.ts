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

export function voicesForAvatarGender(
  gender?: string | null,
): HostVoiceOption[] {
  const g = (gender || "female").toLowerCase();
  if (g === "male") {
    // Belum ada katalog pria — kosong agar UI tidak menampilkan suara perempuan.
    return [];
  }
  return FEMALE_HOST_VOICES;
}

/** Sample pre-live (statis) — tidak hit pod. */
export function localVoicePreviewUrl(
  voiceId: string,
  lang: TtsLangCode = "id",
): string {
  const id = (voiceId || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID;
  const code = lang === "en" ? "en" : "id";
  return `/voices/${id}/preview_${code}.wav`;
}

export function avatarIdleVideoPath(avatarId: string): string {
  const id = (avatarId || "namira").toLowerCase();
  return `/avatars/${id}_idle_1.mp4`;
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
    modelUrl3d: "/models/TufrillaVRM.vrm",
    specialty: "Hard-Selling TikTok Live",
  },
];
