import subprocess
import os
import sys
import json
import glob
import time
import urllib.request
import math
import re
import traceback
from PIL import Image, ImageDraw, ImageFont, ImageFilter

class AIBroadcaster:
    def __init__(self, rtmp_url, idle_video_path, output_folder,
                 product_name="", product_price="", product_image_url="", banner_image_url=""):
        self.rtmp_url = rtmp_url
        self.idle_video = idle_video_path
        self.output_folder = output_folder
        self.product_name = product_name
        self.product_price = product_price
        self.product_image_url = product_image_url
        self.banner_image_url = banner_image_url
        self.silence_threshold = 90
        self.last_new_video_time = time.time()
        self.idle_chunk_seconds = 3.5
        self.max_onair_idle_seconds = 5.0
        self.idle_streak_started_at = None
        self.master_process = None

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

        # A. Top Banner (Lebih Besar & Dinaikkan ke atas agar tidak menutupi kepala avatar - OPTIONAL)
        if has_banner:
            try:
                banner = Image.open(self.local_banner_img).convert("RGBA")
                banner.thumbnail((620, 145), Image.Resampling.LANCZOS)
                bw, bh = banner.size
                bx = (canvas_w - bw) // 2
                by = 42

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
        print(f"[BROADCASTER] PIL Live Overlay berhasil dirender: {out_path}")

    def _ensure_master_process(self):
        status_file = os.path.join(self.output_folder, "rtmp_status.txt")
        if self.master_process is None or self.master_process.poll() is not None:
            try:
                with open(status_file, "w") as f:
                    f.write("disconnected")
            except Exception:
                pass

            if self.master_process is not None:
                print(f"[BROADCASTER] Master FFmpeg keluar (exit code: {self.master_process.poll()}). Menginisialisasi ulang...")
                try:
                    self.master_process.stdin.close()
                except Exception:
                    pass
                try:
                    self.master_process.terminate()
                    self.master_process.wait(timeout=2)
                except Exception:
                    pass
            print("[BROADCASTER] Membuka Master FFmpeg RTMP Ingest Connection...")
            master_command = [
                "ffmpeg",
                "-y",
                "-fflags", "+genpts",
                "-async", "1",
                "-f", "mpegts",
                "-i", "pipe:0",
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-max_muxing_queue_size", "2048",
                "-flvflags", "no_duration_filesize",
                "-f", "flv",
                self.rtmp_url
            ]
            try:
                log_dir = "/workspace/ai_live_worker/logs"
                os.makedirs(log_dir, exist_ok=True)
                self.log_file = open(os.path.join(log_dir, "master_ffmpeg.log"), "a", encoding="utf-8")
                self.master_process = subprocess.Popen(
                    master_command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=self.log_file
                )
                self.master_process_start_time = time.time()
                print(f"[BROADCASTER] Master FFmpeg aktif (PID: {self.master_process.pid})")
            except Exception as e:
                print(f"[BROADCASTER ERROR] Gagal memulai master FFmpeg: {e}")
                self.master_process = None

    def _build_worker_command(self, video_path, max_duration=None):
        if not self.overlay_png_path or not os.path.exists(self.overlay_png_path):
            cmd = [
                "ffmpeg",
                "-re",
                "-i", video_path,
            ]
            if max_duration:
                cmd.extend(["-t", str(max_duration)])
            cmd.extend([
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-max_muxing_queue_size", "2048",
                "-f", "mpegts",
                "pipe:1",
            ])
            return cmd

        # Overlay PIL PNG directly onto video with zero FFmpeg filter latency
        cmd = [
            "ffmpeg",
            "-re",
            "-i", video_path,
            "-loop", "1",
            "-i", self.overlay_png_path,
            "-filter_complex", "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[base];[base][1:v]overlay=0:0:shortest=1[v]",
            "-map", "[v]",
            "-map", "0:a?",
        ]
        if max_duration:
            cmd.extend(["-t", str(max_duration)])
        cmd.extend([
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-max_muxing_queue_size", "2048",
            "-f", "mpegts",
            "pipe:1",
        ])
        return cmd

    def _stream_file_async(self, video_path, max_duration=None):
        """Memutar file video secara non-blocking agar bisa diinterupsi oleh respon AI."""
        if not video_path or not os.path.exists(video_path):
            print(f"[ERROR] File video tidak ditemukan: {video_path}")
            return None
        
        self._ensure_master_process()
        if self.master_process is None or self.master_process.stdin is None:
            print("[BROADCASTER ERROR] Master FFmpeg pipe tidak tersedia.")
            return None
        
        worker_command = self._build_worker_command(video_path, max_duration)
        try:
            worker_process = subprocess.Popen(
                worker_command,
                stdout=self.master_process.stdin,
                stderr=subprocess.DEVNULL
            )
            return worker_process
        except Exception as e:
            print(f"[ERROR] Gagal memutar {video_path}: {e}")
            return None

    def start_loop(self):
        print(f"\n[BROADCASTER] Menyiarkan secara Live (Tekan Ctrl+C untuk berhenti)...\n")
        last_spoken_video = None
        consecutive_idle_errors = 0
        
        current_worker = None
        is_playing_idle = False

        while True:
            try:
                # 0. Hot-Swap Video Overlay check (Update card & banner in-place during live broadcast)
                update_file = os.path.join(self.output_folder, "update_overlay.json")
                if os.path.exists(update_file):
                    try:
                        with open(update_file, "r") as f:
                            data = json.load(f)
                        self.product_name = data.get("product_name", self.product_name)
                        self.product_price = data.get("product_price", self.product_price)
                        self.product_image_url = data.get("product_image_url", self.product_image_url)
                        self.banner_image_url = data.get("banner_image_url", self.banner_image_url)
                        self._prepare_overlay_assets()
                        print(f"[BROADCASTER] 🔄 Live Video Overlay diperbarui secara Hot-Swap: {self.product_name} ({self.product_price})")
                        os.remove(update_file)
                    except Exception as e:
                        print(f"[BROADCASTER ERROR] Gagal update live overlay: {e}")

                playback_flag = os.path.join(self.output_folder, "playback_active.flag")
                playback_active = os.path.exists(playback_flag)

                search_pattern = os.path.join(self.output_folder, "**", "*.mp4")
                idle_abs = os.path.abspath(self.idle_video) if self.idle_video else ""
                new_videos = sorted(
                    [path for path in glob.glob(search_pattern, recursive=True)
                     if path != last_spoken_video 
                     and os.path.abspath(path) != idle_abs
                     and not os.path.basename(path).startswith("temp_")
                     and not os.path.basename(path).endswith(".tmp")],
                    key=os.path.getctime,
                )

                video_to_play = None

                if playback_active and new_videos:
                    video_to_play = new_videos[0]
                    # Pastikan file selesai dirender
                    try:
                        fsize = os.path.getsize(video_to_play)
                        if fsize < 1024:
                            time.sleep(0.3)
                            continue
                    except Exception:
                        time.sleep(0.3)
                        continue

                    # Jika AI video siap dan kita sedang putar idle, hentikan idle sekarang juga!
                    if current_worker and is_playing_idle:
                        print("[BROADCASTER] 🚀 Menginterupsi idle video untuk merespon AI seketika...")
                        try:
                            current_worker.kill()
                        except Exception:
                            pass
                        current_worker = None

                # Cek apakah video saat ini sudah selesai
                if current_worker:
                    ret = current_worker.poll()
                    if ret is not None:
                        current_worker = None
                        if not is_playing_idle and last_spoken_video:
                            try:
                                if os.path.exists(last_spoken_video) and os.path.abspath(last_spoken_video) != idle_abs:
                                    os.remove(last_spoken_video)
                                    print(f"[CLEANUP] Video dihapus setelah tayang: {os.path.basename(last_spoken_video)}")
                            except Exception as e:
                                print(f"[CLEANUP ERROR] Gagal menghapus {last_spoken_video}: {e}")
                        is_playing_idle = False
                        self.idle_streak_started_at = None

                # Putar video jika tidak ada yang sedang diputar
                if current_worker is None:
                    if video_to_play:
                        print(f"[>] MEMUTAR RESPON AI: {os.path.basename(video_to_play)}")
                        current_worker = self._stream_file_async(video_to_play)
                        if current_worker:
                            last_spoken_video = video_to_play
                            self.last_new_video_time = time.time()
                            is_playing_idle = False
                            self.idle_streak_started_at = None
                        else:
                            time.sleep(0.2)
                    else:
                        if os.path.exists(self.idle_video):
                            if self.idle_streak_started_at is None:
                                self.idle_streak_started_at = time.time()
                            elif (
                                time.time() - self.idle_streak_started_at
                                > self.max_onair_idle_seconds
                            ):
                                print(
                                    f"[BROADCASTER] ⚠️ Idle > {self.max_onair_idle_seconds}s — menunggu segmen AI..."
                                )
                            current_worker = self._stream_file_async(
                                self.idle_video,
                                max_duration=self.idle_chunk_seconds,
                            )
                            if current_worker:
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

                # UPDATE STATUS RTMP
                if self.master_process and self.master_process.poll() is None:
                    if time.time() - self.master_process_start_time > 3:
                        try:
                            with open(os.path.join(self.output_folder, "rtmp_status.txt"), "w") as f:
                                f.write("connected")
                        except Exception:
                            pass

                time.sleep(0.05) # Loop responsif & hemat CPU (50ms)

            except Exception as loop_err:
                print(f"[BROADCASTER UNHANDLED EXCEPTION] {loop_err}")
                time.sleep(1)

# --- KONFIGURASI DAN EKSEKUSI ---
if __name__ == "__main__":
    import json

    RTMP_BASE_URL = os.environ.get("RTMP_URL", "").rstrip("/")
    STREAM_KEY = os.environ.get("STREAM_KEY", "")
    if not RTMP_BASE_URL or not STREAM_KEY:
        raise RuntimeError("RTMP_URL dan STREAM_KEY wajib diisi melalui environment")
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
    
    try:
        broadcaster = AIBroadcaster(
            RTMP_URL, IDLE_VIDEO, OUTPUT_FOLDER,
            product_name=PRODUCT_NAME,
            product_price=PRODUCT_PRICE,
            product_image_url=PRODUCT_IMAGE_URL,
            banner_image_url=BANNER_IMAGE_URL
        )
        broadcaster.start_loop()
    except KeyboardInterrupt:
        print("\n[BROADCASTER] Siaran dimatikan.")

