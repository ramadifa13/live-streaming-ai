import subprocess
import os
import time
import asyncio
import torch
import threading
import sys
from argparse import Namespace

class AILiveWorker:
    def __init__(self):
        # Konfigurasi Direktori Server RunPod
        self.base_dir = "/workspace/ai_live_worker"
        self.assets_2d = os.path.join(self.base_dir, "assets", "2d")
        self.assets_3d = os.path.join(self.base_dir, "assets", "3d")
        self.temp_dir = os.path.join(self.base_dir, "temp")
        self.output_dir = os.path.join(self.base_dir, "output")
        
        # Konfigurasi MuseTalk
        self.musetalk_dir = os.path.join(self.base_dir, "MuseTalk")
        paths = self._musetalk_paths()
        self.musetalk_checkpoint = paths["unet_config"]
        
        # Batch size untuk inferensi UNet. RTX 4090 bisa handled 16, GPU kecil gunakan 8.
        self.batch_size = int(os.environ.get("MUSETALK_BATCH_SIZE", "8"))
        
        # Lock untuk serialisasi inferensi GPU (mencegah OOM dan memastikan stabilitas)
        self._inference_lock = threading.Lock()
        
        if not os.path.exists(self.musetalk_checkpoint):
            print(f"[WARNING] Model MuseTalk belum terunduh di {self.musetalk_checkpoint}. Pastikan setup-safe.sh sudah dijalankan.")
        
        self._ensure_musetalk_layout()
        
        # Warmup berat (load ~3GB model) — default lazy agar API cepat online
        self._warmed_up = False
        if os.environ.get("MUSETALK_WARMUP_ON_START", "0") == "1":
            try:
                self._warmup_musetalk()
                self._warmed_up = True
            except Exception as e:
                print(f"[WARMUP] Gagal pre-load MuseTalk: {e}")
            
        print("[INFO] Worker siap dengan sistem TTS Edge-TTS dan Lipsync MuseTalk...")
    
    def _ensure_warmup(self):
        if self._warmed_up:
            return
        self._warmup_musetalk()
        self._warmed_up = True
    
    def _ensure_musetalk_layout(self):
        """MuseTalk pakai path relatif ./musetalk dan ./models — buat symlink dari worker root."""
        links = {
            os.path.join(self.base_dir, "musetalk"): os.path.join(self.musetalk_dir, "musetalk"),
            os.path.join(self.base_dir, "models"): os.path.join(self.musetalk_dir, "models"),
        }
        for link_path, target_path in links.items():
            if not os.path.isdir(target_path):
                print(f"[WARNING] Target MuseTalk belum ada: {target_path}")
                continue
            if os.path.islink(link_path):
                if os.path.realpath(link_path) == os.path.realpath(target_path):
                    continue
                os.unlink(link_path)
            elif os.path.exists(link_path):
                print(f"[WARNING] Lewati symlink {link_path} — path sudah ada (bukan symlink)")
                continue
            os.symlink(target_path, link_path)
            print(f"[INFO] Symlink: {link_path} -> {target_path}")

    def _musetalk_paths(self):
        models_root = os.path.join(self.musetalk_dir, "models")
        return {
            "unet_config": os.path.join(models_root, "musetalkV15", "musetalk.json"),
            "unet_model_path": os.path.join(models_root, "musetalkV15", "unet.pth"),
            "whisper_dir": os.path.join(models_root, "whisper"),
        }
    
    def _warmup_musetalk(self):
        musetalk_dir = self.musetalk_dir
        if musetalk_dir not in sys.path:
            sys.path.insert(0, musetalk_dir)

        original_cwd = os.getcwd()
        os.chdir(musetalk_dir)
        try:
            from scripts.inference import _load_models_cached

            paths = self._musetalk_paths()
            dummy_args = Namespace(
                gpu_id=0,
                use_float16=True,
                version="v15",
                left_cheek_width=90,
                right_cheek_width=90,
                unet_model_path=paths["unet_model_path"],
                unet_config=paths["unet_config"],
                whisper_dir=paths["whisper_dir"],
                vae_type="sd-vae-ft-mse",
                batch_size=self.batch_size,
            )
            _load_models_cached(dummy_args)
            print("[WARMUP] MuseTalk models pre-loaded successfully")
        finally:
            os.chdir(original_cwd)

    async def _generate_voice(self, text, task_id, host_name):
        """Ubah Teks menjadi Suara Indonesia Natural menggunakan Edge-TTS (Lebih Cepat, Hemat VRAM)"""
        audio_path = os.path.join(self.temp_dir, f"{task_id}.mp3")
        
        # Penentuan gender suara sederhana dari nama host
        is_male = any(word in host_name.lower() for word in ["pria", "cowo", "budi", "ardi", "laki"])
        voice = "id-ID-ArdiNeural" if is_male else "id-ID-GadisNeural"
        
        print(f"[INFO] Men-generate suara menggunakan Edge-TTS ({voice})...")
        
        # Jalankan edge-tts via command line
        cmd = ["edge-tts", "--voice", voice, "--text", text, "--write-media", audio_path]
        try:
            # Gunakan asyncio untuk subprocess agar tidak memblokir FastAPI
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await process.communicate()
            
            if process.returncode != 0:
                raise Exception(f"Edge-TTS gagal dengan kode {process.returncode}")
                
        except Exception as e:
            print(f"[ERROR] Gagal memanggil edge-tts: {e}")
            raise e
            
        return audio_path

    def _get_idle_video(self, host_type, host_name):
        """Cari file bahan baku video di folder 2D/3D"""
        target_dir = self.assets_2d if str(host_type).lower() == "2d" else self.assets_3d
        
        # 1. Cek nama persis
        video_path = os.path.join(target_dir, f"{host_name}.mp4")
        if os.path.exists(video_path):
            return video_path
            
        # 2. Cek variasi nama (misal nana / host_2d_statis_nana)
        if os.path.exists(target_dir):
            for f in os.listdir(target_dir):
                if f.endswith(".mp4") and (host_name.lower() in f.lower() or f.lower().replace(".mp4", "") in host_name.lower()):
                    return os.path.join(target_dir, f)
            # 3. Ambil file mp4 pertama di folder yang sesuai tipe (2D / 3D)
            mp4s = [f for f in os.listdir(target_dir) if f.endswith(".mp4")]
            if mp4s:
                return os.path.join(target_dir, mp4s[0])
                
        return None

    async def _sync_lips_async(self, idle_video, audio_path, task_id):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._sync_lips, idle_video, audio_path, task_id)

    def _sync_lips(self, idle_video, audio_path, task_id):
        with self._inference_lock:
            self._ensure_warmup()
            import yaml

            yaml_path = os.path.join(
                self.temp_dir,
                f"{task_id}.yaml"
            )

            config_data = {
                "task_0": {
                    "video_path": idle_video,
                    "audio_path": audio_path,
                    "bbox_shift": 0
                }
            }

            os.makedirs(self.temp_dir, exist_ok=True)
            os.makedirs(self.output_dir, exist_ok=True)

            with open(yaml_path, "w") as f:
                yaml.dump(config_data, f)

            musetalk_dir = self.musetalk_dir
            paths = self._musetalk_paths()
            unet_config = paths["unet_config"]
            unet_model_path = paths["unet_model_path"]
            whisper_dir = paths["whisper_dir"]

            print("\n==============================================")
            print("[MuseTalk] VERSION : 1.5")
            print(f"[MuseTalk] Video   : {idle_video}")
            print(f"[MuseTalk] Audio   : {audio_path}")
            print(f"[MuseTalk] Config  : {unet_config}")
            print(f"[MuseTalk] UNet    : {unet_model_path}")
            print(f"[MuseTalk] Whisper : {whisper_dir}")
            print("==============================================\n")

            if not os.path.exists(unet_config):
                print(f"[ERROR] MuseTalk V1.5 config tidak ditemukan:\n{unet_config}")
                raise FileNotFoundError(unet_config)

            if not os.path.exists(unet_model_path):
                print(f"[ERROR] MuseTalk V1.5 checkpoint tidak ditemukan:\n{unet_model_path}")
                raise FileNotFoundError(unet_model_path)

            if not os.path.exists(whisper_dir):
                print(f"[ERROR] Whisper model tidak ditemukan:\n{whisper_dir}")
                raise FileNotFoundError(whisper_dir)

            if musetalk_dir not in sys.path:
                sys.path.insert(0, musetalk_dir)

            original_cwd = os.getcwd()
            os.chdir(musetalk_dir)
            try:
                from scripts.inference import main as musetalk_main

                args = Namespace(
                    ffmpeg_path="",
                    gpu_id=0,
                    vae_type="sd-vae-ft-mse",
                    unet_config=unet_config,
                    unet_model_path=unet_model_path,
                    whisper_dir=whisper_dir,
                    inference_config=yaml_path,
                    bbox_shift=0,
                    result_dir=self.output_dir,
                    extra_margin=10,
                    fps=25,
                    audio_padding_length_left=2,
                    audio_padding_length_right=2,
                    batch_size=self.batch_size,
                    output_vid_name=f"{task_id}.mp4",
                    use_saved_coord=True,
                    saved_coord=True,
                    use_float16=True,
                    parsing_mode="jaw",
                    left_cheek_width=90,
                    right_cheek_width=90,
                    version="v15",
                )

                print(f"[MuseTalk] Starting V1.5 inference: {task_id}")
                musetalk_main(args)
            except Exception as e:
                print(f"[MuseTalk ERROR] {type(e).__name__}: {e}")
                return None
            finally:
                os.chdir(original_cwd)
                if os.path.exists(yaml_path):
                    try:
                        os.remove(yaml_path)
                    except Exception:
                        pass

            expected_output = os.path.join(
                self.output_dir,
                "v15",
                f"{task_id}.mp4"
            )

            if os.path.exists(expected_output):
                print(f"[MuseTalk SUCCESS] Output ditemukan:\n{expected_output}")
                return expected_output

            list_of_files = []
            for root, dirs, files in os.walk(self.output_dir):
                for file in files:
                    if file.endswith(".mp4") and task_id in file:
                        list_of_files.append(os.path.join(root, file))

            if not list_of_files:
                raise FileNotFoundError(
                    f"Output video MuseTalk untuk {task_id} tidak ditemukan."
                )

            latest_file = max(list_of_files, key=os.path.getctime)

            if latest_file != expected_output:
                os.replace(latest_file, expected_output)

            print(f"[MuseTalk SUCCESS] Output:\n{expected_output}")
            return expected_output

    async def run_pipeline(self, host_type, host_name, text_answer, task_id, audio_path=None):
        """Fungsi Pemicu Utama"""
        print(f"\n[MEMPROSES] {task_id} | Host: {host_name} ({host_type.upper()})")
        
        idle_video = self._get_idle_video(host_type, host_name)
        if not idle_video:
            print(f"[ERROR] Video '{host_name}.mp4' tidak ada di folder assets/{host_type}")
            return None
            
        if audio_path and os.path.exists(audio_path):
            audio_file = audio_path
            print(" -> Menggunakan audio dari backend...")
        else:
            if os.environ.get("WORKER_REQUIRE_AUDIO", "0") == "1":
                print("[ERROR] Backend audio wajib tersedia, tetapi audio_path tidak valid.")
                return None
            print(" -> Generating Suara (XTTSv2)...")
            try:
                audio_file = await self._generate_voice(text_answer, task_id, host_name)
            except Exception as e:
                print(f"[ERROR] Gagal membuat suara: {e}")
                return None
        
        print(" -> Generating Video Lipsync (MuseTalk)...")
        final_video = await self._sync_lips_async(idle_video, audio_file, task_id)
        
        if audio_file and os.path.exists(audio_file) and audio_file.startswith(self.temp_dir):
            os.remove(audio_file) # Bersihkan file suara
            
        if final_video:
            print(f"[SUKSES] Video selesai: {final_video}")
        return final_video

# --- PENGUJIAN ---
if __name__ == "__main__":
    async def run_test():
        ai = AILiveWorker()
        
        # Contoh 1: Menjalankan Host 2D
        await ai.run_pipeline(
            host_type="2d",
            host_name="host_2d_statis", # Pastikan file host_2d_statis.mp4 sudah Anda upload
            text_answer="Halo kak, selamat datang! Baju ini bahannya adem dan ready warna merah ya.",
            task_id="komen_2d_01"
        )
        
        # Contoh 2: Menjalankan Host 3D
        await ai.run_pipeline(
            host_type="3d",
            host_name="host_3d_dinamis", # Pastikan file host_3d_dinamis.mp4 sudah Anda upload
            text_answer="Betul banget kak, silakan cek keranjang kuning di bawah ini.",
            task_id="komen_3d_01"
        )

    asyncio.run(run_test())
