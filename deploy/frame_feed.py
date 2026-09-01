"""Frame-feed broadcaster — continuous A/V timeline for live RTMP.

Mode ini mengganti arsitektur segmen-per-file (spawn FFmpeg per clip + idle
chunk senyap) dengan satu encoder FFmpeg yang menerima frame BGR + PCM stereo
secara kontinu:

  • Idle dipotong per frame saat clip AI baru siap (tidak menunggu chunk 1.5s).
  • Tidak ada spawn worker FFmpeg antar kalimat → jeda/gap RTMP mengecil.
  • Visual idle memakai talk_expressive bila ada (pose sama dengan clip bicara).

Aktifkan dengan BROADCAST_MODE=frame_feed (default tetap segment).
"""

from __future__ import annotations

import glob
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from collections import deque
from typing import Deque, List, Optional

import cv2
import numpy as np


def _sequence_key(path: str):
    basename = os.path.basename(path.rstrip("/\\"))
    # Hapus suffix .ffseg agar urutan submit tetap terbaca dari nama task_
    if basename.endswith(".ffseg"):
        basename = basename[: -len(".ffseg")]
    match = re.match(r"^(prio_)?task_(\d{10,})_", basename)
    if match:
        rank = 0 if match.group(1) else 1
        return (rank, int(match.group(2)), basename)
    try:
        return (2, os.path.getctime(path), basename)
    except OSError:
        return (2, 0.0, basename)


