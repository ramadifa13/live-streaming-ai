/** Normalisasi URL RTMP + stream key (selaras dengan frontend/src/utils/rtmp.ts). */

export function normalizeRtmpInput(rtmpUrl: string, streamKey: string) {
  let url = (rtmpUrl || "").trim();
  let key = (streamKey || "").replace(/[\r\n\s]/g, "");

  const splitFull = (full: string) => {
    const idx = full.toLowerCase().indexOf("/rtmp/");
    if (idx >= 0) {
      return {
        rtmpUrl: full.slice(0, idx + 6),
        streamKey: full.slice(idx + 6),
      };
    }
    const parts = full.split("/");
    if (parts.length >= 5) {
      return {
        rtmpUrl: parts.slice(0, -1).join("/"),
        streamKey: parts[parts.length - 1] || "",
      };
    }
    return { rtmpUrl: full, streamKey: "" };
  };

  if (/^rtmps?:\/\//i.test(key)) {
    const split = splitFull(key);
    url = split.rtmpUrl || url;
    key = split.streamKey || key;
  } else if (/^rtmps?:\/\//i.test(url)) {
    const afterApp = url.toLowerCase().includes("/rtmp/")
      ? url.slice(url.toLowerCase().indexOf("/rtmp/") + 6)
      : "";
    if (afterApp && !key) {
      const split = splitFull(url);
      url = split.rtmpUrl;
      key = split.streamKey;
    }
  }

  return { rtmpUrl: url, streamKey: key };
}

export function isValidRtmpUrl(url: string) {
  return /^rtmps?:\/\/.+/i.test((url || "").trim());
}

export function assertRtmpCredentials(rtmpUrl: string, streamKey: string) {
  const { rtmpUrl: url, streamKey: key } = normalizeRtmpInput(rtmpUrl, streamKey);
  if (!isValidRtmpUrl(url)) {
    throw new Error(
      "RTMP URL tidak valid. Contoh Instagram: rtmps://live-upload.instagram.com:443/rtmp/",
    );
  }
  if (!key) {
    throw new Error("Stream Key kosong — salin dari Instagram Producer / Live.");
  }
  return { rtmpUrl: url, streamKey: key };
}
