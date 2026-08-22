"use client";

import React from "react";
import PhotorealisticAvatarView from "./PhotorealisticAvatarView";
import { AvatarMode } from "./avatarTypes";

interface AvatarRendererProps {
  mode?: AvatarMode;
  avatarName: string;
  avatarImage?: string;
  avatarRole?: string;
  isSpeaking?: boolean;
  tone?: string;
  className?: string;
}

export default function AvatarRenderer({
  mode = "3D",
  avatarName = "Luna",
  avatarImage,
  avatarRole,
  isSpeaking = false,
  tone = "Persuasif",
  className = "",
}: AvatarRendererProps) {
  return (
    <PhotorealisticAvatarView
      avatarName={avatarName}
      avatarImage={avatarImage}
      avatarRole={avatarRole}
      isSpeaking={isSpeaking}
      mode={mode}
      tone={tone}
      className={className}
    />
  );
}
