import { Avatar } from "./types";

export function avatarIdleVideoPath(avatarId: string): string {
  const id = (avatarId || "namira").toLowerCase();
  // Prefer idle_1 (rest diam + lipsync); fallback idle generik.
  return `/avatars/${id}_idle_1.mp4`;
}

export const avatars: Avatar[] = [
  {
    id: "namira",
    name: "Namira",
    role: "Energetic Live Host",
    type: "3D",
    language: "Bahasa Indonesia",
    voice: "id-ID-GadisNeural",
    image: "/avatars/namira.png",
    modelUrl3d: "/models/TufrillaVRM.vrm",
    specialty: "Hard-Selling TikTok Live",
  },
];
