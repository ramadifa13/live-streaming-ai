# 🚀 LiveStreamerAI — Deployment Guide (RunPod All-in-One: Zero-Config)

Semua service berjalan di **1 Pod RunPod RTX 4090**: Frontend (Port 3000), Backend (Port 4000), dan AI Worker (Port 8000).

> [!TIP]
> **Zero-Config Architecture:** Anda **TIDAK PERLU mengubah `.env` sama sekali** saat deploy ke RunPod maupun jalan di lokal! 
> Karena Frontend, Backend, dan Worker berjalan di dalam satu mesin/pod yang sama, ketiga service berkomunikasi langsung via `127.0.0.1` (internal loopback).
> Cukup clone repository, jalankan setup script, dan jalankan PM2!

---

## 🗺️ Arsitektur Sistem

```
Browser Klien (Internet)
       │ Akses via Proxy RunPod
       ▼
Frontend (Next.js :3000) ───► https://<POD_ID>-3000.proxy.runpod.net
       │
       │ (Internal Proxy via 127.0.0.1 - Latensi 0ms, Zero-Config)
       ├───────────────► Backend Fastify (:4000)
       └───────────────► AI Worker SadTalker (:8000)
```

---

## LANGKAH 1 — Buat Pod di RunPod

1. Buka [runpod.io/console/pods](https://www.runpod.io/console/pods) → **+ Deploy Pod**
2. Pilih GPU: **NVIDIA RTX 4090** (24GB VRAM) atau **NVIDIA L4**
3. Template: **RunPod PyTorch 2.1 (CUDA 12.1)**
4. **Expose Ports** (Wajib):
   - `3000` → Frontend Dashboard
   - `4000` → Backend API
   - `8000` → AI Worker SadTalker
5. Volume Disk: Minimal **30 GB** (untuk model SadTalker & dependensi)
6. Klik **Deploy On-Demand**

---

## LANGKAH 2 — Clone & Deploy di Terminal RunPod

Buka **Terminal** di console RunPod / JupyterLab, lalu jalankan perintah di bawah secara berurutan:

```bash
# 1. Masuk ke workspace & clone repository
cd /workspace
git clone <URL_REPOSITORY_ANDA> app
cd /workspace/app

# 2. Install SadTalker, Edge-TTS, & download model checkpoints (~600MB)
bash deploy/setup_runpod_sadtalker.sh

# 3. Install dependencies Node.js (Backend & Frontend)
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 4. Install PM2 & Jalankan Semua Service Sekaligus
npm install -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

---

## LANGKAH 3 — Cek Status & Akses Dashboard

### Cek Status PM2
```bash
pm2 status
```
Output yang diharapkan:
```
┌──┬──────────────┬────────┬──────────┬──────┬──────────┐
│id│ name         │ status │ cpu      │ mem  │ uptime   │
├──┼──────────────┼────────┼──────────┼──────┼──────────┤
│ 0│ ai-worker    │ online │ 0.1%     │180mb │ 15s      │
│ 1│ backend      │ online │ 0.2%     │ 95mb │ 12s      │
│ 2│ frontend     │ online │ 0.1%     │120mb │ 10s      │
└──┴──────────────┴────────┴──────────┴──────┴──────────┘
```

### Akses Dashboard Anda:
Buka di browser:
```
https://<POD_ID>-3000.proxy.runpod.net/dashboard
```
*(Ganti `<POD_ID>` dengan ID pod RunPod Anda yang tertera di console RunPod)*

---

## 🔄 Cara Update Kode di RunPod (Redeploy Cepat)

Jika Anda melakukan push perubahan kode baru ke GitHub:

```bash
cd /workspace/app
git pull
pm2 restart all
```

---

## 🛠️ Perintah Monitoring & Debugging

```bash
# Lihat log real-time semua service
pm2 logs

# Lihat log spesifik AI Worker (SadTalker generation)
pm2 logs ai-worker

# Monitor pemakaian GPU real-time
nvidia-smi -l 2

# Restart service
pm2 restart all
```
