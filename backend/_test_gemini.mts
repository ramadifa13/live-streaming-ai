import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

async function main() {
  const key = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const client = new GoogleGenAI({ apiKey: key });
  const t0 = Date.now();
  const response = await client.models.generateContent({
    model,
    contents: 'Reply with exactly this JSON and nothing else: {"ok":true,"msg":"hello"}',
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
    },
  });
  console.log("ms=", Date.now() - t0);
  console.log("text=", JSON.stringify(response.text));
  console.log(
    "raw=",
    JSON.stringify(
      {
        candidates: (response as any).candidates,
        usageMetadata: (response as any).usageMetadata,
      },
      null,
      2,
    ).slice(0, 2500),
  );
}

main().catch((err) => {
  console.error("FAIL=", err?.message || err);
  process.exitCode = 1;
});
