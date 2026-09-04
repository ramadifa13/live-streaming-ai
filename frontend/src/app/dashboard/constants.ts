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

/** Default VoxCPM2 voice_id — ganti reference.wav tanpa ubah kode. */
export const DEFAULT_VOICE_ID = "default_host";

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
