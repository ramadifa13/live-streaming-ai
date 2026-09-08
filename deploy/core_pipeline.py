"""
Core Live Streaming Pipeline for AI Worker (RunPod)
Rewritten for optimal concurrency, zero-latency fallback, and seamless transitions.
"""

from __future__ import annotations
import os
import sys
import time
import queue
import threading
import subprocess
import asyncio
from typing import Dict, Any, Optional, Tuple, Callable
import torch
import numpy as np
from PIL import Image

try:
    from video_canvas import CANVAS_H, CANVAS_W, fit_bgr
except ImportError:
    CANVAS_W = 720
    CANVAS_H = 1280

try:
    from worker_telemetry import get_telemetry
except ImportError:

    def get_telemetry():
        class NoopMetric:
            def inc(self, *args, **kwargs):
                pass

            def record_latency(self, *args, **kwargs):
                pass

            def set_gauge(self, *args, **kwargs):
                pass

            def measure(self, *args, **kwargs):
                class NoopContextManager:
                    def __enter__(self):
                        pass

                    def __exit__(self, exc_type, exc_val, exc_tb):
                        pass

                return NoopContextManager()

        return NoopMetric()


TARGET_FPS = 24
AUDIO_SAMPLE_RATE = 16000
AUDIO_CHANNELS = 2
BYTES_PER_AUDIO_FRAME = (
    int(round(AUDIO_SAMPLE_RATE / float(TARGET_FPS))) * 2 * AUDIO_CHANNELS
)


def _silence_bytes_for_frame(frame_index: int) -> bytes:
    start = int(frame_index * AUDIO_SAMPLE_RATE / TARGET_FPS)
    end = int((frame_index + 1) * AUDIO_SAMPLE_RATE / TARGET_FPS)
    return b"\x00" * (max(1, end - start) * 2 * AUDIO_CHANNELS)


# === Refactored Components === #
from ai_worker import (
    AssetBank,
    LipSyncEngine,
    VideoStateMachine,
    RawFramePacket,
    RenderedPacket,
)
from ai_worker import frame_fetcher_loop, lipsync_worker_loop, _IdleFallbackPlayer
import cv2

try:
    from rtmp_utils import (
        preflight_rtmp_publish,
        validate_publish_url,
        summarize_ffmpeg_stderr,
        write_rtmp_status,
        FfmpegLogWatcher,
    )
except ImportError:
    preflight_rtmp_publish = None
    validate_publish_url = None
    summarize_ffmpeg_stderr = None
    write_rtmp_status = None
    FfmpegLogWatcher = None


