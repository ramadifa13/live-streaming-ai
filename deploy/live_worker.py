import subprocess
import os
import time
import asyncio
import torch

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
        self.musetalk_checkpoint = os.path.join(self.musetalk_dir, "models", "musetalk", "musetalk.json")
        
        if not os.path.exists(self.musetalk_checkpoint):
            print(f"[WARNING] Model MuseTalk belum terunduh di {self.musetalk_checkpoint}. Pastikan setup.sh sudah dijalankan.")
            
        print("[INFO] Worker siap dengan sistem TTS Edge-TTS dan Lipsync MuseTalk...")

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

    def _sync_lips(self, idle_video, audio_path, task_id):
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

        # =========================================================
        # MUSE TALK 1.5
        # =========================================================

        musetalk_dir = os.path.join(self.base_dir, "MuseTalk")

        unet_config = os.path.join(
            musetalk_dir,
            "models",
            "musetalk",
            "musetalk",
            "musetalk.json"
        )

        unet_model_path = os.path.join(
            musetalk_dir,
            "models",
            "musetalk",
            "musetalkV15",
            "unet.pth"
        )

        whisper_dir = os.path.join(
            musetalk_dir,
            "models",
            "whisper"
        )

        print("\n==============================================")
        print("[MuseTalk] VERSION : 1.5")
        print(f"[MuseTalk] Video   : {idle_video}")
        print(f"[MuseTalk] Audio   : {audio_path}")
        print(f"[MuseTalk] Config  : {unet_config}")
        print(f"[MuseTalk] UNet    : {unet_model_path}")
        print(f"[MuseTalk] Whisper : {whisper_dir}")
        print("==============================================\n")

        # Validasi file
        if not os.path.exists(unet_config):
            print(f"[ERROR] MuseTalk V1.5 config tidak ditemukan:\n{unet_config}")
            return None

        if not os.path.exists(unet_model_path):
            print(f"[ERROR] MuseTalk V1.5 checkpoint tidak ditemukan:\n{unet_model_path}")
            return None

        if not os.path.exists(whisper_dir):
            print(f"[ERROR] Whisper model tidak ditemukan:\n{whisper_dir}")
            return None

        # =========================================================
        # COMMAND MUSE TALK 1.5
        # =========================================================

        command = [
            "python",
            "-m",
            "scripts.inference",
            "--inference_config",
            yaml_path,
            "--result_dir",
            self.output_dir,
            "--unet_model_path",
            unet_model_path,
            "--unet_config",
            unet_config,
            "--whisper_dir",
            whisper_dir,
            "--vae_type",
            "sd-vae-ft-mse",
            "--version",
            "v15",
            "--use_float16",
            "--use_saved_coord",
            "--saved_coord",
            "--output_vid_name",
            f"{task_id}.mp4"
        ]

        try:
            print(
                f"[MuseTalk] Starting V1.5 inference: {task_id}"
            )

            result = subprocess.run(
                command,
                cwd=musetalk_dir,
                check=True,
                text=True
            )

            print(
                f"[MuseTalk] Process selesai dengan code "
                f"{result.returncode}"
            )

            # =====================================================
            # CARI OUTPUT
            # =====================================================

            expected_output = os.path.join(
                self.output_dir,
                "v15",
                f"{task_id}.mp4"
            )

            if os.path.exists(expected_output):
                print(
                    f"[MuseTalk SUCCESS] Output ditemukan:\n"
                    f"{expected_output}"
                )
                return expected_output

            # fallback: cari mp4 task
            list_of_files = []
            for root, dirs, files in os.walk(
                self.output_dir
            ):
                for file in files:
                    if (
                        file.endswith(".mp4")
                        and task_id in file
                    ):
                        list_of_files.append(
                            os.path.join(root, file)
                        )

            if not list_of_files:
                raise FileNotFoundError(
                    f"Output video MuseTalk untuk "
                    f"{task_id} tidak ditemukan."
                )

            latest_file = max(
                list_of_files,
                key=os.path.getctime
            )

            if latest_file != expected_output:
                os.replace(
                    latest_file,
                    expected_output
                )

            print(
                f"[MuseTalk SUCCESS] Output:\n"
                f"{expected_output}"
            )

            return expected_output

        except subprocess.CalledProcessError as e:
            print(
                f"[MuseTalk ERROR] Process gagal "
                f"dengan code {e.returncode}"
            )
            return None

        except Exception as e:
            print(
                f"[MuseTalk ERROR] {type(e).__name__}: {e}"
            )
            return None

        finally:
            if os.path.exists(yaml_path):
                try:
                    os.remove(yaml_path)
                except Exception:
                    pass

    async def run_pipeline(self, host_type, host_name, text_answer, task_id):
        """Fungsi Pemicu Utama"""
        print(f"\n[MEMPROSES] {task_id} | Host: {host_name} ({host_type.upper()})")
        
        idle_video = self._get_idle_video(host_type, host_name)
        if not idle_video:
            print(f"[ERROR] Video '{host_name}.mp4' tidak ada di folder assets/{host_type}")
            return None
            
        print(" -> Generating Suara (XTTSv2)...")
        try:
            audio_file = await self._generate_voice(text_answer, task_id, host_name)
        except Exception as e:
            print(f"[ERROR] Gagal membuat suara: {e}")
            return None
        
        print(" -> Generating Video Lipsync (MuseTalk)...")
        final_video = self._sync_lips(idle_video, audio_file, task_id)
        
        if os.path.exists(audio_file):
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
