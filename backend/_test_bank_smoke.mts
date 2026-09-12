import "dotenv/config";
import { generateScriptBankLines, checkLlmHealth, liveLlmBatchSize, liveLlmRefillAt } from "./src/services/llm.ts";

const health = await checkLlmHealth();
console.log("provider=", process.env.LIVE_LLM_PROVIDER || process.env.LIVE_BRAIN_PROVIDER);
console.log("model=", process.env.GEMINI_MODEL);
console.log("batch=", liveLlmBatchSize(), "refillAt=", liveLlmRefillAt());
console.log("health=", JSON.stringify(health));

const t0 = Date.now();
const lines = await generateScriptBankLines({
  sessionId: "smoke-bank-test",
  productName: "Raja Sambal Teri",
  productPrice: "Rp25.000",
  productDescription: "Sambal teri pedas gurih untuk nasi hangat.",
  productBenefits: "Pedas pas, teri renyah, cocok pemula.",
  productUsage: "Sendok kecil di atas nasi.",
  productFaq: "Pedasnya sedang.",
  userQuestion: "Isi bank ucapan otonom untuk produk ini.",
  requestedMode: "ENGAGE",
  requestedIntent: "SELL",
  mode: "ENGAGE",
  recentUtterances: [],
  avoidTopics: [],
} as any);

console.log("COUNT=" + lines.length + " ms=" + (Date.now() - t0));
if (lines[0]) console.log("sample=", lines[0].speech);
if (!lines.length) process.exitCode = 2;
