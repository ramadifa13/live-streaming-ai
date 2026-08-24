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
        
        # Konfigurasi Wav2Lip
        self.wav2lip_script = os.path.join(self.base_dir, "Wav2Lip", "inference.py")
        self.checkpoint = os.path.join(self.base_dir, "Wav2Lip", "checkpoints", "wav2lip_gan.pth")
        
        if not os.path.exists(self.checkpoint):
            print(f"[ERROR] Model Wav2Lip tidak ditemukan di {self.checkpoint}")
            
        print("[INFO] Worker siap dengan sistem TTS baru (Edge-TTS)...")

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
        target_dir = self.assets_2d if host_type.lower() == "2d" else self.assets_3d
        video_path = os.path.join(target_dir, f"{host_name}.mp4")
        return video_path if os.path.exists(video_path) else None

    def _sync_lips(self, idle_video, audio_path, task_id):
        """Render Sinkronisasi Bibir"""
        output_video = os.path.join(self.output_dir, f"{task_id}.mp4")
        
        command = [
            "python", self.wav2lip_script,
            "--checkpoint_path", self.checkpoint,
            "--face", idle_video,
            "--audio", audio_path,
            "--outfile", output_video,
            "--pads", "0", "15", "0", "0" 
        ]
        
        try:
            # Render video dan biarkan log tampil di terminal agar kita tahu kalau ada error
            subprocess.run(command, check=True)
            return output_video
        except subprocess.CalledProcessError:
            print(f"[GAGAL] Error saat merender video {task_id}.")
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
        
        print(" -> Generating Video Lipsync (Wav2Lip)...")
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
