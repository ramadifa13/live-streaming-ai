import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBackgroundInput, resolveMediaAsDataUrl } from "./runpod-bridge.js";

test("normalizeBackgroundInput preserves the exact cropped custom background data URL", () => {
  const original = "  data:image/jpeg;base64,abc123crop  ";
  assert.equal(normalizeBackgroundInput(original), "data:image/jpeg;base64,abc123crop");
});

test("normalizeBackgroundInput keeps remote URLs and falls back to local default only when empty", () => {
  const remote = "https://cdn.example.com/bg.jpg";
  assert.equal(normalizeBackgroundInput(remote), "https://cdn.example.com/bg.jpg");

  const fallback = normalizeBackgroundInput(undefined, "/banner_studio_live_streaming.jpg");
  assert.ok(fallback && fallback.startsWith("data:image/"));
  assert.match(fallback, /^data:image\/(png|jpeg|webp);base64,/i);
});

test("resolveMediaAsDataUrl prefers the exact custom crop over the default background fallback", () => {
  const customBg = "data:image/png;base64,customCropData";
  assert.equal(resolveMediaAsDataUrl(customBg, "/banner_studio_live_streaming.jpg"), customBg);
});
