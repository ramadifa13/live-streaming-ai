import type { NextConfig } from "next";
import path from "path";
import { env } from "./src/env";

// Backend URL: reads from validated env
const BACKEND_URL = env.NEXT_PUBLIC_BACKEND_URL;

// AI Worker URL: reads from validated env
const WORKER_URL = env.AVATAR_WORKER_URL;

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-**",
      },
      {
        protocol: "https",
        hostname: "**.runpod.net",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.shopee.co.id",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.tiktok.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.tokopedia.net",
        pathname: "/**",
      },
    ],
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
