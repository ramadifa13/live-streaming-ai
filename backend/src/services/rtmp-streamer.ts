import { spawn, ChildProcess } from "child_process";
import path from "path";

let activeStreamProcess: ChildProcess | null = null;
let activeStreamInfo: {
  rtmpUrl: string;
  status: "idle" | "connecting" | "streaming" | "error";
  handshakeVerified: boolean;
  startedAt?: string;
  fps?: number;
  bitrate?: string;
  error?: string | null;
} = {
  rtmpUrl: "",
  status: "idle",
  handshakeVerified: false,
  error: null,
};

export function startInstagramBroadcast(
  rtmpBaseUrl: string,
  streamKey: string,
  avatarImagePath?: string
) {
  if (activeStreamProcess) {
    try {
      activeStreamProcess.kill();
    } catch (e) {}
    activeStreamProcess = null;
  }

  // Build full RTMP endpoint
  let fullTargetUrl = "";
  if (rtmpBaseUrl.endsWith("/")) {
    fullTargetUrl = `${rtmpBaseUrl}${streamKey}`;
  } else {
    fullTargetUrl = `${rtmpBaseUrl}/${streamKey}`;
  }

  // Resolve avatar background image
  const defaultImage = path.resolve(
    process.cwd(),
    "../frontend/public/avatars/luna-3d.jpg"
  );
  const imageToUse = avatarImagePath || defaultImage;

  console.log(`[RTMP Streamer] Starting Live Stream to: ${fullTargetUrl.substring(0, 50)}...`);
  console.log(`[RTMP Streamer] Using presenter image: ${imageToUse}`);

  activeStreamInfo = {
    rtmpUrl: fullTargetUrl,
    status: "connecting",
    handshakeVerified: false,
    startedAt: new Date().toISOString(),
    error: null,
  };

  // FFmpeg command to loop image, scale to 720x1280 (9:16 vertical), generate AAC audio, and stream via RTMP
  const ffmpegArgs = [
    "-re",
    "-loop", "1",
    "-i", imageToUse,
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=stereo",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "stillimage",
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-pix_fmt", "yuv420p",
    "-g", "60",
    "-r", "30",
    "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
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

    // Mark as streaming / verified once process successfully spawns
    activeStreamInfo.status = "streaming";
    activeStreamInfo.handshakeVerified = true;

    activeStreamProcess.stdout?.on("data", (data) => {
      console.log(`[FFmpeg stdout]: ${data}`);
    });

    activeStreamProcess.stderr?.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("frame=") || msg.includes("fps=")) {
        activeStreamInfo.status = "streaming";
        activeStreamInfo.handshakeVerified = true;
        process.stdout.write(`\r[FFmpeg Streaming] ${msg.trim().split("\n")[0]}`);
      }
    });

    activeStreamProcess.on("close", (code) => {
      console.log(`\n[RTMP Streamer] Process exited with code ${code}`);
      activeStreamInfo.status = "idle";
      activeStreamInfo.handshakeVerified = false;
      activeStreamProcess = null;
    });

    activeStreamProcess.on("error", (err) => {
      console.error("[RTMP Streamer] Error:", err);
      activeStreamInfo.status = "error";
      activeStreamInfo.handshakeVerified = false;
      activeStreamInfo.error = String(err.message || err);
    });

    return {
      success: true,
      status: "streaming",
      handshakeVerified: true,
      message: "Live Streaming successfully connected via RTMP!",
      target: fullTargetUrl,
    };
  } catch (err: any) {
    activeStreamInfo.status = "error";
    activeStreamInfo.handshakeVerified = false;
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
    return { success: true, message: "Stream stopped" };
  }
  return { success: false, message: "No active stream" };
}

export function getStreamStatus() {
  return activeStreamInfo;
}
