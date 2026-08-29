import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { URL } from "url";

let activeStreamProcess: ChildProcess | null = null;
let activeStreamConfig: {
  rtmpBaseUrl: string;
  streamKey: string;
  avatarImagePath?: string;
  avatarVideoPath?: string;
  productName?: string;
  productPrice?: string;
  productImageUrl?: string;
  bannerImageUrl?: string;
  platform?: string;
  stockCount?: number;
  ctaLabel?: string;
} | null = null;
let activeStreamInfo: {
  rtmpUrl: string;
  status: "idle" | "connecting" | "streaming" | "error";
  paused: boolean;
  handshakeVerified: boolean;
  startedAt?: string;
  fps?: number;
  bitrate?: string;
  error?: string | null;
} = {
  rtmpUrl: "",
  status: "idle",
  paused: false,
  handshakeVerified: false,
  error: null,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Escape a string for use inside FFmpeg drawtext `text=` value.
 * FFmpeg drawtext uses : and ' as special chars; we also strip newlines.
 */
function escapeDrawtext(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Resolve a platform label, badge colour, and CTA button colour
 * to values we can embed in FFmpeg drawbox/drawtext.
 */
function getPlatformStyle(platform: string): {
  badge: string; // text shown in badge
  badgeColor: string; // hex colour for badge box (0xRRGGBB)
  ctaColor: string; // hex colour for CTA button box
} {
  switch (platform) {
    case "TikTok LIVE":
      return {
        badge: "Keranjang Kuning",
        badgeColor: "0xB8860B",
        ctaColor: "0xB8860B",
      };
    case "Shopee Live":
      return {
        badge: "Flash Sale",
        badgeColor: "0xC0392B",
        ctaColor: "0xC0392B",
      };
    case "Instagram Live":
      return { badge: "IG Shop", badgeColor: "0x6A0DAD", ctaColor: "0x7B2FBE" };
    case "YouTube Live":
      return {
        badge: "YouTube Live",
        badgeColor: "0xCC0000",
        ctaColor: "0xCC0000",
      };
    case "Facebook Live":
      return {
        badge: "Facebook Live",
        badgeColor: "0x1877F2",
        ctaColor: "0x1877F2",
      };
    default:
      return {
        badge: "Toko Live",
        badgeColor: "0x1A56DB",
        ctaColor: "0x1A56DB",
      };
  }
}

const downloadedTempFiles: string[] = [];

async function downloadImageToTemp(
  imageUrl: string,
): Promise<string | undefined> {
  try {
    if (imageUrl.startsWith("data:image/")) {
      const ext = imageUrl.startsWith("data:image/png") ? ".png" : ".jpg";
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const tmpPath = path.join(process.cwd(), `tmp-img-${Date.now()}${ext}`);
      await fs.promises.writeFile(tmpPath, buffer);
      downloadedTempFiles.push(tmpPath);
      return tmpPath;
    }
    const res = await fetch(imageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(
        `[RTMP Streamer] Failed to download image: ${res.status} ${imageUrl}`,
      );
      return undefined;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
    const tmpPath = path.join(process.cwd(), `tmp-img-${Date.now()}${ext}`);
    await fs.promises.writeFile(tmpPath, buffer);
    downloadedTempFiles.push(tmpPath);
    return tmpPath;
  } catch (err) {
    console.error("[RTMP Streamer] Error downloading image:", err);
    return undefined;
  }
}

function cleanupTempFiles() {
  for (const file of downloadedTempFiles) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
  downloadedTempFiles.length = 0;
}

export async function startInstagramBroadcast(
  rtmpBaseUrl: string,
  streamKey: string,
  avatarImagePath?: string,
  avatarVideoPath?: string,
  productName?: string,
  productPrice?: string,
  productImageUrl?: string,
  bannerImageUrl?: string,
  platform?: string,
  stockCount?: number,
  ctaLabel?: string,
) {
  stopBroadcast();
  activeStreamConfig = {
    rtmpBaseUrl,
    streamKey,
    avatarImagePath,
    avatarVideoPath,
    productName,
    productPrice,
    productImageUrl,
    bannerImageUrl,
    platform,
    stockCount,
    ctaLabel,
  };

  const normalizedBaseUrl = rtmpBaseUrl.replace(/\/+$/, "");
  const fullTargetUrl = normalizedBaseUrl.endsWith(`/${streamKey}`)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/${streamKey}`;

  const publicRoot = path.resolve(process.cwd(), "../frontend/public");
  const resolvePublicAsset = (assetPath: string | undefined) => {
    if (
      !assetPath ||
      assetPath.startsWith("http://") ||
      assetPath.startsWith("https://")
    )
      return undefined;
    const relativePath = assetPath.replace(/^[/\\]+/, "");
    return path.resolve(publicRoot, relativePath);
  };
  const defaultVideo = path.resolve(publicRoot, "avatars/namira_idle.mp4");
  const mediaToUse =
    resolvePublicAsset(avatarVideoPath) ||
    resolvePublicAsset(avatarImagePath) ||
    defaultVideo;

  if (!fs.existsSync(mediaToUse)) {
    activeStreamInfo = {
      rtmpUrl: fullTargetUrl,
      status: "error",
      paused: false,
      handshakeVerified: false,
      error: `Media avatar tidak ditemukan: ${mediaToUse}`,
    };
    return {
      success: false,
      status: "error",
      handshakeVerified: false,
      error: activeStreamInfo.error,
    };
  }

  console.log(
    `[RTMP Streamer] Starting Live Stream to: ${fullTargetUrl.substring(0, 50)}...`,
  );
  console.log(`[RTMP Streamer] Using presenter media: ${mediaToUse}`);
  if (productName)
    console.log(
      `[RTMP Streamer] Product: ${productName} — Rp${productPrice} | Platform: ${platform || "default"}`,
    );

  activeStreamInfo = {
    rtmpUrl: fullTargetUrl,
    status: "connecting",
    paused: false,
    handshakeVerified: false,
    startedAt: new Date().toISOString(),
    error: null,
  };

  const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(mediaToUse);

  // Resolve product image — supports remote URLs by downloading to temp file
  // Resolve product image and banner image — supports remote URLs and base64
  let productImagePath: string | undefined;
  if (productImageUrl) {
    if (
      !productImageUrl.startsWith("http://") &&
      !productImageUrl.startsWith("https://") &&
      !productImageUrl.startsWith("data:image/")
    ) {
      const resolved = resolvePublicAsset(productImageUrl);
      if (resolved && fs.existsSync(resolved)) {
        productImagePath = resolved;
      }
    } else {
      const downloaded = await downloadImageToTemp(productImageUrl);
      if (downloaded) {
        productImagePath = downloaded;
      }
    }
  }

  let bannerImagePath: string | undefined;
  if (bannerImageUrl) {
    if (
      !bannerImageUrl.startsWith("http://") &&
      !bannerImageUrl.startsWith("https://") &&
      !bannerImageUrl.startsWith("data:image/")
    ) {
      const resolved = resolvePublicAsset(bannerImageUrl);
      if (resolved && fs.existsSync(resolved)) {
        bannerImagePath = resolved;
      }
    } else {
      const downloaded = await downloadImageToTemp(bannerImageUrl);
      if (downloaded) {
        bannerImagePath = downloaded;
      }
    }
  }

  // ── Font path ─────────────────────────────────────────────────────────────
  // FFmpeg on Windows needs escaped colon in drive letter
  const fontFile =
    process.platform === "win32"
      ? "C\\\\:/Windows/Fonts/arial.ttf"
      : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

  const fontFileBold =
    process.platform === "win32"
      ? "C\\\\:/Windows/Fonts/arialbd.ttf"
      : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

  // ── Text values & Auto Strikethrough Price ────────────────────────────────
  const safeName = escapeDrawtext((productName || "").substring(0, 24));
  const rawPrice =
    typeof productPrice === "string"
      ? parseInt(productPrice.replace(/[^0-9]/g, ""), 10) || 0
      : Number(productPrice) || 0;
  const priceText = rawPrice ? `Rp${rawPrice.toLocaleString("id-ID")}` : "";
  const safePriceText = escapeDrawtext(priceText);

  // Auto Strikethrough Price: ~35% higher rounded to nearest thousand
  const autoOriginalPrice =
    rawPrice > 0 ? Math.ceil((rawPrice * 1.35) / 5000) * 5000 : 0;
  const strikeText =
    autoOriginalPrice > 0
      ? `Rp${autoOriginalPrice.toLocaleString("id-ID")}`
      : "";
  const safeStrikeText = escapeDrawtext(strikeText);

  // ── Canvas dimensions (9:16 portrait) ───────────────────────────────────
  const W = 720;
  const H = 1280;

  // Ultra-Modern Floating Pill Card (Universal Safe Area 220px di atas komentar)
  const cardW = 630;
  const cardH = 136;
  const cardX = Math.round((W - cardW) / 2);
  const cardY = H - cardH - 220;
  const thumbSize = 104;
  const thumbX = cardX + 16;
  const thumbY = cardY + 16;
  const textX = thumbX + thumbSize + 18;

  // ── Build filter_complex ─────────────────────────────────────────────────
  const videoScaleFilter = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[v0]`;

  let padIdx = 0;
  const filterStages: string[] = [videoScaleFilter];

  let nextInputIdx = 1;
  const inputsBeforeAudio = [
    "-re",
    ...(isVideo ? ["-stream_loop", "-1"] : ["-loop", "1"]),
    "-i",
    mediaToUse,
  ];

  // 1. Top Center Banner Overlay (Universal Safe Area: y=85px)
  if (bannerImagePath) {
    inputsBeforeAudio.push("-loop", "1", "-i", bannerImagePath);
    const bannerInputPad = nextInputIdx++;
    filterStages.push(
      `[v${padIdx}]drawbox=x=106:y=85:w=508:h=120:color=0x000000@0.35:t=fill[v${padIdx + 1}]`,
      `[${bannerInputPad}:v]scale=500:115:force_original_aspect_ratio=decrease[banner]`,
      `[v${padIdx + 1}][banner]overlay=x=(W-w)/2:y=85[v${padIdx + 2}]`,
    );
    padIdx += 2;
  }

  // 2. Bottom Ultra-Modern Floating White Card (Shadow + Body + Top Highlight + Border)
  filterStages.push(
    `[v${padIdx}]drawbox=x=${cardX + 4}:y=${cardY + 6}:w=${cardW}:h=${cardH}:color=0x000000@0.32:t=fill[v${padIdx + 1}]`,
    `[v${padIdx + 1}]drawbox=x=${cardX}:y=${cardY}:w=${cardW}:h=${cardH}:color=0xFFFFFF@0.98:t=fill[v${padIdx + 2}]`,
    `[v${padIdx + 2}]drawbox=x=${cardX}:y=${cardY}:w=${cardW}:h=2:color=0xFFFFFF@0.7:t=fill[v${padIdx + 3}]`,
    `[v${padIdx + 3}]drawbox=x=${cardX}:y=${cardY}:w=${cardW}:h=${cardH}:color=0xE2E8F0@1:t=1[v${padIdx + 4}]`,
  );
  padIdx += 4;

  // 3. Product Thumbnail
  if (productImagePath) {
    inputsBeforeAudio.push("-loop", "1", "-i", productImagePath);
    const thumbInputPad = nextInputIdx++;
    filterStages.push(
      `[v${padIdx}]drawbox=x=${thumbX - 1}:y=${thumbY - 1}:w=${thumbSize + 2}:h=${thumbSize + 2}:color=0xE2E8F0@1:t=fill[v${padIdx + 1}]`,
      `[${thumbInputPad}:v]scale=${thumbSize}:${thumbSize}[thumb]`,
      `[v${padIdx + 1}][thumb]overlay=x=${thumbX}:y=${thumbY}[v${padIdx + 2}]`,
    );
    padIdx += 2;
  }

  // 4. Product Name & Price
  if (safeName) {
    filterStages.push(
      `[v${padIdx}]drawtext=text='${safeName}':fontfile=${fontFileBold}:fontcolor=0x0F172A:fontsize=22:x=${textX}:y=${cardY + 34}[v${padIdx + 1}]`,
    );
    padIdx += 1;
  }

  if (safePriceText) {
    filterStages.push(
      `[v${padIdx}]drawtext=text='${safePriceText}':fontfile=${fontFileBold}:fontcolor=0xE11D48:fontsize=28:x=${textX}:y=${cardY + 76}[v${padIdx + 1}]`,
    );
    padIdx += 1;
  }

  // 5. Strikethrough Original Price
  if (safeStrikeText) {
    filterStages.push(
      `[v${padIdx}]drawtext=text='${safeStrikeText}':fontfile=${fontFile}:fontcolor=0x94A3B8:fontsize=18:x=${textX + 200}:y=${cardY + 84}[v${padIdx + 1}]`,
      `[v${padIdx + 1}]drawbox=x=${textX + 198}:y=${cardY + 93}:w=110:h=2:color=0x94A3B8@1:t=fill[v${padIdx + 2}]`,
    );
    padIdx += 2;
  }

  // ── Assemble filter_complex string ───────────────────────────────────────
  const filterChain = filterStages.join(";");
  const finalPad = `[v${padIdx}]`;

  // ── Build FFmpeg args ─────────────────────────────────────────────────────
  const anullsrcInputIdx = nextInputIdx;
  const ffmpegArgs = [
    ...inputsBeforeAudio,
    // Silent audio source
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",

    "-filter_complex",
    filterChain,
    "-map",
    finalPad,
    "-map",
    `${anullsrcInputIdx}:a`, // audio from anullsrc

    // Video encoding — dioptimasi untuk live streaming real-time
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast", // Encoding lebih cepat → latency lebih rendah untuk live
    "-tune",
    "zerolatency", // Meminimalkan latency buffer → cocok untuk RTMP live
    "-vsync",
    "cfr", // Constant frame rate → gerakan avatar konsisten 30fps
    "-b:v",
    "2500k",
    "-maxrate",
    "3000k",
    "-bufsize",
    "5000k", // 2× bitrate (standard) → buffer lebih kecil = latency lebih rendah & stabil
    "-pix_fmt",
    "yuv420p",
    "-g",
    "30", // Keyframe setiap 1 detik @30fps → recovery cepat jika ada packet loss
    "-sc_threshold",
    "0", // Disable scene change detection → keyframe interval konsisten
    "-r",
    "30",
    "-x264-params",
    "nal-hrd=cbr:force-cfr=1", // CBR ketat untuk koneksi RTMP yang stabil

    // Audio encoding
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",

    // Output
    "-f",
    "flv",
    fullTargetUrl,
  ];

  try {
    console.log("[RTMP Streamer] FFmpeg filter_complex:");
    console.log(
      filterChain.substring(0, 500) + (filterChain.length > 500 ? "..." : ""),
    );

    activeStreamProcess = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // FFmpeg can spawn successfully while the input or RTMP endpoint fails.
    // Progress plus a live process is the practical confirmation available from
    // the RTMP publisher without a platform-specific ingest API.

    activeStreamProcess.stdout?.on("data", (data) => {
      console.log(`[FFmpeg stdout]: ${data}`);
    });

    activeStreamProcess.stderr?.on("data", (data) => {
      const msg = data.toString();
      // Log all FFmpeg output for debugging
      if (
        msg.includes("error") ||
        msg.includes("Error") ||
        msg.includes("failed")
      ) {
        console.error(`[FFmpeg ERROR]: ${msg.trim()}`);
      }
      if (msg.includes("frame=") || msg.includes("fps=")) {
        activeStreamInfo.status = "streaming";
        activeStreamInfo.handshakeVerified = true;
        process.stdout.write(
          `\r[FFmpeg Streaming] ${msg.trim().split("\n")[0]}`,
        );
      }
    });

    activeStreamProcess.on("close", (code) => {
      console.log(`\n[RTMP Streamer] Process exited with code ${code}`);
      if (activeStreamInfo.paused) {
        activeStreamProcess = null;
        return;
      }
      if (activeStreamInfo.status === "connecting") {
        activeStreamInfo.status = "error";
        activeStreamInfo.error = `FFmpeg berhenti sebelum streaming dimulai (kode ${code ?? "unknown"}).`;
      } else {
        activeStreamInfo.status = "idle";
      }
      activeStreamInfo.handshakeVerified = false;
      activeStreamInfo.paused = false;
      activeStreamProcess = null;
      activeStreamConfig = null;
    });

    activeStreamProcess.on("error", (err) => {
      console.error("[RTMP Streamer] Error:", err);
      activeStreamInfo.status = "error";
      activeStreamInfo.handshakeVerified = false;
      activeStreamInfo.paused = false;
      activeStreamInfo.error = String(err.message || err);
    });

    const startedAt = Date.now();
    while (
      activeStreamInfo.status === "connecting" &&
      Date.now() - startedAt < 10000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (activeStreamInfo.status !== "streaming") {
      stopBroadcast();
      return {
        success: false,
        status: activeStreamInfo.status,
        handshakeVerified: false,
        error:
          activeStreamInfo.error || "RTMP belum terverifikasi dalam 10 detik.",
        target: fullTargetUrl,
      };
    }

    return {
      success: true,
      status: "streaming",
      handshakeVerified: true,
      message: "RTMP stream aktif.",
      target: fullTargetUrl,
    };
  } catch (err: any) {
    activeStreamInfo.status = "error";
    activeStreamInfo.handshakeVerified = false;
    activeStreamInfo.paused = false;
    activeStreamConfig = null;
    activeStreamInfo.error = String(err.message || err);
    return {
      success: false,
      status: "error",
      handshakeVerified: false,
      error: activeStreamInfo.error,
    };
  }
}

export function stopBroadcast() {
  if (activeStreamProcess) {
    try {
      activeStreamProcess.kill();
    } catch (e) {}
    activeStreamProcess = null;
  }
  activeStreamInfo.status = "idle";
  activeStreamInfo.handshakeVerified = false;
  activeStreamInfo.paused = false;
  activeStreamConfig = null;
  cleanupTempFiles();
  return { success: true, message: "Stream stopped" };
}

export function pauseBroadcast() {
  if (!activeStreamProcess || activeStreamInfo.status !== "streaming") {
    return {
      success: false,
      status: activeStreamInfo.status,
      message: "No active stream",
    };
  }

  try {
    if (process.platform === "win32") {
      activeStreamInfo.paused = true;
      activeStreamInfo.status = "connecting";
      activeStreamInfo.handshakeVerified = false;
      activeStreamProcess.kill();
    } else {
      process.kill(activeStreamProcess.pid!, "SIGSTOP");
      activeStreamInfo.status = "connecting";
      activeStreamInfo.paused = true;
      activeStreamInfo.handshakeVerified = false;
    }
    return { success: true, status: "paused", message: "RTMP stream paused" };
  } catch (error) {
    activeStreamInfo.error = String(error);
    return {
      success: false,
      status: activeStreamInfo.status,
      message: activeStreamInfo.error,
    };
  }
}

export async function resumeBroadcast() {
  if (!activeStreamInfo.paused || !activeStreamConfig) {
    return {
      success: false,
      status: activeStreamInfo.status,
      message: "No paused stream",
    };
  }

  if (process.platform !== "win32" && activeStreamProcess?.pid) {
    try {
      process.kill(activeStreamProcess.pid, "SIGCONT");
      activeStreamInfo.status = "streaming";
      activeStreamInfo.paused = false;
      activeStreamInfo.handshakeVerified = true;
      return {
        success: true,
        status: "streaming",
        message: "RTMP stream resumed",
      };
    } catch (error) {
      activeStreamInfo.error = String(error);
    }
  }

  const config = activeStreamConfig;
  activeStreamProcess = null;
  return startInstagramBroadcast(
    config.rtmpBaseUrl,
    config.streamKey,
    config.avatarImagePath,
    config.avatarVideoPath,
    config.productName,
    config.productPrice,
    config.productImageUrl,
    config.bannerImageUrl,
    config.platform,
    config.stockCount,
    config.ctaLabel,
  );
}

export function getStreamStatus() {
  return activeStreamInfo;
}
