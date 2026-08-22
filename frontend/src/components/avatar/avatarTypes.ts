/**
 * Core Avatar Type Definitions for LiveStreamerAI
 * Aligned with photorealistic AI Presenter architecture.
 */

export type AvatarMode = "2D" | "3D";

export interface AvatarProfile {
  id: string;
  name: string;
  role?: string;
  type: AvatarMode;
  style?: string;
  language?: string;
  voice?: string;
  image: string;
  description?: string;
}

export interface AvatarSpeakingState {
  isSpeaking: boolean;
  activePrompt?: string;
  activeAudioUrl?: string;
}
