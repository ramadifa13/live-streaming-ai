import type { NextConfig } from "next";
import path from "path";

// Backend URL: reads from .env (NEXT_PUBLIC_BACKEND_URL)
// - Local dev  : http://localhost:4000
// - RunPod prod: https://odmobbl78r5e79-4000.proxy.runpod.net
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

// AI Worker URL: reads from .env (AVATAR_WORKER_URL)
// - Local dev  : http://localhost:8000
// - RunPod prod: https://odmobbl78r5e79-8000.proxy.runpod.net
const WORKER_URL = process.env.AVATAR_WORKER_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  async rewrites() {
    return [
      {
        // Proxy semua /api/* ke backend Fastify
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        // Proxy /live_videos/* ke AI Worker (video MuseTalk hasil lip-sync)
        source: "/live_videos/:path*",
        destination: `${WORKER_URL}/output/:path*`,
      },
    ];
  },
};

export default nextConfig;
