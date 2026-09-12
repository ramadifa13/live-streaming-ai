import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/**
 * Provider-agnostic LLM transport.
 * Env (new → alias):
 *   LIVE_LLM_PROVIDER | LIVE_BRAIN_PROVIDER (gemini|groq|openrouter|auto)
 *   LIVE_LLM_BATCH_SIZE=30 | LIVE_SCRIPT_BANK_LLM_LINES
 *   LIVE_LLM_REFILL_AT=8
 *   GEMINI_MODEL=gemini-3.1-flash-lite
 *   OPENROUTER_API_KEY | OPEN_ROUTER_KEY
 *   OPENROUTER_MODEL | OPEN_ROUTER_MODEL (default google/gemma-4-26b-a4b:free)
 *   LIVE_LLM_BANK_MAX_TOKENS | LIVE_BRAIN_BANK_MAX_TOKENS
 *
 * API notes:
 * - Gemini: keep models.generateContent (JSON + thinkingLevel). Interactions API is for free-form chat.
 * - Groq: keep /chat/completions (json_object). Responses API tidak dipakai untuk bank JSON.
 * - OpenRouter: OpenAI-compatible /chat/completions (free models).
 */

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.LIVE_BRAIN_API_KEY || "";
export const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_KEY || process.env.OPEN_ROUTER_API_KEY || "";
export const SCRIPT_BANK_MIN_WORDS = Number(process.env.LIVE_SCRIPT_BANK_MIN_WORDS || 16);
export const SCRIPT_BANK_MAX_WORDS = Number(process.env.LIVE_SCRIPT_BANK_MAX_WORDS || 20);

const GEMINI_MODEL_RAW = process.env.GEMINI_MODEL || process.env.LIVE_BRAIN_MODEL || "gemini-3.1-flash-lite";
const DEPRECATED_GEMINI_MODELS: Record<string, string> = {
  "gemini-3.7-flash": "gemini-3.6-flash",
  "gemini-2.5-flash": "gemini-3.6-flash",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-2.5-pro": "gemini-3.5-flash",
  "gemini-2.5-flash-preview-05-20": "gemini-3.6-flash",
  "gemini-2.5-flash-preview-09-25": "gemini-3.6-flash",
  "gemini-2.5-flash-lite-preview-09-2025": "gemini-3.5-flash-lite",
  "gemini-3-flash-preview": "gemini-3.6-flash",
  "gemini-1.5-flash": "gemini-3.6-flash",
  "gemini-1.5-flash-latest": "gemini-3.6-flash",
  "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
  "gemini-1.5-pro": "gemini-3.5-flash",
  "gemini-1.5-pro-latest": "gemini-3.5-flash",
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-pro": "gemini-3.6-flash",
  "gemini-1.0-pro": "gemini-3.6-flash",
};

// Lite first (quota), then newer Flash, then older Flash family.
const GEMINI_MODEL_FALLBACKS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
] as const;

function resolveGeminiModel(requested = GEMINI_MODEL_RAW): string {
  const normalized = requested.trim();
  return DEPRECATED_GEMINI_MODELS[normalized] || normalized;
}

const GEMINI_MODEL = resolveGeminiModel();

if (GEMINI_MODEL !== GEMINI_MODEL_RAW.trim()) {
  console.warn(`[LLM] GEMINI_MODEL "${GEMINI_MODEL_RAW}" sudah deprecated → memakai "${GEMINI_MODEL}"`);
}

const GROQ_MODEL_RAW = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const DEPRECATED_GROQ_MODELS: Record<string, string> = {
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama3-8b-8192": "openai/gpt-oss-20b",
  "gemma2-9b-it": "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama3-70b-8192": "openai/gpt-oss-120b",
  "llama-3.3-70b-specdec": "openai/gpt-oss-120b",
  "qwen/qwen3-32b": "qwen/qwen3.8-27b",
};

// gpt-oss still default; qwen as same-tier failover.
const GROQ_MODEL_FALLBACKS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b"] as const;

function resolveGroqModel(requested = GROQ_MODEL_RAW): string {
  const normalized = requested.trim();
  return DEPRECATED_GROQ_MODELS[normalized] || normalized;
}