class StreamBroadcaster(threading.Thread):
    _ffmpeg_ipv4_supported: Optional[bool] = None

    def __init__(
        self,
        rtmp_url: str,
        bank: AssetBank,
        render_q: queue.Queue,
        stop_event: threading.Event,
        output_folder: str,
        background_path: str = "",
        overlay_path: str = "",
        bridge=None,
    ):
        super().__init__(name="StreamBroadcaster", daemon=True)
        self.rtmp_url = (rtmp_url or "").strip()
        self.bank = bank
        self.render_q = render_q
        self.stop_event = stop_event
        self.output_folder = output_folder
        self.background_path = background_path
        self.overlay_path = overlay_path
        self.bridge = bridge

        self.proc = None
        self.v_fh = None
        self.a_fh = None
        self.progress_seen = False
        self.last_error = ""
        self.stderr_tail = ""

        # Smooth fallback player (mencegah patah jumping saat transisi rest pose)
        self.fallback_player = _IdleFallbackPlayer(bank)
        self.silence_pcm = b"\x00" * BYTES_PER_AUDIO_FRAME
        self._audio_frame_index = 0

        # Background & Overlay buffers
        self._bg_bgr: Optional[np.ndarray] = None
        self._ov_rgb: Optional[np.ndarray] = None
        self._ov_alpha: Optional[np.ndarray] = None
        self._foreground_masks: dict[tuple[str, int], np.ndarray] = {}
        self._init_bg_overlay()

    def _init_bg_overlay(self):
        self._bg_mtime = 0.0
        self._last_bg_check = 0.0
        self._reload_background()
        self._ov_candidate = self.overlay_path
        self._last_ov_check = 0.0
        self._reload_overlay()

    def _reload_background(self):
        bg_path = self.background_path
        if (not bg_path or not os.path.exists(bg_path)) and self.output_folder:
            for ext in (".jpg", ".png", ".jpeg", ".webp"):
                cand = os.path.join(self.output_folder, f"custom_background{ext}")
                if os.path.exists(cand):
                    bg_path = cand
                    break

        if not bg_path or not os.path.exists(bg_path):
            for cand in [
                "/workspace/live-streaming-ai/frontend/public/banner_studio_live_streaming.jpg",
                os.path.join(
                    os.path.dirname(__file__),
                    "../frontend/public/banner_studio_live_streaming.jpg",
                ),
                "/workspace/ai_live_worker/assets/banner_studio_live_streaming.jpg",
                os.path.join(
                    os.path.dirname(__file__), "assets/banner_studio_live_streaming.jpg"
                ),
            ]:
                if os.path.isfile(cand):
                    bg_path = cand
                    break

        if bg_path and os.path.exists(bg_path):
            try:
                mtime = os.path.getmtime(bg_path)
                if (
                    getattr(self, "_bg_mtime", None) == mtime
                    and self._bg_bgr is not None
                ):
                    return
                bg = cv2.imread(bg_path)
                if bg is not None:
                    self._bg_bgr = fit_bgr(bg, CANVAS_W, CANVAS_H)
                    self._bg_mtime = mtime
                    print(
                        f"[StreamBroadcaster] ✅ Custom background berhasil dimuat: {bg_path}"
                    )
            except Exception as e:
                print(f"[StreamBroadcaster] Failed to load background: {e}")

    def _reload_overlay(self):
        cand = self._ov_candidate
        if (not cand or not os.path.exists(cand)) and self.output_folder:
            for c in (
                os.path.join(self.output_folder, "overlay_live.png"),
                os.path.join(self.output_folder, "tmp_assets", "live_overlay.png"),
            ):
                if os.path.exists(c):
                    cand = c
                    break
        if cand and os.path.exists(cand):
            try:
                mtime = os.path.getmtime(cand)
                if (
                    getattr(self, "_ov_mtime", None) == mtime
                    and self._ov_alpha is not None
                ):
                    return
                ov = cv2.imread(cand, cv2.IMREAD_UNCHANGED)
                if ov is not None:
                    if ov.shape[0] != CANVAS_H or ov.shape[1] != CANVAS_W:
                        ov = cv2.resize(ov, (CANVAS_W, CANVAS_H))
                    if ov.shape[2] == 4:
                        self._ov_alpha = ov[:, :, 3:4].astype(np.float32) / 255.0
                        self._ov_rgb = ov[:, :, :3].astype(np.float32)
                        self._ov_mtime = mtime
                        print(
                            f"[StreamBroadcaster] ✅ Overlay berhasil dimuat dari: {cand}"
                        )
            except Exception as e:
                print(f"[StreamBroadcaster] Failed to load overlay: {e}")

    def is_ffmpeg_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    @classmethod
    def _ffmpeg_ipv4_flag_supported(cls) -> bool:
        if cls._ffmpeg_ipv4_supported is not None:
            return cls._ffmpeg_ipv4_supported
        try:
            p = subprocess.run(
                ["ffmpeg", "-hide_banner", "-4", "-version"],
                capture_output=True,
                timeout=8,
            )
            err = (p.stderr or p.stdout or b"").decode("utf-8", errors="ignore").lower()
            cls._ffmpeg_ipv4_supported = p.returncode == 0 and "unrecognized" not in err
        except Exception:
            cls._ffmpeg_ipv4_supported = False
        return cls._ffmpeg_ipv4_supported

    def _apply_overlay(self, frame: np.ndarray) -> np.ndarray:
        if self._ov_alpha is None or self._ov_rgb is None:
            return frame
        base = frame.astype(np.float32)
        out = base * (1.0 - self._ov_alpha) + self._ov_rgb * self._ov_alpha
        return out.astype(np.uint8)

    def _source_foreground_mask(
        self, clip_name: str, frame_idx: int, frame: np.ndarray
    ) -> np.ndarray:
        key = (clip_name or "idle", int(frame_idx))
        cached = self._foreground_masks.get(key)
        if cached is not None:
            return cached

        # Studio keying yang stabil tanpa jitter iteratif GrabCut:
        # Deteksi latar putih/terang studio Namira dengan threshold halus (anti-flicker).
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Area putih/background studio: Saturation rendah (< 35) dan Value tinggi (> 210)
        is_bg = (hsv[:, :, 1] < 40) & (gray > 215)
        raw_mask = np.where(is_bg, 0, 255).astype(np.uint8)

        # Haluskan tepian dengan morphology & gaussian blur agar transisi mulus
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        raw_mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel)
        smooth_mask = cv2.GaussianBlur(raw_mask, (15, 15), 0)

        # Temporal smoothing (EMA) dengan frame sebelumnya jika ada agar batas rambut tidak bergetar
        prev_key = (clip_name or "idle", max(0, int(frame_idx) - 1))
        prev_mask = self._foreground_masks.get(prev_key)
        if prev_mask is not None and prev_mask.shape == smooth_mask.shape:
            smooth_mask = cv2.addWeighted(prev_mask, 0.45, smooth_mask, 0.55, 0)

        self._foreground_masks[key] = smooth_mask
        if len(self._foreground_masks) > 300:
            self._foreground_masks.pop(next(iter(self._foreground_masks)))
        return smooth_mask

    def _replace_video_background(
        self, frame: np.ndarray, clip_name: str = "", frame_idx: int = 0
    ) -> np.ndarray:
        """Replace video background without flicker using smooth studio matte."""
        if self._bg_bgr is None or frame is None or frame.size == 0:
            return frame
        if self._bg_bgr.shape[:2] != frame.shape[:2]:
            self._bg_bgr = fit_bgr(self._bg_bgr, frame.shape[1], frame.shape[0])
        source = frame
        if self.bank is not None and clip_name:
            clip = self.bank.get_clip(clip_name)
            if clip is not None and clip.frames:
                source = clip.frames[max(0, min(int(frame_idx), len(clip.frames) - 1))]

        alpha = (
            self._source_foreground_mask(clip_name, frame_idx, source).astype(
                np.float32
            )[:, :, None]
            / 255.0
        )
        foreground = frame.astype(np.float32)
        background = self._bg_bgr.astype(np.float32)
        return np.clip(foreground * alpha + background * (1.0 - alpha), 0, 255).astype(
            np.uint8
        )

    @staticmethod
    def _write_all(fh, data: bytes) -> None:
        """Tulis seluruh buffer ke blocking pipe (mencegah partial pipe write drop)."""
        view = memoryview(data)
        offset = 0
        while offset < len(view):
            n = fh.write(view[offset:])
            if n is None or n <= 0:
                raise BrokenPipeError("Pipe write returned 0 (broken connection)")
            offset += n

    def _build_cmd(self, v_in: str, a_in: str, *, use_ipv4: bool) -> list:
        gop = TARGET_FPS * 2
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "info"]
        if use_ipv4:
            cmd.append("-4")

        cmd.extend(
            [
                "-fflags",
                "+nobuffer+genpts",
                "-thread_queue_size",
                "1024",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "bgr24",
                "-s",
                f"{CANVAS_W}x{CANVAS_H}",
                "-r",
                str(TARGET_FPS),
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-i",
                v_in,
                "-thread_queue_size",
                "1024",
                "-f",
                "s16le",
                "-ar",
                str(AUDIO_SAMPLE_RATE),
                "-ac",
                str(AUDIO_CHANNELS),
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-i",
                a_in,
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-pix_fmt",
                "yuv420p",
                "-profile:v",
                "baseline",
                "-level",
                "3.1",
                "-g",
                str(gop),
                "-keyint_min",
                str(gop),
                "-sc_threshold",
                "0",
                "-b:v",
                "2500k",
                "-maxrate",
                "2500k",
                "-bufsize",
                "2500k",
                "-vsync",
                "cfr",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-ar",
                "44100",
                "-flvflags",
                "no_duration_filesize",
                "-f",
                "flv",
                "-rtmp_live",
                "live",
                "-stimeout",
                "30000000",
                "-rw_timeout",
                "30000000",
            ]
        )

        if self.rtmp_url.lower().startswith("rtmps://"):
            cmd.extend(["-tls_verify", "0"])
        cmd.append(self.rtmp_url)
        return cmd

    def _start_ffmpeg(self):
        # Preflight Check untuk mencegah silent failure / DNS hang
        if validate_publish_url:
            self.rtmp_url = validate_publish_url(self.rtmp_url)
        if preflight_rtmp_publish:
            print(f"[StreamBroadcaster] Preflight checking RTMP host...")
            preflight_rtmp_publish(self.rtmp_url)

        print(
            f"[StreamBroadcaster] Starting FFmpeg to {self.rtmp_url.split('?')[0]}?***"
        )
        video_r, video_w = os.pipe()
        audio_r, audio_w = os.pipe()
        os.set_inheritable(video_r, True)
        os.set_inheritable(audio_r, True)
        os.set_inheritable(video_w, False)
        os.set_inheritable(audio_w, False)

        v_in = f"/proc/self/fd/{video_r}"
        a_in = f"/proc/self/fd/{audio_r}"

        force_ipv4 = True
        ipv4_ok = force_ipv4 and self._ffmpeg_ipv4_flag_supported()
        attempts = [ipv4_ok, False] if ipv4_ok else [False]

        proc = None
        for idx, use_v4 in enumerate(attempts):
            cmd = self._build_cmd(v_in, a_in, use_ipv4=use_v4)
            if idx > 0:
                print("[StreamBroadcaster] Retrying FFmpeg without -4 IPv4 flag...")
            try:
                proc = subprocess.Popen(
                    cmd,
                    pass_fds=(video_r, audio_r),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
                time.sleep(0.35)
                if proc.poll() is None:
                    self.proc = proc
                    break
                try:
                    stderr_bytes = proc.communicate(timeout=1)[1] or b""
                    stderr_text = stderr_bytes.decode("utf-8", errors="ignore")
                    self.stderr_tail = stderr_text[-12000:]
                    if summarize_ffmpeg_stderr:
                        self.last_error = summarize_ffmpeg_stderr(
                            self.stderr_tail,
                            "FFmpeg RTMP berhenti saat handshake — periksa stream key / server URL.",
                        )
                except Exception:
                    pass
            except Exception as e:
                self.last_error = str(e)
                continue

        if self.proc is None or self.proc.poll() is not None:
            os.close(video_r)
            os.close(audio_r)
            try:
                os.close(video_w)
                os.close(audio_w)
            except Exception:
                pass
            hint = (
                self.last_error
                or "FFmpeg RTMP gagal start (proses keluar saat inisialisasi)"
            )
            if write_rtmp_status and self.output_folder:
                write_rtmp_status(self.output_folder, "failed", hint)
            raise RuntimeError(hint)

        os.close(video_r)
        os.close(audio_r)
        self.v_fh = os.fdopen(video_w, "wb", buffering=0)
        self.a_fh = os.fdopen(audio_w, "wb", buffering=0)

        # Feed initial frames segera agar handshake RTMP langsung jalan tanpa deadlock probe
        try:
            init_frame = self.fallback_player.next_frame()
            init_frame = fit_bgr(init_frame, CANVAS_W, CANVAS_H)
            init_frame = self._replace_video_background(
                init_frame,
                self.bank.idle_clip.name,
                self.bank.idle_clip.base_pose_frame,
            )
            init_buf = np.ascontiguousarray(init_frame, dtype=np.uint8).tobytes()
            init_pcm = self.silence_pcm
            for _ in range(5):
                self._write_all(self.v_fh, init_buf)
                self._write_all(self.a_fh, init_pcm)
        except Exception as e:
            print(f"[StreamBroadcaster] Primer notice: {e}")

        out_dir = self.output_folder
        if out_dir:
            try:

                def _on_progress():
                    self.progress_seen = True
                    if write_rtmp_status:
                        write_rtmp_status(out_dir, "connected")

                def _on_fatal(hint: str):
                    self.last_error = hint
                    if write_rtmp_status:
                        write_rtmp_status(out_dir, "failed", hint)

                watcher = (
                    FfmpegLogWatcher(
                        on_fatal=_on_fatal,
                        on_progress=_on_progress,
                    )
                    if FfmpegLogWatcher
                    else None
                )
                log_path = os.path.join(out_dir, "ai_worker_rtmp.log")
                log_fh = open(log_path, "a", encoding="utf-8")

                def _drain_stderr():
                    try:
                        while True:
                            chunk = self.proc.stderr.read(4096)
                            if not chunk:
                                break
                            text = chunk.decode("utf-8", errors="ignore")
                            self.stderr_tail = (self.stderr_tail + text)[-12000:]
                            log_fh.write(text)
                            log_fh.flush()
                            if watcher:
                                watcher.ingest(text)
                    except Exception:
                        pass
                    finally:
                        if watcher:
                            watcher.ingest("\n")
                        try:
                            log_fh.close()
                        except Exception:
                            pass

                threading.Thread(target=_drain_stderr, daemon=True).start()
            except Exception as e:
                print(f"[StreamBroadcaster] Watcher init error: {e}")

    def run(self):
        try:
            self._start_ffmpeg()
        except Exception as e:
            print(f"[StreamBroadcaster] Failed to start FFmpeg: {e}")
            if self.output_folder and write_rtmp_status:
                try:
                    write_rtmp_status(self.output_folder, "failed", str(e)[:200])
                except Exception:
                    pass
            return

        frame_duration = 1.0 / TARGET_FPS
        next_frame_time = time.perf_counter()
        print("[StreamBroadcaster] Running seamless loop...")

        metrics = get_telemetry()
        expected_bytes = CANVAS_W * CANVAS_H * 3
        failed = False

        while not self.stop_event.is_set():
            try:
                if self.proc and self.proc.poll() is not None:
                    if summarize_ffmpeg_stderr:
                        self.last_error = summarize_ffmpeg_stderr(
                            self.stderr_tail,
                            "FFmpeg RTMP berhenti saat siaran berjalan",
                        )
                    else:
                        self.last_error = "FFmpeg RTMP berhenti saat siaran berjalan"
                    failed = True
                    print(f"[StreamBroadcaster] {self.last_error}")
                    if self.output_folder and write_rtmp_status:
                        write_rtmp_status(self.output_folder, "failed", self.last_error)
                    self.stop_event.set()
                    break

                try:
                    pkt = self.render_q.get_nowait()
                    frame = pkt.frame
                    pcm = pkt.audio_pcm
                    clip_name = getattr(pkt, "clip_name", "") or "idle"
                    frame_idx = int(getattr(pkt, "frame_idx", 0) or 0)
                    if (
                        getattr(pkt, "clip_name", None)
                        and getattr(pkt, "frame_idx", None) is not None
                    ):
                        self.fallback_player.sync(pkt.clip_name, pkt.frame_idx)
                except queue.Empty:
                    if self.bridge is not None and self.bridge.is_utterance_active():
                        try:
                            # Toleransi batch latency GPU (hingga 3 detik) agar ucapan tidak terpotong di tengah jalan
                            pkt = self.render_q.get(timeout=3.0)
                            frame = pkt.frame
                            pcm = pkt.audio_pcm
                            clip_name = getattr(pkt, "clip_name", "") or "idle"
                            frame_idx = int(getattr(pkt, "frame_idx", 0) or 0)
                            self.fallback_player.sync(clip_name, frame_idx)
                        except queue.Empty:
                            # Jangan gagalkan siaran, fallback sementara ke idle frame agar stream tetap hidup
                            metrics.inc("broadcast_speech_timeout_idle")
                            frame = self.fallback_player.next_frame()
                            pcm = _silence_bytes_for_frame(self._audio_frame_index)
                            clip_name = getattr(
                                self.fallback_player._clip, "name", "idle"
                            )
                            frame_idx = int(
                                getattr(self.fallback_player, "_idx", 0) or 0
                            )
                    else:
                        # ZERO-LATENCY FALLBACK (Mencegah patah/loncat dengan ping-pong continuous player)
                        metrics.inc("broadcast_idle_fallback")
                        frame = self.fallback_player.next_frame()
                        pcm = _silence_bytes_for_frame(self._audio_frame_index)
                        clip_name = getattr(self.fallback_player._clip, "name", "idle")
                        frame_idx = int(getattr(self.fallback_player, "_idx", 0) or 0)

                if pcm is None:
                    pcm = _silence_bytes_for_frame(self._audio_frame_index)
                self._audio_frame_index += 1

                now = time.perf_counter()

                if frame is not None and frame.size > 0:
                    h, w = frame.shape[:2]
                    if w != CANVAS_W or h != CANVAS_H:
                        frame = fit_bgr(frame, CANVAS_W, CANVAS_H)

                    # Cek berkala apakah background baru siap (hot-reload)
                    if (
                        self._bg_bgr is None
                        or now - getattr(self, "_last_bg_check", 0.0) > 2.0
                    ):
                        self._last_bg_check = now
                        self._reload_background()

                    frame = self._replace_video_background(frame, clip_name, frame_idx)

                    # Cek berkala apakah overlay baru selesai dirender di latar belakang (hot-reload)
                    if self._ov_alpha is None or now - self._last_ov_check > 2.0:
                        self._last_ov_check = now
                        self._reload_overlay()

                    # Terapkan overlay dinamis jika ada
                    frame = self._apply_overlay(frame)

                    buf = np.ascontiguousarray(frame, dtype=np.uint8).tobytes()
                    if len(buf) == expected_bytes:
                        self._write_all(self.v_fh, buf)
                        self._write_all(self.a_fh, pcm)

                sleep_time = next_frame_time - now
                if sleep_time > 0:
                    time.sleep(sleep_time)
                elif sleep_time < -frame_duration * 2:
                    next_frame_time = now

                next_frame_time += frame_duration

            except (BrokenPipeError, OSError) as e:
                self.last_error = f"Pipe siaran tertutup: {e}"
                failed = True
                print(f"[StreamBroadcaster] {self.last_error}")
                if self.output_folder and write_rtmp_status:
                    write_rtmp_status(self.output_folder, "failed", self.last_error)
                self.stop_event.set()
                break
            except Exception as e:
                print(f"[StreamBroadcaster] Loop error: {e}")
                time.sleep(0.01)

        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except:
                self.proc.kill()
        if self.v_fh:
            try:
                self.v_fh.close()
            except Exception:
                pass
        if self.a_fh:
            try:
                self.a_fh.close()
            except Exception:
                pass
        if self.output_folder and write_rtmp_status and not failed:
            try:
                write_rtmp_status(self.output_folder, "disconnected")
            except Exception:
                pass
        print("[StreamBroadcaster] Stopped.")


# Kita bisa menggunakan fungsi fetcher/lipsync worker asli


class NewAIVisualWorker:
    def __init__(self, output_folder: str = ""):
        self.output_folder = output_folder or "/workspace/ai_live_worker/output"
        self.rtmp_url = None
        self.host = "namira"
        self.assets_dir = None
        self.background_path = ""
        self.overlay_path = ""

        self.bank = None
        self.sm = None
        self.engine = None

        self.in_q = queue.Queue(maxsize=100)
        self.render_q = queue.Queue(maxsize=300)
        self.stop_event = threading.Event()

        self.threads = []
        self._is_running = False

    def initialize(self):
        print("[NewAIVisualWorker] Initializing assets and models...")
        from argparse import Namespace
        from inference import _load_models_cached, musetalk_visual_params

        vparams = musetalk_visual_params()
        models_root = "./models"
        dummy_args = Namespace(
            gpu_id=0,
            use_float16=True,
            version="v15",
            left_cheek_width=vparams.get("left_cheek_width", 45),
            right_cheek_width=vparams.get("right_cheek_width", 45),
            unet_model_path=os.path.join(models_root, "musetalkV15", "unet.pth"),
            unet_config=os.path.join(models_root, "musetalkV15", "musetalk.json"),
            whisper_dir=os.path.join(models_root, "whisper"),
            vae_type="sd-vae-ft-mse",
            batch_size=8,
        )
        models = _load_models_cached(dummy_args)

        if not self.assets_dir or not os.path.exists(self.assets_dir):
            base_worker = "/workspace/ai_live_worker"
            candidate = os.path.join(base_worker, "assets", "3d")
            if os.path.isdir(candidate):
                self.assets_dir = candidate
            else:
                self.assets_dir = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), "assets", "3d"
                )

        # Load asset bank asli
        self.bank = AssetBank(self.assets_dir, host=self.host, models_bundle=models)
        self.bank.discover_and_load()

        # Init State Machine & Engine asli
        self.sm = VideoStateMachine(self.bank)
        self.engine = LipSyncEngine(
            models,
            self.bank,
            batch_size=8,
            face_registry=self.sm._face_registry
            if hasattr(self.sm, "_face_registry")
            else None,
        )

    def start(self, *, wait_rtmp=True):
        if self._is_running:
            return

        if not self.bank:
            self.initialize()

        self.stop_event.clear()

        try:
            from speech_bridge import get_speech_bridge

            self._bridge = get_speech_bridge(self.output_folder)
        except ImportError:
            self._bridge = None

        if self._bridge is not None and self.engine is not None:
            self._bridge.set_models(self.engine.models)

            def _on_utterance_ready(job):
                start_idx = 0
                body = None
                task_id = getattr(job, "task_id", None)
                if self.sm:
                    start_idx = self.sm.pin_talk_body(task_id)
                    body = self.sm._talk_target or self.sm.current_name
                if self.engine:
                    self.engine.set_utterance(
                        job, start_frame_idx=start_idx, body_clip=body
                    )

                def _mark_ready():
                    ok = False
                    try:
                        if self.engine:
                            deadline = time.monotonic() + 15.0
                            while not self.stop_event.is_set():
                                ok = self.engine.wait_preroll(8, timeout=2.0)
                                if ok or time.monotonic() >= deadline:
                                    break
                                time.sleep(0.04)
                    except Exception as err:
                        print(f"[NewAIVisualWorker] Preroll notice: {err}")
                    finally:
                        ready = getattr(job, "lipsync_ready", None)
                        if ready is not None:
                            ready.set()

                threading.Thread(
                    target=_mark_ready,
                    name=f"Preroll-{getattr(job, 'task_id', '')[:16]}",
                    daemon=True,
                ).start()

            def _on_utterance_start(job):
                task_id = getattr(job, "task_id", None)
                if (
                    self.engine
                    and getattr(self.engine, "_utterance_id", None) != task_id
                ):
                    start_idx = self.sm.pin_talk_body(task_id) if self.sm else 0
                    body = (
                        (self.sm._talk_target or self.sm.current_name)
                        if self.sm
                        else None
                    )
                    self.engine.set_utterance(
                        job, start_frame_idx=start_idx, body_clip=body
                    )
                if self.sm:
                    self.sm.begin_utterance()
                    if getattr(job, "action", None):
                        self.sm.set_utterance_gesture(job.action)

            def _on_utterance_end(_job):
                if self.engine:
                    self.engine.clear_utterance()
                if self.sm:
                    self.sm.end_utterance()

            self._bridge.set_callbacks(
                on_start=_on_utterance_start,
                on_end=_on_utterance_end,
                on_ready=_on_utterance_ready,
            )

        audio_fn_ext = self._bridge.get_audio_chunk if self._bridge else None
        action_fn = self._bridge.make_action_hook() if self._bridge else None

        def dummy_audio():
            return b"\x00" * BYTES_PER_AUDIO_FRAME, False

        # Gunakan thread asli
        fetcher_t = threading.Thread(
            target=frame_fetcher_loop,
            args=(
                self.sm,
                self.in_q,
                self.stop_event,
                dummy_audio,
                action_fn,
                audio_fn_ext,
                self._bridge,
            ),
            name="FrameFetcher",
            daemon=True,
        )
        lipsync_t = threading.Thread(
            target=lipsync_worker_loop,
            args=(self.bank, self.engine, self.in_q, self.render_q, self.stop_event),
            name="LipSyncWorker",
            daemon=True,
        )
        broadcaster_t = StreamBroadcaster(
            self.rtmp_url,
            self.bank,
            self.render_q,
            self.stop_event,
            self.output_folder,
            background_path=self.background_path,
            overlay_path=self.overlay_path,
            bridge=self._bridge,
        )
        self.broadcaster = broadcaster_t

        self.threads = [fetcher_t, lipsync_t, broadcaster_t]
        for t in self.threads:
            t.start()

        if wait_rtmp:
            timeout_sec = 15.0
            deadline = time.monotonic() + timeout_sec
            print(
                f"[NewAIVisualWorker] Menunggu handshake RTMP ({timeout_sec:.1f}s)..."
            )
            while time.monotonic() < deadline:
                if not broadcaster_t.is_alive() or (
                    broadcaster_t.proc is not None
                    and broadcaster_t.proc.poll() is not None
                ):
                    err_msg = (
                        broadcaster_t.last_error
                        or "FFmpeg RTMP berhenti saat handshake — periksa stream key / server URL."
                    )
                    raise RuntimeError(f"FFmpeg RTMP gagal: {err_msg}")
                if broadcaster_t.progress_seen:
                    print(
                        "[NewAIVisualWorker] RTMP terhubung & frame pertama terkirim!"
                    )
                    break
                time.sleep(0.15)
            else:
                if not broadcaster_t.is_alive() or (
                    broadcaster_t.proc is not None
                    and broadcaster_t.proc.poll() is not None
                ):
                    err_msg = broadcaster_t.last_error or "FFmpeg RTMP gagal terhubung."
                    raise RuntimeError(f"FFmpeg RTMP gagal: {err_msg}")
                print(
                    "[NewAIVisualWorker] Warning: RTMP wait timeout, melanjutkan streaming di background..."
                )

        self._is_running = True
        print("[NewAIVisualWorker] Pipeline started.")

    def stop(self, *, clear_queue=True):
        if not self._is_running:
            return
        self.stop_event.set()

        if self.engine:
            self.engine.clear_utterance()

        for t in self.threads:
            t.join(timeout=3)

        if clear_queue:
            while not self.in_q.empty():
                self.in_q.get_nowait()
            while not self.render_q.empty():
                self.render_q.get_nowait()
            if self._bridge:
                self._bridge.clear_pending()

        self._is_running = False
        print("[NewAIVisualWorker] Pipeline stopped.")

    @property
    def is_running(self):
        return self._is_running

    @property
    def is_pipeline_active(self):
        return self._is_running

    @property
    def is_rtmp_connected(self):
        return bool(
            self.broadcaster
            and self.broadcaster.progress_seen
            and self.broadcaster.is_ffmpeg_alive()
        )

    def enqueue_utterance(
        self,
        audio_path: str,
        *,
        task_id: str,
        action: str = None,
        priority: bool = False,
    ):
        if self._bridge:
            return self._bridge.enqueue(
                audio_path, task_id=task_id, action=action, priority=priority
            )
        return False


