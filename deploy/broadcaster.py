import subprocess
import os
import glob
import time
import urllib.request

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
        self.master_process = None

        self.local_product_img = None
        self.local_banner_img = None
        self._prepare_overlay_assets()
        
        print("[BROADCASTER] Menginisialisasi Koneksi ke Server RTMP...")
        self.master_process_start_time = 0
        self._ensure_master_process()

    def _prepare_overlay_assets(self):
        tmp_dir = os.path.join(self.output_folder, "tmp_assets")
        os.makedirs(tmp_dir, exist_ok=True)

        # 1. Product Image: support base64, remote URL, local path
        if self.product_image_url:
            if self.product_image_url.startswith("data:image/"):
                try:
                    import base64
                    _, encoded = self.product_image_url.split(",", 1)
                    img_data = base64.b64decode(encoded)
                    local_p = os.path.join(tmp_dir, "product_thumb.png")
                    with open(local_p, "wb") as f:
                        f.write(img_data)
                    self.local_product_img = local_p
                except Exception as e:
                    print(f"[BROADCASTER] Gagal decode base64 product image: {e}")
            elif self.product_image_url.startswith("http://") or self.product_image_url.startswith("https://"):
                try:
                    local_p = os.path.join(tmp_dir, "product_thumb.jpg")
                    urllib.request.urlretrieve(self.product_image_url, local_p)
                    self.local_product_img = local_p
                except Exception as e:
                    print(f"[BROADCASTER] Gagal download product image: {e}")
            elif os.path.exists(self.product_image_url):
                self.local_product_img = self.product_image_url

        # 2. Banner Image: support base64, remote URL, local path
        if self.banner_image_url:
            if self.banner_image_url.startswith("data:image/"):
                try:
                    import base64
                    _, encoded = self.banner_image_url.split(",", 1)
                    img_data = base64.b64decode(encoded)
                    local_b = os.path.join(tmp_dir, "banner_promo.png")
                    with open(local_b, "wb") as f:
                        f.write(img_data)
                    self.local_banner_img = local_b
                except Exception as e:
                    print(f"[BROADCASTER] Gagal decode base64 banner image: {e}")
            elif self.banner_image_url.startswith("http://") or self.banner_image_url.startswith("https://"):
                try:
                    local_b = os.path.join(tmp_dir, "banner_promo.jpg")
                    urllib.request.urlretrieve(self.banner_image_url, local_b)
                    self.local_banner_img = local_b
                except Exception as e:
                    print(f"[BROADCASTER] Gagal download banner image: {e}")
            elif os.path.exists(self.banner_image_url):
                self.local_banner_img = self.banner_image_url

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

    def _build_worker_command(self, video_path):
        has_overlay = bool(self.local_banner_img or self.product_name or self.local_product_img or self.product_price)
        if not has_overlay:
            return [
                "ffmpeg",
                "-re",
                "-i", video_path,
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-max_muxing_queue_size", "2048",
                "-f", "mpegts",
                "pipe:1"
            ]

        # Composite video overlay: Banner top-center & Floating Modern Card bottom-center
        inputs = ["ffmpeg", "-re", "-i", video_path]
        next_input_idx = 1

        filter_stages = [
            "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[v0]"
        ]
        pad_idx = 0

        # 1. Banner Image (Top Center)
        if self.local_banner_img and os.path.exists(self.local_banner_img):
            inputs.extend(["-loop", "1", "-i", self.local_banner_img])
            b_pad = next_input_idx
            next_input_idx += 1
            # Shadow behind banner
            filter_stages.append(f"[v{pad_idx}]drawbox=x=106:y=24:w=508:h=136:color=0x000000@0.35:t=fill[v{pad_idx+1}]")
            pad_idx += 1
            filter_stages.append(f"[{b_pad}:v]scale=500:130:force_original_aspect_ratio=decrease[banner]")
            filter_stages.append(f"[v{pad_idx}][banner]overlay=x=(720-w)/2:y=24[v{pad_idx+1}]")
            pad_idx += 1

        # 2. Bottom Modern Floating White Card (Pill style)
        card_w, card_h = 630, 136
        card_x = (720 - card_w) // 2
        card_y = 1280 - card_h - 28
        thumb_size = 104
        thumb_x = card_x + 16
        thumb_y = card_y + 16
        text_x = thumb_x + thumb_size + 16
        btn_w, btn_h = 106, 52
        btn_x = card_x + card_w - btn_w - 18
        btn_y = card_y + (card_h - btn_h) // 2

        # Card shadow, pure white body, top highlight line, subtle border
        filter_stages.extend([
            f"[v{pad_idx}]drawbox=x={card_x+4}:y={card_y+6}:w={card_w}:h={card_h}:color=0x000000@0.32:t=fill[v{pad_idx+1}]",
            f"[v{pad_idx+1}]drawbox=x={card_x}:y={card_y}:w={card_w}:h={card_h}:color=0xFFFFFF@0.98:t=fill[v{pad_idx+2}]",
            f"[v{pad_idx+2}]drawbox=x={card_x}:y={card_y}:w={card_w}:h=2:color=0xFFFFFF@0.7:t=fill[v{pad_idx+3}]",
            f"[v{pad_idx+3}]drawbox=x={card_x}:y={card_y}:w={card_w}:h={card_h}:color=0xE2E8F0@1:t=1[v{pad_idx+4}]",
        ])
        pad_idx += 4

        # 3. Mini Badge "FLASH SALE" inside card
        filter_stages.extend([
            f"[v{pad_idx}]drawbox=x={text_x}:y={card_y+14}:w=116:h=22:color=0xFFE4E6@1:t=fill[v{pad_idx+1}]",
            f"[v{pad_idx+1}]drawbox=x={text_x+6}:y={card_y+21}:w=7:h=7:color=0xF43F5E@1:t=fill[v{pad_idx+2}]",
        ])
        pad_idx += 2

        # 4. Product Thumbnail
        if self.local_product_img and os.path.exists(self.local_product_img):
            inputs.extend(["-loop", "1", "-i", self.local_product_img])
            p_pad = next_input_idx
            next_input_idx += 1
            filter_stages.append(f"[v{pad_idx}]drawbox=x={thumb_x-1}:y={thumb_y-1}:w={thumb_size+2}:h={thumb_size+2}:color=0xE2E8F0@1:t=fill[v{pad_idx+1}]")
            pad_idx += 1
            filter_stages.append(f"[{p_pad}:v]scale={thumb_size}:{thumb_size}[thumb]")
            filter_stages.append(f"[v{pad_idx}][thumb]overlay=x={thumb_x}:y={thumb_y}[v{pad_idx+1}]")
            pad_idx += 1

        # 5. Text: Badge Text, Product Name, and Price
        safe_name = self.product_name.replace(":", "\\:").replace("'", "\\'")[:24] if self.product_name else ""
        safe_price = self.product_price.replace(":", "\\:").replace("'", "\\'") if self.product_price else ""
        if safe_price and not safe_price.startswith("Rp") and safe_price.isdigit():
            safe_price = f"Rp{int(safe_price):,}".replace(",", ".")

        font_opt = ""
        for possible_font in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "C\\\\:/Windows/Fonts/arialbd.ttf"
        ]:
            if os.path.exists(possible_font.replace("\\\\:", ":")):
                font_opt = f":fontfile={possible_font}"
                break


        # Name
        if safe_name:
            filter_stages.append(f"[v{pad_idx}]drawtext=text='{safe_name}'{font_opt}:fontsize=20:fontcolor=0x0F172A:x={text_x}:y={card_y+46}[v{pad_idx+1}]")
            pad_idx += 1

        # Price
        if safe_price:
            filter_stages.append(f"[v{pad_idx}]drawtext=text='{safe_price}'{font_opt}:fontsize=26:fontcolor=0xE11D48:x={text_x}:y={card_y+78}[v{pad_idx+1}]")
            pad_idx += 1


        filter_chain = ";".join(filter_stages)
        return inputs + [
            "-filter_complex", filter_chain,
            "-map", f"[v{pad_idx}]",
            "-map", "0:a?",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-max_muxing_queue_size", "2048",
            "-f", "mpegts",
            "pipe:1"
        ]

    def _stream_file_async(self, video_path):
        """Memutar file video secara non-blocking agar bisa diinterupsi oleh respon AI."""
        if not video_path or not os.path.exists(video_path):
            print(f"[ERROR] File video tidak ditemukan: {video_path}")
            return None
        
        self._ensure_master_process()
        if self.master_process is None or self.master_process.stdin is None:
            print("[BROADCASTER ERROR] Master FFmpeg pipe tidak tersedia.")
            return None
        
        worker_command = self._build_worker_command(video_path)
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
                        current_worker.terminate()
                        try:
                            current_worker.wait(timeout=1)
                        except subprocess.TimeoutExpired:
                            current_worker.kill()
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

                # Putar video jika tidak ada yang sedang diputar
                if current_worker is None:
                    if video_to_play:
                        print(f"[>] MEMUTAR RESPON AI: {os.path.basename(video_to_play)}")
                        current_worker = self._stream_file_async(video_to_play)
                        if current_worker:
                            last_spoken_video = video_to_play
                            self.last_new_video_time = time.time()
                            is_playing_idle = False
                        else:
                            time.sleep(0.5)
                    else:
                        if os.path.exists(self.idle_video):
                            current_worker = self._stream_file_async(self.idle_video)
                            if current_worker:
                                is_playing_idle = True
                                consecutive_idle_errors = 0
                            else:
                                consecutive_idle_errors += 1
                                if consecutive_idle_errors > 3:
                                    self._ensure_master_process()
                                    consecutive_idle_errors = 0
                                time.sleep(1)
                        else:
                            time.sleep(2)

                # UPDATE STATUS RTMP
                if self.master_process and self.master_process.poll() is None:
                    if time.time() - self.master_process_start_time > 3:
                        try:
                            with open(os.path.join(self.output_folder, "rtmp_status.txt"), "w") as f:
                                f.write("connected")
                        except Exception:
                            pass

                time.sleep(0.1) # Cegah 100% CPU usage di loop

            except Exception as loop_err:
                print(f"[BROADCASTER UNHANDLED EXCEPTION] {loop_err}")
                time.sleep(1)

