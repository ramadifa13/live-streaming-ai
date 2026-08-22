const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * PM2 Ecosystem Config — LiveStreamerAI (RunPod All-in-One: Zero-Config)
 * Jalankan: pm2 start deploy/ecosystem.config.js
 */
module.exports = {
  apps: [
    // ── 1. AI Worker: SadTalker Lip-Sync + Edge-TTS (FastAPI :8000) ───────────
    {
      name: "ai-worker",
      script: "python3",
      args: "deploy/ai_stream_worker.py",
      cwd: ROOT_DIR,
      interpreter: "none",
      env: {
        PORT: "8000",
        PYTHONUNBUFFERED: "1",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ── 2. Backend: Fastify API (Node.js :4000) ──────────────────────────────
    {
      name: "backend",
      script: "npm",
      args: "run dev",
      cwd: path.join(ROOT_DIR, "backend"),
      interpreter: "none",
      env: {
        PORT: "4000",
        HOST: "0.0.0.0",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ── 3. Frontend: Next.js Studio (:3000) ──────────────────────────────────
    {
      name: "frontend",
      script: "npm",
      args: "run dev",
      cwd: path.join(ROOT_DIR, "frontend"),
      interpreter: "none",
      env: {
        PORT: "3000",
        HOST: "0.0.0.0",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