const GROQ_MODEL = resolveGroqModel();

if (GROQ_MODEL !== GROQ_MODEL_RAW.trim()) {
  console.warn(`[LLM] GROQ_MODEL "${GROQ_MODEL_RAW}" sudah deprecated → memakai "${GROQ_MODEL}"`);
}

const GROQ_BASE_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const OPENROUTER_MODEL_RAW =
  process.env.OPENROUTER_MODEL || process.env.OPEN_ROUTER_MODEL || "google/gemma-4-26b-a4b:free";
const OPENROUTER_MODEL_FALLBACKS = [
  "google/gemma-4-26b-a4b:free",
  "google/gemma-4-31b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
] as const;

function resolveOpenRouterModel(requested = OPENROUTER_MODEL_RAW): string {
  return requested.trim() || "google/gemma-4-26b-a4b:free";
}

const OPENROUTER_MODEL = resolveOpenRouterModel();

export const CIRCUIT_BREAKER_MS = Number(process.env.LIVE_BRAIN_CIRCUIT_MS || 45_000);
const VALIDATION_RETRY_COOLDOWN_MS = Number(process.env.LIVE_BRAIN_RETRY_COOLDOWN_MS || 30_000);
const MAX_INFLIGHT = Math.max(1, Number(process.env.LIVE_BRAIN_MAX_INFLIGHT || 12));
export const BANK_MAX_TOKENS = Number(process.env.LIVE_LLM_BANK_MAX_TOKENS || process.env.LIVE_BRAIN_BANK_MAX_TOKENS || 8192);
export const PREP_LINE_TARGET = Number(process.env.LIVE_LLM_BATCH_SIZE || process.env.LIVE_SCRIPT_PREP_LINE_TARGET || 30);
export const PREP_EXTRA_PASS = process.env.LIVE_BRAIN_PREP_EXTRA_PASS !== "0";

let groqBlockedUntil = 0;
let geminiBlockedUntil = 0;
let openrouterBlockedUntil = 0;
let globalBrainBackoffUntil = 0;
const sessionBackoffUntil = new Map<string, number>();
export const lastValidationRetryAt = new Map<string, number>();
let geminiClient: GoogleGenAI | null = null;

class BrainSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  constructor(max: number) {
    this.available = max;
  }
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.available++;
  }
}

const brainSemaphore = new BrainSemaphore(MAX_INFLIGHT);

function liveBrainProvider(): string {
  const raw = (process.env.LIVE_LLM_PROVIDER || process.env.LIVE_BRAIN_PROVIDER || "auto").toLowerCase().trim();
  if (raw === "vllm" || raw === "local") return "ollama";
  if (raw === "open_router" || raw === "open-router") return "openrouter";
  return raw || "auto";
}

export function isSelfHostedBrain(): boolean {
  return false;
}

function groqAuthToken(): string {
  return GROQ_API_KEY || "";
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|resource_exhausted|quota|too many requests|503/i.test(msg);
}

function pruneBackoffMap(map: Map<string, number>): void {
  const now = Date.now();
  for (const [key, until] of map) {
    if (until <= now) map.delete(key);
  }
}

function tripCircuit(provider: "groq" | "gemini" | "openrouter", ms = CIRCUIT_BREAKER_MS, sessionId?: string): void {
  const duration = ms;
  const until = Date.now() + duration;

  if (sessionId) {
    const jitter = 400 + Math.floor(Math.random() * 2_400);
    sessionBackoffUntil.set(sessionId, Date.now() + duration + jitter);
  }

  if (provider === "groq") groqBlockedUntil = until;
  else if (provider === "openrouter") openrouterBlockedUntil = until;
  else geminiBlockedUntil = until;
  globalBrainBackoffUntil = Math.max(globalBrainBackoffUntil, until);
}

export function getBrainBackoffMs(sessionId?: string): number {
  pruneBackoffMap(sessionBackoffUntil);
  const sessionWait = sessionId ? Math.max(0, (sessionBackoffUntil.get(sessionId) || 0) - Date.now()) : 0;
  const globalWait = Math.max(0, globalBrainBackoffUntil - Date.now());
  return Math.max(sessionWait, globalWait);
}

