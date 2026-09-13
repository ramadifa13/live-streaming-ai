import test from "node:test";
import assert from "node:assert/strict";
import { getPlanById, listPublicPlans } from "../config/plans.js";
import { isAllowedOrigin } from "../lib/cors.js";
import { consumeRateLimit } from "../lib/rate-limit.js";
import { signResumeCode, verifySignedResumeCode } from "../lib/order-ticket.js";
import {
  consumeReasonFromEndedReason,
  generateResumeCode,
  isReusableStatus,
  isStartableStatus,
  normalizeResumeCode,
  publicOrderMessage,
} from "./order-service.js";

test("resume codes are LIV- plus 8 unambiguous characters", () => {
  const code = generateResumeCode();
  assert.match(code, /^LIV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.notEqual(code, generateResumeCode());
});

test("normalize resume codes", () => {
  assert.equal(normalizeResumeCode(" liv-7k2m9q4x "), "LIV-7K2M9Q4X");
});

test("paid family can retry; consumed cannot", () => {
  assert.equal(isReusableStatus("paid"), true);
  assert.equal(isReusableStatus("preparing"), true);
  assert.equal(isReusableStatus("failed"), true);
  assert.equal(isReusableStatus("live"), false);
  assert.equal(isReusableStatus("consumed"), false);
  assert.equal(isStartableStatus("live"), true);
  assert.equal(isStartableStatus("consumed"), false);
});

test("stop reasons map to consume vs retry", () => {
  assert.equal(consumeReasonFromEndedReason("user_ended"), "user_ended");
  assert.equal(consumeReasonFromEndedReason("user_stop"), "user_ended");
  assert.equal(consumeReasonFromEndedReason("duration_expiry"), "duration_elapsed");
  assert.equal(consumeReasonFromEndedReason("prepare_failed"), null);
  assert.equal(consumeReasonFromEndedReason("pending_timeout"), null);
});

test("server catalog has the four pay-per-use plans", () => {
  const plans = listPublicPlans();
  assert.equal(plans.length, 4);
  assert.equal(getPlanById("trial-1h")?.amount, 59000);
  assert.equal(getPlanById("express-2h")?.hours, 2);
  assert.equal(getPlanById("shift-8h")?.amount, 299000);
  assert.equal(getPlanById("marathon-24h")?.hours, 24);
  assert.equal(getPlanById("unknown"), null);
});

test("consumed and live messages stay user-facing", () => {
  assert.match(publicOrderMessage("consumed", "user_ended"), /sudah diakhiri/i);
  assert.match(publicOrderMessage("consumed", "duration_elapsed"), /habis/i);
  assert.match(publicOrderMessage("live"), /masih berjalan/i);
});

test("signed resume cookie cannot be forged", () => {
  const code = "LIV-7K2M9Q4X";
  const signed = `${code}.${signResumeCode(code)}`;
  assert.equal(verifySignedResumeCode(signed), code);
  assert.equal(verifySignedResumeCode(`${code}.deadbeef`), null);
});

test("CORS allowlist accepts livio and localhost only", () => {
  const list = ["https://livio.id", "http://localhost:3000"];
  assert.equal(isAllowedOrigin(undefined, list), true);
  assert.equal(isAllowedOrigin("https://livio.id", list), true);
  assert.equal(isAllowedOrigin("https://evil.example", list), false);
});

test("rate limiter blocks after the window quota", () => {
  const key = `test-${Date.now()}`;
  assert.equal(consumeRateLimit(key, 2, 60_000).ok, true);
  assert.equal(consumeRateLimit(key, 2, 60_000).ok, true);
  assert.equal(consumeRateLimit(key, 2, 60_000).ok, false);
});
