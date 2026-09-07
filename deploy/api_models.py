"""Pydantic request and response models for LiveStreamer AI Worker API server."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel


class GenerateVideoRequest(BaseModel):
    text: str
    avatar_name: Optional[str] = None
    avatarName: Optional[str] = None
    avatar_image_path: Optional[str] = None
    avatarImagePath: Optional[str] = None
    host_name: Optional[str] = None
    hostName: Optional[str] = None
    host_type: Optional[str] = None
    hostType: Optional[str] = None
    voice: Optional[str] = None
    voice_id: Optional[str] = None
    voiceId: Optional[str] = None
    language: Optional[str] = None
    style: Optional[str] = None
    emotion: Optional[str] = None
    speed: float = 1.0
    tone: str = "Persuasif"
    audio_base64: Optional[str] = None
    audioBase64: Optional[str] = None
    audio_url: Optional[str] = None
    audioUrl: Optional[str] = None
    wait: Optional[bool] = False
    action: Optional[str] = None
    priority: Optional[bool] = False
    live_session_id: Optional[str] = None
    liveSessionId: Optional[str] = None


class TtsSynthesizeRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    voiceId: Optional[str] = None
    language: Optional[str] = None
    style: Optional[str] = None
    emotion: Optional[str] = None
    request_id: Optional[str] = None
    requestId: Optional[str] = None
    live_session_id: Optional[str] = None
    liveSessionId: Optional[str] = None


class BroadcastRequest(BaseModel):
    model_config = {"extra": "ignore"}
    rtmp_url: Optional[str] = None
    rtmpUrl: Optional[str] = None
    stream_key: Optional[str] = None
    streamKey: Optional[str] = None
    idle_video: Optional[str] = None
    idleVideo: Optional[str] = None
    product_name: Optional[str] = None
    productName: Optional[str] = None
    product_price: Optional[str] = None
    productPrice: Optional[str] = None
    product_image_url: Optional[str] = None
    productImageUrl: Optional[str] = None
    banner_image_url: Optional[str] = None
    bannerImageUrl: Optional[str] = None
    background_image: Optional[str] = None
    backgroundImage: Optional[str] = None
    platform: Optional[str] = None
    stock_count: Optional[Any] = None
    cta_label: Optional[str] = None
    host_name: Optional[str] = None
    hostName: Optional[str] = None
    avatar_name: Optional[str] = None
    avatarName: Optional[str] = None


class PlaybackRequest(BaseModel):
    action: str


class UpdateProductRequest(BaseModel):
    product_name: Optional[str] = None
    productName: Optional[str] = None
    product_price: Optional[str] = None
    productPrice: Optional[str] = None
    product_image_url: Optional[str] = None
    productImageUrl: Optional[str] = None
    banner_image_url: Optional[str] = None
    bannerImageUrl: Optional[str] = None