# --- KONFIGURASI DAN EKSEKUSI ---
if __name__ == "__main__":
    
    RTMP_BASE_URL = os.environ.get("RTMP_URL", "").rstrip("/")
    STREAM_KEY = os.environ.get("STREAM_KEY", "")
    if not RTMP_BASE_URL or not STREAM_KEY:
        raise RuntimeError("RTMP_URL dan STREAM_KEY wajib diisi melalui environment")
    if RTMP_BASE_URL.endswith(f"/{STREAM_KEY}"):
        RTMP_URL = RTMP_BASE_URL
    else:
        RTMP_URL = f"{RTMP_BASE_URL}/{STREAM_KEY}"
    
    # 2. Tentukan video Idle (Sesuai dengan host yang dipilih pelanggan)
    IDLE_VIDEO = os.environ.get(
        "IDLE_VIDEO",
        "/workspace/ai_live_worker/assets/3d/namira_idle.mp4",
    )
    
    OUTPUT_FOLDER = os.environ.get("OUTPUT_FOLDER", "/workspace/ai_live_worker/output")
    PRODUCT_NAME = os.environ.get("PRODUCT_NAME", "")
    PRODUCT_PRICE = os.environ.get("PRODUCT_PRICE", "")
    PRODUCT_IMAGE_URL = os.environ.get("PRODUCT_IMAGE_URL", "")
    BANNER_IMAGE_URL = os.environ.get("BANNER_IMAGE_URL", "")
    
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

