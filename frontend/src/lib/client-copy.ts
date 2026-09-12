/** Kalimat yang boleh dilihat calon klien. Istilah teknis diseragamkan di sini. */

const PHRASES: Array<[RegExp, string]> = [
  [/mengalokasikan cloud gpu[^.!\n]*/i, "Menyiapkan studio AI…"],
  [/menghubungkan ke pod (statis|gpu)[^.!\n]*/i, "Menyiapkan studio AI…"],
  [/memuat pytorch[^.!\n]*/i, "Menyiapkan host AI…"],
  [/menghubungkan runpod[^.!\n]*/i, "Menyiapkan host AI…"],
  [/menunggu (worker|port)[^.!\n]*/i, "Menyiapkan host AI…"],
  [/pod running[^.!\n]*/i, "Host AI hampir siap…"],
  [/worker lokal siap[^.!\n]*/i, "Host AI siap."],
  [/gpu siap[^.!\n]*/i, "Host AI siap. Menyambungkan siaran…"],
  [/gpu tidak tersedia[^.!\n]*/i, "Kapasitas studio sedang penuh. Coba lagi nanti."],
  [/semua gpu[^.!\n]*penuh[^.!\n]*/i, "Kapasitas studio sedang penuh. Coba lagi nanti."],
  [/gagal (menyalakan|menghidupkan) (pod|gpu)[^.!\n]*/i, "Gagal menyiapkan host AI. Coba lagi."],
  [/gpu runpod gagal[^.!\n]*/i, "Gagal menyiapkan host AI. Coba lagi."],
  [/gpu runpod masih booting[^.!\n]*/i, "Host AI masih disiapkan. Tunggu sebentar, lalu coba lagi."],
  [/gpu masih booting[^.!\n]*/i, "Host AI masih disiapkan. Tunggu sebentar, lalu coba lagi."],
  [/pod gpu belum[^.!\n]*/i, "Host AI belum siap. Tunggu sebentar, lalu coba lagi."],
  [/ai worker[^.!\n]*(belum merespons|tidak merespons)[^.!\n]*/i, "Host AI belum merespons. Coba mulai siaran baru."],
  [/worker gpu[^.!\n]*/i, "Host AI tidak merespons. Bukan masalah kode siaran — tutup lalu mulai siaran baru."],
  [/broadcast worker[^.!\n]*/i, "Host AI belum siap. Tunggu sebentar, lalu coba lagi."],
  [/failed to update overlay/i, "Tampilan produk di siaran belum berubah. Coba ganti lagi."],
  [/overlay worker gagal[^.!\n]*/i, "Tampilan produk di siaran belum berubah. Coba lagi."],
  [/gpu pod (belum ter-terminate|gagal di-terminate)[^.!\n]*/i, "Siaran berakhir. Penutupan studio sedang diproses."],
  [/pod statis keep-warm[^.!\n]*/i, ""],
  [/cek runpod console[^.!\n]*/i, "Siaran berakhir. Penutupan studio sedang diproses."],
  [/deploy backend[^.!\n]*/i, "Server sibuk saat memulai siaran. Tunggu sebentar, lalu coba lagi."],
  [/timeout[^.!\n]*(rtmp|gpu|runpod|worker)[^.!\n]*/i, "Koneksi siaran timeout. Tunggu sebentar, lalu coba lagi."],
  [/server timeout saat memulai sesi[^.!\n]*/i, "Server sibuk saat memulai siaran. Tunggu sebentar, lalu coba lagi."],
  [/session tidak ditemukan/i, "Sesi siaran tidak ditemukan."],
  [/memulai broadcast rtmp[^.!\n]*/i, "Menyiapkan host AI…"],
  [/menghubungkan ke cloud gpu[^.!\n]*/i, "Menyiapkan studio AI…"],
  [/menyalakan mesin ai di cloud[^.!\n]*/i, "Menyiapkan host AI. Mohon tunggu."],
  [/menyiapkan wajah\s*&\s*gerak host[^.!\n]*/i, "Menyiapkan wajah dan gerak host. Pertama kali bisa 3–7 menit. Tetap di halaman ini."],
  [/menyiapkan buffer host\s*\((\d+)\/(\d+)[^)]*\)/i, "Menyiapkan sapaan host ($1/$2)"],
  [/host sedang live\s+buffer[^.!\n]*/i, "Host sedang live."],
  [/buat stream key baru[^.!\n]*/i, "Siaran gagal tersambung. Buat siaran baru di aplikasi live, lalu tempel kode siaran yang baru."],
  [/cek stream key[^.!\n]*/i, "Belum berhasil tersambung. Periksa kode siaran, lalu coba lagi."],
  [/rtmp url tidak valid[^.!\n]*/i, "Alamat server siaran tidak valid. Salin persis dari aplikasi live Anda."],
  [/rtmp url \/ stream key tidak valid/i, "Alamat server atau kode siaran tidak valid. Salin persis dari aplikasi live Anda."],
  [/stream key (kosong|sudah tidak valid)[^.!\n]*/i, "Kode siaran tidak valid. Buat siaran baru di aplikasi live, lalu tempel kode yang baru."],
  [/server rtmp menolak[^.!\n]*/i, "Platform menolak koneksi. Periksa alamat server dan kode siaran."],
  [/ffmpeg[^.!\n]*/i, "Siaran gagal disambungkan. Coba kode siaran baru."],
  [/pod gpu tidak bisa resolve[^.!\n]*/i, "Tidak bisa menghubungi platform live. Coba lagi beberapa saat."],
  [/client id[^.!\n]*\.env[^.!\n]*/i, "Koneksi akun belum tersedia. Gunakan isi manual, atau hubungi tim Livio."],
  [/oauth belum dikonfigurasi[^.!\n]*/i, "Koneksi cepat belum tersedia. Gunakan isi manual."],
  [/gagal memuat status oauth[^.!\n]*/i, "Gagal memuat status koneksi akun."],
  [/gagal memuat status pipeline[^.!\n]*/i, "Gagal memuat status persiapan siaran."],
  [/gagal memuat metrics[^.!\n]*/i, "Gagal memuat statistik siaran."],
  [/tts synthesis failed/i, "Gagal menyiapkan suara host."],
  [/gagal sintesis pocket tts[^.!\n]*/i, "Gagal menyiapkan suara host."],
  [/pause stream gagal/i, "Gagal menjeda siaran."],
  [/resume stream gagal/i, "Gagal melanjutkan siaran."],
  [/ai worker (soft-paused|resumed)[^.!\n]*/i, "Status siaran diperbarui."],
  [/gagal broadcast stream/i, "Gagal memulai siaran."],
  [/cloud ai belum siap[^.!\n]*/i, "Host AI belum siap setelah menunggu lama. Coba lagi, atau pastikan internet stabil."],
];

const TOKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bOAuth(?:\s*2\.0)?\b/gi, "login akun"],
  [/\bRTMPS?:\/\/\S+/gi, "alamat server siaran"],
  [/\bRTMP(?:S)?(?:\s+URL)?\b/gi, "alamat server siaran"],
  [/\bstream\s*keys?\b/gi, "kode siaran"],
  [/\bMuseTalk\b/gi, "host AI"],
  [/\bPyTorch\b/gi, "host AI"],
  [/\bCUDA\b/gi, ""],
  [/\bRunPod\b/gi, "studio AI"],
  [/\bL40S\b/gi, ""],
  [/\bPocket TTS\b/gi, "suara host"],
  [/\bLLM\b/gi, "AI"],
  [/\bpipeline\b/gi, "persiapan siaran"],
  [/\boverlay\b/gi, "tampilan siaran"],
  [/\bbackend\b/gi, "server"],
  [/\bworker\b/gi, "host AI"],
  [/\bpod\b/gi, "studio"],
  [/\bGPU\b/gi, "studio AI"],
  [/\bHTTP\s*\d{3}\b/gi, ""],
  [/\b\.env\b/gi, "pengaturan akun"],
];

const LEAK =
  /\b(runpod|musetalk|pytorch|cuda|ffmpeg|oauth|rtmp|l40s|pocket tts|http\s*\d{3}|pod id|terminat|\.env|gpu_provider|network volume|port 8000)\b/i;

export function toClientCopy(input: unknown, fallback = "Terjadi gangguan. Coba lagi."): string {
  if (input == null) return fallback;
  if (typeof input === "object") {
    const rec = input as Record<string, unknown>;
    const nested = rec.error ?? rec.message ?? rec.stageText;
    if (nested != null && typeof nested !== "object") return toClientCopy(nested, fallback);
    return fallback;
  }

  let text = String(input).trim();
  if (!text) return fallback;

  for (const [pattern, replacement] of PHRASES) {
    const next = text.replace(pattern, replacement);
    if (next !== text) {
      const cleaned = next.replace(/\s{2,}/g, " ").trim();
      return cleaned || fallback;
    }
  }

  for (const [pattern, replacement] of TOKEN_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  if (!text) return fallback;
  if (LEAK.test(text)) {
    if (/penuh|kuota|capacity/i.test(text)) return "Kapasitas studio sedang penuh. Coba lagi nanti.";
    if (/timeout|belum siap|menunggu/i.test(text)) return "Masih disiapkan. Tunggu sebentar, lalu coba lagi.";
    if (/gagal|error|fail|tolak/i.test(text)) return fallback;
    return "Menyiapkan siaran…";
  }
  return text;
}