def _fade_in_pcm(pcm: bytes, frames: int, bytes_per_frame: int) -> bytes:
    """Ramp volume 0→1 di awal clip agar tidak klik saat keluar dari silence."""
    if not pcm or frames <= 0 or bytes_per_frame <= 0:
        return pcm
    out = bytearray(pcm)
    n = min(frames, max(1, len(out) // bytes_per_frame))
    for i in range(n):
        gain = (i + 1) / float(n)
        start = i * bytes_per_frame
        end = start + bytes_per_frame
        chunk = out[start:end]
        if len(chunk) < 2:
            break
        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32)
        samples *= gain
        out[start:end] = np.clip(samples, -32768, 32767).astype(np.int16).tobytes()
    return bytes(out)


class _PrefetchCache:
    """Muat .ffseg berikutnya di background supaya join AI→AI tanpa jeda decode."""

    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self.path = None
        self.frames = None  # list[(frame, pcm)]
        self._lock = threading.Lock()
        self._thread = None
        self._token = 0

    def clear(self):
        with self._lock:
            self._token += 1
            self.path = None
            self.frames = None

    def request(self, path: str):
        if not path or not (os.path.isdir(path) and path.endswith(".ffseg")):
            return
        with self._lock:
            if self.path == path and self.frames is not None:
                return
            if self.path == path and self._thread and self._thread.is_alive():
                return
            self._token += 1
            token = self._token
            self.path = path
            self.frames = None

        def _job():
            try:
                from ffseg import iter_ffseg_frames
            except ImportError:
                sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
                from ffseg import iter_ffseg_frames
            try:
                _meta, it = iter_ffseg_frames(path)
                loaded = []
                for frame, chunk in it:
                    if frame.shape[1] != self.width or frame.shape[0] != self.height:
                        frame = cv2.resize(
                            frame, (self.width, self.height), interpolation=cv2.INTER_AREA
                        )
                    loaded.append((frame, chunk))
                with self._lock:
                    if token == self._token and self.path == path:
                        self.frames = loaded
                        print(
                            f"[FRAME-FEED] Prefetch siap: {os.path.basename(path)} "
                            f"({len(loaded)} frames)"
                        )
            except Exception as err:
                print(f"[FRAME-FEED] Prefetch notice: {err}")

        self._thread = threading.Thread(target=_job, daemon=True)
        self._thread.start()

    def take(self, path: str):
        with self._lock:
            if self.path == path and self.frames is not None:
                frames = self.frames
                self.frames = None
                self.path = None
                return frames
        return None


def _prefer_talk_visual(idle_path: str) -> str:
    """Pakai talk_expressive sebagai visual idle bila tersedia — pose nyambung."""
    if not idle_path:
        return idle_path
    directory = os.path.dirname(idle_path) or "."
    base = os.path.basename(idle_path)
    stem = os.path.splitext(base)[0]
    host = stem.replace("_idle", "").replace("_talk_expressive", "") or "namira"
    for name in (
        f"{host}_talk_expressive.mp4",
        "namira_talk_expressive.mp4",
        "talk_expressive.mp4",
    ):
        candidate = os.path.join(directory, name)
        if os.path.exists(candidate):
            print(f"[FRAME-FEED] Visual idle → {name} (pose match talk clips)")
            return candidate
    return idle_path


def _load_frames(video_path: str, width: int, height: int):
    frames = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Tidak bisa membuka video: {video_path}")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame.shape[1] != width or frame.shape[0] != height:
            frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
        frames.append(frame)
    cap.release()
    if not frames:
        raise RuntimeError(f"Video kosong: {video_path}")
    return frames


def _extract_pcm_s16le(video_path: str, sample_rate: int = 44100) -> bytes:
    """Ambil audio stereo s16le dari clip; silence jika tidak ada stream audio."""
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        video_path,
        "-vn",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "2",
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
    except Exception as err:
        print(f"[FRAME-FEED] Audio extract notice: {err}")
    return b""


def _silence_pcm(num_frames: int, fps: int, sample_rate: int = 44100) -> bytes:
    samples = int(round(sample_rate / float(fps))) * num_frames
    return b"\x00" * (samples * 2 * 2)  # stereo s16le


class FrameFeedBroadcaster:
    def __init__(
        self,
        rtmp_url: str,
        idle_video_path: str,
        output_folder: str,
        product_name: str = "",
        product_price: str = "",
        product_image_url: str = "",
        banner_image_url: str = "",
    ):
        self.rtmp_url = rtmp_url
        self.output_folder = output_folder
        self.product_name = product_name
        self.product_price = product_price
        self.product_image_url = product_image_url
        self.banner_image_url = banner_image_url

        self.width = int(os.environ.get("FRAME_FEED_WIDTH", "720"))
        self.height = int(os.environ.get("FRAME_FEED_HEIGHT", "1280"))
        self.fps = int(os.environ.get("FRAME_FEED_FPS", "25"))
        self.sample_rate = 44100
        self.samples_per_frame = int(round(self.sample_rate / float(self.fps)))
        self.bytes_per_audio_frame = self.samples_per_frame * 2 * 2

        visual_path = _prefer_talk_visual(idle_video_path)
        self.idle_video = visual_path
        print(f"[FRAME-FEED] Memuat frame idle dari {os.path.basename(visual_path)}...")
        self.idle_frames = _load_frames(visual_path, self.width, self.height)
        self.idle_idx = 0

        self._shutting_down = False
        self.ffmpeg = None
        self._video_fifo = None
        self._audio_fifo = None
        self._tmpdir = None
        self._v_fh = None
        self._a_fh = None
        self._fifo_thread = None

        self.overlay_png_path = None
        self._prepare_overlay()
        self._prefetch = _PrefetchCache(self.width, self.height)
        # Clock bersama antar clip AI agar join tanpa lonjakan pacing.
        self._av_deadline = None
        self._chain_from_ai = False

        os.makedirs(self.output_folder, exist_ok=True)
        self._rtmp_status_path = os.path.join(self.output_folder, "rtmp_status.txt")
        self._start_encoder()

    def _set_rtmp_status(self, connected: bool) -> None:
        try:
            with open(self._rtmp_status_path, "w", encoding="utf-8") as fh:
                fh.write("connected" if connected else "disconnected")
        except Exception:
            pass

    def _prepare_overlay(self):
        """Reuse overlay PNG dari broadcaster segment bila sudah digenerate."""
        candidate = os.path.join(self.output_folder, "overlay_live.png")
        if os.path.exists(candidate):
            self.overlay_png_path = candidate
            return
        # Lazy: biarkan tanpa overlay; hot-swap file tetap dipantau di loop.
        self.overlay_png_path = None

    def _apply_overlay(self, frame: np.ndarray) -> np.ndarray:
        if not self.overlay_png_path or not os.path.exists(self.overlay_png_path):
            return frame
        try:
            overlay = cv2.imread(self.overlay_png_path, cv2.IMREAD_UNCHANGED)
            if overlay is None:
                return frame
            if overlay.shape[0] != self.height or overlay.shape[1] != self.width:
                overlay = cv2.resize(overlay, (self.width, self.height))
            if overlay.shape[2] == 4:
                alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
                rgb = overlay[:, :, :3].astype(np.float32)
                base = frame.astype(np.float32)
                out = base * (1.0 - alpha) + rgb * alpha
                return out.astype(np.uint8)
            return overlay[:, :, :3]
        except Exception:
            return frame

    def _start_encoder(self):
        self._tmpdir = tempfile.mkdtemp(prefix="frame_feed_")
        self._video_fifo = os.path.join(self._tmpdir, "video.fifo")
        self._audio_fifo = os.path.join(self._tmpdir, "audio.fifo")
        os.mkfifo(self._video_fifo)
        os.mkfifo(self._audio_fifo)

        gop = self.fps * 2
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "warning",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-s",
            f"{self.width}x{self.height}",
            "-r",
            str(self.fps),
            "-i",
            self._video_fifo,
            "-f",
            "s16le",
            "-ar",
            str(self.sample_rate),
            "-ac",
            "2",
            "-i",
            self._audio_fifo,
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "high",
            "-level",
            "4.1",
            "-g",
            str(gop),
            "-keyint_min",
            str(gop),
            "-sc_threshold",
            "0",
            "-b:v",
            "2500k",
            "-maxrate",
            "3000k",
            "-bufsize",
            "6000k",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            str(self.sample_rate),
            "-ac",
            "2",
            "-f",
            "flv",
            "-rtmp_live",
            "live",
            self.rtmp_url,
        ]

        # Buka FIFO di thread terpisah supaya FFmpeg tidak deadlock saat open().
        ready = threading.Event()
        err_box = []

        def _open_fifos():
            try:
                self._v_fh = open(self._video_fifo, "wb", buffering=0)
                self._a_fh = open(self._audio_fifo, "wb", buffering=0)
                ready.set()
            except Exception as exc:
                err_box.append(exc)
                ready.set()

        self._fifo_thread = threading.Thread(target=_open_fifos, daemon=True)
        self._fifo_thread.start()

        print("[FRAME-FEED] Menyalakan encoder RTMP (satu sesi kontinu)...")
        self.ffmpeg = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        if not ready.wait(timeout=15):
            raise RuntimeError("Timeout membuka FIFO frame-feed")
        if err_box:
            raise err_box[0]
        if self.ffmpeg.poll() is not None:
            err = self.ffmpeg.stderr.read().decode("utf-8", errors="ignore") if self.ffmpeg.stderr else ""
            raise RuntimeError(f"FFmpeg frame-feed gagal start: {err[:500]}")

        self._set_rtmp_status(True)
        # Legacy flag (queue-status lama); primary = rtmp_status.txt
        flag = os.path.join(self.output_folder, "rtmp_connected.flag")
        try:
            with open(flag, "w", encoding="utf-8") as fh:
                fh.write("connected")
        except Exception:
            pass
        print("[FRAME-FEED] Encoder siap — status RTMP: connected (menunggu ingest platform).")

    def shutdown(self):
        if self._shutting_down:
            return
        self._shutting_down = True
        self._set_rtmp_status(False)
        print("[FRAME-FEED] Menutup encoder...")
        for fh in (self._v_fh, self._a_fh):
            if fh is not None:
                try:
                    fh.close()
                except Exception:
                    pass
        if self.ffmpeg and self.ffmpeg.poll() is None:
            try:
                self.ffmpeg.terminate()
                self.ffmpeg.wait(timeout=5)
            except Exception:
                try:
                    self.ffmpeg.kill()
                except Exception:
                    pass
        if self._tmpdir and os.path.isdir(self._tmpdir):
            for name in ("video.fifo", "audio.fifo"):
                path = os.path.join(self._tmpdir, name)
                try:
                    if os.path.exists(path):
                        os.remove(path)
                except Exception:
                    pass
            try:
                os.rmdir(self._tmpdir)
            except Exception:
                pass

    def _write_av(self, frame: np.ndarray, pcm: bytes):
        if self._shutting_down or self._v_fh is None or self._a_fh is None:
            return False
        frame = self._apply_overlay(frame)
        if frame.dtype != np.uint8:
            frame = frame.astype(np.uint8)
        if len(pcm) < self.bytes_per_audio_frame:
            pcm = pcm + b"\x00" * (self.bytes_per_audio_frame - len(pcm))
        elif len(pcm) > self.bytes_per_audio_frame:
            pcm = pcm[: self.bytes_per_audio_frame]
        try:
            self._v_fh.write(frame.tobytes())
            self._a_fh.write(pcm)
            return True
        except (BrokenPipeError, OSError) as err:
            print(f"[FRAME-FEED] Pipe putus: {err}")
            return False

    def _collect_ai_queue(self, last_spoken, idle_abs: str):
        items = []
        # Raw packs (prioritas) — tanpa decode H264
        for path in glob.glob(os.path.join(self.output_folder, "**", "*.ffseg"), recursive=True):
            if not os.path.isdir(path):
                continue
            if path == last_spoken:
                continue
            if not os.path.exists(os.path.join(path, "ready.flag")):
                continue
            if os.path.basename(path).startswith("temp_"):
                continue
            items.append(path)
        # Fallback MP4 (segment / legacy)
        for path in glob.glob(os.path.join(self.output_folder, "**", "*.mp4"), recursive=True):
            if path == last_spoken:
                continue
            if idle_abs and os.path.abspath(path) == idle_abs:
                continue
            base = os.path.basename(path)
            if base.startswith("temp_") or base.endswith(".tmp"):
                continue
            try:
                if os.path.getsize(path) < 1024:
                    continue
            except OSError:
                continue
            items.append(path)
        return sorted(items, key=_sequence_key)

    def _cleanup(self, path: str, idle_abs: str):
        try:
            if not path or not os.path.exists(path):
                return
            if idle_abs and os.path.abspath(path) == idle_abs:
                return
            if os.path.isdir(path):
                import shutil

                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
            print(f"[FRAME-FEED] Cleanup: {os.path.basename(path)}")
        except Exception as err:
            print(f"[FRAME-FEED] Cleanup error: {err}")

    def _peek_next_ai(self, pending: deque, last_spoken, idle_abs, playback_active: bool):
        if not playback_active:
            return None
        for path in self._collect_ai_queue(last_spoken, idle_abs):
            if path not in pending:
                pending.append(path)
        if pending:
            reordered = sorted(pending, key=_sequence_key)
            pending.clear()
            pending.extend(reordered)
        return pending[0] if pending else None

    def _feed_idle_until_ai(self, pending, last_spoken, idle_abs, playback_active):
        """Kirim frame idle; cek antrian AI setiap frame — interrupt segera."""
        silence = b"\x00" * self.bytes_per_audio_frame
        frame_period = 1.0 / float(self.fps)
        next_deadline = time.perf_counter()

        while not self._shutting_down:
            nxt = self._peek_next_ai(pending, last_spoken, idle_abs, playback_active)
            if nxt:
                # Prefetch segera agar clip pertama setelah idle lebih cepat start.
                self._prefetch.request(nxt)
                self._av_deadline = next_deadline
                return nxt

            frame = self.idle_frames[self.idle_idx % len(self.idle_frames)]
            self.idle_idx = (self.idle_idx + 1) % len(self.idle_frames)
            if not self._write_av(frame, silence):
                return None

            next_deadline += frame_period
            sleep_for = next_deadline - time.perf_counter()
            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                next_deadline = time.perf_counter()
        return None

    def _feed_ai_clip(self, video_path: str, *, fade_in: bool = True, prefetched=None) -> bool:
        """Dorong segmen AI (ffseg raw atau MP4) ke encoder realtime."""
        print(f"[FRAME-FEED] ▶ {os.path.basename(video_path)} fade_in={fade_in}")
        frame_period = 1.0 / float(self.fps)
        next_deadline = self._av_deadline if self._av_deadline else time.perf_counter()
        ok_any = False
        fade_frames = max(1, int(self.fps * 0.08)) if fade_in else 0

        def _pace():
            nonlocal next_deadline
            next_deadline += frame_period
            sleep_for = next_deadline - time.perf_counter()
            if sleep_for > 0:
                time.sleep(sleep_for)
            else:
                next_deadline = time.perf_counter()

        # --- Prefetched frames ---
        if prefetched is not None:
            for idx, (frame, chunk) in enumerate(prefetched):
                if self._shutting_down:
                    break
                if fade_frames and idx < fade_frames:
                    gain = (idx + 1) / float(fade_frames)
                    samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) * gain
                    chunk = np.clip(samples, -32768, 32767).astype(np.int16).tobytes()
                if not self._write_av(frame, chunk):
                    return False
                ok_any = True
                self.idle_idx = (self.idle_idx + 1) % len(self.idle_frames)
                _pace()
            self._av_deadline = next_deadline
            return ok_any

        # --- Raw .ffseg path (tanpa decode) ---
        if os.path.isdir(video_path) and video_path.endswith(".ffseg"):
            try:
                from ffseg import iter_ffseg_frames
            except ImportError:
                sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
                from ffseg import iter_ffseg_frames

            try:
                meta, frame_iter = iter_ffseg_frames(video_path)
            except Exception as err:
                print(f"[FRAME-FEED] ffseg buka gagal: {err}")
                return False

            idx = 0
            for frame, chunk in frame_iter:
                if self._shutting_down:
                    break
                if frame.shape[1] != self.width or frame.shape[0] != self.height:
                    frame = cv2.resize(frame, (self.width, self.height), interpolation=cv2.INTER_AREA)
                if fade_frames and idx < fade_frames:
                    gain = (idx + 1) / float(fade_frames)
                    samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) * gain
                    chunk = np.clip(samples, -32768, 32767).astype(np.int16).tobytes()
                if not self._write_av(frame, chunk):
                    return False
                ok_any = True
                self.idle_idx = (self.idle_idx + 1) % len(self.idle_frames)
                idx += 1
                _pace()
            self._av_deadline = next_deadline
            return ok_any

        # --- Legacy MP4 path ---
        pcm = _extract_pcm_s16le(video_path, self.sample_rate)
        if fade_frames:
            pcm = _fade_in_pcm(pcm, fade_frames, self.bytes_per_audio_frame)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(f"[FRAME-FEED] Gagal buka clip: {video_path}")
            return False

        audio_pos = 0
        while not self._shutting_down:
            ok, frame = cap.read()
            if not ok:
                break
            if frame.shape[1] != self.width or frame.shape[0] != self.height:
                frame = cv2.resize(frame, (self.width, self.height), interpolation=cv2.INTER_AREA)

            chunk = pcm[audio_pos : audio_pos + self.bytes_per_audio_frame]
            audio_pos += self.bytes_per_audio_frame
            if not chunk:
                chunk = b"\x00" * self.bytes_per_audio_frame

            if not self._write_av(frame, chunk):
                cap.release()
                return False
            ok_any = True
            self.idle_idx = (self.idle_idx + 1) % len(self.idle_frames)
            _pace()

        cap.release()
        self._av_deadline = next_deadline
        return ok_any

    def start_loop(self):
        print(
            f"\n[FRAME-FEED] Siaran kontinu — {self.width}x{self.height}@{self.fps}fps, "
            f"idle_frames={len(self.idle_frames)}\n"
        )
        last_spoken = None
        pending: deque = deque()
        idle_abs = os.path.abspath(self.idle_video) if self.idle_video else ""

        while not self._shutting_down:
            try:
                if self.ffmpeg and self.ffmpeg.poll() is not None:
                    err = ""
                    if self.ffmpeg.stderr:
                        try:
                            err = self.ffmpeg.stderr.read().decode("utf-8", errors="ignore")[-800:]
                        except Exception:
                            pass
                    self._set_rtmp_status(False)
                    print(f"[FRAME-FEED] Encoder mati: {err}")
                    break

                # Hot-swap overlay
                update_file = os.path.join(self.output_folder, "update_overlay.json")
                if os.path.exists(update_file):
                    try:
                        overlay = os.path.join(self.output_folder, "overlay_live.png")
                        if os.path.exists(overlay):
                            self.overlay_png_path = overlay
                        os.remove(update_file)
                        print("[FRAME-FEED] Overlay diperbarui")
                    except Exception as err:
                        print(f"[FRAME-FEED] Overlay update notice: {err}")

                playback_flag = os.path.join(self.output_folder, "playback_active.flag")
                playback_active = os.path.exists(playback_flag)

                nxt = self._peek_next_ai(pending, last_spoken, idle_abs, playback_active)
                came_from_idle = False
                if not nxt:
                    # Reset chain clock saat masuk idle — next AI soft-open lagi.
                    self._chain_from_ai = False
                    self._av_deadline = None
                    self._prefetch.clear()
                    nxt = self._feed_idle_until_ai(
                        pending, last_spoken, idle_abs, playback_active
                    )
                    came_from_idle = True
                    if not nxt:
                        if self._shutting_down:
                            break
                        time.sleep(0.02)
                        continue

                path = pending.popleft()
                # Prefetch calon berikutnya selagi clip ini diputar.
                self._peek_next_ai(pending, path, idle_abs, playback_active)
                if pending:
                    self._prefetch.request(pending[0])

                prefetched = self._prefetch.take(path)
                fade_in = came_from_idle or not self._chain_from_ai
                played = self._feed_ai_clip(path, fade_in=fade_in, prefetched=prefetched)
                if played:
                    last_spoken = path
                    self._chain_from_ai = True
                    self._cleanup(path, idle_abs)
                    # Zero-gap: jika antrian sudah ada, langsung putar tanpa idle.
                    continue
                else:
                    time.sleep(0.1)

            except Exception as loop_err:
                print(f"[FRAME-FEED UNHANDLED] {loop_err}")
                traceback.print_exc()
                time.sleep(0.5)


