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
        """Render Sinkronisasi Bibir dengan MuseTalk (Kecepatan Tinggi)"""
        import yaml
        
        # 1. Buat file konfigurasi YAML dinamis untuk tugas ini
        yaml_path = os.path.join(self.temp_dir, f"{task_id}.yaml")
        config_data = {
            "task_0": {
                "video_path": idle_video,
                "audio_path": audio_path,
                "bbox_shift": 0
            }
        }
        with open(yaml_path, 'w') as f:
            yaml.dump(config_data, f)
            
        # 2. Siapkan perintah eksekusi MuseTalk
        musetalk_dir = os.path.join(self.base_dir, "MuseTalk")
        output_dir = os.path.join(self.base_dir, "output")

        # 1. Pastikan cross_attention_dim = 384 agar cocok dengan bobot checkpoint pytorch_model.bin ([320, 384])
        for root, _, files in os.walk(musetalk_dir):
            for file in files:
                if file == "musetalk.json":
                    fp = os.path.join(root, file)
                    try:
                        import json
                        with open(fp, "r") as jf:
                            cfg = json.load(jf)
                        if cfg.get("cross_attention_dim") != 384:
                            cfg["cross_attention_dim"] = 384
                            with open(fp, "w") as jf:
                                json.dump(cfg, jf, indent=2)
                    except Exception:
                        pass

        # 2. Patch musetalk/models/pe.py agar otomatis menangani tensor 768 -> (2, 384)
        for root, _, files in os.walk(musetalk_dir):
            for file in files:
                if file == "pe.py":
                    fp = os.path.join(root, file)
                    try:
                        with open(fp, "r", encoding="utf-8") as f:
                            pe_code = f.read()
                        if "x.shape[-1] == 768" not in pe_code and "x = x + self.pe" in pe_code:
                            pe_code = pe_code.replace(
                                "x = x + self.pe[:, :x.size(1)]",
                                "if x.shape[-1] == 768:\n            x = x.view(x.shape[0], -1, 384) if x.dim() >= 2 else x.view(-1, 2, 384)\n        x = x + self.pe[:, :x.size(1)]"
                            )
                            with open(fp, "w", encoding="utf-8") as f:
                                f.write(pe_code)
                            print(f"[INFO] Berhasil mem-patch PositionalEncoding di {fp}")
                    except Exception as e:
                        print(f"[WARNING] Gagal patch pe.py: {e}")

        # 3. Patch scripts/inference.py: reshape whisper_batch ke (B, -1, 384) dan terapkan pe
        inf_py = os.path.join(musetalk_dir, "scripts", "inference.py")
        if os.path.exists(inf_py):
            try:
                with open(inf_py, "r", encoding="utf-8") as f:
                    inf_code = f.read()
                
                # Auto-reshape whisper_batch saat dimuat
                if "whisper_batch.shape[-1] == 768" not in inf_code:
                    if "whisper_batch = torch.from_numpy(whisper_batch)" in inf_code:
                        inf_code = inf_code.replace(
                            "whisper_batch = torch.from_numpy(whisper_batch).to(device=unet.device, dtype=unet.dtype)",
                            "whisper_batch = torch.from_numpy(whisper_batch).to(device=unet.device, dtype=unet.dtype)\n            if whisper_batch.shape[-1] == 768:\n                whisper_batch = whisper_batch.view(whisper_batch.shape[0], -1, 384)\n            if 'pe' in locals() and pe is not None:\n                whisper_batch = pe(whisper_batch)"
                        )
                    with open(inf_py, "w", encoding="utf-8") as f:
                        f.write(inf_code)
                    print("[INFO] Berhasil menerapkan patch whisper reshape 384 ke scripts/inference.py")
            except Exception as e:
                print(f"[WARNING] Gagal patch inference.py: {e}")

        # Cari lokasi unet_config dan unet_model_path yang ada di disk
        unet_config = "./models/musetalk/musetalk/musetalk.json"
        if not os.path.exists(os.path.join(musetalk_dir, unet_config)):
            unet_config = "./models/musetalk/musetalk.json"

        unet_model_path = "./models/musetalk/musetalk/pytorch_model.bin"
        if not os.path.exists(os.path.join(musetalk_dir, unet_model_path)):
            unet_model_path = "./models/musetalk/pytorch_model.bin"
        
        command = [
            "python", "-m", "scripts.inference",
            "--inference_config", yaml_path,
            "--result_dir", output_dir,
            "--vae_type", "sd-vae-ft-mse",
            "--unet_config", unet_config,
            "--unet_model_path", unet_model_path,
            "--use_float16",
            "--use_saved_coord",
            "--saved_coord"
        ]
        
        try:
            print(f"[INFO] Mengeksekusi MuseTalk untuk {task_id}...")
            # Kita jalankan dari dalam folder MuseTalk agar module 'scripts' terbaca
            subprocess.run(command, cwd=musetalk_dir, check=True)
            
            # Cari video mp4 hasil render khusus untuk task_id ini
            list_of_files = []
            for root, dirs, files in os.walk(output_dir):
                for file in files:
                    if file.endswith(".mp4") and task_id in file:
                        list_of_files.append(os.path.join(root, file))
            
            if not list_of_files:
                raise FileNotFoundError(f"Output video dari MuseTalk untuk task {task_id} tidak ditemukan.")
                
            latest_file = max(list_of_files, key=os.path.getctime)
            
            # Rename (pindahkan) ke target path final
            final_output = os.path.join(self.output_dir, f"{task_id}.mp4")
            if latest_file != final_output:
                os.rename(latest_file, final_output)
            
            # Hapus file yaml
            if os.path.exists(yaml_path):
                os.remove(yaml_path)
                
            return final_output
            
        except subprocess.CalledProcessError as e:
            print(f"[GAGAL] Error saat merender video {task_id}. Kode: {e.returncode}")
            # Catat error ke file log jika terjadi kegagalan
            with open(os.path.join(self.base_dir, "worker_error.log"), "a") as err_log:
                err_log.write(f"[{time.ctime()}] MuseTalk Error (Task {task_id}): {e}\n")
            return None
        except Exception as e:
            print(f"[GAGAL] Error sistem: {e}")
            with open(os.path.join(self.base_dir, "worker_error.log"), "a") as err_log:
                err_log.write(f"[{time.ctime()}] Worker Error (Task {task_id}): {e}\n")
            return None

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