export function canValidationRetry(sessionId?: string): boolean {
  const key = sessionId || "_global";
  return Date.now() - (lastValidationRetryAt.get(key) || 0) >= VALIDATION_RETRY_COOLDOWN_MS;
}

export interface BrainCallOptions {
  sessionId?: string;
  maxTokens?: number;
  groqOnly?: boolean;
}

function getGeminiClient(): GoogleGenAI {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY tidak tersedia");
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return geminiClient;
}

interface ProviderResult {
  text: string;
  provider: "gemini" | "groq" | "openrouter" | "fallback";
  model: string;
}

function isGemini3FamilyModel(model: string): boolean {
  return /^gemini-3(\.|$|-)/.test(model) || model === "gemini-flash-latest";
}

function buildGeminiGenerationConfig(model: string, maxOutputTokens?: number) {
  const config: {
    responseMimeType: string;
    maxOutputTokens: number;
    temperature?: number;
    thinkingConfig?: { thinkingLevel: ThinkingLevel };
  } = {
    responseMimeType: "application/json",
    maxOutputTokens: Math.max(256, Number(maxOutputTokens || process.env.LIVE_LLM_MAX_TOKENS || process.env.LIVE_BRAIN_MAX_TOKENS || 320)),
  };
  if (!isGemini3FamilyModel(model)) {
    config.temperature = Number(process.env.LIVE_LLM_TEMPERATURE || process.env.LIVE_BRAIN_TEMPERATURE || 0.85);
  }
  // Flash 3.x / lite: keep thinking minimal so bank JSON is not eaten by thinking tokens.
  if (isGemini3FamilyModel(model) || /flash-lite/i.test(model)) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return config;
}

async function callGeminiWithModel(prompt: string, model: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: buildGeminiGenerationConfig(model, options.maxTokens),
  });
  return {
    text: response.text || "",
    provider: "gemini",
    model,
  };
}

function geminiModelCandidates(): string[] {
  const primary = resolveGeminiModel();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [primary, ...GEMINI_MODEL_FALLBACKS]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function isGeminiModelNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|404|invalid.*model|model.*does not exist|is not supported|NOT_FOUND|no longer available|deprecated|shut down|shutdown|limiting access|not available for/i.test(
    msg,
  );
}

async function callGemini(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  if (Date.now() < geminiBlockedUntil) {
    throw new Error("Gemini circuit open — rate limit cooldown aktif");
  }
  if (getBrainBackoffMs(options.sessionId) > 0) {
    throw new Error("Session brain cooldown aktif");
  }

  const candidates = geminiModelCandidates();
  let lastError: Error | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]!;
    try {
      if (model !== GEMINI_MODEL_RAW.trim() && model !== resolveGeminiModel(GEMINI_MODEL_RAW)) {
        console.warn(`[LLM] Gemini mencoba model alternatif: ${model}`);
      }
      return await callGeminiWithModel(prompt, model, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRateLimitError(err)) {
        const canFailover = i < candidates.length - 1;
        if (canFailover) {
          console.warn(`[LLM] Gemini 429/quota on ${model}, failover model berikutnya...`);
          continue;
        }
        tripCircuit("gemini", CIRCUIT_BREAKER_MS, options.sessionId);
        throw lastError;
      }
      const canRetry = i < candidates.length - 1 && isGeminiModelNotFound(err);
      if (!canRetry) throw lastError;
      console.warn(`[LLM] Gemini model ${model} tidak tersedia, coba berikutnya...`);
    }
  }

  throw lastError || new Error("Gemini gagal — tidak ada model yang tersedia");
}

