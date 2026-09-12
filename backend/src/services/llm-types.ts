import { z } from "zod";
import type { StreamPlan } from "./live-host-orchestrator.js";

export type HostMode = "ENGAGE" | "SELL" | "QNA" | "DEMO" | "OBJECTION" | "SOCIAL" | "ANNOUNCEMENT" | "RECOVERY" | "CLOSING";

export type HostIntent =
  | "ANSWER"
  | "PRODUCT_INFO"
  | "PRICE"
  | "BUYING_INTENT"
  | "OBJECTION"
  | "SOCIAL"
  | "THANKS"
  | "COMPLAINT"
  | "ANNOUNCEMENT"
  | "SELL"
  | "SPAM"
  | "OTHER";

export const LunaActionEnum = z.enum(["IDLE"]);
export type LunaAction = z.infer<typeof LunaActionEnum>;

export function normalizeLunaAction(_action: unknown): LunaAction {
  return "IDLE";
}

export const LunaEmotionEnum = z.enum(["happy", "neutral", "surprised", "thinking", "warm", "excited", "empathetic"]);
export type LunaEmotion = z.infer<typeof LunaEmotionEnum>;

export const HostModeEnum = z.enum(["ENGAGE", "SELL", "QNA", "DEMO", "OBJECTION", "SOCIAL", "ANNOUNCEMENT", "RECOVERY", "CLOSING"]);

export const HostIntentEnum = z.enum([
  "ANSWER",
  "PRODUCT_INFO",
  "PRICE",
  "BUYING_INTENT",
  "OBJECTION",
  "SOCIAL",
  "THANKS",
  "COMPLAINT",
  "ANNOUNCEMENT",
  "SELL",
  "SPAM",
  "OTHER",
]);

export const HostResponseSchema = z.object({
  speech: z.string().min(3),
  action: z.preprocess((v) => normalizeLunaAction(v), LunaActionEnum),
  emotion: LunaEmotionEnum,
  intent: HostIntentEnum,
  mode: HostModeEnum,
  topic: z.string().min(1).max(80),
  ctaType: z.enum(["NONE", "SOFT", "DIRECT", "PRICE", "PRODUCT", "COMMENT"]).default("NONE"),
  target_product_id: z.string().nullable().default(null),
  interruptible: z.boolean().default(true),
  claims: z.array(z.string()).default([]),
  behavior: z.string().optional(),
  semanticKey: z.string().optional(),
  salesRule: z.string().optional(),
  cycleId: z.number().optional(),
});
export type HostResponse = z.infer<typeof HostResponseSchema>;

export function inferCtaPointAction(_speech: string, _topic?: string): LunaAction {
  return "IDLE";
}

export type SpeechGestureSegment = { text: string; action: LunaAction };

export function splitSpeechIntoGestureSegments(speech: string, _action: unknown): SpeechGestureSegment[] {
  const clean = String(speech || "")
    .replace(/^\s*\[[A-Z_]+\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  return [{ text: clean, action: "IDLE" }];
}

export interface SalesBrainOutput {
  replyText: string;
  engineUsed: string;
  intent: string;
  action: string;
}

export interface SalesBrainInput {
  userQuestion: string;
  authorName?: string;
  avatarName?: string;
  tone?: string;
  productName?: string;
  productPrice?: string;
  productDescription?: string;
  productCategory?: string;
  productBenefits?: string;
  productUsage?: string;
  productFaq?: string;
  productStock?: number;
  allProducts?: Array<{
    id: string;
    name: string;
    price: string | number;
    category?: string;
    benefits?: string;
    description?: string;
  }>;
  recentUtterances?: string[];
  recentTopics?: string[];
  recentCTAs?: string[];
  recentClaims?: string[];
  avoidPhrases?: string[];
  avoidTopics?: string[];
  mode?: HostMode;
  elapsedMinutes?: number;
  requestedIntent?: HostIntent;
  requestedMode?: HostMode;
  audienceCount?: number;
  plan?: StreamPlan;
  sessionId?: string;
}

export interface LiveSalesPitchInput {
  productName: string;
  productPrice?: string;
  productCategory?: string;
  category?: string;
  productDescription?: string;
  productBenefits?: string;
  productUsage?: string;
  productFaq?: string;
  productStock?: number;
  avatarName?: string;
  tone?: string;
  allProducts?: Array<{
    id: string;
    name: string;
    price: string | number;
    category?: string;
    benefits?: string;
  }>;
}

export interface LiveSalesPitchOutput {
  productName: string;
  price: string;
  stock: number;
  category: string;
  avatarName: string;
  tone: string;
  hook: string;
  showcase: string;
  cta: string;
  fullScript: string;
}

export interface VideoSalesScriptInput {
  productName: string;
  productDescription?: string;
  productPrice?: string;
  productCategory?: string;
  durationType?: "15s" | "30s" | "60s";
  style?: string;
}
