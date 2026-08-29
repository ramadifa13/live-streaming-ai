import subprocess
import os
import glob
import time

class AIBroadcaster:
    def __init__(self, rtmp_url, idle_video_path, output_folder):
        self.rtmp_url = rtmp_url
        self.idle_video = idle_video_path
        self.output_folder = output_folder
        self.silence_threshold = 90
        self.last_new_video_time = time.time()
        self.master_process = None
        
        print("[BROADCASTER] Menginisialisasi Koneksi ke Server RTMP...")
        self.master_process_start_time = 0
        self._ensure_master_process()
        
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
            # MASTER COMMAND OPTIMIZATION: 
            # - Gunakan -use_wallclock_as_timestamps 1 agar timestamp selalu maju (tidak patah-patah saat ganti video)
            # - Gunakan -c copy penuh (audio & video) agar sangat ringan di CPU (tidak ngelag)
            master_command = [
                "ffmpeg",
                "-y",
                "-f", "mpegts",
                "-use_wallclock_as_timestamps", "1",
                "-i", "pipe:0",
                "-c:v", "copy",
                "-c:a", "copy",
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

    def _stream_file_async(self, video_path):
        """Memutar file video secara non-blocking agar bisa diinterupsi oleh respon AI."""
        if not video_path or not os.path.exists(video_path):
            print(f"[ERROR] File video tidak ditemukan: {video_path}")
            return None
        
        self._ensure_master_process()
        if self.master_process is None or self.master_process.stdin is None:
            print("[BROADCASTER ERROR] Master FFmpeg pipe tidak tersedia.")
            return None
        
        worker_command = [
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
    
    try:
        broadcaster = AIBroadcaster(RTMP_URL, IDLE_VIDEO, OUTPUT_FOLDER)
        broadcaster.start_loop()
    except KeyboardInterrupt:
        print("\n[BROADCASTER] Siaran dimatikan.")

