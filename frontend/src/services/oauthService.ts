export interface ConnectedAccount {
  platform: string;
  isConnected: boolean;
  username: string;
  displayName: string;
  storeName: string;
  avatarUrl: string;
  followers: number;
  rating: number;
  status: string;
  ingestUrl?: string;
  streamKey?: string;
  accessToken?: string;
  liveChatId?: string;
  liveVideoId?: string;
}

export const oauthService = {
  async fetchConfigStatus(): Promise<Record<string, boolean>> {
    try {
      const res = await fetch("/api/oauth/config-status");
      const json = await res.json();
      if (json.data) {
        const map: Record<string, boolean> = {};
        (json.data as { platform: string; configured: boolean }[]).forEach(
          (p) => {
            map[p.platform] = p.configured;
          },
        );
        return map;
      }
    } catch {}
    return {};
  },

  async fetchProfile(platform: string): Promise<ConnectedAccount | null> {
    try {
      const res = await fetch(
        `/api/oauth/profile/${encodeURIComponent(platform)}`,
      );
      const json = await res.json();
      if (json.data && json.data.isConnected) {
        return json.data;
      }
    } catch {}
    return null;
  },

  async disconnect(platform: string): Promise<boolean> {
    try {
      const res = await fetch("/api/oauth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getAuthorizeUrl(platform: string): Promise<{ authUrl?: string; error?: string; missingEnvKey?: string }> {
    const res = await fetch(
      `/api/oauth/authorize?platform=${encodeURIComponent(platform)}`,
    );
    return await res.json();
  },
};
