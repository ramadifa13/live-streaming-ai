"use client";

import React from "react";
import PhotorealisticAvatarView from "./avatar/PhotorealisticAvatarView";
import { AvatarMode } from "./avatar/avatarTypes";

interface Avatar3DCanvasProps {
  isSpeaking: boolean;
  avatarName: string;
  avatarImage?: string;
  avatarModelUrl?: string;
  avatarRole?: string;
  mode?: "3D";
  tone?: string;
  className?: string;
}

/**
 * Avatar3DCanvas / Photorealistic Presenter Component
 * Renders the Namira 3D AI Host with real-time speech visualizer.
 */
export default function Avatar3DCanvas({
  isSpeaking,
  avatarName = "Namira",
  avatarImage,
  avatarRole,
  mode = "3D",
  tone = "Persuasif",
  className = "",
}: Avatar3DCanvasProps) {
  return (
    <PhotorealisticAvatarView
      avatarName={avatarName}
      avatarImage={avatarImage}
      avatarRole={avatarRole}
      isSpeaking={isSpeaking}
      mode={mode as AvatarMode}
      tone={tone}
      className={className}
    />
  );
}
