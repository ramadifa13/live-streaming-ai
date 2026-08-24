# Riset & Rencana Implementasi: Optimasi Latensi Video AI Real-Time

Tujuan utama dari arsitektur *Live Streaming AI* adalah mencapai **latensi sekecil mungkin (Idealnya < 2 detik)** dari saat user mengirimkan komentar hingga Avatar mulai merespons dengan suara dan bibir yang bergerak.

Saat ini, *pipeline* kita beroperasi dalam mode **Batch Processing**:
1. Menunggu kalimat penuh dari LLM
2. Mengubah seluruh kalimat menjadi satu file audio `mp3` utuh (Edge-TTS).
3. Merender seluruh durasi video secara penuh (MuseTalk).
4. Menyimpan sebagai `mp4` utuh dan mengirim URL-nya ke *frontend*.

Metode di atas memakan waktu linier terhadap durasi jawaban. Jawaban 10 detik akan memakan waktu render 10+ detik sebelum bisa diputar.

Untuk menembus batas ini, kita harus mengubah arsitektur menjadi **Real-Time Streaming Pipeline**. Berikut adalah hasil riset mendalam dan strategi implementasinya:

## 1. Arsitektur Streaming Pipeline (Chunking)

Alih-alih memproses semuanya di akhir, kita memecah data menjadi potongan-potongan kecil (chunks) dan memprosesnya secara paralel bagaikan *assembly line* di pabrik.

- **LLM Streaming:** Saat LLM menghasilkan teks, kita menangkapnya per kalimat (atau per klausa tanda baca).
- **TTS Streaming:** Begitu 1 kalimat didapat, langsung dikirim ke Edge-TTS untuk diubah menjadi potongan audio (`chunk 1`).
- **Video Streaming:** `chunk 1` audio langsung dikirim ke MuseTalk. MuseTalk akan me-render video untuk `chunk 1` dan **langsung menayangkannya ke layar** lewat WebRTC, sementara `chunk 2` sedang diproses di belakang.

## 2. Pemanfaatan `realtime_inference.py` dari MuseTalk

Berdasarkan dokumentasi dan *source code* MuseTalk v1.5 terbaru, mereka telah menyediakan skrip khusus bernama `realtime_inference.py`.
Skrip ini dirancang untuk membaca aliran audio (*audio stream*) secara terus-menerus dan memuntahkan *frame* video (*video frames*) secara *real-time* ke memori (bukan ke file `.mp4`).

**Cara Kerja Integrasi:**
1. Di `live_worker.py` (RunPod), kita tidak lagi memanggil `inference.py`. Kita akan menjalankan sebuah *server* WebSocket atau WebRTC yang terhubung dengan `realtime_inference.py`.
2. *Backend* (di komputer Anda) akan mengirim aliran audio (PCM/WAV stream) ke RunPod.
3. RunPod akan membalas dengan aliran *frame* video (RGB array) secara instan.
4. *Backend* meneruskan *frame* tersebut ke WebRTC (misalnya via *Mediasoup* atau *Pion*) agar bisa diputar di *frontend* tanpa *lag*.

## 3. Trik Ilusi (The "Filler" Strategy)

Sambil menunggu *chunk* pertama dirender (yang biasanya masih butuh waktu 1-3 detik), *frontend* tidak boleh diam (terlihat *lagging*). 

**Implementasi:**
1. Siapkan 5-10 video pendek statis (misal: Avatar mengangguk, mengelus dagu, atau tersenyum sambil berkata *"Hmm..."* atau *"Bentar ya kak..."*).
2. Begitu komentar masuk, *frontend* langsung memutar salah satu video *filler* secara acak.
3. Proses ini "membeli waktu" 3-5 detik secara gratis. 
4. Saat video *filler* selesai diputar, *frame* pertama dari MuseTalk sudah matang dan langsung disambung secara *seamless* (tanpa putus).

## 4. Mengganti Edge-TTS dengan Streaming TTS (Opsional namun Sangat Disarankan)

Edge-TTS sangat bagus karena gratis, namun latensinya masih di kisaran 1-2 detik.
Untuk performa *enterprise*, disarankan menggunakan TTS yang mendukung *Websocket Streaming* (seperti **ElevenLabs** atau **OpenAI TTS via websocket**).
Dengan Streaming TTS, audio pertama bisa turun dalam waktu **~200ms**, sehingga MuseTalk bisa langsung bekerja hampir seketika.