function groqModelCandidates(): string[] {
  const primary = resolveGroqModel();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [primary, ...GROQ_MODEL_FALLBACKS]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function isGroqModelNotFound(errBody: string): boolean {
  return /model_not_found|does not exist|decommissioned|deprecated/i.test(errBody);
}

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return undefined;
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  model: string,
  options: BrainCallOptions,
  label: "groq" | "openrouter",
  useJsonFormat = true,
): Promise<ProviderResult> {
  const maxTokens = options.maxTokens || Number(process.env.LIVE_LLM_MAX_TOKENS || process.env.LIVE_BRAIN_MAX_TOKENS || 320);
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: "Kembalikan JSON valid persis sesuai instruksi. Jangan menambahkan markdown.",
      },
      { role: "user", content: prompt },
    ],
    temperature: Number(process.env.LIVE_LLM_TEMPERATURE || process.env.LIVE_BRAIN_TEMPERATURE || 0.85),
    max_tokens: maxTokens,
  };
  if (useJsonFormat) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (label === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER || process.env.BACKEND_PUBLIC_URL || "http://localhost:4000";
    headers["X-Title"] = process.env.OPENROUTER_APP_TITLE || "LiveStreamingAI";
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    if (
      useJsonFormat &&
      (response.status === 400 || response.status === 422) &&
      /response_format|json_object|json schema|json_validate_failed/i.test(errBody)
    ) {
      return callOpenAiCompatible(baseUrl, apiKey, prompt, model, options, label, false);
    }
    if (response.status === 429 || response.status === 503) {
      tripCircuit(label, parseRetryAfterMs(response) || CIRCUIT_BREAKER_MS, options.sessionId);
    }
    throw new Error(`${label === "openrouter" ? "OpenRouter" : "Groq"} ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as any;
  return {
    text: data?.choices?.[0]?.message?.content || "",
    provider: label,
    model,
  };
}

async function callGroqWithModel(prompt: string, model: string, options: BrainCallOptions = {}, useJsonFormat = true): Promise<ProviderResult> {
  return callOpenAiCompatible(GROQ_BASE_URL, groqAuthToken(), prompt, model, options, "groq", useJsonFormat);
}

async function callGroq(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY tidak tersedia");
  }
  if (Date.now() < groqBlockedUntil) {
    throw new Error("Groq circuit open — rate limit cooldown aktif");
  }
  if (getBrainBackoffMs(options.sessionId) > 0) {
    throw new Error("Session brain cooldown aktif");
  }

  const candidates = groqModelCandidates();
  let lastError: Error | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]!;
    try {
      if (model !== GROQ_MODEL_RAW && model !== resolveGroqModel(GROQ_MODEL_RAW)) {
        console.warn(`[LLM] Groq mencoba model alternatif: ${model}`);
      }
      return await callGroqWithModel(prompt, model, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRateLimitError(err)) {
        const canFailover = i < candidates.length - 1;
        if (canFailover) {
          console.warn(`[LLM] Groq 429/quota on ${model}, failover model berikutnya...`);
          continue;
        }
        throw lastError;
      }
      const canRetry = i < candidates.length - 1 && isGroqModelNotFound(lastError.message);
      if (!canRetry) throw lastError;
      console.warn(`[LLM] Groq model ${model} tidak tersedia, coba berikutnya...`);
    }
  }

  throw lastError || new Error("Groq gagal — tidak ada model yang tersedia");
}

function openRouterModelCandidates(): string[] {
  const primary = resolveOpenRouterModel();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [primary, ...OPENROUTER_MODEL_FALLBACKS]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

async function callOpenRouter(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY / OPEN_ROUTER_KEY tidak tersedia");
  }
  if (Date.now() < openrouterBlockedUntil) {
    throw new Error("OpenRouter circuit open — rate limit cooldown aktif");
  }
  if (getBrainBackoffMs(options.sessionId) > 0) {
    throw new Error("Session brain cooldown aktif");
  }

  const candidates = openRouterModelCandidates();
  let lastError: Error | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]!;
    try {
      if (model !== OPENROUTER_MODEL) {
        console.warn(`[LLM] OpenRouter mencoba model alternatif: ${model}`);
      }
      return await callOpenAiCompatible(OPENROUTER_BASE_URL, OPENROUTER_API_KEY, prompt, model, options, "openrouter");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRateLimitError(err)) {
        const canFailover = i < candidates.length - 1;
        if (canFailover) {
          console.warn(`[LLM] OpenRouter 429/quota on ${model}, failover model berikutnya...`);
          continue;
        }
        throw lastError;
      }
      const canRetry = i < candidates.length - 1 && /not found|404|no endpoints|model/i.test(lastError.message);
      if (!canRetry) throw lastError;
      console.warn(`[LLM] OpenRouter model ${model} tidak tersedia, coba berikutnya...`);
    }
  }

  throw lastError || new Error("OpenRouter gagal — tidak ada model yang tersedia");
}

export async function callLlm(prompt: string, options: BrainCallOptions = {}): Promise<ProviderResult> {
  await brainSemaphore.acquire();
  try {
    const provider = liveBrainProvider();

    if (provider === "gemini") return callGemini(prompt, options);
    if (provider === "groq") return callGroq(prompt, options);
    if (provider === "openrouter") return callOpenRouter(prompt, options);

    // auto: Gemini (quota bagus untuk bank) → OpenRouter free → Groq
    if (GEMINI_API_KEY && Date.now() >= geminiBlockedUntil) {
      try {
        return await callGemini(prompt, options);
      } catch (err) {
        if (options.groqOnly) throw err;
        console.warn("[LLM] Gemini gagal, fallback ke OpenRouter/Groq:", err instanceof Error ? err.message : err);
      }
    }

    if (!options.groqOnly && OPENROUTER_API_KEY && Date.now() >= openrouterBlockedUntil) {
      try {
        return await callOpenRouter(prompt, options);
      } catch (err) {
        console.warn("[LLM] OpenRouter gagal, fallback ke Groq:", err instanceof Error ? err.message : err);
      }
    }

    if (GROQ_API_KEY && Date.now() >= groqBlockedUntil) {
      return callGroq(prompt, options);
    }

    throw new Error("Semua provider LLM sedang cooldown atau tidak tersedia");
  } finally {
    brainSemaphore.release();
  }
}

export async function checkLlmHealth(): Promise<{
  online: boolean;
  model: string;
  provider: string;
  latencyMs?: number;
  error?: string;
}> {
  const started = Date.now();
  const provider = liveBrainProvider();

  try {
    if (provider === "openrouter") {
      if (!OPENROUTER_API_KEY) {
        return { online: false, model: OPENROUTER_MODEL, provider: "openrouter", latencyMs: Date.now() - started, error: "no key" };
      }
      const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      });
      return {
        online: response.ok,
        model: OPENROUTER_MODEL,
        provider: "openrouter",
        latencyMs: Date.now() - started,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    }

    if (provider === "groq" && GROQ_API_KEY) {
      const response = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${groqAuthToken()}` },
      });
      if (!response.ok) {
        return {
          online: false,
          model: GROQ_MODEL,
          provider: "groq",
          latencyMs: Date.now() - started,
          error: `HTTP ${response.status}`,
        };
      }
      return {
        online: true,
        model: GROQ_MODEL,
        provider: "groq",
        latencyMs: Date.now() - started,
      };
    }

    if (GEMINI_API_KEY && (provider === "gemini" || provider === "auto")) {
      getGeminiClient();
      return {
        online: true,
        model: GEMINI_MODEL,
        provider: "gemini",
        latencyMs: Date.now() - started,
      };
    }

    if (OPENROUTER_API_KEY) {
      return {
        online: true,
        model: OPENROUTER_MODEL,
        provider: "openrouter",
        latencyMs: Date.now() - started,
      };
    }

    if (GROQ_API_KEY) {
      return {
        online: true,
        model: GROQ_MODEL,
        provider: "groq",
        latencyMs: Date.now() - started,
      };
    }

    return {
      online: false,
      model: "none",
      provider: "none",
      latencyMs: Date.now() - started,
      error: "Tidak ada endpoint LLM yang tersedia",
    };
  } catch (err: any) {
    return {
      online: false,
      model: provider === "gemini" ? GEMINI_MODEL : provider === "openrouter" ? OPENROUTER_MODEL : GROQ_MODEL,
      provider: provider === "auto" ? "none" : provider,
      latencyMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}

export const checkGroqHealth = checkLlmHealth;
export const checkOllamaHealth = checkLlmHealth;

export function getGroqClient() {
  if (!GEMINI_API_KEY) {
    console.warn("[LLM] getGroqClient() dipertahankan hanya untuk kompatibilitas lama. Request baru lewat generateDynamicSalesResponse().");
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}
