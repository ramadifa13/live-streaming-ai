/**
 * Upload deploy/* + jalankan sync-restart via Jupyter (token auth).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const __dir = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dir, "..", "backend", ".env"), "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
const podId = envText.match(/^RUNPOD_POD_ID="([^"]+)"/m)?.[1] || "soal83vccq018w";
const base = `https://${podId}-8888.proxy.runpod.net`;
const wsBase = `wss://${podId}-8888.proxy.runpod.net`;

const FILES = [
  "ai_worker.py", "api_server.py", "rtmp_utils.py", "speech_bridge.py",
  "start.sh", "sync-restart.sh", "sync-worker.sh",
  "verify_rtmp.py", "verify-worker.sh", "redeploy-worker.sh",
];

async function gql(query, variables = {}) {
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getToken() {
  const data = await gql(
    `query Pod($podId: String!) { pod(input: { podId: $podId }) { env } }`,
    { podId },
  );
  const line = data.pod.env.find((e) => e.startsWith("JUPYTER_PASSWORD="));
  if (!line) throw new Error("JUPYTER_PASSWORD not found");
  return line.replace("JUPYTER_PASSWORD=", "");
}

function api(token, path, init = {}) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${base}${path}${sep}token=${encodeURIComponent(token)}`, init);
}

async function upload(token, relPath, localPath) {
  const content = readFileSync(localPath).toString("base64");
  const parts = relPath.split("/");
  parts.pop();
  const parent = parts.join("/");
  if (parent) {
    await api(token, `/api/contents/${parent}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "directory" }),
    }).catch(() => {});
  }
  const res = await api(token, `/api/contents/${relPath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "file", format: "base64", content }),
  });
  if (!res.ok) throw new Error(`upload ${relPath}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log(`  OK ${relPath.split("/").pop()} (${readFileSync(localPath).length} bytes)`);
}

function runInTerminal(token, termName, command, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const url = `${wsBase}/terminals/websocket/${termName}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    let out = "";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Terminal timeout\n" + out.slice(-2000)));
    }, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(["stdin", command + "\n"]));
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (Array.isArray(msg) && msg[0] === "stdout") out += msg[1];
        if (out.includes("__SYNC_DONE__")) {
          clearTimeout(timer);
          ws.close();
          resolve(out);
        }
      } catch {
        out += String(ev.data);
      }
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

console.log("=".repeat(60));
console.log("Upload + restart →", base);
console.log("=".repeat(60));

const token = await getToken();
console.log("[1/3] Token OK");

console.log("[2/3] Upload files...");
for (const f of FILES) {
  await upload(token, `workspace/live-streaming-ai/deploy/${f}`, join(__dir, f));
}

console.log("[3/3] sync-restart via terminal...");
const termRes = await api(token, "/api/terminals", { method: "POST" });
if (!termRes.ok) throw new Error(`terminal create: ${termRes.status} ${await termRes.text()}`);
const { name: termName } = await termRes.json();
console.log("  Terminal:", termName);

const cmd = [
  "chmod +x /workspace/live-streaming-ai/deploy/*.sh",
  "bash /workspace/live-streaming-ai/deploy/sync-restart.sh 2>&1 | tail -50",
  "python3 /workspace/ai_live_worker/verify_rtmp.py 2>&1 || true",
  "curl -sf http://127.0.0.1:8000/health || echo HEALTH_FAIL",
  "echo __SYNC_DONE__",
].join(" && ");

const output = await runInTerminal(token, termName, cmd, 600000);
console.log("\n--- Terminal output (tail) ---");
console.log(output.slice(-3500));

console.log("\nVerify proxy health...");
for (let i = 0; i < 18; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    const h = await fetch(`https://${podId}-8000.proxy.runpod.net/health`);
    if (h.ok) {
      console.log("HEALTH OK:", await h.text());
      process.exit(0);
    }
  } catch {}
  process.stdout.write(".");
}
console.log("\nWorker proxy belum health — cek manual di Jupyter terminal.");
