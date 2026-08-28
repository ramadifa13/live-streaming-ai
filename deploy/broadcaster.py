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
        
        print("[BROADCASTER] Menginisialisasi Koneksi ke Server RTMP...")
        
        master_command = [
            "ffmpeg",
            "-y",
            "-f", "mpegts",
            "-i", "pipe:0",
            "-c:v", "libx264",          
            "-preset", "ultrafast",     
            "-b:v", "2500k",            
            "-c:a", "aac",              
            "-ar", "44100",             
            "-f", "flv",                
            self.rtmp_url
        ]
        
        self.master_process = subprocess.Popen(master_command, stdin=subprocess.PIPE)
        print("[SUKSES] Terhubung ke Platform Live Streaming!")
        
        if not os.path.exists(self.idle_video):
            print(f"[WARNING] Video idle tidak ditemukan: {self.idle_video}")

    def _stream_file(self, video_path):
        if not video_path or not os.path.exists(video_path):
            print(f"[ERROR] File video tidak ditemukan: {video_path}")
            return False
        worker_command = [
            "ffmpeg",
            "-re",
            "-i", video_path,
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
            "-f", "mpegts",
            "pipe:1"
        ]
        try:
            worker_process = subprocess.Popen(worker_command, stdout=self.master_process.stdin, stderr=subprocess.DEVNULL)
            worker_process.wait() 
            return True
        except Exception as e:
            print(f"[ERROR] Gagal memutar {video_path}: {e}")
            return False

    def start_loop(self):
        print(f"\n[BROADCASTER] Menyiarkan secara Live (Tekan Ctrl+C untuk berhenti)...\n")
        last_spoken_video = None
        
        while True:
            playback_flag = os.path.join(self.output_folder, "playback_active.flag")
            playback_active = os.path.exists(playback_flag)

            search_pattern = os.path.join(self.output_folder, "**", "*.mp4")
            new_videos = sorted(
                [path for path in glob.glob(search_pattern, recursive=True)
                 if path != last_spoken_video],
                key=os.path.getctime,
            )

            if playback_active and new_videos:
                # === LIVE MODE: ada video AI → putar langsung ===
                video_to_play = new_videos[0]
                print(f"[>] MEMUTAR RESPON AI: {os.path.basename(video_to_play)}")
                success = self._stream_file(video_to_play)
                if success:
                    # Hapus video yang sudah selesai disiarkan agar disk tidak penuh
                    try:
                        if os.path.exists(video_to_play):
                            os.remove(video_to_play)
                            print(f"[CLEANUP] Video dihapus setelah tayang: {os.path.basename(video_to_play)}")
                    except Exception as e:
                        print(f"[CLEANUP ERROR] Gagal menghapus {video_to_play}: {e}")
                    last_spoken_video = None
                    self.last_new_video_time = time.time()
                # Langsung kembali ke atas loop — cek apakah video berikutnya sudah ada
                # TIDAK ada sleep di sini agar transisi antar video semulus mungkin

            elif playback_active and not new_videos:
                # === LIVE MODE: belum ada video baru — busy-wait, JANGAN putar idle ===
                # Bug 2 & 5 fix: idle TIDAK boleh diputar saat live, ini menyebabkan jeda.
                print(f"[WAIT] playback_active=True tapi belum ada video AI — menunggu render GPU...")
                time.sleep(0.2)

            else:
                # === PRE-LIVE / IDLE MODE: putar idle video terus-menerus ===
                self._stream_file(self.idle_video)
                time.sleep(0.5)

# --- KONFIGURASI DAN EKSEKUSI ---
if __name__ == "__main__":
    
    RTMP_BASE_URL = os.environ.get("RTMP_URL", "").rstrip("/")
    STREAM_KEY = os.environ.get("STREAM_KEY", "")
    if not RTMP_BASE_URL or not STREAM_KEY:
        raise RuntimeError("RTMP_URL dan STREAM_KEY wajib diisi melalui environment")
    RTMP_URL = f"{RTMP_BASE_URL}/{STREAM_KEY}"
    
    # 2. Tentukan video Idle (Sesuai dengan host yang dipilih pelanggan)
    IDLE_VIDEO = os.environ.get(
        "IDLE_VIDEO",
        "/workspace/ai_live_worker/assets/3d/namira.mp4",
    )
    
    OUTPUT_FOLDER = os.environ.get("OUTPUT_FOLDER", "/workspace/ai_live_worker/output")
    
    try:
        broadcaster = AIBroadcaster(RTMP_URL, IDLE_VIDEO, OUTPUT_FOLDER)
        broadcaster.start_loop()
    except KeyboardInterrupt:
        print("\n[BROADCASTER] Siaran dimatikan.")
