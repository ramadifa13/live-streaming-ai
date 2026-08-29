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
    const tmpPath = path.join(process.cwd(), `tmp-product-${Date.now()}${ext}`);
    await fs.promises.writeFile(tmpPath, buffer);
    downloadedTempFiles.push(tmpPath);
    return tmpPath;
  } catch (err) {
    console.error("[RTMP Streamer] Error downloading product image:", err);
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
  let productImagePath: string | undefined;
  if (productImageUrl) {
    if (
      !productImageUrl.startsWith("http://") &&
      !productImageUrl.startsWith("https://")
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

  // ── Text values ───────────────────────────────────────────────────────────
  const safeName = escapeDrawtext((productName || "").substring(0, 22));
  const rawPrice =
    typeof productPrice === "string"
      ? parseInt(productPrice.replace(/[^0-9]/g, ""), 10) || 0
      : Number(productPrice) || 0;
  const priceText = rawPrice ? `Rp${rawPrice.toLocaleString("id-ID")}` : "";
  const safePriceText = escapeDrawtext(priceText);
  const safeStockText = escapeDrawtext(`Sisa\\: ${stockCount ?? 0} pcs`);
  const safeCTA = escapeDrawtext(ctaLabel || "Beli");

  const { badge, badgeColor, ctaColor } = getPlatformStyle(platform || "");
  const safeBadge = escapeDrawtext(badge);

  // ── Canvas dimensions (9:16 portrait) ───────────────────────────────────
  const W = 720;
  const H = 1280;

  // Bottom panel geometry — modern card-style overlay with balanced margins
  const panelH = 186;
  const panelY = H - panelH - 6;
  const sideMargin = 18;
  const innerGap = 12;
  const cornerRadius = 12;

  // Product thumbnail with subtle border
  const thumbSize = 68;
  const thumbX = sideMargin + 4;
  const thumbY = panelY + 14;

  // Text x-position after thumbnail
  const textX = thumbX + thumbSize + innerGap;

  // Row positions inside the panel
  const badgeY = panelY + 12;
  const nameY = panelY + 44;
  const priceY = panelY + 72;

  // CTA button with balanced margins
  const ctaBtnW = 154;
  const ctaBtnH = 50;
  const ctaBtnX = W - ctaBtnW - sideMargin;
  const ctaBtnY = panelY + 34;

  // LIVE badge removed from RTMP overlay

  // ── Build filter_complex ─────────────────────────────────────────────────
  //
  // Strategy:
  //   1. Scale / crop avatar video to 720x1280
  //   2. Draw a bottom dark panel via drawbox (replaces CSS gradient)
  //   3. If product image is local: overlay thumbnail
  //   4. Draw all text overlays (platform badge, stock, name, price, CTA)
  //   5. Live status is shown in the frontend, not burned into the RTMP stream
  //
  // We build the chain as an array and join with `;` for filter_complex,
  // using named pads ([vN]) so each filter stage is legible.

  const videoScaleFilter = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[v0]`;

  // Modern card-style bottom panel with rounded corners, subtle border and shadow
  const panelFilter = [
    // Shadow below panel
    `[v0]drawbox=x=0:y=${panelY + 4}:w=${W}:h=${panelH}:color=0x000000@0.35:t=fill[v1]`,
    // Main panel body with side margins
    `[v1]drawbox=x=${sideMargin}:y=${panelY}:w=${W - sideMargin * 2}:h=${panelH}:color=0x0B0D1A@0.96:t=fill[v2]`,
    // Top highlight line
    `[v2]drawbox=x=${sideMargin}:y=${panelY}:w=${W - sideMargin * 2}:h=2:color=0xFFFFFF@0.15:t=fill[v3]`,
    // Rounded corners - top-left
    `[v3]drawbox=x=${sideMargin}:y=${panelY}:w=${cornerRadius}:h=${cornerRadius}:color=0x0B0D1A@0.96:t=fill[v4]`,
    // Rounded corners - top-right
    `[v4]drawbox=x=${W - sideMargin - cornerRadius}:y=${panelY}:w=${cornerRadius}:h=${cornerRadius}:color=0x0B0D1A@0.96:t=fill[v5]`,
    // Rounded corners - bottom-left
    `[v5]drawbox=x=${sideMargin}:y=${panelY + panelH - cornerRadius}:w=${cornerRadius}:h=${cornerRadius}:color=0x0B0D1A@0.96:t=fill[v6]`,
    // Rounded corners - bottom-right
    `[v6]drawbox=x=${W - sideMargin - cornerRadius}:y=${panelY + panelH - cornerRadius}:w=${cornerRadius}:h=${cornerRadius}:color=0x0B0D1A@0.96:t=fill[v7]`,
    // Subtle border around panel
    `[v7]drawbox=x=${sideMargin}:y=${panelY}:w=${W - sideMargin * 2}:h=${panelH}:color=0xFFFFFF@0.08:t=fill[v8]`,
  ].join(";");

  // Next pad index after panel
  let padIdx = 8;

  // Insert product thumbnail if we have a local file
  // (input [1:v] will be the thumbnail; we add it after the base video)
  let thumbFilter = "";
  let inputsBeforeAudio = [
    "-re",
    ...(isVideo ? ["-stream_loop", "-1"] : ["-loop", "1"]),
    "-i",
    mediaToUse,
  ];

  if (productImagePath) {
    inputsBeforeAudio = [
      ...inputsBeforeAudio,
      "-loop",
      "1",
      "-i",
      productImagePath,
    ];
    // Shadow + thumbnail overlay combined so they execute sequentially
    thumbFilter = `[v${padIdx}]drawbox=x=${thumbX + 3}:y=${thumbY + 3}:w=${thumbSize}:h=${thumbSize}:color=0x000000@0.5:t=fill[v${padIdx + 1}];[1:v]scale=${thumbSize}:${thumbSize}[thumb];[v${padIdx + 1}][thumb]overlay=x=${thumbX}:y=${thumbY}[v${padIdx + 2}]`;
    padIdx += 2;
  }

  // Build drawtext chain for text overlays
  // Each drawtext filter takes [vN] in and produces [vN+1]
  const textFilters: string[] = [];
  const addText = (opts: {
    text: string;
    x: number;
    y: number;
    size: number;
    color: string;
    bold?: boolean;
    box?: boolean;
    boxColor?: string;
    boxBorder?: number;
  }) => {
    const fontPath = opts.bold ? fontFileBold : fontFile;
    const boxPart = opts.box
      ? `:box=1:boxcolor=${opts.boxColor || "0x000000@0.6"}:boxborderw=${opts.boxBorder ?? 6}`
      : "";
    const filter = `[v${padIdx}]drawtext=text='${opts.text}':fontfile=${fontPath}:fontcolor=${opts.color}:fontsize=${opts.size}:x=${opts.x}:y=${opts.y}${boxPart}[v${padIdx + 1}]`;
    textFilters.push(filter);
    padIdx += 1;
  };

  // ── Platform badge (top-left of panel) ──────────────────────────────────
  if (safeBadge) {
    addText({
      text: safeBadge,
      x: thumbX,
      y: badgeY,
      size: 13,
      color: "white",
      bold: true,
      box: true,
      boxColor: `${badgeColor}@0.9`,
      boxBorder: 7,
    });
  }

  // ── Stock text (top-right of panel) ─────────────────────────────────────
  addText({
    text: safeStockText,
    x: W - sideMargin - 105,
    y: badgeY + 1,
    size: 12,
    color: "0xE2E8F0",
  });

  // ── Product name with subtle shadow for readability ──────────────────────
  if (safeName) {
    addText({
      text: safeName,
      x: textX + 1,
      y: nameY + 1,
      size: 16,
      color: "0x000000@0.5",
      bold: true,
    });
    addText({
      text: safeName,
      x: textX,
      y: nameY,
      size: 16,
      color: "white",
      bold: true,
    });
  }

  // ── Price ────────────────────────────────────────────────────────────────
  if (safePriceText) {
    addText({
      text: safePriceText,
      x: textX,
      y: priceY,
      size: 18,
      color: "0x34D399",
      bold: true,
    });
  }

  // ── CTA button with gradient-like shadow and modern styling ──────────────
  const addBox = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ) => {
    const filter = `[v${padIdx}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill[v${padIdx + 1}]`;
    textFilters.push(filter);
    padIdx += 1;
  };

  // Shadow beneath CTA
  addBox(ctaBtnX + 2, ctaBtnY + 2, ctaBtnW, ctaBtnH, "0x000000@0.4");
  // Main CTA button
  addBox(ctaBtnX, ctaBtnY, ctaBtnW, ctaBtnH, `${ctaColor}@0.95`);
  // Top highlight for 3D effect
  addBox(ctaBtnX, ctaBtnY, ctaBtnW, 3, "0xFFFFFF@0.2");
  addText({
    text: safeCTA,
    x: ctaBtnX + 18,
    y: ctaBtnY + 16,
    size: 16,
    color: "white",
    bold: true,
  });

  // ── LIVE badge removed from RTMP overlay ──────────────────────────────────
  // Live status is already shown in the frontend preview and control center.

  // ── Assemble filter_complex string ───────────────────────────────────────
  const filterChain = [
    videoScaleFilter,
    panelFilter,
    ...(thumbFilter ? [thumbFilter] : []),
    ...textFilters,
  ].join(";");

  // Final output pad is [vN] where N = padIdx (last text filter already bumped it)
  const finalPad = `[v${padIdx}]`;

  // ── Build FFmpeg args ─────────────────────────────────────────────────────
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
    `${productImagePath ? "2" : "1"}:a`, // audio from anullsrc

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
    config.platform,
    config.stockCount,
    config.ctaLabel,
  );
}

export function getStreamStatus() {
  return activeStreamInfo;
}
