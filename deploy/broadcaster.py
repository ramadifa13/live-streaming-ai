import subprocess
import os
import sys
import json
import glob
import time
import urllib.request
import math
import re
import signal
import threading
import traceback
from collections import deque
from PIL import Image, ImageDraw, ImageFont, ImageFilter

try:
    from rtmp_utils import (
        FfmpegLogWatcher,
        join_rtmp_url,
        write_rtmp_status,
    )
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from rtmp_utils import (
        FfmpegLogWatcher,
        join_rtmp_url,
        write_rtmp_status,
    )

try:
    from video_canvas import ffmpeg_fit_filter, prefer_idle_clip
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from video_canvas import ffmpeg_fit_filter, prefer_idle_clip

class AIBroadcaster:
    def __init__(self, rtmp_url, idle_video_path, output_folder,
                 product_name="", product_price="", product_image_url="", banner_image_url=""):
        self.rtmp_url = rtmp_url
        self.idle_video = prefer_idle_clip(idle_video_path) if idle_video_path else idle_video_path
        self.output_folder = output_folder
        self.product_name = product_name
        self.product_price = product_price
        self.product_image_url = product_image_url
        self.banner_image_url = banner_image_url
        self.silence_threshold = 90
        self.last_new_video_time = time.time()
        # Smooth transitions — tunable via env on RunPod
        self.crossfade_seconds = float(os.environ.get("BROADCAST_CROSSFADE_SECONDS", "0.5"))
        self.fade_seconds = float(os.environ.get("BROADCAST_FADE_SECONDS", "0.4"))
        # Chunk idle pendek = jeda senyap lebih singkat sebelum segmen AI berikutnya.
        self.idle_chunk_seconds = float(os.environ.get("BROADCAST_IDLE_CHUNK_SECONDS", "1.5"))
        self.max_onair_idle_seconds = float(os.environ.get("BROADCAST_MAX_IDLE_SECONDS", "6.0"))
        self.idle_streak_started_at = None
        self.master_process = None
        self._duration_cache = {}
        self._audio_cache = {}
        self._action_meta_cache = {}
        self._shutting_down = False
        self._rtmp_fatal = False
        self._rtmp_fatal_hint = ""
        self._stderr_thread = None
        self._current_worker = None
        self.output_width = 720
        self.output_height = 1280
        self.output_fps = 25

        self.local_product_img = None
        self.local_banner_img = None
        self.overlay_png_path = None
        self._prepare_overlay_assets()
        
        print("[BROADCASTER] Menginisialisasi Koneksi ke Server RTMP...")
        self.master_process_start_time = 0
        self._ensure_master_process()

    def _prepare_overlay_assets(self):
        tmp_dir = os.path.join(self.output_folder, "tmp_assets")
        os.makedirs(tmp_dir, exist_ok=True)

        # 1. Product Image (Optional): support base64, remote URL, local path
        if self.product_image_url and self.product_image_url.strip():
            p_url = self.product_image_url.strip()
            if p_url.startswith("data:image/"):
                try:
                    import base64
                    _, encoded = p_url.split(",", 1)
                    img_data = base64.b64decode(encoded)
                    local_p = os.path.join(tmp_dir, "product_thumb.png")
                    with open(local_p, "wb") as f:
                        f.write(img_data)
                    self.local_product_img = local_p
                    print(f"[BROADCASTER] Foto Produk decoded dari base64: {local_p}")
                except Exception as e:
                    print(f"[BROADCASTER ERROR] Gagal decode base64 product image: {e}")
            elif p_url.startswith("http://") or p_url.startswith("https://"):
                try:
                    ext = os.path.splitext(p_url.split("?")[0])[1] or ".png"
                    local_p = os.path.join(tmp_dir, f"product_thumb{ext}")
                    req = urllib.request.Request(
                        p_url,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    )
                    with urllib.request.urlopen(req, timeout=15) as response, open(local_p, "wb") as out_file:
                        out_file.write(response.read())
                    self.local_product_img = local_p
                    print(f"[BROADCASTER] Foto Produk berhasil didownload: {local_p}")
                except Exception as e:
                    print(f"[BROADCASTER ERROR] Gagal download product image dari {p_url}: {e}")
            elif os.path.exists(p_url):
                self.local_product_img = p_url

        # 2. Banner Image (Optional): support base64, remote URL, local path
        if self.banner_image_url and self.banner_image_url.strip():
            b_url = self.banner_image_url.strip()
            if b_url.startswith("data:image/"):
                try:
                    import base64
                    _, encoded = b_url.split(",", 1)
                    img_data = base64.b64decode(encoded)
                    local_b = os.path.join(tmp_dir, "banner_promo.png")
                    with open(local_b, "wb") as f:
                        f.write(img_data)
                    self.local_banner_img = local_b
                    print(f"[BROADCASTER] Banner Promo decoded dari base64: {local_b}")
                except Exception as e:
                    print(f"[BROADCASTER ERROR] Gagal decode base64 banner image: {e}")
            elif b_url.startswith("http://") or b_url.startswith("https://"):
                try:
                    ext = os.path.splitext(b_url.split("?")[0])[1] or ".png"
                    local_b = os.path.join(tmp_dir, f"banner_promo{ext}")
                    req = urllib.request.Request(
                        b_url,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    )
                    with urllib.request.urlopen(req, timeout=15) as response, open(local_b, "wb") as out_file:
                        out_file.write(response.read())
                    self.local_banner_img = local_b
                    print(f"[BROADCASTER] Banner Promo berhasil didownload: {local_b}")
                except Exception as e:
                    print(f"[BROADCASTER ERROR] Gagal download banner image dari {b_url}: {e}")
            elif os.path.exists(b_url):
                self.local_banner_img = b_url

        # 3. Generate PIL Ultra-Modern Overlay PNG
        self._render_pil_overlay(tmp_dir)

    def _render_pil_overlay(self, tmp_dir):
        """Generate true-rounded, anti-aliased, soft-shadow overlay with Python Pillow (PIL)."""
        canvas_w, canvas_h = 720, 1280
        overlay = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

        has_banner = bool(self.local_banner_img and os.path.exists(self.local_banner_img))
        has_product = bool(self.product_name or self.product_price or (self.local_product_img and os.path.exists(self.local_product_img)))

        if not has_banner and not has_product:
            self.overlay_png_path = None
            return

        # A. Top Banner — synced with LivePreviewBoard (w-[75%], h-20, top-1) on 720×1280
        if has_banner:
            try:
                banner_max_w, banner_max_h, banner_y = 540, 245, 12
                banner = Image.open(self.local_banner_img).convert("RGBA")
                banner.thumbnail((banner_max_w, banner_max_h), Image.Resampling.LANCZOS)
                bw, bh = banner.size
                bx = (canvas_w - bw) // 2
                by = banner_y

                # Soft drop shadow behind banner
                shadow_banner = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
                sb_draw = ImageDraw.Draw(shadow_banner)
                sb_draw.rounded_rectangle((bx, by + 4, bx + bw, by + bh + 4), radius=20, fill=(0, 0, 0, 90))
                shadow_banner = shadow_banner.filter(ImageFilter.GaussianBlur(radius=8))
                overlay = Image.alpha_composite(overlay, shadow_banner)

                # Rounded mask for banner
                b_mask = Image.new("L", (bw, bh), 0)
                b_draw = ImageDraw.Draw(b_mask)
                b_draw.rounded_rectangle((0, 0, bw, bh), radius=20, fill=255)

                overlay.paste(banner, (bx, by), b_mask)
                print(f"[BROADCASTER] Banner diperbesar & ditempelkan di posisi ({bx}, {by}) ukuran {bw}x{bh}")
            except Exception as e:
                print(f"[PIL ERROR] Gagal merender banner: {e}")

        # B. Bottom Modern Floating Card (Foto + Nama + Harga + Harga Dicoret Auto - OPTIONAL)
        # Posisi diangkat 220px dari bawah (y=920px) agar 100% aman dari kolom chat, gift, like, & keranjang belanja
        if has_product:
            card_w, card_h = 630, 138
            card_x = (canvas_w - card_w) // 2
            card_y = canvas_h - card_h - 150
            radius = 24

            # 1. Soft Gaussian Drop Shadow for Card
            shadow_card = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
            sc_draw = ImageDraw.Draw(shadow_card)
            sc_draw.rounded_rectangle(
                (card_x, card_y + 8, card_x + card_w, card_y + card_h + 8),
                radius=radius,
                fill=(0, 0, 0, 85)
            )
            shadow_card = shadow_card.filter(ImageFilter.GaussianBlur(radius=14))
            overlay = Image.alpha_composite(overlay, shadow_card)

            # 2. Pure White Card Body (Rounded 24px)
            card_img = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
            card_draw = ImageDraw.Draw(card_img)
            card_draw.rounded_rectangle(
                (0, 0, card_w, card_h),
                radius=radius,
                fill=(255, 255, 255, 250),
                outline=(226, 232, 240, 255),
                width=2
            )
            overlay.paste(card_img, (card_x, card_y), card_img)
            draw = ImageDraw.Draw(overlay)

            # 3. Product Thumbnail (Rounded 16px)
            thumb_size = 106
            thumb_x = card_x + 18
            thumb_y = card_y + 17

            if self.local_product_img and os.path.exists(self.local_product_img):
                try:
                    p_img = Image.open(self.local_product_img).convert("RGBA")
                    p_img = p_img.resize((thumb_size, thumb_size), Image.Resampling.LANCZOS)

                    p_mask = Image.new("L", (thumb_size, thumb_size), 0)
                    pm_draw = ImageDraw.Draw(p_mask)
                    pm_draw.rounded_rectangle((0, 0, thumb_size, thumb_size), radius=16, fill=255)

                    overlay.paste(p_img, (thumb_x, thumb_y), p_mask)
                    draw.rounded_rectangle(
                        (thumb_x, thumb_y, thumb_x + thumb_size, thumb_y + thumb_size),
                        radius=16,
                        outline=(226, 232, 240, 255),
                        width=2
                    )
                except Exception as e:
                    print(f"[PIL] Error rendering thumbnail: {e}")

            # 4. Typography & Pricing
            text_x = thumb_x + thumb_size + 20

            font_name = None
            font_price = None
            font_strike = None

            for font_path in [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                "C:/Windows/Fonts/arialbd.ttf",
                "C:/Windows/Fonts/arial.ttf"
            ]:
                if os.path.exists(font_path):
                    try:
                        font_name = ImageFont.truetype(font_path, 25)
                        font_price = ImageFont.truetype(font_path, 34)
                        font_strike = ImageFont.truetype(font_path, 21)
                        break
                    except Exception:
                        pass

            if not font_name:
                font_name = ImageFont.load_default()
                font_price = ImageFont.load_default()
                font_strike = ImageFont.load_default()

            # Product Name (Dark Slate Bold)
            if self.product_name:
                clean_name = self.product_name[:26]
                draw.text((text_x, card_y + 26), clean_name, font=font_name, fill=(15, 23, 42, 255))

            # Prices Calculation (Discounted Price + Auto System Strikethrough Price)
            raw_price = 0
            if self.product_price:
                digits = re.sub(r"[^0-9]", "", str(self.product_price))
                if digits:
                    raw_price = int(digits)

            if raw_price > 0:
                current_price_str = f"Rp{raw_price:,}".replace(",", ".")
                # Auto Strikethrough Original Price: ~35% higher rounded to nearest thousand
                auto_orig_price = int(math.ceil((raw_price * 1.35) / 5000.0) * 5000)
                strikethrough_str = f"Rp{auto_orig_price:,}".replace(",", ".")

                # Draw Current Price (Rose Bold)
                draw.text((text_x, card_y + 70), current_price_str, font=font_price, fill=(225, 29, 72, 255))

                # Measure width to place strikethrough price right next to it
                bbox = font_price.getbbox(current_price_str)
                price_w = bbox[2] - bbox[0] if bbox else 150

                strike_x = text_x + price_w + 16
                strike_y = card_y + 80

                # Draw Original Strikethrough Text (Muted Slate Gray)
                draw.text((strike_x, strike_y), strikethrough_str, font=font_strike, fill=(148, 163, 184, 255))

                # Draw Strikethrough Line
                s_bbox = font_strike.getbbox(strikethrough_str)
                strike_w = s_bbox[2] - s_bbox[0] if s_bbox else 80
                line_y = strike_y + 11
                draw.line((strike_x - 2, line_y, strike_x + strike_w + 2, line_y), fill=(148, 163, 184, 255), width=2)
            elif self.product_price:
                draw.text((text_x, card_y + 70), str(self.product_price), font=font_price, fill=(225, 29, 72, 255))

        out_path = os.path.join(tmp_dir, "live_overlay.png")
        overlay.save(out_path, "PNG")
        self.overlay_png_path = out_path
        public_overlay = os.path.join(self.output_folder, "overlay_live.png")
        try:
            overlay.save(public_overlay, "PNG")
        except Exception as e:
            print(f"[BROADCASTER] Gagal salin overlay_live.png: {e}")
        print(f"[BROADCASTER] PIL Live Overlay berhasil dirender: {out_path}")

    def _ensure_master_process(self):
        if self._rtmp_fatal:
            write_rtmp_status(self.output_folder, "failed", self._rtmp_fatal_hint)
            return
        if self.master_process is not None and self.master_process.poll() is None:
            return

        write_rtmp_status(self.output_folder, "connecting")
        if self.master_process is not None:
            print(
                f"[BROADCASTER] Master FFmpeg keluar (exit code: {self.master_process.poll()})."
            )
            try:
                self.master_process.stdin.close()
            except Exception:
                pass
            try:
                self.master_process.terminate()
                self.master_process.wait(timeout=2)
            except Exception:
                pass
            # Instagram/Facebook mematikan session setelah I/O error —
            # jangan publish ulang ke stream key yang sudah hangus.
            self._rtmp_fatal = True
            self._rtmp_fatal_hint = (
                self._rtmp_fatal_hint
                or "Koneksi RTMP terputus. Buat siaran baru di platform dan tempel Stream Key baru."
            )
            write_rtmp_status(self.output_folder, "failed", self._rtmp_fatal_hint)
            print(f"[BROADCASTER] RTMP fatal — tidak reconnect: {self._rtmp_fatal_hint}")
            return

        print("[BROADCASTER] Membuka Master FFmpeg RTMP Ingest Connection...")
        master_command = [
            "ffmpeg",
            "-y",
            "-fflags", "+genpts+igndts+discardcorrupt",
            "-err_detect", "ignore_err",
            "-avoid_negative_ts", "make_zero",
            "-f", "mpegts",
            "-i", "pipe:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-max_muxing_queue_size", "4096",
            "-flvflags", "no_duration_filesize",
            "-rtmp_live", "live",
            "-f", "flv",
            self.rtmp_url,
        ]
        try:
            log_dir = "/workspace/ai_live_worker/logs"
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, "master_ffmpeg.log")
            self.log_file = open(log_path, "a", encoding="utf-8")
            self.master_process = subprocess.Popen(
                master_command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            self.master_process_start_time = time.time()
            watcher = FfmpegLogWatcher(
                on_fatal=self._on_rtmp_fatal,
                on_progress=lambda: (
                    write_rtmp_status(self.output_folder, "connected")
                    if not self._rtmp_fatal
                    else None
                ),
            )

            def _pump_stderr():
                proc = self.master_process
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
            print(f"[BROADCASTER] Master FFmpeg aktif (PID: {self.master_process.pid})")
        except Exception as e:
            print(f"[BROADCASTER ERROR] Gagal memulai master FFmpeg: {e}")
            write_rtmp_status(self.output_folder, "failed", str(e))
            self.master_process = None

    def _on_rtmp_fatal(self, hint: str) -> None:
        self._rtmp_fatal = True
        self._rtmp_fatal_hint = hint
        write_rtmp_status(self.output_folder, "failed", hint)
        print(f"[BROADCASTER] RTMP fatal: {hint}")

    def _probe_cache_key(self, video_path):
        try:
            stat = os.stat(video_path)
            return (os.path.abspath(video_path), stat.st_mtime_ns, stat.st_size)
        except OSError:
            return (os.path.abspath(video_path), 0, 0)

    def _has_audio(self, video_path):
        """True bila file punya stream audio. Dicache karena dipanggil per segmen."""
        key = self._probe_cache_key(video_path)
        if key in self._audio_cache:
            return self._audio_cache[key]
        result = True
        try:
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v", "error",
                    "-select_streams", "a:0",
                    "-show_entries", "stream=codec_type",
                    "-of", "csv=p=0",
                    video_path,
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            result = bool(probe.stdout.strip())
        except Exception:
            result = True
        self._audio_cache[key] = result
        return result

    def _probe_duration(self, video_path):
        """Durasi media dalam detik (fallback aman jika ffprobe gagal)."""
        key = self._probe_cache_key(video_path)
        if key in self._duration_cache:
            return self._duration_cache[key]
        value = self._probe_duration_uncached(video_path)
        self._duration_cache[key] = value
        return value

    def _probe_duration_uncached(self, video_path):
        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    video_path,
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                return max(0.5, float(result.stdout.strip()))
        except Exception:
            pass
        try:
            size = os.path.getsize(video_path)
            return max(4.0, min(22.0, size / 160_000.0))
        except Exception:
            return 12.0

    def _encode_output_args(self):
        # Master FFmpeg memakai -c:v copy, sehingga SETIAP segmen yang masuk pipe
        # wajib punya parameter stream identik (resolusi, fps, GOP, kanal audio).
        # Perbedaan sekecil 720x1276 vs 720x1280 akan merusak muxer FLV.
        gop = self.output_fps * 2
        return [
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-profile:v", "high",
            "-level", "4.1",
            "-r", str(self.output_fps),
            "-g", str(gop),
            "-keyint_min", str(gop),
            "-sc_threshold", "0",
            "-b:v", "2500k",
            "-maxrate", "3000k",
            "-bufsize", "6000k",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-ac", "2",
            "-max_muxing_queue_size", "2048",
            "-mpegts_flags", "+resend_headers+initial_discontinuity",
            "-muxpreload", "0",
            "-muxdelay", "0",
            "-flush_packets", "1",
            "-f", "mpegts",
            "pipe:1",
        ]

    def _video_fade_chain(self, fade_in=0.0, fade_out=0.0, fade_out_start=None):
        scale = (
            ffmpeg_fit_filter(self.output_width, self.output_height)
        )
        parts = [scale]
        if fade_in > 0:
            parts.append(f"fade=t=in:st=0:d={fade_in}")
        if fade_out > 0 and fade_out_start is not None:
            parts.append(f"fade=t=out:st={fade_out_start}:d={fade_out}")
        parts.append(f"fps={self.output_fps}")
        return ",".join(parts)

    def _audio_fade_filters(self, fade_in=0.0, fade_out=0.0, fade_out_start=None):
        """Return (filter_complex_fragment, audio_map_label)."""
        if fade_in <= 0 and fade_out <= 0:
            return None, "0:a?"
        parts = []
        if fade_in > 0:
            parts.append(f"afade=t=in:st=0:d={fade_in}")
        if fade_out > 0 and fade_out_start is not None:
            parts.append(f"afade=t=out:st={fade_out_start}:d={fade_out}")
        if not parts:
            return None, "0:a?"
        chain = "[0:a]" + ",".join(parts) + "[aout]"
        return chain, "[aout]"

    def _build_worker_command(
        self,
        video_path,
        max_duration=None,
        fade_in=0.0,
        fade_out=0.0,
        loop_input=False,
        silent_audio=False,
    ):
        """Selalu re-encode lewat filter_complex.

        Jalur `-c:v copy` sengaja dihapus: aset avatar bisa berbeda resolusi dan
        fps antar gesture, dan mengalirkannya apa adanya ke master `-c:v copy`
        mengubah SPS/PPS di tengah siaran sehingga RTMP diputus platform.
        """
        duration = self._probe_duration(video_path)
        effective_duration = max_duration if max_duration else duration
        fade_out_start = None
        if fade_out > 0 and effective_duration > fade_out + 0.08:
            fade_out_start = round(effective_duration - fade_out, 3)

        has_overlay = bool(
            self.overlay_png_path and os.path.exists(self.overlay_png_path)
        )

        vchain = self._video_fade_chain(fade_in, fade_out, fade_out_start)

        cmd = ["ffmpeg", "-y"]
        if loop_input:
            cmd.extend(["-stream_loop", "-1"])
        cmd.extend(["-re", "-i", video_path])

        next_input_idx = 1
        overlay_idx = None
        if has_overlay:
            cmd.extend(["-loop", "1", "-i", self.overlay_png_path])
            overlay_idx = next_input_idx
            next_input_idx += 1

        # Idle memakai sumber senyap eksplisit agar audio asli clip tidak
        # pernah tersiar, apa pun isi file aset yang dipasang operator.
        silence_idx = None
        if silent_audio:
            cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"])
            silence_idx = next_input_idx
            next_input_idx += 1

        if silent_audio:
            afilter, amap = None, f"{silence_idx}:a"
        else:
            afilter, amap = self._audio_fade_filters(
                fade_in, fade_out, fade_out_start
            )

        if has_overlay:
            fc = (
                f"[0:v]{vchain}[vbase];"
                f"[vbase][{overlay_idx}:v]overlay=0:0:shortest=1[vout]"
            )
        else:
            fc = f"[0:v]{vchain}[vout]"
        if afilter:
            fc = f"{fc};{afilter}"

        cmd.extend([
            "-filter_complex", fc,
            "-map", "[vout]",
            "-map", amap,
        ])

        if max_duration:
            cmd.extend(["-t", str(max_duration)])
        cmd.extend(self._encode_output_args())
        return cmd

    def _build_crossfade_command(self, from_path, to_path, fade=None):
        """FFmpeg xfade + acrossfade untuk transisi natural antar clip."""
        fade = self.crossfade_seconds if fade is None else fade
        from_dur = self._probe_duration(from_path)
        offset = max(0.08, from_dur - fade)
        scale = (
            ffmpeg_fit_filter(self.output_width, self.output_height)
            + f",fps={self.output_fps}"
        )
        has_overlay = bool(
            self.overlay_png_path and os.path.exists(self.overlay_png_path)
        )

        if has_overlay:
            fc = (
                f"[0:v]{scale}[v0];"
                f"[1:v]{scale}[v1];"
                f"[v0][v1]xfade=transition=fade:duration={fade}:offset={offset}[vx];"
                f"[vx][2:v]overlay=0:0:shortest=1[vout];"
                f"[0:a][1:a]acrossfade=d={fade}:c1=tri:c2=tri[aout]"
            )
            cmd = [
                "ffmpeg", "-y",
                "-re", "-i", from_path,
                "-re", "-i", to_path,
                "-loop", "1", "-i", self.overlay_png_path,
                "-filter_complex", fc,
                "-map", "[vout]",
                "-map", "[aout]",
            ]
        else:
            fc = (
                f"[0:v]{scale}[v0];"
                f"[1:v]{scale}[v1];"
                f"[v0][v1]xfade=transition=fade:duration={fade}:offset={offset}[vout];"
                f"[0:a][1:a]acrossfade=d={fade}:c1=tri:c2=tri[aout]"
            )
            cmd = [
                "ffmpeg", "-y",
                "-re", "-i", from_path,
                "-re", "-i", to_path,
                "-filter_complex", fc,
                "-map", "[vout]",
                "-map", "[aout]",
            ]

        cmd.extend(self._encode_output_args())
        return cmd

    def _spawn_worker(self, command):
        if self._shutting_down:
            return None
        self._ensure_master_process()
        if self._rtmp_fatal or self.master_process is None or self.master_process.stdin is None:
            print("[BROADCASTER ERROR] Master FFmpeg pipe tidak tersedia.")
            return None
        try:
            worker = subprocess.Popen(
                command,
                stdout=self.master_process.stdin,
                stderr=subprocess.DEVNULL,
            )
            self._current_worker = worker
            return worker
        except Exception as e:
            print(f"[BROADCASTER ERROR] Gagal spawn worker FFmpeg: {e}")
            return None

    def shutdown(self):
        """Matikan worker dan master FFmpeg secara eksplisit.

        Tanpa ini, SIGTERM hanya menghentikan proses Python sementara FFmpeg
        master tetap hidup dan terus memegang koneksi publish RTMP. Broadcaster
        berikutnya lalu publish ke stream key yang sama dan ditolak platform,
        sehingga siaran mati permanen meski watchdog terus me-restart.
        """
        if self._shutting_down:
            return
        self._shutting_down = True
        print("[BROADCASTER] Menutup worker dan master FFmpeg...")

        for label, proc in (
            ("worker", getattr(self, "_current_worker", None)),
            ("master", self.master_process),
        ):
            if proc is None or proc.poll() is not None:
                continue
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            print(f"[BROADCASTER] FFmpeg {label} dihentikan.")

        self._current_worker = None
        self.master_process = None

        write_rtmp_status(
            self.output_folder,
            "failed" if self._rtmp_fatal else "disconnected",
            self._rtmp_fatal_hint,
        )

    def _stream_file_async(
        self,
        video_path,
        max_duration=None,
        fade_in=0.0,
        fade_out=0.0,
        loop_input=False,
        silent_audio=False,
    ):
        """Putar satu clip dengan optional fade in/out di awal/akhir."""
        if not video_path or not os.path.exists(video_path):
            print(f"[ERROR] File video tidak ditemukan: {video_path}")
            return None
        worker_command = self._build_worker_command(
            video_path,
            max_duration=max_duration,
            fade_in=fade_in,
            fade_out=fade_out,
            loop_input=loop_input,
            silent_audio=silent_audio,
        )
        return self._spawn_worker(worker_command)

    def _load_action_meta(self, video_path):
        """Sidecar `<video>.json` ditulis live_worker.py — berisi aksi/kategori/
        durasi crossfade yang cocok untuk clip ini. Di-cache karena dibaca
        berkali-kali (sekali per polling loop sebelum worker selesai)."""
        meta_path = f"{video_path}.json"
        if meta_path in self._action_meta_cache:
            return self._action_meta_cache[meta_path]
        meta = None
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                meta = None
        self._action_meta_cache[meta_path] = meta
        return meta

    def _resolve_crossfade_seconds(self, video_path):
        """Gestur pendek (NOD, LAUGH, dst) butuh crossfade lebih singkat
        daripada idle/talk supaya perpindahan pose tidak terasa lambat/kaku."""
        meta = self._load_action_meta(video_path)
        if meta and isinstance(meta.get("crossfadeSeconds"), (int, float)):
            return float(meta["crossfadeSeconds"])
        return self.crossfade_seconds

    def _stream_crossfade_async(self, from_path, to_path):
        """Crossfade halus antar dua clip (visual + audio)."""
        if not from_path or not os.path.exists(from_path):
            return self._stream_file_async(to_path, fade_in=self.fade_seconds)
        if not to_path or not os.path.exists(to_path):
            return self._stream_file_async(from_path, fade_out=self.fade_seconds)
        # acrossfade menuntut kedua input punya stream audio; tanpa penjagaan ini
        # satu aset tanpa audio membuat FFmpeg langsung mati dan siaran nge-gap.
        if not (self._has_audio(from_path) and self._has_audio(to_path)):
            print(
                f"[BROADCASTER] Crossfade dilewati — {os.path.basename(from_path)} "
                f"atau {os.path.basename(to_path)} tidak punya stream audio."
            )
            return self._stream_file_async(to_path, fade_in=self.fade_seconds)
        fade = self._resolve_crossfade_seconds(to_path)
        label_from = os.path.basename(from_path)
        label_to = os.path.basename(to_path)
        print(
            f"[BROADCASTER] ✨ Crossfade {fade}s: "
            f"{label_from} → {label_to}"
        )
        return self._spawn_worker(self._build_crossfade_command(from_path, to_path, fade=fade))

    def _stream_idle_chunk(self):
        """Idle chunk: input di-loop, audio senyap, tanpa fade.

        `-stream_loop -1` membuat clip idle 5 detik mengisi penuh chunk tanpa
        sambungan, dan fade dihapus supaya penonton tidak melihat kedip berkala
        setiap kali chunk berganti.
        """
        return self._stream_file_async(
            self.idle_video,
            max_duration=self.idle_chunk_seconds,
            loop_input=True,
            silent_audio=True,
        )

    def _sequence_key(self, path):
        """Urutan tayang = urutan SUBMIT, bukan urutan selesai render.

        Nama file worker berbentuk `[prio_]task_<epoch_ms>_<hex>.mp4`, dan
        epoch_ms ditetapkan saat job diterima API sehingga mencerminkan urutan
        yang dimaksud orchestrator. Mengurutkan dengan ctime salah karena
        beberapa job berjalan bersamaan dan lock inferensi GPU tidak menjamin
        FIFO, sehingga host bisa menyinggung hal yang belum diucapkan.

        Prefix `prio_` dipakai untuk jawaban komentar dan selalu naik ke depan
        antrian agar interaksi tidak terasa tertunda.
        """
        basename = os.path.basename(path)
        match = re.match(r"^(prio_)?task_(\d{10,})_", basename)
        if match:
            rank = 0 if match.group(1) else 1
            return (rank, int(match.group(2)), basename)
        try:
            return (2, os.path.getctime(path), basename)
        except OSError:
            return (2, 0.0, basename)

    def _collect_ai_queue(self, last_spoken_video, idle_abs):
        search_pattern = os.path.join(self.output_folder, "**", "*.mp4")
        return sorted(
            [
                path
                for path in glob.glob(search_pattern, recursive=True)
                if path != last_spoken_video
                and os.path.abspath(path) != idle_abs
                and not os.path.basename(path).startswith("temp_")
                and not os.path.basename(path).endswith(".tmp")
                and os.path.getsize(path) >= 1024
            ],
            key=self._sequence_key,
        )

    def _cleanup_played_ai(self, video_path, idle_abs):
        if not video_path:
            return
        try:
            if (
                os.path.exists(video_path)
                and os.path.abspath(video_path) != idle_abs
            ):
                os.remove(video_path)
                print(
                    f"[CLEANUP] Video dihapus setelah tayang: "
                    f"{os.path.basename(video_path)}"
                )
        except Exception as e:
            print(f"[CLEANUP ERROR] Gagal menghapus {video_path}: {e}")
        meta_path = f"{video_path}.json"
        self._action_meta_cache.pop(meta_path, None)
        try:
            if os.path.exists(meta_path):
                os.remove(meta_path)
        except Exception:
            pass

    def _start_next_segment(
        self,
        *,
        from_path,
        to_path,
        is_idle=False,
        fade_in=0.0,
        use_crossfade=True,
    ):
        """Mulai segmen berikutnya — crossfade jika ada clip sebelumnya."""
        if (
            use_crossfade
            and from_path
            and to_path
            and os.path.exists(from_path)
            and os.path.exists(to_path)
            and os.path.abspath(from_path) != os.path.abspath(to_path)
        ):
            return self._stream_crossfade_async(from_path, to_path), to_path, is_idle

        if to_path and os.path.exists(to_path):
            if is_idle:
                return self._stream_idle_chunk(), to_path, True
            worker = self._stream_file_async(to_path, fade_in=fade_in)
            return worker, to_path, is_idle
        return None, from_path, is_idle

    def start_loop(self):
        print(
            f"\n[BROADCASTER] Siaran live — crossfade={self.crossfade_seconds}s, "
            f"fade={self.fade_seconds}s, idle_chunk={self.idle_chunk_seconds}s\n"
        )
        last_spoken_video = None
        consecutive_idle_errors = 0

        current_worker = None
        is_playing_idle = False
        current_path = None
        pending_ai_queue = deque()

        while not self._shutting_down:
            try:
                if self._rtmp_fatal:
                    print("[BROADCASTER] Menghentikan loop — RTMP sudah fatal.")
                    break
                if self.master_process is not None and self.master_process.poll() is not None:
                    self._ensure_master_process()
                    if self._rtmp_fatal:
                        break
                # 0. Hot-Swap Video Overlay
                update_file = os.path.join(self.output_folder, "update_overlay.json")
                if os.path.exists(update_file):
                    try:
                        with open(update_file, "r") as f:
                            data = json.load(f)
                        self.product_name = data.get("product_name", self.product_name)
                        self.product_price = data.get("product_price", self.product_price)
                        self.product_image_url = data.get(
                            "product_image_url", self.product_image_url
                        )
                        self.banner_image_url = data.get(
                            "banner_image_url", self.banner_image_url
                        )
                        self._prepare_overlay_assets()
                        print(
                            f"[BROADCASTER] 🔄 Overlay diperbarui: "
                            f"{self.product_name} ({self.product_price})"
                        )
                        os.remove(update_file)
                    except Exception as e:
                        print(f"[BROADCASTER ERROR] Gagal update overlay: {e}")

                playback_flag = os.path.join(
                    self.output_folder, "playback_active.flag"
                )
                playback_active = os.path.exists(playback_flag)
                idle_abs = (
                    os.path.abspath(self.idle_video) if self.idle_video else ""
                )

                # Kumpulkan video AI baru ke antrian (tanpa interrupt kasar)
                if playback_active:
                    queue_changed = False
                    for path in self._collect_ai_queue(last_spoken_video, idle_abs):
                        if path not in pending_ai_queue:
                            pending_ai_queue.append(path)
                            queue_changed = True
                    if queue_changed:
                        # Urut ulang seluruh antrian, bukan hanya batch baru:
                        # jawaban komentar (prefix prio_) sering muncul setelah
                        # beberapa segmen otonom sudah mengantre, dan append
                        # biasa akan menaruhnya di belakang.
                        reordered = sorted(pending_ai_queue, key=self._sequence_key)
                        pending_ai_queue.clear()
                        pending_ai_queue.extend(reordered)

                # Worker selesai → transisi halus ke segmen berikutnya
                if current_worker and current_worker.poll() is not None:
                    finished_path = current_path
                    finished_idle = is_playing_idle
                    finished_ai = last_spoken_video

                    current_worker = None
                    current_path = None
                    is_playing_idle = False

                    if finished_ai and not finished_idle:
                        self._cleanup_played_ai(finished_ai, idle_abs)

                    next_ai = (
                        pending_ai_queue.popleft()
                        if pending_ai_queue
                        else None
                    )

                    if next_ai:
                        print(
                            f"[>] TRANSISI → AI: {os.path.basename(next_ai)}"
                        )
                        # Idle hanya diputar sebagai chunk — crossfade dari file
                        # idle penuh akan salah offset; gunakan fade-in saja.
                        worker, path, idle_flag = self._start_next_segment(
                            from_path=(
                                finished_path if not finished_idle else None
                            ),
                            to_path=next_ai,
                            is_idle=False,
                            use_crossfade=bool(
                                finished_path
                                and not finished_idle
                                and os.path.exists(finished_path)
                            ),
                        )
                        if worker:
                            current_worker = worker
                            current_path = path
                            last_spoken_video = next_ai
                            self.last_new_video_time = time.time()
                            self.idle_streak_started_at = None
                        else:
                            pending_ai_queue.appendleft(next_ai)
                    elif playback_active and os.path.exists(self.idle_video):
                        print("[>] TRANSISI → idle (menunggu segmen AI)")
                        worker, path, idle_flag = self._start_next_segment(
                            from_path=finished_path if not finished_idle else None,
                            to_path=self.idle_video,
                            is_idle=True,
                            use_crossfade=bool(
                                finished_path
                                and not finished_idle
                                and os.path.exists(finished_path)
                            ),
                        )
                        if worker:
                            current_worker = worker
                            current_path = path
                            is_playing_idle = True
                            if self.idle_streak_started_at is None:
                                self.idle_streak_started_at = time.time()
                    else:
                        self.idle_streak_started_at = None

                # Mulai segmen jika idle
                if current_worker is None:
                    next_ai = (
                        pending_ai_queue.popleft()
                        if pending_ai_queue
                        else None
                    )

                    if next_ai:
                        print(
                            f"[>] MEMUTAR AI: {os.path.basename(next_ai)}"
                        )
                        worker, path, _ = self._start_next_segment(
                            from_path=None,
                            to_path=next_ai,
                            is_idle=False,
                            fade_in=self.fade_seconds,
                            use_crossfade=False,
                        )
                        if worker:
                            current_worker = worker
                            current_path = path
                            last_spoken_video = next_ai
                            self.last_new_video_time = time.time()
                            self.idle_streak_started_at = None
                        else:
                            pending_ai_queue.appendleft(next_ai)
                    elif os.path.exists(self.idle_video):
                        if self.idle_streak_started_at is None:
                            self.idle_streak_started_at = time.time()
                        elif (
                            playback_active
                            and time.time() - self.idle_streak_started_at
                            > self.max_onair_idle_seconds
                        ):
                            print(
                                f"[BROADCASTER] ⚠️ Idle > "
                                f"{self.max_onair_idle_seconds}s — "
                                "menunggu segmen AI..."
                            )
                        worker = self._stream_idle_chunk()
                        if worker:
                            current_worker = worker
                            current_path = self.idle_video
                            is_playing_idle = True
                            consecutive_idle_errors = 0
                        else:
                            consecutive_idle_errors += 1
                            if consecutive_idle_errors > 3:
                                self._ensure_master_process()
                                consecutive_idle_errors = 0
                            time.sleep(0.3)
                    else:
                        time.sleep(0.5)

                time.sleep(0.05)

            except Exception as loop_err:
                print(f"[BROADCASTER UNHANDLED EXCEPTION] {loop_err}")
                traceback.print_exc()
                time.sleep(1)

# --- KONFIGURASI DAN EKSEKUSI ---
if __name__ == "__main__":
    import json

    RTMP_BASE_URL = os.environ.get("RTMP_URL", "")
    STREAM_KEY = os.environ.get("STREAM_KEY", "")
    if not RTMP_BASE_URL.strip() or not STREAM_KEY.strip():
        raise RuntimeError("RTMP_URL dan STREAM_KEY wajib diisi melalui environment")
    RTMP_URL = join_rtmp_url(RTMP_BASE_URL, STREAM_KEY)
    print(f"[BROADCASTER] Target RTMP: {RTMP_URL.split('?')[0]}?**")
    
    OUTPUT_FOLDER = os.environ.get("OUTPUT_FOLDER", "/workspace/ai_live_worker/output")
    IDLE_VIDEO = os.environ.get(
        "IDLE_VIDEO",
        "/workspace/ai_live_worker/assets/3d/namira_idle.mp4",
    )
    
    PRODUCT_NAME = os.environ.get("PRODUCT_NAME", "")
    PRODUCT_PRICE = os.environ.get("PRODUCT_PRICE", "")
    PRODUCT_IMAGE_URL = os.environ.get("PRODUCT_IMAGE_URL", "")
    BANNER_IMAGE_URL = os.environ.get("BANNER_IMAGE_URL", "")

    # Load configuration JSON file (mencegah Linux Errno 7: Argument list too long akibat base64 image yang besar)
    config_file = os.environ.get("CONFIG_PATH") or os.path.join(OUTPUT_FOLDER, "broadcast_config.json")
    if os.path.exists(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            PRODUCT_NAME = cfg.get("product_name", PRODUCT_NAME)
            PRODUCT_PRICE = cfg.get("product_price", PRODUCT_PRICE)
            PRODUCT_IMAGE_URL = cfg.get("product_image_url", PRODUCT_IMAGE_URL)
            BANNER_IMAGE_URL = cfg.get("banner_image_url", BANNER_IMAGE_URL)
            IDLE_VIDEO = cfg.get("idle_video", IDLE_VIDEO)
            print(f"[BROADCASTER] Konfigurasi siaran dimuat dari {config_file}")
        except Exception as e:
            print(f"[BROADCASTER ERROR] Gagal membaca {config_file}: {e}")
    
    broadcaster = None
    try:
        broadcaster = AIBroadcaster(
            RTMP_URL, IDLE_VIDEO, OUTPUT_FOLDER,
            product_name=PRODUCT_NAME,
            product_price=PRODUCT_PRICE,
            product_image_url=PRODUCT_IMAGE_URL,
            banner_image_url=BANNER_IMAGE_URL
        )

        def _handle_termination(signum, _frame):
            print(f"\n[BROADCASTER] Sinyal {signum} diterima — menutup siaran.")
            broadcaster.shutdown()

        # Tanpa handler ini, SIGTERM dari api_server meninggalkan FFmpeg master
        # hidup sebagai proses yatim yang masih memegang slot publish RTMP.
        signal.signal(signal.SIGTERM, _handle_termination)
        signal.signal(signal.SIGINT, _handle_termination)

        broadcaster.start_loop()
        if broadcaster._rtmp_fatal:
            sys.exit(2)
    except KeyboardInterrupt:
        print("\n[BROADCASTER] Siaran dimatikan.")
    finally:
        if broadcaster is not None:
            broadcaster.shutdown()


def prepare_overlay_files(
    output_folder,
    product_name="",
    product_price="",
    product_image_url="",
    banner_image_url="",
):
    """Render overlay PNG tanpa membuka koneksi RTMP (dipakai frame_feed)."""
    dummy = object.__new__(AIBroadcaster)
    dummy.output_folder = output_folder
    dummy.product_name = product_name or ""
    dummy.product_price = product_price or ""
    dummy.product_image_url = product_image_url or ""
    dummy.banner_image_url = banner_image_url or ""
    dummy.local_product_img = None
    dummy.local_banner_img = None
    dummy.overlay_png_path = None
    dummy._prepare_overlay_assets()
    return dummy.overlay_png_path

