/** Finish deploy: run sync-restart via Jupyter token API */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dir, "..", "backend", ".env"), "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
const podId = envText.match(/^RUNPOD_POD_ID="([^"]+)"/m)?.[1] || "soal83vccq018w";
const base = `https://${podId}-8888.proxy.runpod.net`;

async function gql(q, v = {}) {
  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: q, variables: v }),
  });
  return (await r.json()).data;
}

const pod = await gql(
  `query Pod($podId: String!) { pod(input: { podId: $podId }) { env } }`,
  { podId },
);
const token = pod.pod.env
  .find((e) => e.startsWith("JUPYTER_PASSWORD="))
  ?.replace("JUPYTER_PASSWORD=", "");
if (!token) throw new Error("no token");

function api(path, init = {}) {
  const url = `${base}${path}${path.includes("?") ? "&" : "?"}token=${token}`;
  return fetch(url, init);
}

// Create terminal and run command via kernel execute with token
const kr = await api("/api/kernels", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "python3" }),
});
if (!kr.ok) throw new Error(await kr.text());
const { id: kid } = await kr.json();
console.log("kernel", kid);

const cmd = `
import subprocess, sys
r = subprocess.run(
    "chmod +x /workspace/live-streaming-ai/deploy/*.sh && bash /workspace/live-streaming-ai/deploy/sync-restart.sh",
    shell=True, capture_output=True, text=True, timeout=600,
    cwd="/workspace",
)
sys.stdout.write(r.stdout[-6000:])
sys.stdout.write(r.stderr[-2000:])
sys.stdout.write(f"\\nEXIT={r.returncode}\\n")
print("DONE")
`;

const ex = await api(`/api/kernels/${kid}/execute`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: cmd }),
});
console.log("execute status", ex.status, (await ex.text()).slice(0, 500));

// Poll output file written by sync
await new Promise((r) => setTimeout(r, 15000));
for (let i = 0; i < 40; i++) {
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
console.log("\nWorker belum health — cek manual di pod");
