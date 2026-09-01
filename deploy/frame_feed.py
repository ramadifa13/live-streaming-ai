"""Frame-feed broadcaster — continuous A/V timeline for live RTMP.

Mode ini mengganti arsitektur segmen-per-file (spawn FFmpeg per clip + idle
chunk senyap) dengan satu encoder FFmpeg yang menerima frame BGR + PCM stereo
secara kontinu:

  • Idle dipotong per frame saat clip AI baru siap (tidak menunggu chunk 1.5s).
  • Tidak ada spawn worker FFmpeg antar kalimat → jeda/gap RTMP mengecil.
  • Visual idle memakai namira_idle.mp4 (atau IDLE_VIDEO), bukan talk_expressive.

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
import threading
import time
import traceback
from collections import deque
from typing import Deque, List, Optional

import cv2
import numpy as np

try:
    from rtmp_utils import FfmpegLogWatcher, join_rtmp_url, write_rtmp_status
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from rtmp_utils import FfmpegLogWatcher, join_rtmp_url, write_rtmp_status

try:
    from video_canvas import fit_bgr, prefer_idle_clip
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from video_canvas import fit_bgr, prefer_idle_clip


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
                        frame = fit_bgr(frame, self.width, self.height)
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


def _prefer_idle_visual(idle_path: str) -> str:
    """Pakai *_idle.mp4 sebagai visual idle bila tersedia."""
    return prefer_idle_clip(idle_path)


def _load_frames(video_path: str, width: int, height: int):
    frames = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Tidak bisa membuka video: {video_path}")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(fit_bgr(frame, width, height))
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

        visual_path = _prefer_idle_visual(idle_video_path)
        self.idle_video = visual_path
        print(f"[FRAME-FEED] Memuat frame idle dari {os.path.basename(visual_path)}...")
        self.idle_frames = _load_frames(visual_path, self.width, self.height)
        self.idle_idx = 0
        self.idle_anchor = 0
        self.idle_hold = max(1, int(os.environ.get("IDLE_HOLD_FRAMES", "3")))
        self._idle_ping = 0

        self._shutting_down = False
        self.ffmpeg = None
        self._v_fh = None
        self._a_fh = None

        self.overlay_png_path = None
        self._overlay_rgb = None
        self._overlay_alpha = None
        self._queue_cache = []
        self._queue_cache_at = 0.0
        self._prepare_overlay()
        self._prefetch = _PrefetchCache(self.width, self.height)
        # Clock bersama antar clip AI agar join tanpa lonjakan pacing.
        self._av_deadline = None
        self._chain_from_ai = False

        os.makedirs(self.output_folder, exist_ok=True)
        self._rtmp_status_path = os.path.join(self.output_folder, "rtmp_status.txt")
        self._rtmp_fatal = False
        self._rtmp_fatal_hint = ""
        self._rtmp_connected = False
        self._stderr_thread = None
        self._playback_nudge_at = 0.0
        self._start_encoder()

    def _set_rtmp_status(self, connected: bool, error: str = "") -> None:
        if self._rtmp_fatal and connected:
            return
        if connected:
            self._rtmp_connected = True
        write_rtmp_status(
            self.output_folder,
            "connected" if connected else ("failed" if self._rtmp_fatal else "disconnected"),
            error or self._rtmp_fatal_hint,
        )

    def _on_rtmp_fatal(self, hint: str) -> None:
        self._rtmp_fatal = True
        self._rtmp_fatal_hint = hint
        write_rtmp_status(self.output_folder, "failed", hint)
        print(f"[FRAME-FEED] RTMP fatal: {hint}")

    def _idle_display_frame(self, full_loop: bool = False):
        """Sebelum clip pertama: loop idle.
        Setelah bicara: tahan pose terakhir (bukan ping-pong — itu kelihatan ngadat).
        """
        n = len(self.idle_frames)
        if n <= 1:
            return self.idle_frames[0]
        if full_loop:
            return self.idle_frames[self.idle_idx % n]
        window = min(max(1, self.idle_hold), n)
        if window <= 2:
            return self.idle_frames[self.idle_anchor % n]
        period = window * 2 - 2
        p = self._idle_ping % period
        off = p if p < window else period - p
        return self.idle_frames[(self.idle_anchor + off) % n]

    def _advance_idle_hold(self, full_loop: bool = False) -> None:
        if full_loop:
            n = max(1, len(self.idle_frames))
            self.idle_idx = (self.idle_idx + 1) % n
            return
        self._idle_ping += 1

    def _lock_idle_anchor(self, frames_played: int) -> None:
        n = max(1, len(self.idle_frames))
        self.idle_anchor = (self.idle_anchor + max(0, frames_played)) % n
        self._idle_ping = 0
        self.idle_idx = self.idle_anchor

    def _prepare_overlay(self):
        """Generate overlay PNG (nama file harus overlay_live.png, sama dengan hot-swap)."""
        try:
            from broadcaster import prepare_overlay_files

            path = prepare_overlay_files(
                self.output_folder,
                product_name=self.product_name,
                product_price=self.product_price,
                product_image_url=self.product_image_url,
                banner_image_url=self.banner_image_url,
            )
            if path and os.path.exists(path):
                self.overlay_png_path = path
                self._cache_overlay(path)
                return
        except Exception as err:
            print(f"[FRAME-FEED] Overlay generate notice: {err}")
        for candidate in (
            os.path.join(self.output_folder, "overlay_live.png"),
            os.path.join(self.output_folder, "tmp_assets", "live_overlay.png"),
        ):
            if os.path.exists(candidate):
                self.overlay_png_path = candidate
                self._cache_overlay(candidate)
                return
        self.overlay_png_path = None
        self._overlay_rgb = None
        self._overlay_alpha = None

    def _cache_overlay(self, path: str) -> None:
        overlay = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if overlay is None:
            self._overlay_rgb = None
            self._overlay_alpha = None
            return
        if overlay.shape[0] != self.height or overlay.shape[1] != self.width:
            overlay = cv2.resize(overlay, (self.width, self.height))
        if overlay.shape[2] == 4:
            self._overlay_alpha = overlay[:, :, 3:4].astype(np.float32) / 255.0
            self._overlay_rgb = overlay[:, :, :3].astype(np.float32)
        else:
            self._overlay_alpha = np.ones((self.height, self.width, 1), dtype=np.float32)
            self._overlay_rgb = overlay[:, :, :3].astype(np.float32)

    def _apply_overlay(self, frame: np.ndarray) -> np.ndarray:
        if self._overlay_alpha is None or self._overlay_rgb is None:
            return frame
        try:
            base = frame.astype(np.float32)
            out = base * (1.0 - self._overlay_alpha) + self._overlay_rgb * self._overlay_alpha
            return out.astype(np.uint8)
        except Exception:
            return frame

    def _start_encoder(self):
        """Encoder via anonymous pipe — jangan mkfifo.

        Dua named pipe + open() berurutan deadlock: FFmpeg probe input pertama
        menunggu data, Python menunggu reader input kedua. Timeout 15s, RTMP
        tidak pernah handshake.
        """
        gop = self.fps * 2
        video_r, video_w = os.pipe()
        audio_r, audio_w = os.pipe()
        os.set_inheritable(video_r, True)
        os.set_inheritable(audio_r, True)
        os.set_inheritable(video_w, False)
        os.set_inheritable(audio_w, False)
        try:
            import fcntl

            pipe_bytes = min(4 * 1024 * 1024, max(1024 * 1024, self.width * self.height * 3))
            set_sz = getattr(fcntl, "F_SETPIPE_SZ", 1031)
            for fd in (video_r, video_w, audio_r, audio_w):
                try:
                    fcntl.fcntl(fd, set_sz, pipe_bytes)
                except Exception:
                    pass
        except Exception:
            pass

        v_in = f"/proc/self/fd/{video_r}"
        a_in = f"/proc/self/fd/{audio_r}"
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "info",
            "-stats",
            "-y",
            "-fflags",
            "+nobuffer+genpts",
            "-thread_queue_size",
            "512",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-s",
            f"{self.width}x{self.height}",
            "-r",
            str(self.fps),
            "-probesize",
            "32",
            "-analyzeduration",
            "0",
            "-i",
            v_in,
            "-thread_queue_size",
            "512",
            "-f",
            "s16le",
            "-ar",
            str(self.sample_rate),
            "-ac",
            "2",
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
            "-flvflags",
            "no_duration_filesize",
            "-f",
            "flv",
            "-rtmp_live",
            "live",
            self.rtmp_url,
        ]

        print("[FRAME-FEED] Menyalakan encoder RTMP (satu sesi kontinu)...")
        write_rtmp_status(self.output_folder, "connecting")
        log_dir = "/workspace/ai_live_worker/logs"
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "frame_feed_ffmpeg.log")
        self.log_file = open(log_path, "a", encoding="utf-8")
        try:
            self.ffmpeg = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                pass_fds=(video_r, audio_r),
            )
        except Exception:
            for fd in (video_r, video_w, audio_r, audio_w):
                try:
                    os.close(fd)
                except OSError:
                    pass
            raise

        os.close(video_r)
        os.close(audio_r)
        self._v_fh = os.fdopen(video_w, "wb", buffering=0)
        self._a_fh = os.fdopen(audio_w, "wb", buffering=0)

        watcher = FfmpegLogWatcher(
            on_fatal=self._on_rtmp_fatal,
            on_progress=lambda: self._set_rtmp_status(True),
        )

        def _pump_stderr():
            proc = self.ffmpeg
            if proc is None or proc.stderr is None:
                return
            try:
                while True:
                    chunk = proc.stderr.read(4096)
                    if not chunk:
                        break
                    text = chunk.decode("utf-8", errors="ignore")
                    try:
                        self.log_file.write(text)
                        self.log_file.flush()
                    except Exception:
                        pass
                    watcher.ingest(text)
            except Exception:
                pass

        self._stderr_thread = threading.Thread(target=_pump_stderr, daemon=True)
        self._stderr_thread.start()

        time.sleep(0.2)
        if self.ffmpeg.poll() is not None:
            raise RuntimeError(
                "FFmpeg frame-feed gagal start — cek logs/frame_feed_ffmpeg.log"
            )
        print("[FRAME-FEED] Encoder siap — menunggu handshake RTMP (belum connected).")

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
        except (BrokenPipeError, OSError, ValueError) as err:
            print(f"[FRAME-FEED] Pipe putus: {err}")
            return False

    def _collect_ai_queue(self, last_spoken, idle_abs: str):
        now = time.time()
        if now - self._queue_cache_at < 0.2 and self._queue_cache:
            return [p for p in self._queue_cache if p != last_spoken]
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
        items = sorted(items, key=_sequence_key)
        self._queue_cache = items
        self._queue_cache_at = now
        return items

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

    def _playback_flag_path(self) -> str:
        return os.path.join(self.output_folder, "playback_active.flag")

    def _is_playback_active(self) -> bool:
        return os.path.exists(self._playback_flag_path())

    def _arm_playback(self, reason: str) -> bool:
        path = self._playback_flag_path()
        try:
            os.makedirs(self.output_folder, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("1")
            print(f"[FRAME-FEED] Playback aktif ({reason})")
            return True
        except Exception as err:
            print(f"[FRAME-FEED] Gagal menulis playback flag: {err}")
            return False

    def _ensure_playback(self, last_spoken, idle_abs: str) -> bool:
        """Hanya bicara setelah flag dari dashboard (setelah user klik Siarkan di IG).

        Preview Instagram Producer = feed RTMP yang sama. Auto-play di sini
        membuat host ngomong sebelum siaran publik.
        """
        if self._is_playback_active():
            return True
        now = time.time()
        if now - self._playback_nudge_at >= 5:
            self._playback_nudge_at = now
            queued = self._collect_ai_queue(last_spoken, idle_abs)
            print(
                "[FRAME-FEED] Preview idle — menunggu konfirmasi Go Live "
                f"(rtmp={'on' if self._rtmp_connected else 'off'}, "
                f"clip={len(queued)})"
            )
        return False

    def _peek_next_ai(self, pending: deque, last_spoken, idle_abs) -> Optional[str]:
        if not self._ensure_playback(last_spoken, idle_abs):
            return None
        for path in self._collect_ai_queue(last_spoken, idle_abs):
            if path not in pending:
                pending.append(path)
        if pending:
            reordered = sorted(pending, key=_sequence_key)
            pending.clear()
            pending.extend(reordered)
        return pending[0] if pending else None

    def _feed_idle_until_ai(self, pending, last_spoken, idle_abs):
        """Kirim frame idle; cek flag + antrian AI setiap frame."""
        silence = b"\x00" * self.bytes_per_audio_frame
        frame_period = 1.0 / float(self.fps)
        next_deadline = time.perf_counter()
        full_loop = last_spoken is None

        while not self._shutting_down:
            nxt = self._peek_next_ai(pending, last_spoken, idle_abs)
            if nxt:
                self._prefetch.request(nxt)
                self._av_deadline = next_deadline
                return nxt

            frame = self._idle_display_frame(full_loop=full_loop)
            self._advance_idle_hold(full_loop=full_loop)
            if not self._write_av(frame, silence):
                return None

            next_deadline += frame_period
            sleep_for = next_deadline - time.perf_counter()
            if sleep_for > 0:
                time.sleep(sleep_for)
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
            # Jangan reset clock jika telat — reset bikin burst frame lalu ngadat di IG.

        # --- Prefetched frames ---
        if prefetched is not None:
            played = 0
            for idx, (frame, chunk) in enumerate(prefetched):
                if self._shutting_down:
                    break
                if fade_frames and idx < fade_frames:
                    gain = (idx + 1) / float(fade_frames)
                    samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) * gain
                    chunk = np.clip(samples, -32768, 32767).astype(np.int16).tobytes()
                frame = fit_bgr(frame, self.width, self.height)
                if not self._write_av(frame, chunk):
                    return False
                ok_any = True
                played += 1
                _pace()
            if ok_any:
                self._lock_idle_anchor(played)
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
                    frame = fit_bgr(frame, self.width, self.height)
                if fade_frames and idx < fade_frames:
                    gain = (idx + 1) / float(fade_frames)
                    samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) * gain
                    chunk = np.clip(samples, -32768, 32767).astype(np.int16).tobytes()
                if not self._write_av(frame, chunk):
                    return False
                ok_any = True
                idx += 1
                _pace()
            if ok_any:
                self._lock_idle_anchor(idx)
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
                frame = fit_bgr(frame, self.width, self.height)

            chunk = pcm[audio_pos : audio_pos + self.bytes_per_audio_frame]
            audio_pos += self.bytes_per_audio_frame
            if not chunk:
                chunk = b"\x00" * self.bytes_per_audio_frame

            if not self._write_av(frame, chunk):
                cap.release()
                return False
            ok_any = True
            _pace()

        cap.release()
        if ok_any:
            played = max(1, audio_pos // max(1, self.bytes_per_audio_frame))
            self._lock_idle_anchor(played)
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
                if self._rtmp_fatal:
                    print("[FRAME-FEED] Menghentikan loop — RTMP sudah fatal.")
                    break
                if self.ffmpeg and self.ffmpeg.poll() is not None:
                    if not self._rtmp_fatal:
                        self._rtmp_fatal = True
                        self._rtmp_fatal_hint = (
                            self._rtmp_fatal_hint
                            or "Koneksi RTMP terputus. Buat siaran baru di platform dan tempel Stream Key baru."
                        )
                    self._set_rtmp_status(False)
                    print(f"[FRAME-FEED] Encoder mati: {self._rtmp_fatal_hint}")
                    break

                # Hot-swap overlay
                update_file = os.path.join(self.output_folder, "update_overlay.json")
                if os.path.exists(update_file):
                    try:
                        with open(update_file, "r", encoding="utf-8") as fh:
                            data = json.load(fh)
                        self.product_name = data.get("product_name", self.product_name)
                        self.product_price = data.get("product_price", self.product_price)
                        self.product_image_url = data.get(
                            "product_image_url", self.product_image_url
                        )
                        self.banner_image_url = data.get(
                            "banner_image_url", self.banner_image_url
                        )
                        self._prepare_overlay()
                        os.remove(update_file)
                        print("[FRAME-FEED] Overlay diperbarui")
                    except Exception as err:
                        print(f"[FRAME-FEED] Overlay update notice: {err}")

                nxt = self._peek_next_ai(pending, last_spoken, idle_abs)
                came_from_idle = False
                if not nxt:
                    idle_started = time.perf_counter()
                    nxt = self._feed_idle_until_ai(pending, last_spoken, idle_abs)
                    came_from_idle = (time.perf_counter() - idle_started) > 0.15
                    if came_from_idle:
                        self._chain_from_ai = False
                    if not nxt:
                        if self._shutting_down:
                            break
                        time.sleep(0.02)
                        continue

                path = pending.popleft()
                # Prefetch calon berikutnya selagi clip ini diputar.
                self._peek_next_ai(pending, path, idle_abs)
                if pending:
                    self._prefetch.request(pending[0])

                prefetched = self._prefetch.take(path)
                fade_in = (not came_from_idle) and (not self._chain_from_ai)
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
    RTMP_BASE_URL = os.environ.get("RTMP_URL", "")
    STREAM_KEY = os.environ.get("STREAM_KEY", "")
    if not RTMP_BASE_URL.strip() or not STREAM_KEY.strip():
        raise RuntimeError("RTMP_URL dan STREAM_KEY wajib diisi")
    RTMP_URL = join_rtmp_url(RTMP_BASE_URL, STREAM_KEY)
    print(f"[FRAME-FEED] Target RTMP: {RTMP_URL.split('?')[0]}?**")

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
        if broadcaster._rtmp_fatal:
            sys.exit(2)
    except KeyboardInterrupt:
        print("\n[FRAME-FEED] Dimatikan.")
    finally:
        if broadcaster is not None:
            broadcaster.shutdown()
