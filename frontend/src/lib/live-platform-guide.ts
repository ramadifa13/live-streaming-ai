import type { PlatformKey } from "@/lib/brand-assets";

export interface GuideWebsite {
  url: string;
  label: string;
  buttonLabel: string;
}

export interface GuideClickStep {
  title: string;
  place: "platform" | "livio";
  website?: GuideWebsite;
  doThis: string[];
  youWillSee?: string;
}

export interface LivePlatformGuide {
  id: string;
  label: string;
  shortLabel: string;
  platformKey: PlatformKey | null;
  accent: string;
  accentSoft: string;
  intro: string;
  officialUrl: string;
  officialLabel: string;
  requirements: string[];
  steps: GuideClickStep[];
  warnings: string[];
}

export const LIVE_PLATFORM_GUIDES: LivePlatformGuide[] = [
  {
    id: "TikTok LIVE",
    label: "TikTok LIVE",
    shortLabel: "TikTok",
    platformKey: "TikTok",
    accent: "text-cyan-300",
    accentSoft: "bg-cyan-500/10 border-cyan-500/30",
    intro:
      "Livio butuh dua tulisan dari TikTok: alamat server siaran dan kode siaran. Kedua tulisan itu hanya muncul di komputer, lewat halaman Live Center. Jangan cari di aplikasi HP.",
    officialUrl: "https://www.tiktok.com/live/studio/help/article/Before-you-go-LIVE/Apply-for-LIVE-access",
    officialLabel: "Bantuan resmi TikTok LIVE Studio",
    requirements: [
      "Usia minimal 18 tahun.",
      "Akun sudah boleh LIVE. Di Indonesia biasanya sekitar 1.000 pengikut. TikTok bisa mengubah syarat ini per wilayah.",
      "Akun dalam kondisi baik dan tidak sedang dilarang siaran.",
      "Akun harus menampilkan tulisan Server URL dan Stream Key di Live Center. Tidak semua akun LIVE otomatis mendapat ini.",
      "Kerjakan di komputer atau laptop. Aplikasi TikTok di HP tidak menampilkan kode untuk Livio.",
    ],
    steps: [
      {
        title: "Buka situs TikTok di komputer",
        place: "platform",
        website: {
          url: "https://www.tiktok.com",
          label: "tiktok.com",
          buttonLabel: "Buka TikTok",
        },
        doThis: [
          "Di komputer, buka Google Chrome atau Microsoft Edge.",
          "Klik tombol di bawah, atau ketik tiktok.com di kotak alamat atas.",
          "Masuk dengan akun TikTok yang akan dipakai siaran.",
        ],
        youWillSee: "Halaman beranda TikTok. Di sisi kiri biasanya ada menu, termasuk tulisan Go LIVE.",
      },
      {
        title: "Masuk ke Live Center",
        place: "platform",
        website: {
          url: "https://livecenter.tiktok.com/producer",
          label: "livecenter.tiktok.com/producer",
          buttonLabel: "Buka Live Center",
        },
        doThis: [
          "Di sisi kiri layar, klik tulisan Go LIVE.",
          "Kalau tombol itu tidak ada, klik tombol Buka Live Center di bawah.",
          "Jika TikTok meminta, buka Your LIVE access lalu ajukan akses siaran dari komputer.",
        ],
        youWillSee: "Halaman Live Center / LIVE Producer. Ini masih persiapan, belum ditonton orang.",
      },
      {
        title: "Isi judul, lalu simpan sesi",
        place: "platform",
        doThis: [
          "Gulir ke bawah sampai ketemu tombol merah Go LIVE.",
          "Klik tombol merah itu.",
          "Isi judul siaran dan pilih kategori.",
          "Klik tombol merah Save & Go LIVE atau Simpan & Go LIVE.",
        ],
        youWillSee:
          "Dashboard siaran. Tenang: penonton belum masuk. TikTok baru membuat kode untuk sesi ini.",
      },
      {
        title: "Salin dua tulisan penting",
        place: "platform",
        doThis: [
          "Lihat bagian bawah halaman, atau bagian Stream Settings / Pengaturan siaran.",
          "Cari tulisan Server URL. Itu alamat server siaran. Klik Salin / Copy di sampingnya.",
          "Cari tulisan Stream Key. Itu kode siaran. Klik Salin / Copy di sampingnya.",
        ],
        youWillSee: "Dua kotak berisi tulisan panjang. Jangan diketik manual. Pakai tombol Salin.",
      },
      {
        title: "Tempel di Livio, lalu mulai",
        place: "livio",
        doThis: [
          "Kembali ke tab Livio. Jangan tutup tab TikTok.",
          "Tempel alamat server ke kolom Alamat server siaran. Caranya: klik kolom, lalu tekan Ctrl dan V bersama.",
          "Tempel kode ke kolom Kode siaran dengan cara yang sama.",
          "Klik Mulai Live Sekarang.",
        ],
        youWillSee: "Livio menyiapkan host AI, lalu mengirim gambar ke TikTok.",
      },
      {
        title: "Konfirmasi di TikTok jika diminta",
        place: "platform",
        doThis: [
          "Kembali ke tab TikTok yang masih terbuka.",
          "Tunggu sampai pratinjau host AI muncul.",
          "Jika TikTok menampilkan tombol Go LIVE, klik tombol itu supaya penonton bisa masuk.",
        ],
        youWillSee: "Siaran tampil di akun TikTok Anda. Biarkan tab TikTok tetap terbuka selama live.",
      },
    ],
    warnings: [
      "Kode TikTok sering hanya berlaku untuk sesi itu, dan bisa berubah setelah keluar akun. Kalau putus, buat sesi baru lalu tempel kode yang baru.",
      "Kalau Server URL atau Stream Key tidak muncul, akun belum punya akses siaran dari komputer.",
      "Jangan bagikan kode siaran ke orang lain. Siapa pun yang punya kode itu bisa siaran di akun Anda.",
    ],
  },
  {
    id: "Shopee Live",
    label: "Shopee Live",
    shortLabel: "Shopee",
    platformKey: "Shopee",
    accent: "text-orange-300",
    accentSoft: "bg-orange-500/10 border-orange-500/30",
    intro:
      "Live dari HP di aplikasi Shopee tidak memakai kode. Livio memakai jalur Siaran dari PC. Toko harus sudah disetujui Shopee untuk live dari komputer dulu.",
    officialUrl: "https://seller.shopee.co.id/edu/article/25704",
    officialLabel: "Panduan resmi Shopee: live dari komputer",
    requirements: [
      "Toko Shopee sudah terdaftar, punya produk aktif, dan tidak sedang dibatasi.",
      "Untuk live dari komputer, Shopee Indonesia mensyaratkan: toko aktif 30 hari terakhir; pernah live minimal 1 jam per sesi dalam 14 hari terakhir; tidak dibatasi; dan rata-rata minimal 25 pesanan per hari dari live dalam 30 hari terakhir.",
      "Setelah syarat terpenuhi, isi formulir Shopee Live PC Stream dari akun toko yang ingin dipakai. Formulir biasanya hanya bisa dibuka lewat HP.",
      "Pengajuan sampai Rabu pukul 23.59 WIB diproses Jumat di minggu yang sama. Pengajuan setelah itu diproses Jumat berikutnya.",
      "Cek hasil di pengumuman akses streaming di Seller Centre sebelum mencoba langkah di bawah.",
    ],
    steps: [
      {
        title: "Buka Pusat Penjual Shopee",
        place: "platform",
        website: {
          url: "https://seller.shopee.co.id",
          label: "seller.shopee.co.id",
          buttonLabel: "Buka Pusat Penjual",
        },
        doThis: [
          "Di komputer, buka Google Chrome atau Microsoft Edge.",
          "Klik tombol di bawah, atau ketik seller.shopee.co.id.",
          "Masuk dengan akun toko Shopee yang sudah punya akses live dari komputer.",
        ],
        youWillSee: "Halaman Pusat Penjual (Seller Centre) toko Anda.",
      },
      {
        title: "Buka menu Shopee Live",
        place: "platform",
        doThis: [
          "Di menu kiri atau atas, cari Promosi Saya atau Pusat Pemasaran.",
          "Klik Shopee Live.",
          "Klik Buat Siaran Langsung atau tombol serupa untuk membuat sesi baru.",
        ],
        youWillSee: "Halaman membuat siaran: judul, sampul, produk, dan pilihan sumber siaran.",
      },
      {
        title: "Pilih siaran dari komputer",
        place: "platform",
        doThis: [
          "Isi judul, foto sampul, dan produk yang ingin ditampilkan.",
          "Di bagian sumber siaran, pilih Siaran dari PC atau Siaran melalui komputer. Jangan pilih siaran dari HP.",
          "Kalau diminta, simpan atau buat sesi dulu.",
        ],
        youWillSee: "Shopee menampilkan Server URL dan Stream Key. Jangan tutup halaman ini.",
      },
      {
        title: "Salin dua tulisan penting",
        place: "platform",
        doThis: [
          "Cari tulisan Server URL. Itu alamat server siaran. Klik Salin di sampingnya.",
          "Cari tulisan Stream Key. Itu kode siaran. Klik Salin di sampingnya.",
        ],
        youWillSee: "Dua kotak berisi tulisan panjang. Jangan diketik satu per satu.",
      },
      {
        title: "Tempel di Livio, lalu mulai",
        place: "livio",
        doThis: [
          "Kembali ke tab Livio. Jangan tutup tab Shopee.",
          "Tempel alamat server ke kolom Alamat server siaran (klik kolom, lalu Ctrl + V).",
          "Tempel kode ke kolom Kode siaran.",
          "Klik Mulai Live Sekarang.",
        ],
        youWillSee: "Livio mengirim gambar ke Shopee. Penonton belum melihat siaran.",
      },
      {
        title: "Mulai siaran di Shopee",
        place: "platform",
        doThis: [
          "Kembali ke tab Pusat Penjual Shopee yang tadi dibuka.",
          "Tunggu pratinjau host AI muncul.",
          "Klik Mulai Siaran Langsung atau Go Live di halaman Shopee.",
        ],
        youWillSee: "Baru setelah tombol ini diklik, pembeli di Shopee bisa menonton.",
      },
    ],
    warnings: [
      "Toko baru biasanya belum bisa pakai Livio ke Shopee. Live dulu dari aplikasi HP sampai akses komputer disetujui.",
      "Shopee Indonesia secara resmi menyebut OBS Studio sebagai software komputer. Livio memakai dua kode yang sama setelah akses PC aktif.",
      "Kalau pilihan Siaran dari PC tidak muncul, akses komputer belum aktif.",
    ],
  },
  {
    id: "Instagram Live",
    label: "Instagram Live",
    shortLabel: "Instagram",
    platformKey: "Instagram",
    accent: "text-pink-300",
    accentSoft: "bg-pink-500/10 border-pink-500/30",
    intro:
      "Kode siaran Instagram hanya ada di situs instagram.com lewat komputer. Aplikasi HP tidak menampilkan kode ini. Akun harus Profesional (Bisnis atau Kreator).",
    officialUrl: "https://about.instagram.com/blog/tips-and-tricks/instagram-live-producer",
    officialLabel: "Penjelasan resmi Instagram Live Producer",
    requirements: [
      "Ubah akun menjadi Profesional: Bisnis atau Kreator. Akun pribadi tidak mendapat kode siaran.",
      "Masuk di komputer lewat instagram.com. Menu Live video tidak ada di aplikasi HP.",
      "Akun harus sudah boleh Instagram Live dan tidak sedang dibatasi.",
    ],
    steps: [
      {
        title: "Buka Instagram di komputer",
        place: "platform",
        website: {
          url: "https://www.instagram.com",
          label: "instagram.com",
          buttonLabel: "Buka Instagram",
        },
        doThis: [
          "Di komputer, buka Google Chrome atau Microsoft Edge.",
          "Klik tombol di bawah, atau ketik instagram.com.",
          "Masuk dengan akun Profesional yang akan dipakai siaran.",
        ],
        youWillSee: "Beranda Instagram versi komputer. Di sisi kiri ada menu, termasuk tombol Buat.",
      },
      {
        title: "Buat video live",
        place: "platform",
        doThis: [
          "Di sisi kiri, klik Buat. Ikonnya tanda plus (+).",
          "Pada menu yang muncul, klik Live video atau Live.",
        ],
        youWillSee: "Layar persiapan live. Instagram menyebut halaman ini Live Producer.",
      },
      {
        title: "Isi judul dan pilih penonton",
        place: "platform",
        doThis: [
          "Ketik judul siaran.",
          "Pilih penonton: Latihan / Practice tidak tampil ke pengikut. Publik / Public tampil seperti live biasa.",
          "Klik Next atau Lanjut.",
        ],
        youWillSee: "Halaman berisi Stream URL dan Stream Key. Jangan tutup jendela ini.",
      },
      {
        title: "Salin dua tulisan penting",
        place: "platform",
        doThis: [
          "Cari Stream URL. Itu alamat server siaran. Klik Salin / Copy.",
          "Cari Stream key. Itu kode siaran. Klik Salin / Copy.",
        ],
        youWillSee: "Dua kotak. Kode biasanya disembunyikan titik-titik. Tidak perlu dibuka, cukup disalin.",
      },
      {
        title: "Tempel di Livio, lalu mulai",
        place: "livio",
        doThis: [
          "Kembali ke tab Livio. Jangan tutup tab Instagram.",
          "Tempel alamat server ke kolom Alamat server siaran (klik kolom, lalu Ctrl + V).",
          "Tempel kode ke kolom Kode siaran.",
          "Klik Mulai Live Sekarang.",
        ],
        youWillSee: "Livio mengirim gambar ke Instagram. Pengikut belum melihat siaran.",
      },
      {
        title: "Klik Go live di Instagram",
        place: "platform",
        doThis: [
          "Kembali ke tab Instagram.",
          "Tunggu pratinjau host AI muncul.",
          "Setelah gambar terlihat, klik Go live di kanan atas.",
        ],
        youWillSee: "Baru setelah itu pengikut bisa masuk. Biarkan tab Instagram tetap terbuka.",
      },
    ],
    warnings: [
      "Kode Instagram selalu baru setiap sesi. Kalau putus atau tab ditutup, buat live baru lalu tempel kode yang baru.",
      "Jangan klik Go live di Instagram sebelum pratinjau dari Livio muncul.",
      "Setelah Livio terhubung, Instagram biasanya memberi waktu terbatas untuk menekan Go live.",
    ],
  },
  {
    id: "YouTube",
    label: "YouTube Live",
    shortLabel: "YouTube",
    platformKey: "YouTube",
    accent: "text-red-300",
    accentSoft: "bg-red-500/10 border-red-500/30",
    intro:
      "Livio memakai YouTube Studio di komputer, bukan tombol Live di aplikasi HP. Setelah kode ditempel dan Livio mulai, YouTube sering langsung menayangkan siaran.",
    officialUrl: "https://support.google.com/youtube/answer/2907883",
    officialLabel: "Bantuan resmi YouTube: siaran dari komputer",
    requirements: [
      "Usia minimal 16 tahun untuk siaran live.",
      "Nomor telepon channel sudah diverifikasi di YouTube Studio.",
      "Tidak ada pembatasan live dalam 90 hari terakhir.",
      "Fitur live sudah aktif. Aktivasi pertama bisa menunggu hingga 24 jam.",
      "Siaran dari komputer / Livio tidak mensyaratkan jumlah subscriber. Syarat 50 subscriber hanya untuk live dari aplikasi YouTube di HP.",
    ],
    steps: [
      {
        title: "Buka YouTube Studio",
        place: "platform",
        website: {
          url: "https://studio.youtube.com",
          label: "studio.youtube.com",
          buttonLabel: "Buka YouTube Studio",
        },
        doThis: [
          "Di komputer, buka Google Chrome atau Microsoft Edge.",
          "Klik tombol di bawah, atau ketik studio.youtube.com.",
          "Masuk dengan akun Google milik channel yang akan dipakai siaran.",
          "Pastikan foto profil di kanan atas adalah channel yang benar.",
        ],
        youWillSee: "Dasbor YouTube Studio.",
      },
      {
        title: "Buat siaran live",
        place: "platform",
        doThis: [
          "Di kanan atas, klik Buat atau CREATE. Ikonnya kamera plus.",
          "Klik Go live atau Mulai live.",
          "Jika ditanya kapan, pilih Sekarang / Now.",
          "Jika ditanya cara siaran, pilih Streaming software atau Perangkat lunak siaran. Jangan pilih Webcam.",
        ],
        youWillSee: "Ruang kendali live YouTube (Live Control Room).",
      },
      {
        title: "Buka tab Stream dan buat sesi",
        place: "platform",
        doThis: [
          "Klik tab Stream di kiri atau atas.",
          "Kalau ini pertama kali, isi judul lalu klik Create stream atau Buat stream.",
          "Kalau pernah live sebelumnya, pengaturan lama biasanya muncul sendiri.",
        ],
        youWillSee: "Kotak Stream URL dan Stream key di halaman Stream.",
      },
      {
        title: "Salin dua tulisan penting",
        place: "platform",
        doThis: [
          "Cari Stream URL. Itu alamat server siaran. Klik Salin / Copy.",
          "Cari Stream key. Itu kode siaran. Klik ikon mata jika ingin melihat, lalu klik Salin.",
        ],
        youWillSee: "Kode YouTube biasanya bisa dipakai ulang, kecuali Anda menekan Reset.",
      },
      {
        title: "Tempel di Livio, lalu mulai",
        place: "livio",
        doThis: [
          "Kembali ke tab Livio. Jangan tutup YouTube Studio.",
          "Tempel alamat server ke kolom Alamat server siaran (klik kolom, lalu Ctrl + V).",
          "Tempel kode ke kolom Kode siaran.",
          "Klik Mulai Live Sekarang.",
        ],
        youWillSee: "Livio mengirim gambar ke YouTube.",
      },
      {
        title: "Cek di YouTube Studio",
        place: "platform",
        doThis: [
          "Kembali ke YouTube Studio.",
          "Tunggu pratinjau muncul.",
          "Kalau YouTube sudah menayangkan sendiri, biarkan. Kalau ada tombol Go live, klik tombol itu.",
        ],
        youWillSee: "Siaran tampil di channel YouTube. Biarkan Studio tetap terbuka.",
      },
    ],
    warnings: [
      "Aktifkan fitur live sehari sebelumnya agar tidak terhenti di masa tunggu 24 jam.",
      "Kalau koneksi ditolak, buat stream baru atau tekan Reset di samping kode, lalu tempel kode yang baru.",
      "Jangan bagikan kode siaran. Siapa pun yang punya kode itu bisa siaran di channel Anda.",
    ],
  },
  {
    id: "Facebook Live",
    label: "Facebook Live",
    shortLabel: "Facebook",
    platformKey: "Facebook",
    accent: "text-blue-300",
    accentSoft: "bg-blue-500/10 border-blue-500/30",
    intro:
      "Livio memakai halaman Live Producer Facebook di komputer. Setelah gambar dari Livio muncul, Anda masih harus menekan Go Live Now di Facebook.",
    officialUrl: "https://www.facebook.com/help/755943624557739",
    officialLabel: "Bantuan resmi Facebook: live dari komputer",
    requirements: [
      "Akun Facebook berusia minimal 60 hari.",
      "Halaman Facebook atau profil Mode Profesional punya minimal 100 pengikut.",
      "Untuk live dari Halaman, Anda harus punya izin membuat konten di Halaman itu.",
    ],
    steps: [
      {
        title: "Buka halaman buat live Facebook",
        place: "platform",
        website: {
          url: "https://www.facebook.com/live/create",
          label: "facebook.com/live/create",
          buttonLabel: "Buka Facebook Live",
        },
        doThis: [
          "Di komputer, buka Google Chrome atau Microsoft Edge.",
          "Klik tombol di bawah, atau ketik facebook.com/live/create.",
          "Masuk dengan akun Facebook yang akan dipakai siaran.",
        ],
        youWillSee: "Halaman Live Producer Facebook.",
      },
      {
        title: "Pilih tempat siaran",
        place: "platform",
        doThis: [
          "Di menu kiri, klik Choose where to post atau Pilih tempat posting.",
          "Pilih Halaman toko atau profil profesional Anda.",
          "Klik Go live atau Mulai live.",
        ],
        youWillSee: "Pilihan sumber video.",
      },
      {
        title: "Pilih siaran dari komputer",
        place: "platform",
        doThis: [
          "Pada Select a video source atau Pilih sumber video, klik Streaming software atau Perangkat lunak siaran.",
          "Jangan pilih kamera HP atau webcam biasa.",
          "Isi judul dan deskripsi siaran jika diminta.",
        ],
        youWillSee: "Facebook menampilkan Server URL dan Stream key.",
      },
      {
        title: "Salin dua tulisan penting",
        place: "platform",
        doThis: [
          "Cari Server URL. Itu alamat server siaran. Klik Salin.",
          "Cari Stream key. Itu kode siaran. Klik Salin.",
          "Kalau ingin memakai kode yang sama lain kali, buka pengaturan lanjutan lalu aktifkan Persistent stream key atau Kode siaran tetap.",
        ],
        youWillSee: "Dua kotak. Pakai tombol Salin, jangan diketik manual.",
      },
      {
        title: "Tempel di Livio, lalu mulai",
        place: "livio",
        doThis: [
          "Kembali ke tab Livio. Jangan tutup tab Facebook.",
          "Tempel alamat server ke kolom Alamat server siaran (klik kolom, lalu Ctrl + V).",
          "Tempel kode ke kolom Kode siaran.",
          "Klik Mulai Live Sekarang.",
        ],
        youWillSee: "Livio mengirim gambar ke Facebook. Teman atau pengikut belum melihat siaran.",
      },
      {
        title: "Klik Go Live Now di Facebook",
        place: "platform",
        doThis: [
          "Kembali ke tab Facebook.",
          "Tunggu pratinjau host AI muncul.",
          "Klik Go Live Now atau Mulai Live Sekarang.",
        ],
        youWillSee: "Baru setelah itu siaran tampil ke penonton. Biarkan tab Facebook tetap terbuka.",
      },
    ],
    warnings: [
      "Kode sesi biasa hanya untuk siaran itu. Setelah Livio terhubung, Anda punya waktu terbatas untuk menekan Go Live Now.",
      "Kalau Facebook menampilkan alamat yang diawali rtmps://, salin yang itu.",
      "Jangan bagikan kode siaran ke orang lain.",
    ],
  },
  {
    id: "Custom RTMP",
    label: "Server siaran lain",
    shortLabel: "Lain",
    platformKey: null,
    accent: "text-slate-200",
    accentSoft: "bg-slate-500/10 border-slate-500/30",
    intro:
      "Pakai ini hanya jika platform Anda memberi dua tulisan: alamat server siaran dan kode siaran. Cari di pengaturan live atau encoder di dashboard platform itu.",
    officialUrl: "https://livio.id",
    officialLabel: "Bantuan Livio",
    requirements: [
      "Platform tujuan harus menampilkan alamat server (biasanya diawali rtmp:// atau rtmps://) dan kode siaran.",
      "Akun di platform itu sudah boleh siaran live.",
    ],
    steps: [
      {
        title: "Buka dashboard platform tujuan",
        place: "platform",
        doThis: [
          "Di komputer, buka situs resmi platform yang ingin dipakai.",
          "Masuk ke akun Anda.",
          "Cari menu Live, Siaran, Encoder, atau Siaran dari komputer.",
        ],
        youWillSee: "Halaman pengaturan siaran milik platform itu.",
      },
      {
        title: "Salin dua tulisan penting",
        place: "platform",
        doThis: [
          "Cari Server URL / Stream URL. Itu alamat server siaran. Klik Salin.",
          "Cari Stream Key. Itu kode siaran. Klik Salin.",
          "Jangan menambah atau memotong spasi.",
        ],
        youWillSee: "Dua kotak berisi tulisan panjang.",
      },
      {
        title: "Tempel di Livio, lalu mulai",
        place: "livio",
        doThis: [
          "Kembali ke tab Livio.",
          "Tempel alamat server ke kolom Alamat server siaran (klik kolom, lalu Ctrl + V).",
          "Tempel kode ke kolom Kode siaran.",
          "Klik Mulai Live Sekarang.",
        ],
        youWillSee: "Livio mengirim gambar ke platform tujuan.",
      },
      {
        title: "Mulai siaran di platform tujuan",
        place: "platform",
        doThis: [
          "Kembali ke tab platform tujuan.",
          "Kalau diminta, tekan Mulai / Go Live / Publikasikan setelah pratinjau muncul.",
        ],
        youWillSee: "Siaran tampil ke penonton jika platform itu meminta konfirmasi terakhir.",
      },
    ],
    warnings: [
      "Kalau gagal tersambung, minta kode baru dari platform tujuan lalu tempel ulang.",
      "Jangan mengubah atau memotong kode.",
    ],
  },
];

export function resolveLiveGuideId(platformName: string): string {
  const normalized = platformName.toLowerCase();
  if (normalized.includes("tiktok")) return "TikTok LIVE";
  if (normalized.includes("shopee")) return "Shopee Live";
  if (normalized.includes("instagram")) return "Instagram Live";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("facebook")) return "Facebook Live";
  if (normalized.includes("custom")) return "Custom RTMP";
  return "TikTok LIVE";
}
