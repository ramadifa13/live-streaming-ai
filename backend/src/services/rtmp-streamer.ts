import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

let activeStreamProcess: ChildProcess | null = null;
let activeStreamConfig: {
  rtmpBaseUrl: string;
  streamKey: string;
  avatarImagePath?: string;
  avatarVideoPath?: string;
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

export async function startInstagramBroadcast(
  rtmpBaseUrl: string,
  streamKey: string,
  avatarImagePath?: string,
  avatarVideoPath?: string,
  productName?: string,
  productPrice?: string,
  productImageUrl?: string,
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
  const defaultVideo = path.resolve(
    publicRoot,
    "avatars/host_3d_dinamis_namira.mp4",
  );
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
  if (productName) console.log(`[RTMP Streamer] Product overlay: ${productName} - Rp${productPrice}`);

  activeStreamInfo = {
    rtmpUrl: fullTargetUrl,
    status: "connecting",
    paused: false,
    handshakeVerified: false,
    startedAt: new Date().toISOString(),
    error: null,
  };

  const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(mediaToUse);

  // Resolve product image path
  let productImagePath: string | undefined;
  if (productImageUrl) {
    if (productImageUrl.startsWith("http://") || productImageUrl.startsWith("https://")) {
      // Download remote image to temp file (simplified - use a local cache)
      productImagePath = undefined;
    } else {
      const resolved = resolvePublicAsset(productImageUrl);
      if (resolved && fs.existsSync(resolved)) {
        productImagePath = resolved;
      }
    }
  }

  // Build overlay filter for product info
  const fontFile = process.platform === "win32"
    ? "C\\\\:/Windows/Fonts/arial.ttf"
    : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

  const safeName = (productName || "").replace(/['\\]/g, "").substring(0, 25);
  const priceText = productPrice ? `Rp${Number(productPrice).toLocaleString("id-ID")}` : "";

  let videoFilter: string;

  if (productImagePath) {
    // With product image overlay
    videoFilter = [
      "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[bg]",
      "[1:v]scale=80:80[img]",
      "[bg][img]overlay=20:H-h-120[bgimg]",
      `[bgimg]drawtext=text='${safeName}':fontfile=${fontFile}:fontcolor=white:fontsize=28:box=1:boxcolor=black@0.7:boxborderw=6:x=110:y=H-h-90`,
      priceText ? `drawtext=text='${priceText}':fontfile=${fontFile}:fontcolor=yellow:fontsize=24:box=1:boxcolor=red@0.8:boxborderw=5:x=110:y=H-h-50` : "",
      `drawtext=text='Tanya DM!':fontfile=${fontFile}:fontcolor=white:fontsize=20:box=1:boxcolor=purple@0.8:boxborderw=5:x=20:y=H-h-20`,
    ].filter(Boolean).join(",");
  } else {
    // Text only overlay
    videoFilter = [
      "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
      safeName ? `drawtext=text='${safeName}':fontfile=${fontFile}:fontcolor=white:fontsize=36:box=1:boxcolor=black@0.5:boxborderw=8:x=20:y=H-th-80` : "",
      priceText ? `drawtext=text='${priceText}':fontfile=${fontFile}:fontcolor=yellow:fontsize=30:box=1:boxcolor=red@0.6:boxborderw=6:x=20:y=H-th-30` : "",
    ].filter(Boolean).join(",");
  }

  // Build FFmpeg args
  const videoInput = ["-re", ...(isVideo ? ["-stream_loop", "-1"] : ["-loop", "1"]), "-i", mediaToUse];
  if (productImagePath) {
    videoInput.push("-loop", "1", "-i", productImagePath);
  }

  // Keep the idle avatar moving when no AI response video is available.
  const ffmpegArgs = [
    ...videoInput,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-filter_complex", videoFilter,
    "-c:v", "libx264",
    "-preset", "veryfast",
    ...(isVideo ? [] : ["-tune", "stillimage"]),
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-pix_fmt", "yuv420p",
    "-g", "60",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-f", "flv",
    fullTargetUrl,
  ];
  try {
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
      if (msg.includes("error") || msg.includes("Error") || msg.includes("failed")) {
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
    activeStreamInfo.status = "idle";
    activeStreamInfo.handshakeVerified = false;
    activeStreamInfo.paused = false;
    activeStreamConfig = null;
    return { success: true, message: "Stream stopped" };
  }
  activeStreamConfig = null;
  return { success: false, message: "No active stream" };
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
  );
}

export function getStreamStatus() {
  return activeStreamInfo;
}
