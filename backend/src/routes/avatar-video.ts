import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateAvatarVideo,
  getVideoJob,
} from "../services/videoAvatarService.js";

const generateSchema = z.object({
  avatarImageUrl: z.string().min(1, "avatarImageUrl is required"),
  productImageUrl: z.string().url().optional(),
  scriptText: z.string().min(1),
  audioBase64: z.string().optional(),
  audioUrl: z.string().url().optional(),
  avatarName: z.string().default("Namira"),
  tone: z.string().optional().default("Persuasif"),
});

export async function avatarVideoRoutes(server: FastifyInstance) {
  /**
   * POST /api/avatar/generate-video
   * Starts an async AI video generation job.
   * Returns immediately with jobId; client polls for status.
   */
  server.post("/api/avatar/generate-video", async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { success: false, error: parsed.error.flatten() };
    }

    const job = await generateAvatarVideo(parsed.data);

    return {
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        provider: process.env.AVATAR_PROVIDER ?? "mock",
      },
    };
  });

  /**
   * GET /api/avatar/video-status/:jobId
   * Poll this endpoint every 1.5-2 seconds.
   * Returns current status, progress (0-100), stage label, and videoUrl when done.
   *
   * NOTE: When status === "done", use `proxyVideoUrl` for playback to avoid CORS issues.
   * If `proxyVideoUrl` is null, fall back to `videoUrl` directly.
   */
  server.get<{ Params: { jobId: string } }>(
    "/api/avatar/video-status/:jobId",
    async (request, reply) => {
      const { jobId } = request.params;
      const job = getVideoJob(jobId);

      if (!job) {
        reply.code(404);
        return { success: false, error: "Job not found" };
      }

      // Build a proxied URL for the frontend to use (avoids CORS on HeyGen/D-ID CDN)
      const proxyVideoUrl = job.videoUrl
        ? `/api/avatar/proxy-video?url=${encodeURIComponent(job.videoUrl)}`
        : null;
      const isExternalCdn = job.videoUrl && (job.videoUrl.includes("pexels.com") || job.videoUrl.includes("cloudfront") || job.videoUrl.includes("cloudinary"));
      const finalVideoUrl = isExternalCdn ? job.videoUrl : (proxyVideoUrl ?? job.videoUrl ?? null);

      return {
        success: true,
        data: {
          jobId: job.jobId,
          status: job.status,
          progress: job.progress,
          stage: job.stage,
          videoUrl: finalVideoUrl,
          rawVideoUrl: job.videoUrl ?? null,
          error: job.error ?? null,
        },
      };
    }
  );

  /**
   * GET /api/avatar/proxy-video?url=<encoded-video-url>
   * Backend proxy that fetches the video from the provider CDN and streams it
   * to the frontend as a binary Buffer — solving CORS and Fastify stream issues.
   */
  server.get<{ Querystring: { url: string } }>(
    "/api/avatar/proxy-video",
    async (request, reply) => {
      const { url } = request.query as { url: string };

      if (!url) {
        reply.code(400);
        return { error: "Missing url query param" };
      }

      let targetUrl: string;
      try {
        targetUrl = decodeURIComponent(url);
        new URL(targetUrl);
      } catch {
        reply.code(400);
        return { error: "Invalid URL" };
      }

      try {
        const upstream = await fetch(targetUrl);

        if (!upstream.ok) {
          reply.code(upstream.status);
          return { error: `Upstream returned ${upstream.status}` };
        }

        const contentType = upstream.headers.get("content-type") ?? "video/mp4";
        const arrayBuf = await upstream.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        reply.header("Content-Type", contentType);
        reply.header("Content-Length", String(buffer.length));
        reply.header("Accept-Ranges", "bytes");
        reply.header("Access-Control-Allow-Origin", "*");
        reply.header("Cache-Control", "public, max-age=3600");

        return reply.send(buffer);
      } catch (err) {
        reply.code(502);
        return { error: `Proxy fetch failed: ${String(err)}` };
      }
    }
  );
}
