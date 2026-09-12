import "dotenv/config";
import { callLlm } from "./src/services/llm-providers.ts";
import { generateScriptBankLines } from "./src/services/llm.ts";

// Peek into cleanAndExtractJson by duplicating a quick parse here
function cleanOutputText(text: string): string {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function cleanAndExtractJson(text: string): unknown {
  const cleaned = cleanOutputText(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    const a0 = cleaned.indexOf("[");
    const a1 = cleaned.lastIndexOf("]");
    if (a0 >= 0 && a1 > a0) {
      try {
        return JSON.parse(cleaned.slice(a0, a1 + 1));
      } catch {
        /* fallthrough */
      }
    }
    return null;
  }
}

const prompt = `Kamu host live. Kembalikan JSON murni dengan tepat 3 lines. Speech 22-36 kata.
{"lines":[{"speech":"...","action":"IDLE","emotion":"warm","intent":"SELL","mode":"ENGAGE","topic":"benefit","ctaType":"NONE","target_product_id":null,"interruptible":true,"claims":[]}]}
Produk: Raja Sambal Teri Rp25.000`;

const result = await callLlm(prompt, { sessionId: "parse-smoke", maxTokens: 3200 });
const parsed = cleanAndExtractJson(result.text) as any;
console.log("text_len", result.text.length);
console.log("parsed_type", parsed && typeof parsed, Array.isArray(parsed?.lines), parsed?.lines?.length);
if (!parsed) {
  console.log("PARSE_FAIL last200=", result.text.slice(-200));
  // find bad chars
  for (let i = 0; i < result.text.length; i++) {
    const c = result.text[i]!;
    if (c.charCodeAt(0) > 127) {
      // skip normal unicode
    }
  }
  try {
    JSON.parse(result.text);
  } catch (e: any) {
    console.log("JSON err", e.message);
  }
} else {
  console.log("first speech words", String(parsed.lines?.[0]?.speech || "")
    .split(/\s+/)
    .filter(Boolean).length);
}
