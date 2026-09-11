import subprocess
import os
import time
import asyncio
import torch
import threading
import sys
import shutil
import random
from argparse import Namespace


class AILiveWorker:
    def __init__(self):
        # Shared root is mounted from the network volume and is read-mostly.
        # Every pod gets its own local runtime root so output/flags/temp from
        # concurrent buyers can never collide on the shared volume.
        default_shared = (
            "/workspace/ai_live_worker"
            if os.path.exists("/workspace/ai_live_worker")
            else os.path.dirname(os.path.abspath(__file__))
        )
        self.base_dir = os.environ.get("WORKER_SHARED_ROOT", default_shared).rstrip(
            "/\\"
        )
        default_runtime = (
            "/tmp/ai_live_worker"
            if self.base_dir.startswith("/workspace/")
            else os.path.join(self.base_dir, ".runtime")
        )
        self.runtime_root = os.environ.get(
            "WORKER_RUNTIME_ROOT", default_runtime
        ).rstrip("/\\")
        self.assets_2d = os.path.join(self.base_dir, "assets", "2d")
        self.assets_3d = os.path.join(self.base_dir, "assets", "3d")
        self.temp_dir = os.path.join(self.runtime_root, "temp")
        self.output_dir = os.path.join(self.runtime_root, "output")
        self.log_dir = os.path.join(self.runtime_root, "logs")
        os.makedirs(self.temp_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(self.log_dir, exist_ok=True)

        # Konfigurasi MuseTalk
        self.musetalk_dir = os.path.join(self.base_dir, "MuseTalk")
        paths = self._musetalk_paths()
        self.musetalk_checkpoint = paths["unet_config"]

        # Batch size untuk inferensi UNet (Default 16 untuk RTX 3090/4090/A100)
        self.batch_size = 16
        self.use_float16 = self._resolve_use_float16()

        # Lock untuk serialisasi inferensi GPU intra-process
        self._inference_lock = threading.Lock()

        if not os.path.exists(self.musetalk_checkpoint):
            print(
                f"[WARNING] Model MuseTalk belum terunduh di {self.musetalk_checkpoint}. Pastikan setup.sh sudah dijalankan."
            )

        self._ensure_musetalk_layout()
        self._clean_temp_dir()

        # Dedicated pod (1 pembeli): muat MuseTalk saat start, bukan saat siaran pertama.
        # HTTP tetap naik dulu; warmup jalan di background.
        self._warmed_up = False
        self._warmup_lock = threading.Lock()
        self._warmup_thread: threading.Thread | None = None
        warmup_flag = str(os.environ.get("MUSETALK_WARMUP_ON_START", "1")).strip().lower()
        if warmup_flag in ("1", "true", "yes", "on"):
            self.ensure_warmup_started()
            print("[WARMUP] MuseTalk warmup di background saat start (siaran pertama tidak menunggu load model)")
        else:
            print(
                "[WARMUP] Skip startup warmup (MUSETALK_WARMUP_ON_START=0) — "
                "model dimuat saat broadcast/utterance pertama atau bash warmup.sh."
            )

        print(
            f"[INFO] 🚀 AI Worker API siap (Batch: {self.batch_size}, warmup deferred={warmup_flag not in ('1', 'true', 'yes', 'on')})..."
        )

    def ensure_warmup_started(self) -> None:
        """Mulai load MuseTalk ke VRAM sekali; aman dipanggil berulang (demo warmup.sh)."""
        if self._warmed_up:
            return
        with self._warmup_lock:
            if self._warmed_up:
                return
            if self._warmup_thread is not None and self._warmup_thread.is_alive():
                return
            self._warmup_thread = threading.Thread(
                target=self._warmup_musetalk_safe,
                name="MuseTalkWarmup",
                daemon=True,
            )
            self._warmup_thread.start()

    def warmup_status(self) -> str:
        if self._warmed_up:
            return "ready"
        if self._warmup_thread is not None and self._warmup_thread.is_alive():
            return "warming"
        return "cold"

    def _warmup_musetalk_safe(self) -> None:
        try:
            self._warmup_musetalk()
            self._warmed_up = True
        except Exception as e:
            print(f"[WARMUP WARNING] Pre-load MuseTalk notice: {e}")

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
            elif os.path.isdir(link_path) and not os.path.islink(link_path):
                # Replace existing regular directory with symlink
                try:
                    import shutil

                    shutil.rmtree(link_path)
                except Exception as e:
                    print(f"[WARNING] Failed to remove dir {link_path}: {e}")
            elif os.path.exists(link_path):
                # Remove stray file if any
                try:
                    os.remove(link_path)
                except Exception as e:
                    print(f"[WARNING] Failed to remove file {link_path}: {e}")
            try:
                os.symlink(target_path, link_path)
                print(f"[INFO] Symlink: {link_path} -> {target_path}")
            except Exception as link_err:
                print(f"[WARNING] Could not create symlink {link_path}: {link_err}")

    def _resolve_use_float16(self) -> bool:
        mode = str(os.environ.get("BROADCAST_MODE", "ai_worker")).strip().lower()
        warmup = str(os.environ.get("MUSETALK_WARMUP_ON_START", "1")).strip().lower()
        if mode in (
            "ai_worker",
            "ai-worker",
            "realtime",
            "visual_worker",
        ) and warmup not in (
            "1",
            "true",
            "yes",
            "on",
        ):
            print(
                "[GPU] BROADCAST_MODE=ai_worker + MUSETALK_WARMUP_ON_START=0 — "
                "probe GPU ditunda ke AIVisualWorker.",
                flush=True,
            )
            return False

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
            "unet_config": os.path.join(models_root, "musetalkV15", "musetalk.json"),
            "unet_model_path": os.path.join(models_root, "musetalkV15", "unet.pth"),
            "whisper_dir": os.path.join(models_root, "whisper"),
        }

    def _warmup_musetalk(self):
        print(f"[WARMUP] ⏳ Pre-loading MuseTalk models ke GPU VRAM (batch_size={self.batch_size})...")
        print(
            f"[WARMUP] ⏳ Pre-loading MuseTalk models ke GPU VRAM (batch_size={self.batch_size})..."
        )
        musetalk_dir = self.musetalk_dir
        if self.base_dir not in sys.path:
            sys.path.insert(0, self.base_dir)
        if musetalk_dir not in sys.path:
            sys.path.insert(0, musetalk_dir)

        original_cwd = os.getcwd()
        os.chdir(musetalk_dir)
        try:
            try:
                from inference import _load_models_cached, _get_avatar_materials
            except ImportError:
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
        try:
            from inference import _get_avatar_materials
        except ImportError:
            from scripts.inference import _get_avatar_materials
        
        vae = models_bundle['vae'] if models_bundle else None
        fp = models_bundle['fp'] if models_bundle else None

        vae = models_bundle["vae"] if models_bundle else None
        fp = models_bundle["fp"] if models_bundle else None
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
            idle_clips = [f for f in files if "idle" in f.lower()]
            # Precache idle saja (MuseTalk GPU-heavy). Jangan warmup semua gesture.
            for f in idle_clips[:1] or files[:1]:
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
                        default_fps=30,
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
        clean_name = (
            host_name.lower()
            .replace(".png", "")
            .replace(".jpg", "")
            .replace(".mp4", "")
            .strip()
        )

        body_tokens = ("talk_1", "talk_2", "talk_3", "idle")
        is_specific_clip = any(
            clean_name == token or clean_name.endswith("_" + token)
            for token in body_tokens
        )
        if is_specific_clip:
            exact_names = [f"{clean_name}.mp4"]
        else:
            exact_names = [
                f"{clean_name}_idle.mp4",
                f"{clean_name}_talk_1.mp4",
            ]
        for d in candidate_dirs:
            if not os.path.exists(d):
                continue
            for target_file in exact_names:
                p = os.path.join(d, target_file)
                if os.path.exists(p):
                    return p

        for d in candidate_dirs:
            if os.path.exists(d):
                for f in sorted(os.listdir(d)):
                    fl = f.lower()
                    if (
                        f.endswith(".mp4")
                        and not f.startswith("temp_")
                        and clean_name in fl
                        and any(
                            fl.endswith("_" + t + ".mp4") or fl == t + ".mp4"
                            for t in body_tokens
                        )
                    ):
                        return os.path.join(d, f)

        for d in candidate_dirs:
            if not os.path.exists(d):
                continue
            for fallback in (
                "namira_idle.mp4",
                "namira_talk_1.mp4",
                "namira_talk_2.mp4",
                "namira_talk_3.mp4",
            ):
                p = os.path.join(d, fallback)
                if os.path.exists(p):
                    return p

        for d in candidate_dirs:
            if os.path.exists(d):
                mp4s = [
                    f
                    for f in sorted(os.listdir(d))
                    if f.endswith(".mp4")
                    and not f.startswith("temp_")
                    and any(
                        f.lower().endswith("_" + t + ".mp4") or f.lower() == t + ".mp4"
                        for t in body_tokens
                    )
                ]
                if mp4s:
                    return os.path.join(d, mp4s[0])
        return None

    def _resolve_action_clip(self, host_type, host_name, action_tag):
        """Pilih clip — idle / talk_1 / talk_2 / talk_3."""
        host = (host_name or "namira").lower().strip()
        action = (action_tag or "talk_1").lower().strip().replace("-", "_")
        if action in ("speak", "speaking"):
            action = "talk_1"
        if action == "talk":
            action = "talk_1"
        action = (action_tag or "").lower().strip().replace("-", "_")
        if not action or action in ("talk", "speak", "speaking"):
            pool = ["idle", "talk_1", "talk_2", "talk_3"]
            last = getattr(self, "_last_talk_action", None)
            candidates = [c for c in pool if c != last] or pool
            action = random.choice(candidates)
            self._last_talk_action = action
        if action in ("rest", "neutral"):
            action = "idle"
        if action not in ("idle", "talk_1", "talk_2", "talk_3"):
            action = "talk_1"
            pool = ["idle", "talk_1", "talk_2", "talk_3"]
            last = getattr(self, "_last_talk_action", None)
            candidates = [c for c in pool if c != last] or pool
            action = random.choice(candidates)
            self._last_talk_action = action
        candidates = [
            f"{host}_{action}",
            action,
            f"namira_{action}",
        ]
        if action != "idle":
            candidates.extend([f"{host}_idle", "idle", "namira_idle"])

        seen = set()
        for name in candidates:
            if name in seen:
                continue
            seen.add(name)
            found = self._get_idle_video(host_type, name)
            if found:
                print(f"[ACTION] {action} → {os.path.basename(found)}")
                return found
        return self._get_idle_video(host_type, f"{host}_idle")

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
        import re

        action_tag = (action or "talk_1").strip().lower().replace("-", "_")
        match = re.search(
            r"\[(talk_1|talk_2|talk_3|talk|idle|TALK_1|TALK_2|TALK_3|TALK|IDLE)\]",
            text_answer or "",
            re.I,
        )
        if match:
            action_tag = match.group(1).lower().replace("-", "_")
            text_answer = re.sub(
                r"\[(talk_1|talk_2|talk_3|talk|idle|TALK_1|TALK_2|TALK_3|TALK|IDLE)\]",
                "",
                text_answer,
                flags=re.I,
            ).strip()
        if action_tag in ("speak", "speaking"):
            action_tag = "talk_1"
        if not action_tag or action_tag in ("talk", "speak", "speaking"):
            pool = ["idle", "talk_1", "talk_2", "talk_3"]
            last = getattr(self, "_last_talk_action", None)
            candidates = [c for c in pool if c != last] or pool
            action_tag = random.choice(candidates)
            self._last_talk_action = action_tag
        if action_tag in ("rest", "neutral"):
            action_tag = "idle"
        if action_tag == "talk":
            action_tag = "talk_1"
        if action_tag not in ("idle", "talk_1", "talk_2", "talk_3"):
            action_tag = "talk_1"
            pool = ["idle", "talk_1", "talk_2", "talk_3"]
            last = getattr(self, "_last_talk_action", None)
            candidates = [c for c in pool if c != last] or pool
            action_tag = random.choice(candidates)
            self._last_talk_action = action_tag

        print(
            f"\n[MEMPROSES] {task_id} | Host: {host_name} ({host_type.upper()}) | Action: {action_tag}"
        )

        idle_video = self._resolve_action_clip(host_type, host_name, action_tag)

        if not idle_video:
            print(
                f"[ERROR] Video idle/talk untuk '{host_name}' tidak ada di folder assets/{host_type}"
            )
            return None

        print(f"[CLIP] Using source video: {idle_video}")

        if audio_path and os.path.exists(audio_path):
            audio_file = audio_path
        else:
            print(
                f"[ERROR] Audio dari backend tidak tersedia untuk {task_id}."
            )
            print(f"[ERROR] Audio dari backend tidak tersedia untuk {task_id}.")
            return None

        # 3. Fast Lipsync Video Generation (< 3-5 detik)
        lipsync_start = time.time()
        final_video = await self._sync_lips_async(
            idle_video, audio_file, task_id
        )
        final_video = await self._sync_lips_async(idle_video, audio_file, task_id)
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
            print(
                f"[⚡ SUKSES KILAT] Video selesai: {final_video} | "
                f"lipsync={lipsync_elapsed}ms total={total_elapsed}ms action={action_tag}"
            )
        return final_video

    async def _sync_lips_async(self, idle_video, audio_path, task_id):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._sync_lips, idle_video, audio_path, task_id
        )

    @staticmethod
    def _probe_media_duration(path: str) -> float:
        if not path or not os.path.exists(path) or os.path.getsize(path) == 0:
            return 0.0
        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    path,
                ],
                capture_output=True,
                text=True,
                timeout=30,
                check=True,
            )
            val = (result.stdout or "").strip()
            return max(0.0, float(val)) if val else 0.0
        except Exception:
            return 0.0

    def _ensure_video_covers_audio(self, video_path: str, audio_path: str) -> str:
        """Extend short MuseTalk output so its video clock never ends before audio."""
        if not video_path or not os.path.exists(video_path):
            return video_path
        if not audio_path or not os.path.exists(audio_path):
            return video_path
        video_duration = self._probe_media_duration(video_path)
        audio_duration = self._probe_media_duration(audio_path)
        if audio_duration <= 0.0 or video_duration + 0.05 >= audio_duration:
            return video_path

        padded_path = f"{video_path}.audio_padded.mp4"
        fps = 24
        command = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-stream_loop",
            "-1",
            "-i",
            video_path,
            "-i",
            audio_path,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(fps),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-shortest",
            padded_path,
        ]
        try:
            subprocess.run(command, check=True, capture_output=True, timeout=300)
            os.replace(padded_path, video_path)
            print(
                f"[MuseTalk] Extended video {video_duration:.2f}s -> "
                f"{audio_duration:.2f}s to preserve audio"
            )
            return video_path
        finally:
            if os.path.exists(padded_path):
                os.remove(padded_path)

    def _sync_lips(self, idle_video, audio_path, task_id):
        with self._inference_lock:
            yaml_path = os.path.join(self.temp_dir, f"{task_id}.yaml")
            try:
                import yaml
                from inference import musetalk_visual_params

                vis = musetalk_visual_params()

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
                    norm_audio_path = os.path.join(self.temp_dir, f"{task_id}_16k.wav")
                    norm_cmd = [
                        "ffmpeg",
                        "-y",
                        "-v", "error",
                        "-v",
                        "error",
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
                        "bbox_shift": int(vis.get("bbox_shift", 0)),
                        "bbox_shift_x": int(vis.get("bbox_shift_x", 0)),
                        "upper_boundary_ratio": float(vis.get("upper_boundary_ratio", 0.32)),
                        "square_pad": bool(vis.get("square_pad", True)),
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
                    _cycle_state_path = os.path.join(self.output_dir, "cycle_state.json")
                    from scripts.inference import main as musetalk_main

                    args = Namespace(
                        ffmpeg_path="",
                        gpu_id=0,
                        vae_type="sd-vae-ft-mse",
                        unet_config=unet_config,
                        unet_model_path=unet_model_path,
                        whisper_dir=whisper_dir,
                        inference_config=yaml_path,
                        bbox_shift=int(vis.get("bbox_shift", 0)),
                        bbox_shift_x=int(vis.get("bbox_shift_x", 0)),
                        upper_boundary_ratio=float(vis.get("upper_boundary_ratio", 0.32)),
                        square_pad=bool(vis.get("square_pad", True)),
                        # RENDER KE TEMP_DIR UNTUK MENGHINDARI RACE CONDITION DENGAN BROADCASTER
                        result_dir=self.temp_dir,
                        extra_margin=int(vis.get("extra_margin", 0)),
                        fps=30,
                        audio_padding_length_left=2,
                        audio_padding_length_right=2,
                        batch_size=self.batch_size,
                        output_vid_name=f"{task_id}.mp4",
                        use_saved_coord=True,
                        saved_coord=True,
                        use_float16=self.use_float16,
                        parsing_mode="jaw",
                        left_cheek_width=int(vis.get("left_cheek_width", 10)),
                        right_cheek_width=int(vis.get("right_cheek_width", 10)),
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
                        if (
                            d.endswith(".ffseg")
                            and task_id in d
                            and not d.endswith(".partial")
                        ):
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
                self._ensure_video_covers_audio(latest_file, target_audio)
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
                if "norm_audio_path" in locals() and os.path.exists(norm_audio_path):
                    try:
                        os.remove(norm_audio_path)
                    except Exception:
                        pass