if __name__ == "__main__":
    RTMP_BASE_URL = os.environ.get("RTMP_URL", "").rstrip("/")
    STREAM_KEY = os.environ.get("STREAM_KEY", "")
    if not RTMP_BASE_URL or not STREAM_KEY:
        raise RuntimeError("RTMP_URL dan STREAM_KEY wajib diisi")
    if RTMP_BASE_URL.endswith(f"/{STREAM_KEY}"):
        RTMP_URL = RTMP_BASE_URL
    else:
        RTMP_URL = f"{RTMP_BASE_URL}/{STREAM_KEY}"

    OUTPUT_FOLDER = os.environ.get("OUTPUT_FOLDER", "/workspace/ai_live_worker/output")
    IDLE_VIDEO = os.environ.get(
        "IDLE_VIDEO",
        "/workspace/ai_live_worker/assets/3d/namira_idle.mp4",
    )

    PRODUCT_NAME = os.environ.get("PRODUCT_NAME", "")
    PRODUCT_PRICE = os.environ.get("PRODUCT_PRICE", "")
    PRODUCT_IMAGE_URL = os.environ.get("PRODUCT_IMAGE_URL", "")
    BANNER_IMAGE_URL = os.environ.get("BANNER_IMAGE_URL", "")

    config_file = os.environ.get("CONFIG_PATH") or os.path.join(
        OUTPUT_FOLDER, "broadcast_config.json"
    )
    if os.path.exists(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            PRODUCT_NAME = cfg.get("product_name", PRODUCT_NAME)
            PRODUCT_PRICE = cfg.get("product_price", PRODUCT_PRICE)
            PRODUCT_IMAGE_URL = cfg.get("product_image_url", PRODUCT_IMAGE_URL)
            BANNER_IMAGE_URL = cfg.get("banner_image_url", BANNER_IMAGE_URL)
            IDLE_VIDEO = cfg.get("idle_video", IDLE_VIDEO)
            print(f"[FRAME-FEED] Config dari {config_file}")
        except Exception as err:
            print(f"[FRAME-FEED] Config notice: {err}")

    broadcaster = None
    try:
        broadcaster = FrameFeedBroadcaster(
            RTMP_URL,
            IDLE_VIDEO,
            OUTPUT_FOLDER,
            product_name=PRODUCT_NAME,
            product_price=PRODUCT_PRICE,
            product_image_url=PRODUCT_IMAGE_URL,
            banner_image_url=BANNER_IMAGE_URL,
        )

        def _handle_termination(signum, _frame):
            print(f"\n[FRAME-FEED] Sinyal {signum} — menutup.")
            if broadcaster:
                broadcaster.shutdown()

        signal.signal(signal.SIGTERM, _handle_termination)
        signal.signal(signal.SIGINT, _handle_termination)
        broadcaster.start_loop()
    except KeyboardInterrupt:
        print("\n[FRAME-FEED] Dimatikan.")
    finally:
        if broadcaster is not None:
            broadcaster.shutdown()
