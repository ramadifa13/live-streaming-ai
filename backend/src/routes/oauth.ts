import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";

interface PlatformOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  scopes: string[];
  rtmpIngestUrl: string;
}

const OAUTH_PLATFORM_CONFIGS: Record<string, () => PlatformOAuthConfig> = {
  tiktok: () => ({
    clientId: process.env.TIKTOK_CLIENT_ID || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    userInfoUrl: "https://open.tiktokapis.com/v2/user/info/",
    scopes: ["user.info.basic", "live.stream.create", "live.stream.manage"],
    rtmpIngestUrl: "rtmp://live.tiktok.com/live/",
  }),
  shopee: () => ({
    clientId: process.env.SHOPEE_APP_ID || "",
    clientSecret: process.env.SHOPEE_SECRET || "",
    authorizationUrl: "https://partner.shopeemobile.com/api/v2/shop/auth_partner",
    tokenUrl: "https://partner.shopeemobile.com/api/v2/auth/token/get",
    userInfoUrl: "https://partner.shopeemobile.com/api/v2/shop/get_shop_info",
    scopes: ["partner.shop.read_write"],
    rtmpIngestUrl: "rtmp://live.shopee.co.id/live/",
  }),
  youtube: () => ({
    clientId: process.env.YOUTUBE_CLIENT_ID || "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    scopes: ["https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"],
    rtmpIngestUrl: "rtmp://a.rtmp.youtube.com/live2",
  }),
  instagram: () => ({
    clientId: process.env.INSTAGRAM_APP_ID || "",
    clientSecret: process.env.INSTAGRAM_APP_SECRET || "",
    authorizationUrl: "https://api.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    userInfoUrl: "https://graph.instagram.com/me",
    scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments"],
    rtmpIngestUrl: "rtmps://live-upload.instagram.com:443/rtmp/",
  }),
  facebook: () => ({
    clientId: process.env.FACEBOOK_APP_ID || "",
    clientSecret: process.env.FACEBOOK_APP_SECRET || "",
    authorizationUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    userInfoUrl: "https://graph.facebook.com/me",
    scopes: ["publish_video", "pages_read_engagement", "pages_manage_posts"],
    rtmpIngestUrl: "rtmps://live-api-s.facebook.com:443/rtmp/",
  }),
};

function getPlatformConfig(platform: string): PlatformOAuthConfig | null {
  const p = platform.toLowerCase();
  const matchedKey = Object.keys(OAUTH_PLATFORM_CONFIGS).find((key) => p.includes(key));
  return matchedKey ? OAUTH_PLATFORM_CONFIGS[matchedKey]() : null;
}

const pendingStates = new Map<string, { platform: string; codeVerifier: string; createdAt: number }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingStates.entries()) {
    if (val.createdAt < cutoff) pendingStates.delete(key);
  }
}, 10 * 60 * 1000);

interface OAuthSession {
  platform: string;
  isConnected: boolean;
  username: string;
  displayName: string;
  storeName: string;
  avatarUrl: string;
  followers: number;
  rating: number;
  status: "active" | "ready";
  ingestUrl: string;
  streamKey: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  connectedAt: string;
}

const sessionStore: Record<string, OAuthSession> = {};

function generateCodeVerifier(): string { return crypto.randomBytes(32).toString("base64url"); }
function generateCodeChallenge(v: string): string { return crypto.createHash("sha256").update(v).digest("base64url"); }
function generateState(): string { return crypto.randomBytes(16).toString("hex"); }

