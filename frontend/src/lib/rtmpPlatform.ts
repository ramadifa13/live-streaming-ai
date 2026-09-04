/** Mirror deploy/rtmp_utils.is_deferred_rtmp_ack — IG/FB butuh Siarkan dulu. */
export function isDeferredGoLivePlatform(platformName: string): boolean {
  const p = (platformName || "").toLowerCase();
  return (
    p.includes("instagram") ||
    p.includes("facebook") ||
    p.includes("fb ") ||
    p === "fb"
  );
}
