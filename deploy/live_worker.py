import subprocess
import os
import time
import asyncio
import torch
import threading
import sys
import contextlib
from argparse import Namespace

@contextlib.contextmanager
def gpu_lock(lock_path="/tmp/gpu_inference.lock"):
    """File-based inter-process lock to prevent concurrent GPU execution between MuseTalk and Chatterbox."""
    lock_file = None
    try:
        try:
            import fcntl
            lock_file = open(lock_path, "w")
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        except (ImportError, AttributeError, OSError):
            pass
        yield
    finally:
        if lock_file:
            try:
                import fcntl
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
            except Exception:
                pass

class AILiveWorker:
    def __init__(self):
        # Konfigurasi Direktori Server RunPod (Dynamic with Fallback)
        default_base = "/workspace/ai_live_worker" if os.path.exists("/workspace/ai_live_worker") else os.path.dirname(os.path.abspath(__file__))
        self.base_dir = os.environ.get("WORKER_ROOT", default_base)
        self.assets_2d = os.path.join(self.base_dir, "assets", "2d")
        self.assets_3d = os.path.join(self.base_dir, "assets", "3d")
        self.temp_dir = os.path.join(self.base_dir, "temp")
        self.output_dir = os.path.join(self.base_dir, "output")
        
        # Konfigurasi MuseTalk
        self.musetalk_dir = os.path.join(self.base_dir, "MuseTalk")
        paths = self._musetalk_paths()
        self.musetalk_checkpoint = paths["unet_config"]
        
        # Batch size untuk inferensi UNet. RTX 4090 bisa handle 16, GPU kecil gunakan 8.
        self.batch_size = int(os.environ.get("MUSETALK_BATCH_SIZE", "8"))
        
        # VRAM Isolation: Batasi MuseTalk 70% VRAM agar Chatterbox & system punya headroom
        if torch.cuda.is_available():
            try:
                vram_fraction = float(os.environ.get("MUSETALK_VRAM_FRACTION", "0.70"))
                torch.cuda.set_per_process_memory_fraction(vram_fraction, device=0)
                print(f"[INFO] MuseTalk CUDA VRAM fraction set to {vram_fraction*100:.0f}%")
            except Exception as vram_err:
                print(f"[WARNING] Could not set MuseTalk per-process VRAM fraction: {vram_err}")

        # Lock untuk serialisasi inferensi GPU intra-process
        self._inference_lock = threading.Lock()
        
        if not os.path.exists(self.musetalk_checkpoint):
            print(f"[WARNING] Model MuseTalk belum terunduh di {self.musetalk_checkpoint}. Pastikan setup-safe.sh sudah dijalankan.")
        
        self._ensure_musetalk_layout()
        self._clean_temp_dir()
        
        # Warmup berat (load ~3GB model) — default lazy agar API cepat online
        self._warmed_up = False
        if os.environ.get("MUSETALK_WARMUP_ON_START", "0") == "1":
            try:
                self._warmup_musetalk()
                self._warmed_up = True
            except Exception as e:
                print(f"[WARMUP] Gagal pre-load MuseTalk: {e}")
            
        print("[INFO] Worker siap dengan sistem TTS Chatterbox-TTS-Indonesian (voice cloning) dan Lipsync MuseTalk...")
        print("[INFO] Worker siap dengan Lipsync MuseTalk (Audio diproses terpusat di Backend via Piper-TTS)...")

    def _clean_temp_dir(self):
        """Clean leftover temporary files from previous runs to save disk."""
        if os.path.exists(self.temp_dir):
            for item in os.listdir(self.temp_dir):
                item_path = os.path.join(self.temp_dir, item)
                try:
                    if os.path.isfile(item_path):
                        os.remove(item_path)
                except Exception:
                    pass

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
                continue
            if os.path.islink(link_path):
                if os.path.realpath(link_path) == os.path.realpath(target_path):
                    continue
                os.unlink(link_path)
            elif os.path.exists(link_path):
                continue
            try:
                os.symlink(target_path, link_path)
                print(f"[INFO] Symlink: {link_path} -> {target_path}")
            except Exception as link_err:
                print(f"[WARNING] Could not create symlink {link_path}: {link_err}")

    def _musetalk_paths(self):
        models_root = os.path.join(self.musetalk_dir, "models")
        return {
            "unet_config": os.path.join(models_root, "musetalkV15", "musetalk.json"),
            "unet_model_path": os.path.join(models_root, "musetalkV15", "unet.pth"),
            "whisper_dir": os.path.join(models_root, "whisper"),
        }
    
    def _warmup_musetalk(self):
        print(f"[WARMUP] Loading MuseTalk models (batch_size={self.batch_size})")
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
            self._models_cache = _load_models_cached(dummy_args)
            print("[WARMUP] MuseTalk models pre-loaded successfully")

            # Pre-cache Idle Video
            self._precache_idle_videos()
        finally:
            os.chdir(original_cwd)

    def _precache_idle_videos(self):
        print("[WARMUP] Pre-caching idle videos to prevent repeating face detection...")
        for host_type in ["2d", "3d"]:
            target_dir = getattr(self, f"assets_{host_type}")
            if not os.path.exists(target_dir):
                continue
            for f in os.listdir(target_dir):
                if f.endswith(".mp4"):
                    video_path = os.path.join(target_dir, f)
                    self._cache_video(video_path)

    def _cache_video(self, video_path):
        print(f"[PRE-CACHE] Processing video: {video_path}")
        try:
            from scripts.inference import get_cropped_video
            import yaml

            yaml_path = os.path.join(self.temp_dir, "cache_dummy.yaml")
            os.makedirs(self.temp_dir, exist_ok=True)
            config_data = {
                "task_0": {
                    "video_path": video_path,
                    "audio_path": "",
                    "bbox_shift": 0
                }
            }
            with open(yaml_path, "w") as f:
                yaml.dump(config_data, f)

            get_cropped_video(video_path, bbox_shift=0)

            if os.path.exists(yaml_path):
                os.remove(yaml_path)

            print(f"[PRE-CACHE] Successfully cached video {video_path}")
        except Exception as e:
            print(f"[WARNING] Failed to pre-cache video {video_path}: {e}")

    async def _generate_voice(self, text, task_id, host_name, tone="Casual"):
        """Ubah Teks menjadi Suara menggunakan Chatterbox-TTS-Indonesian (voice cloning, GPU)"""
        audio_path = os.path.join(self.temp_dir, f"{task_id}.wav")
        chatterbox_url = os.environ.get("CHATTERBOX_SERVICE_URL", "http://127.0.0.1:8090")
        print(f"[INFO] Men-generate suara menggunakan Chatterbox-TTS-Indonesian ({chatterbox_url})...")

        try:
            import json
            import urllib.request

            payload = json.dumps({
                "text": text,
                "avatar": host_name,
                "tone": tone,
            }).encode("utf-8")

            request = urllib.request.Request(
                f"{chatterbox_url}/synthesize",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                gen_time_ms = response.headers.get("X-Gen-Time-Ms", "?")
                with open(audio_path, "wb") as f:
                    f.write(response.read())
                print(f"[INFO] Chatterbox selesai dalam {gen_time_ms}ms")

        except Exception as e:
            print(f"[ERROR] Gagal memanggil Chatterbox-TTS-Indonesian: {e}")
            raise e

        return audio_path

    def _get_idle_video(self, host_type, host_name):
        """Cari file bahan baku video di folder 2D/3D dengan multi-directory fallback"""
        target_dir = self.assets_2d if str(host_type).lower() == "2d" else self.assets_3d
        candidate_dirs = [
            target_dir,
            self.assets_3d,
            self.assets_2d,
            os.path.join(self.base_dir, "assets"),
            os.path.join(self.base_dir, "assets", "avatars"),
        ]

        # 1. Cek nama persis di semua direktori kandidat
        for d in candidate_dirs:
            if os.path.exists(d):
                p = os.path.join(d, f"{host_name}.mp4")
                if os.path.exists(p):
                    return p
                # Cek case-insensitive
                for f in os.listdir(d):
                    if f.lower() == f"{host_name.lower()}.mp4":
                        return os.path.join(d, f)

        # 2. Cek variasi nama / substring
        for d in candidate_dirs:
            if os.path.exists(d):
                for f in os.listdir(d):
                    if f.endswith(".mp4") and (host_name.lower() in f.lower() or f.lower().replace(".mp4", "") in host_name.lower()):
                        return os.path.join(d, f)

        # 3. Cek file IDLE_VIDEO dari environment variable jika ada
        env_idle = os.environ.get("IDLE_VIDEO")
        if env_idle and os.path.exists(env_idle):
            return env_idle

        # 4. Fallback: ambil sembarang file mp4 pertama di direktori assets
        for d in candidate_dirs:
            if os.path.exists(d):
                mp4s = [f for f in os.listdir(d) if f.endswith(".mp4") and not f.startswith("temp_")]
                if mp4s:
                    return os.path.join(d, mp4s[0])

        return None

    async def _sync_lips_async(self, idle_video, audio_path, task_id):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._sync_lips, idle_video, audio_path, task_id)

    def _sync_lips(self, idle_video, audio_path, task_id):
        with self._inference_lock:
            with gpu_lock():
                yaml_path = os.path.join(self.temp_dir, f"{task_id}.yaml")
                try:
                    import yaml
            yaml_path = os.path.join(self.temp_dir, f"{task_id}.yaml")
            try:
                import yaml

                    # Pre-normalize audio to 16kHz PCM WAV for robust Whisper feature extraction
                    norm_audio_path = os.path.join(self.temp_dir, f"{task_id}_16k.wav")
                    norm_cmd = [
                        "ffmpeg", "-y", "-i", audio_path,
                        "-ac", "1", "-ar", "16000",
                        "-c:a", "pcm_s16le",
                        norm_audio_path
                    ]
                    target_audio = audio_path
                    try:
                        subprocess.run(norm_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                        if os.path.exists(norm_audio_path):
                            target_audio = norm_audio_path
                    except Exception as norm_err:
                        print(f"[MuseTalk WARNING] Audio 16kHz normalization notice: {norm_err}")

                    config_data = {
                        "task_0": {
                            "video_path": idle_video,
                            "audio_path": target_audio,
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

                    if not os.path.exists(unet_config):
                        raise FileNotFoundError(f"MuseTalk V1.5 config tidak ditemukan: {unet_config}")

                    if not os.path.exists(unet_model_path):
                        raise FileNotFoundError(f"MuseTalk V1.5 checkpoint tidak ditemukan: {unet_model_path}")

                    if not os.path.exists(whisper_dir):
                        raise FileNotFoundError(f"Whisper model tidak ditemukan: {whisper_dir}")

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
                    finally:
                        os.chdir(original_cwd)

                    expected_output = os.path.join(self.output_dir, "v15", f"{task_id}.mp4")
                    if os.path.exists(expected_output):
                        return expected_output

                    list_of_files = []
                    for root, dirs, files in os.walk(self.output_dir):
                        for file in files:
                            if file.endswith(".mp4") and task_id in file:
                                list_of_files.append(os.path.join(root, file))

                    if not list_of_files:
                        raise FileNotFoundError(f"Output video MuseTalk untuk {task_id} tidak ditemukan.")

                    latest_file = max(list_of_files, key=os.path.getctime)
                    if latest_file != expected_output:
                        os.replace(latest_file, expected_output)

                    return expected_output

                except torch.cuda.OutOfMemoryError as oom:
                    print(f"[MuseTalk OOM ERROR] Out of GPU memory: {oom}")
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    return None
                except Exception as e:
                    print(f"[MuseTalk ERROR] {type(e).__name__}: {e}")
                    return None
                finally:
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    if os.path.exists(yaml_path):
                        try:
                            os.remove(yaml_path)
                        except Exception:
                            pass
                    if 'norm_audio_path' in locals() and os.path.exists(norm_audio_path):
                        try:
                            os.remove(norm_audio_path)
                        except Exception:
                            pass

    async def run_pipeline(self, host_type, host_name, text_answer, task_id, audio_path=None, tone="Casual"):
        """Fungsi Pemicu Utama"""
        pipeline_start = time.time()

        # 1. Parse Action Tags (e.g. [RAISE_HAND])
        import re
        action_tag = "idle"
        match = re.search(r'\[([A-Z_]+)\]', text_answer)
        if match:
            action_tag = match.group(1).lower()
            text_answer = re.sub(r'\[[A-Z_]+\]', '', text_answer).strip()

        print(f"\n[MEMPROSES] {task_id} | Host: {host_name} ({host_type.upper()}) | Action: {action_tag}")

        # 2. Modify host_name dynamically to match action video
        dynamic_host_name = host_name
        if action_tag != "idle":
            dynamic_host_name = f"{host_name}_{action_tag}"

        idle_video = self._get_idle_video(host_type, dynamic_host_name)
        if not idle_video and dynamic_host_name != host_name:
            print(f"[INFO] Video untuk aksi '{action_tag}' tidak ditemukan, fallback ke default {host_name}.mp4")
            idle_video = self._get_idle_video(host_type, host_name)

        if not idle_video:
            print(f"[ERROR] Video '{host_name}.mp4' tidak ada di folder assets/{host_type}")
            return None

        tts_start = time.time()
        if audio_path and os.path.exists(audio_path):
            audio_file = audio_path
            print(" -> Menggunakan audio dari backend (pre-synthesized)...")
            print(" -> Menggunakan audio dari backend (Piper-TTS pre-synthesized)...")
        else:
            # Backend audio tidak tersedia (Edge TTS mungkin timeout sebelum fallback ke Chatterbox)
            # Coba Chatterbox-TTS-Indonesian lokal di port 8090 sebagai safety net
            print(" -> Audio dari backend tidak tersedia, mencoba Chatterbox-TTS lokal (safety net)...")
            try:
                audio_file = await self._generate_voice(text_answer, task_id, host_name, tone=tone)
                print(f" -> Chatterbox TTS berhasil sebagai safety net: {audio_file}")
            except Exception as chatterbox_err:
                print(f"[ERROR] Chatterbox TTS juga gagal: {chatterbox_err}")
                if os.environ.get("WORKER_REQUIRE_AUDIO", "0") == "1":
                    print("[ERROR] WORKER_REQUIRE_AUDIO=1 dan semua TTS gagal — skip video ini.")
                    return None
                # Jika tidak strict, lanjut tanpa audio (akan error di lipsync)
                return None
        tts_elapsed = round((time.time() - tts_start) * 1000)
            print(f"[ERROR] Audio dari backend tidak tersedia untuk {task_id}. Backend TTS via Piper wajib aktif.")
            return None

        lipsync_start = time.time()
        print(" -> Generating Video Lipsync (MuseTalk)...")
        final_video = await self._sync_lips_async(idle_video, audio_file, task_id)
        lipsync_elapsed = round((time.time() - lipsync_start) * 1000)

        if audio_file and os.path.exists(audio_file) and audio_file.startswith(self.temp_dir):
            try:
                os.remove(audio_file)
            except Exception:
                pass

        total_elapsed = round((time.time() - pipeline_start) * 1000)
        if final_video:
            print(
                f"[SUKSES] Video selesai: {final_video} | "
                f"tts={tts_elapsed}ms lipsync={lipsync_elapsed}ms total={total_elapsed}ms"
            )
        return final_video
