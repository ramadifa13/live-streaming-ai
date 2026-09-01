import subprocess
import os
import time
import asyncio
import json
import torch
import threading
import sys
import shutil
from argparse import Namespace

try:
    from action_config import get_action_aliases, get_action_category, get_crossfade_seconds
except ImportError:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from action_config import get_action_aliases, get_action_category, get_crossfade_seconds


class AILiveWorker:
    def __init__(self):
        # Konfigurasi Direktori Server RunPod (Dynamic with Fallback)
        default_base = (
            "/workspace/ai_live_worker"
            if os.path.exists("/workspace/ai_live_worker")
            else os.path.dirname(os.path.abspath(__file__))
        )
        self.base_dir = os.environ.get("WORKER_ROOT", default_base)
        self.assets_2d = os.path.join(self.base_dir, "assets", "2d")
        self.assets_3d = os.path.join(self.base_dir, "assets", "3d")
        self.temp_dir = os.path.join(self.base_dir, "temp")
        self.output_dir = os.path.join(self.base_dir, "output")

        # Konfigurasi MuseTalk
        self.musetalk_dir = os.path.join(self.base_dir, "MuseTalk")
        paths = self._musetalk_paths()
        self.musetalk_checkpoint = paths["unet_config"]

        # Batch size untuk inferensi UNet (Default 16 untuk RTX 3090/4090/A100)
        self.batch_size = int(os.environ.get("MUSETALK_BATCH_SIZE", "16"))
        self.use_float16 = self._resolve_use_float16()

        # Lock untuk serialisasi inferensi GPU intra-process
        self._inference_lock = threading.Lock()

        if not os.path.exists(self.musetalk_checkpoint):
            print(
                f"[WARNING] Model MuseTalk belum terunduh di {self.musetalk_checkpoint}. Pastikan setup-safe.sh sudah dijalankan."
            )

        self._ensure_musetalk_layout()
        self._clean_temp_dir()

        # Warmup berat (load model ke VRAM & pre-cache avatar assets)
        self._warmed_up = False
        try:
            self._warmup_musetalk()
            self._warmed_up = True
        except Exception as e:
            print(f"[WARMUP WARNING] Pre-load MuseTalk notice: {e}")

        print(
            f"[INFO] 🚀 AI Worker siap melayani render video MuseTalk (Batch: {self.batch_size}, Audio: Piper-TTS Backend)..."
        )

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

    def _ensure_musetalk_layout(self):
        """MuseTalk pakai path relatif ./musetalk dan ./models — buat symlink dari worker root."""
        links = {
            os.path.join(self.base_dir, "musetalk"): os.path.join(
                self.musetalk_dir, "musetalk"
            ),
            os.path.join(self.base_dir, "models"): os.path.join(
                self.musetalk_dir, "models"
            ),
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
                print(
                    f"[WARNING] Could not create symlink {link_path}: {link_err}"
                )

    def _resolve_use_float16(self) -> bool:
        worker_dir = self.base_dir
        if worker_dir not in sys.path:
            sys.path.insert(0, worker_dir)
        try:
            from gpu_compat import log_gpu_status, resolve_use_float16

            log_gpu_status(0)
            return resolve_use_float16(True, 0)
        except Exception as exc:
            print(f"[GPU WARNING] {exc}", flush=True)
            return False

    def _musetalk_paths(self):
        models_root = os.path.join(self.musetalk_dir, "models")
        return {
            "unet_config": os.path.join(
                models_root, "musetalkV15", "musetalk.json"
            ),
            "unet_model_path": os.path.join(
                models_root, "musetalkV15", "unet.pth"
            ),
            "whisper_dir": os.path.join(models_root, "whisper"),
        }

    def _warmup_musetalk(self):
        print(f"[WARMUP] ⏳ Pre-loading MuseTalk models ke GPU VRAM (batch_size={self.batch_size})...")
        musetalk_dir = self.musetalk_dir
        if self.base_dir not in sys.path:
            sys.path.insert(0, self.base_dir)
        if musetalk_dir not in sys.path:
            sys.path.insert(0, musetalk_dir)

        original_cwd = os.getcwd()
        os.chdir(musetalk_dir)
        try:
            from scripts.inference import _load_models_cached, _get_avatar_materials
            paths = self._musetalk_paths()
            dummy_args = Namespace(
                gpu_id=0,
                use_float16=self.use_float16,
                version="v15",
                left_cheek_width=90,
                right_cheek_width=90,
                unet_model_path=paths["unet_model_path"],
                unet_config=paths["unet_config"],
                whisper_dir=paths["whisper_dir"],
                vae_type="sd-vae-ft-mse",
                batch_size=self.batch_size,
            )
            models_bundle = _load_models_cached(dummy_args)
            print("[WARMUP] ✅ MuseTalk models resident in GPU VRAM.")

            # Pre-cache avatar video materials in RAM
            self._precache_idle_videos(models_bundle)
        finally:
            os.chdir(original_cwd)

    def _precache_idle_videos(self, models_bundle=None):
        print("[WARMUP] ⏳ Pre-caching avatar assets & face masks in RAM...")
        from scripts.inference import _get_avatar_materials
        
        vae = models_bundle['vae'] if models_bundle else None
        fp = models_bundle['fp'] if models_bundle else None
        if not vae or not fp:
            return

        for host_type in ["2d", "3d"]:
            target_dir = getattr(self, f"assets_{host_type}")
            if not os.path.exists(target_dir):
                continue
            files = [
                f
                for f in os.listdir(target_dir)
                if f.endswith(".mp4") and not f.startswith("temp_")
            ]
            talk_clips = [f for f in files if "talk_expressive" in f.lower()]
            # Hanya cache clip lipsync. Precache semua gesture bisa OOM / force-close.
            for f in talk_clips or files[:1]:
                video_path = os.path.join(target_dir, f)
                try:
                    _get_avatar_materials(
                        video_path=video_path,
                        bbox_shift=0,
                        extra_margin=10,
                        version="v15",
                        parsing_mode="jaw",
                        vae=vae,
                        fp=fp,
                        default_fps=25,
                    )
                except Exception as e:
                    print(f"[WARMUP WARNING] Pre-cache {f} notice: {e}")

    def _get_idle_video(self, host_type, host_name):
        """Cari file bahan baku video di folder 2D/3D dengan multi-directory fallback"""
        target_dir = (
            self.assets_2d if str(host_type).lower() == "2d" else self.assets_3d
        )
        candidate_dirs = [
            target_dir,
            self.assets_3d,
            self.assets_2d,
            os.path.join(self.base_dir, "assets", "3d"),
            os.path.join(self.base_dir, "assets", "2d"),
            os.path.join(self.base_dir, "assets"),
            "/workspace/ai_live_worker/assets/3d",
            "/workspace/ai_live_worker/assets/2d",
            "/workspace/live-streaming-ai/deploy/assets/3d",
            "/workspace/live-streaming-ai/deploy/assets/2d",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "3d"),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "2d"),
        ]

        clean_name = host_name.lower().replace(".png", "").replace(".jpg", "").replace(".mp4", "").strip()

        gesture_tokens = (
            "wave",
            "nod",
            "laugh",
            "point_up",
            "point_down",
            "idle",
            "think",
            "talk_expressive",
            "expressive",
        )
        is_specific_clip = any(
            clean_name == token or clean_name.endswith("_" + token)
            for token in gesture_tokens
        )
        if is_specific_clip:
            exact_names = [f"{clean_name}.mp4"]
        elif not clean_name.endswith("_talk_expressive"):
            # Host "namira" → utamakan idle untuk lookup generik, lalu talk.
            exact_names = [
                f"{clean_name}_idle.mp4",
                f"{clean_name}_talk_expressive.mp4",
                f"{clean_name}.mp4",
            ]
        else:
            exact_names = [f"{clean_name}.mp4", f"{clean_name}_idle.mp4"]
        for d in candidate_dirs:
            if not os.path.exists(d):
                continue
            for target_file in exact_names:
                p = os.path.join(d, target_file)
                if os.path.exists(p):
                    return p

        # 2. Cek variasi nama / substring
        for d in candidate_dirs:
            if os.path.exists(d):
                for f in os.listdir(d):
                    if f.endswith(".mp4") and not f.startswith("temp_") and (
                        clean_name in f.lower()
                    ):
                        return os.path.join(d, f)

        # 3. Cek file IDLE_VIDEO dari env
        env_idle = os.environ.get("IDLE_VIDEO")
        if env_idle and os.path.exists(env_idle):
            return env_idle

        # 4. Fallback: clip gerak natural, baru ke namira.mp4
        for d in candidate_dirs:
            if not os.path.exists(d):
                continue
            for fallback in (
                "namira_idle.mp4",
                "namira_talk_expressive.mp4",
                "namira.mp4",
            ):
                p = os.path.join(d, fallback)
                if os.path.exists(p):
                    return p

        for d in candidate_dirs:
            if os.path.exists(d):
                mp4s = [
                    f
                    for f in os.listdir(d)
                    if f.endswith(".mp4") and not f.startswith("temp_")
                ]
                if mp4s:
                    return os.path.join(d, mp4s[0])
        return None

    def _resolve_action_clip(self, host_type, host_name, action_tag):
        """Pilih clip gesture sesuai action. Fallback ke talk_expressive bila file tidak ada.

        Canvas 720x1280 (pad, bukan crop) menahan lonjakan resolusi antar clip.
        """
        host = (host_name or "namira").lower().strip()
        action = (action_tag or "talk_expressive").lower().strip().replace("-", "_")
        variants = get_action_aliases(action)
        candidates = []
        for variant in variants:
            candidates.extend(
                [
                    f"{host}_{variant}",
                    variant,
                    f"namira_{variant}",
                ]
            )
        if get_action_category(action) == "gesture":
            candidates.append(f"{host}_talk_expressive")
            candidates.append("namira_talk_expressive")
        candidates.append(f"{host}_idle")
        candidates.append("namira_idle")
        candidates.append(host)
        candidates.append("namira")

        seen = set()
        for name in candidates:
            if name in seen:
                continue
            seen.add(name)
            found = self._get_idle_video(host_type, name)
            if found:
                print(f"[ACTION] {action} → {os.path.basename(found)}")
                return found
        return self._get_idle_video(host_type, host)

    async def run_pipeline(
        self,
        host_type,
        host_name,
        text_answer,
        task_id,
        audio_path=None,
        tone="Casual",
        action=None,
    ):
        """Fungsi Pemicu Utama — Zero-Latency High Speed Pipeline"""
        pipeline_start = time.time()

        # 1. Parse Action Tags (e.g. [WAVE], [NOD]) — juga terima field action dari backend
        import re

        action_tag = (action or "").strip().lower()
        match = re.search(r"\[([A-Z_]+)\]", text_answer or "")
        if match:
            action_tag = match.group(1).lower()
            text_answer = re.sub(r"\[[A-Z_]+\]", "", text_answer).strip()
        if not action_tag or action_tag in ("none", "null"):
            action_tag = "talk_expressive"

        print(
            f"\n[MEMPROSES] {task_id} | Host: {host_name} ({host_type.upper()}) | Action: {action_tag}"
        )

        idle_video = self._resolve_action_clip(host_type, host_name, action_tag)

        if not idle_video:
            print(
                f"[ERROR] Video '{host_name}.mp4' tidak ada di folder assets/{host_type}"
            )
            return None

        print(f"[CLIP] Using source video: {idle_video}")

        if audio_path and os.path.exists(audio_path):
            audio_file = audio_path
        else:
            print(
                f"[ERROR] Audio dari backend tidak tersedia untuk {task_id}."
            )
            return None

        # 3. Fast Lipsync Video Generation (< 3-5 detik)
        lipsync_start = time.time()
        final_video = await self._sync_lips_async(
            idle_video, audio_file, task_id
        )
        lipsync_elapsed = round((time.time() - lipsync_start) * 1000)

        if (
            audio_file
            and os.path.exists(audio_file)
            and audio_file.startswith(self.temp_dir)
        ):
            try:
                os.remove(audio_file)
            except Exception:
                pass

        total_elapsed = round((time.time() - pipeline_start) * 1000)
        if final_video:
            self._write_action_meta(final_video, action_tag)
            print(
                f"[⚡ SUKSES KILAT] Video selesai: {final_video} | "
                f"lipsync={lipsync_elapsed}ms total={total_elapsed}ms action={action_tag}"
            )
        return final_video

    def _write_action_meta(self, video_path, action_tag):
        """Sidecar `<video>.json` — dibaca broadcaster untuk crossfade per-aksi.

        Tanpa ini broadcaster hanya tahu path video, bukan gestur apa yang
        sedang diputar, sehingga tidak bisa memilih durasi transisi yang pas
        (gestur pendek butuh crossfade lebih singkat daripada idle/talk).
        """
        meta = {
            "action": action_tag,
            "category": get_action_category(action_tag),
            "crossfadeSeconds": get_crossfade_seconds(action_tag),
        }
        try:
            with open(f"{video_path}.json", "w", encoding="utf-8") as f:
                json.dump(meta, f)
        except Exception as e:
            print(f"[WARNING] Gagal tulis metadata aksi untuk {video_path}: {e}")

    async def _sync_lips_async(self, idle_video, audio_path, task_id):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._sync_lips, idle_video, audio_path, task_id
        )

    def _sync_lips(self, idle_video, audio_path, task_id):
        with self._inference_lock:
            yaml_path = os.path.join(self.temp_dir, f"{task_id}.yaml")
            try:
                import yaml

                # Fast check: if audio is already 16kHz WAV, use directly without ffmpeg re-encode
                target_audio = audio_path
                try:
                    import wave
                    with wave.open(audio_path, "rb") as wf:
                        if wf.getframerate() != 16000 or wf.getnchannels() != 1:
                            raise ValueError("Need re-sample")
                except Exception:
                    # Normalize audio to 16kHz PCM WAV
                    norm_audio_path = os.path.join(
                        self.temp_dir, f"{task_id}_16k.wav"
                    )
                    norm_cmd = [
                        "ffmpeg",
                        "-y",
                        "-v", "error",
                        "-i",
                        audio_path,
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        "-c:a",
                        "pcm_s16le",
                        norm_audio_path,
                    ]
                    try:
                        subprocess.run(
                            norm_cmd,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            check=True,
                        )
                        if os.path.exists(norm_audio_path):
                            target_audio = norm_audio_path
                    except Exception as norm_err:
                        print(
                            f"[MuseTalk WARNING] Audio normalization notice: {norm_err}"
                        )

                config_data = {
                    "task_0": {
                        "video_path": idle_video,
                        "audio_path": target_audio,
                        "bbox_shift": 0,
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
                    raise FileNotFoundError(
                        f"MuseTalk V1.5 config tidak ditemukan: {unet_config}"
                    )
                if not os.path.exists(unet_model_path):
                    raise FileNotFoundError(
                        f"MuseTalk V1.5 checkpoint tidak ditemukan: {unet_model_path}"
                    )
                if not os.path.exists(whisper_dir):
                    raise FileNotFoundError(
                        f"Whisper model tidak ditemukan: {whisper_dir}"
                    )

                if self.base_dir not in sys.path:
                    sys.path.insert(0, self.base_dir)
                if musetalk_dir not in sys.path:
                    sys.path.insert(0, musetalk_dir)

                original_cwd = os.getcwd()
                os.chdir(musetalk_dir)
                try:
                    # Pose continuity antar clip — indeks cycle disimpan di output_dir.
                    os.environ["MUSETALK_CYCLE_STATE"] = os.path.join(
                        self.output_dir, "cycle_state.json"
                    )
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
                        # RENDER KE TEMP_DIR UNTUK MENGHINDARI RACE CONDITION DENGAN BROADCASTER
                        result_dir=self.temp_dir,
                        extra_margin=10,
                        fps=25,
                        audio_padding_length_left=2,
                        audio_padding_length_right=2,
                        batch_size=self.batch_size,
                        output_vid_name=f"{task_id}.mp4",
                        use_saved_coord=True,
                        saved_coord=True,
                        use_float16=self.use_float16,
                        parsing_mode="jaw",
                        left_cheek_width=90,
                        right_cheek_width=90,
                        version="v15",
                    )

                    musetalk_main(args)
                finally:
                    os.chdir(original_cwd)

                # Prefer raw .ffseg (frame_feed) — atomic rename ke output_dir.
                expected_ffseg = os.path.join(self.output_dir, f"{task_id}.ffseg")
                ffseg_candidates = []
                for root, dirs, _files in os.walk(self.temp_dir):
                    for d in dirs:
                        if d.endswith(".ffseg") and task_id in d and not d.endswith(".partial"):
                            ffseg_candidates.append(os.path.join(root, d))
                if ffseg_candidates:
                    latest_ffseg = max(ffseg_candidates, key=os.path.getctime)
                    if os.path.exists(expected_ffseg):
                        shutil.rmtree(expected_ffseg, ignore_errors=True)
                    os.replace(latest_ffseg, expected_ffseg)
                    print(f"[MuseTalk] Handoff ffseg → {expected_ffseg}")
                    return expected_ffseg

                expected_output = os.path.join(self.output_dir, f"{task_id}.mp4")
                list_of_files = []
                for root, dirs, files in os.walk(self.temp_dir):
                    for file in files:
                        if file.endswith(".mp4") and task_id in file:
                            list_of_files.append(os.path.join(root, file))

                if not list_of_files:
                    raise FileNotFoundError(
                        f"Output MuseTalk untuk {task_id} tidak ditemukan (ffseg/mp4) di temp_dir."
                    )

                latest_file = max(list_of_files, key=os.path.getctime)
                os.replace(latest_file, expected_output)
                return expected_output

            except torch.cuda.OutOfMemoryError as oom:
                print(f"[MuseTalk OOM ERROR] Out of GPU memory: {oom}")
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                raise RuntimeError(f"GPU OOM: {oom}")
            except Exception as e:
                import traceback
                print(f"[MuseTalk ERROR] {type(e).__name__}: {e}")
                traceback.print_exc()
                raise RuntimeError(f"{type(e).__name__}: {str(e)}")
            finally:
                if os.path.exists(yaml_path):
                    try:
                        os.remove(yaml_path)
                    except Exception:
                        pass
                if "norm_audio_path" in locals() and os.path.exists(
                    norm_audio_path
                ):
                    try:
                        os.remove(norm_audio_path)
                    except Exception:
                        pass