export async function oauthRoutes(server: FastifyInstance) {

  server.get("/api/oauth/accounts", async () => ({ success: true, data: sessionStore }));

  server.get<{ Params: { platform: string } }>("/api/oauth/profile/:platform", async (request) => {
    const rawPlatform = decodeURIComponent(request.params.platform);
    const matched = Object.keys(sessionStore).find((k) => k.toLowerCase() === rawPlatform.toLowerCase());
    if (matched && sessionStore[matched]) return { success: true, data: sessionStore[matched] };
    return { success: true, data: { platform: rawPlatform, isConnected: false, username: "", displayName: "", storeName: "", avatarUrl: "", followers: 0, rating: 0, status: "ready", ingestUrl: "", streamKey: "", connectedAt: "" } };
  });

  server.get<{ Querystring: { platform: string } }>("/api/oauth/authorize", async (request, reply) => {
    const { platform } = request.query;
    const config = getPlatformConfig(platform);
    if (!config) { reply.code(400); return { success: false, error: `Platform "${platform}" tidak didukung.` }; }
    if (!config.clientId) {
      const keyMap: Record<string, string> = { tiktok: "TIKTOK_CLIENT_ID", shopee: "SHOPEE_APP_ID", youtube: "YOUTUBE_CLIENT_ID", instagram: "INSTAGRAM_APP_ID", facebook: "FACEBOOK_APP_ID" };
      const key = Object.keys(keyMap).find((k) => platform.toLowerCase().includes(k));
      reply.code(503);
      return { success: false, error: `Client ID untuk ${platform} belum dikonfigurasi di .env`, missingEnvKey: key ? keyMap[key] : "OAUTH_CLIENT_ID" };
    }
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const redirectUri = `${process.env.BACKEND_PUBLIC_URL || "http://localhost:4000"}/api/oauth/callback`;
    pendingStates.set(state, { platform, codeVerifier, createdAt: Date.now() });
    const isShopee = platform.toLowerCase().includes("shopee");
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", scope: config.scopes.join(" "), state, ...(!isShopee ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}) });
    return { success: true, data: { authUrl: `${config.authorizationUrl}?${params.toString()}`, state } };
  });

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/oauth/callback", async (request, reply) => {
    const { code, state, error } = request.query;
    const frontendUrl = process.env.CORS_ORIGIN || "http://localhost:3000";
    if (error) return reply.redirect(`${frontendUrl}/dashboard?oauth_error=${encodeURIComponent(error)}`);
    if (!code || !state) return reply.redirect(`${frontendUrl}/dashboard?oauth_error=missing_params`);
    const pending = pendingStates.get(state);
    if (!pending) return reply.redirect(`${frontendUrl}/dashboard?oauth_error=invalid_state`);
    pendingStates.delete(state);
    const { platform, codeVerifier } = pending;
    const config = getPlatformConfig(platform);
    if (!config) return reply.redirect(`${frontendUrl}/dashboard?oauth_error=unknown_platform`);
    try {
      const redirectUri = `${process.env.BACKEND_PUBLIC_URL || "http://localhost:4000"}/api/oauth/callback`;
      const tokenRes = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: codeVerifier }).toString(),
      });
      if (!tokenRes.ok) { server.log.error(`[OAuth] Token exchange failed for ${platform}: ${await tokenRes.text()}`); return reply.redirect(`${frontendUrl}/dashboard?oauth_error=token_exchange_failed`); }
      const tokenData = await tokenRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      const accessToken = tokenData.access_token || "";
      const refreshToken = tokenData.refresh_token;
      const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : undefined;
      let username = "", displayName = "", avatarUrl = "";
      let followers = 0;
      if (config.userInfoUrl && accessToken) {
        try {
          const profileRes = await fetch(config.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (profileRes.ok) {
            const profile = await profileRes.json() as Record<string, unknown>;
            if (platform.toLowerCase().includes("tiktok")) {
              const u = ((profile.data as Record<string, unknown>)?.user || {}) as Record<string, unknown>;
              username = String(u.username || u.open_id || ""); displayName = String(u.display_name || ""); avatarUrl = String(u.avatar_url || ""); followers = Number(u.follower_count || 0);
            } else if (platform.toLowerCase().includes("youtube")) {
              username = String(profile.email || ""); displayName = String(profile.name || ""); avatarUrl = String(profile.picture || "");
            } else {
              username = String(profile.username || profile.login || profile.name || ""); displayName = String(profile.name || profile.username || ""); avatarUrl = String(profile.avatar_url || profile.profile_picture_url || "");
            }
          }
        } catch { /* profile fetch is optional */ }
      }
      const streamKey = `live_${platform.replace(/\s/g, "").toLowerCase()}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const session: OAuthSession = { platform, isConnected: true, username: username || `${platform.replace(/\s/g, "").toLowerCase()}_user`, displayName: displayName || `${platform} Account`, storeName: displayName || `${platform} Official Store`, avatarUrl, followers, rating: 0, status: "active", ingestUrl: config.rtmpIngestUrl, streamKey, accessToken, refreshToken, expiresAt, connectedAt: new Date().toISOString() };
      sessionStore[platform] = session;
      return reply.redirect(`${frontendUrl}/dashboard?oauth_success=${encodeURIComponent(platform)}&display=${encodeURIComponent(session.displayName)}`);
    } catch (err) {
      server.log.error(err, "[OAuth] Callback error");
      return reply.redirect(`${frontendUrl}/dashboard?oauth_error=server_error`);
    }
  });

  server.post("/api/oauth/connect", async (request, reply) => {
    const parsed = z.object({ platform: z.string().min(1), accessToken: z.string().optional(), username: z.string().optional(), displayName: z.string().optional(), storeName: z.string().optional(), avatarUrl: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.flatten() }; }
    const { platform, accessToken, username, displayName, storeName, avatarUrl } = parsed.data;
    const config = getPlatformConfig(platform);
    if (config && !config.clientId) server.log.warn(`[OAuth] ${platform}: OAuth env keys not configured — using manual connect.`);
    const streamKey = `live_${platform.replace(/\s/g, "").toLowerCase()}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const session: OAuthSession = { platform, isConnected: true, username: username || `${platform.toLowerCase().replace(/[^a-z0-9]/g, "")}_user`, displayName: displayName || `${platform} Official Store`, storeName: storeName || "Official Brand Store Indonesia", avatarUrl: avatarUrl || "", followers: 0, rating: 0, status: "active", ingestUrl: config?.rtmpIngestUrl || "rtmp://live.livestreamer.ai/live", streamKey, accessToken: accessToken || "", connectedAt: new Date().toISOString() };
    sessionStore[platform] = session;
    return { success: true, message: `Akun ${platform} berhasil terhubung!`, data: session };
  });

  server.post("/api/oauth/disconnect", async (request, reply) => {
    const parsed = z.object({ platform: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) { reply.code(400); return { error: parsed.error.flatten() }; }
    const { platform } = parsed.data;
    if (sessionStore[platform]) delete sessionStore[platform];
    return { success: true, message: `Koneksi akun ${platform} berhasil diputuskan.` };
  });

  server.get("/api/oauth/config-status", async () => {
    const platforms = [
      { name: "TikTok LIVE", envVars: ["TIKTOK_CLIENT_ID", "TIKTOK_CLIENT_SECRET"] },
      { name: "Shopee Live", envVars: ["SHOPEE_APP_ID", "SHOPEE_SECRET"] },
      { name: "YouTube Live", envVars: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"] },
      { name: "Instagram Live", envVars: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"] },
      { name: "Facebook Live", envVars: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"] },
    ];
    return { success: true, data: platforms.map((p) => ({ platform: p.name, configured: p.envVars.every((k) => !!process.env[k]), missingEnvVars: p.envVars.filter((k) => !process.env[k]), connected: !!(sessionStore[p.name]?.isConnected) })) };
  });
}