_visual_worker_singleton = None


def get_visual_worker(output_folder: str = "") -> NewAIVisualWorker:
    global _visual_worker_singleton
    if _visual_worker_singleton is None:
        _visual_worker_singleton = NewAIVisualWorker(output_folder)
    elif output_folder:
        _visual_worker_singleton.output_folder = output_folder
    return _visual_worker_singleton


def start_visual_broadcast(
    rtmp_url: str,
    *,
    idle_video: str = "",
    output_folder: str = "",
    host: str = "namira",
    background_path: str = "",
    overlay_path: str = "",
) -> NewAIVisualWorker:
    vw = get_visual_worker(output_folder)
    vw.rtmp_url = rtmp_url
    vw.host = host
    if background_path:
        vw.background_path = background_path
    if overlay_path:
        vw.overlay_path = overlay_path
    if idle_video and os.path.exists(idle_video):
        vw.assets_dir = os.path.dirname(idle_video)
    vw.initialize()
    vw.start(wait_rtmp=True)
    return vw


def stop_visual_broadcast(*, destroy: bool = True) -> None:
    global _visual_worker_singleton
    if _visual_worker_singleton:
        _visual_worker_singleton.stop(clear_queue=destroy)
        if destroy:
            _visual_worker_singleton = None


def pause_visual_broadcast(output_folder: str = "") -> dict:
    return {"success": True, "message": "Paused"}


def resume_visual_broadcast(output_folder: str = "") -> dict:
    return {"success": True, "message": "Resumed"}
