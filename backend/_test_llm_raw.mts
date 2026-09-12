import "dotenv/config";
import { callLlm } from "./src/services/llm-providers.ts";

const prompt = `Kembalikan JSON murni:
{"lines":[{"speech":"Sambal teri ini pedas pas dan teri renyahnya enak buat nasi hangat setiap hari ya kak.","action":"IDLE","emotion":"warm","intent":"SELL","mode":"ENGAGE","topic":"benefit","ctaType":"NONE","target_product_id":null,"interruptible":true,"claims":[]},{"speech":"Cara pakainya gampang, cukup ambil sedikit lalu campur di nasi biar rasanya langsung nendang.","action":"IDLE","emotion":"warm","intent":"SELL","mode":"DEMO","topic":"how_to_use","ctaType":"NONE","target_product_id":null,"interruptible":true,"claims":[]}]}
Buat tepat 5 objek di lines, speech 22-36 kata bahasa Indonesia.`;

const t0 = Date.now();
const result = await callLlm(prompt, { sessionId: "raw-smoke", maxTokens: 3200 });
console.log("provider=", result.provider, "model=", result.model, "ms=", Date.now() - t0);
console.log("text_len=", (result.text || "").length);
console.log("preview=", String(result.text || "").slice(0, 500));
