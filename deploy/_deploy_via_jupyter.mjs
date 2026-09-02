/**
 * Deploy deploy/* ke pod RunPod via Jupyter API (port 8888).
 * Dipakai bila SSH gagal karena PUBLIC_KEY pod stale.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const deployDir = __dir;
const envPath = join(__dir, "..", "backend", ".env");
const envText = readFileSync(envPath, "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
const podId = envText.match(/^RUNPOD_POD_ID="([^"]+)"/m)?.[1] || "soal83vccq018w";
const jupyterBase = `https://${podId}-8888.proxy.runpod.net`;

const DEPLOY_FILES = [
  "ai_worker.py",
  "api_server.py",
  "rtmp_utils.py",
  "speech_bridge.py",
  "start.sh",
  "sync-restart.sh",
  "sync-worker.sh",
  "verify_rtmp.py",
  "verify-worker.sh",
  "redeploy-worker.sh",
];

async function gql(query, variables = {}) {
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getJupyterPassword() {
  const data = await gql(
    `query Pod($podId: String!) { pod(input: { podId: $podId }) { env } }`,
    { podId },
  );
  const line = data.pod.env.find((e) => e.startsWith("JUPYTER_PASSWORD="));
  if (!line) throw new Error("JUPYTER_PASSWORD not found");
  return line.replace("JUPYTER_PASSWORD=", "");
}

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders?.length) return "";
  return setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
}

function xsrfFromCookies(cookies) {
  const m = cookies.match(/(?:^|;\s*)_xsrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function jupyterLogin(password) {
  const page = await fetch(`${jupyterBase}/login`);
  const html = await page.text();
  const xsrf = html.match(/name="_xsrf"\s+value="([^"]+)"/)?.[1] || "";
  let cookies = parseCookies(page.headers.getSetCookie?.());

  const loginRes = await fetch(`${jupyterBase}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
      Referer: `${jupyterBase}/login`,
    },
    body: new URLSearchParams({ password, _xsrf: xsrf }),
    redirect: "manual",
  });
  const extra = parseCookies(loginRes.headers.getSetCookie?.());
  cookies = [cookies, extra].filter(Boolean).join("; ");
  const xsrfToken = xsrfFromCookies(cookies) || xsrf;
  if (loginRes.status >= 400 && loginRes.status !== 302) {
    throw new Error(`Jupyter login HTTP ${loginRes.status}`);
  }
  return { cookies, xsrf: xsrfToken };
}

async function jupyterFetch(auth, path, init = {}) {
  const headers = {
    Cookie: auth.cookies,
    ...(init.headers || {}),
  };
  if (init.method && init.method !== "GET" && auth.xsrf) {
    headers["X-XSRFToken"] = auth.xsrf;
  }
  const res = await fetch(`${jupyterBase}${path}`, {
    ...init,
    headers,
  });
  return res;
}

async function uploadFile(auth, remoteRelPath, localPath) {
  const raw = readFileSync(localPath);
  const b64 = raw.toString("base64");
  const apiPath = `/api/contents/${remoteRelPath}`;
  let res = await jupyterFetch(auth, apiPath, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "file", format: "base64", content: b64 }),
  });
  if (res.status === 404 || res.status === 409) {
    // Ensure parent dir exists
    const parts = remoteRelPath.split("/");
    parts.pop();
    const parent = parts.join("/");
    if (parent) {
      await jupyterFetch(auth, `/api/contents/${parent}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "directory" }),
      }).catch(() => {});
    }
    res = await jupyterFetch(auth, apiPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "file", format: "base64", content: b64 }),
    });
  }
  if (!res.ok) {
    throw new Error(`upload ${remoteRelPath}: ${res.status} ${await res.text()}`);
  }
  console.log(`  OK ${remoteRelPath} (${raw.length} bytes)`);
}

async function runCommand(auth, kernelId, shell, timeoutSec = 600) {
  const b64 = Buffer.from(shell, "utf8").toString("base64");
  const marker = `/tmp/jupyter_cmd_${Date.now()}.done`;
  const code = `
import subprocess, base64, os, time
cmd = base64.b64decode("${b64}").decode()
log = "${marker}.log"
with open(log, "w") as out:
    r = subprocess.run(cmd, shell=True, stdout=out, stderr=subprocess.STDOUT, text=True, timeout=${timeoutSec})
    out.write(f"\\n__EXIT__={r.returncode}\\n")
open("${marker}", "w").write(str(r.returncode))
`;
  const execRes = await jupyterFetch(auth, `/api/kernels/${kernelId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!execRes.ok) throw new Error(`execute: ${await execRes.text()}`);

  for (let i = 0; i < timeoutSec; i += 3) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = `
import os
m = "${marker}"
if os.path.exists(m):
    log = open("${marker}.log").read()
    print(log[-8000:])
else:
    print("__PENDING__")
`;
    const checkRes = await jupyterFetch(auth, `/api/kernels/${kernelId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: check }),
    });
    // Output is async — read via contents API on log file instead
    const logRes = await jupyterFetch(
      auth,
      `/api/contents/${encodeURIComponent(marker.replace(/^\//, ""))}.log`,
    );
    if (logRes.ok) {
      const body = await logRes.json();
      if (body.content) {
        const text = Buffer.from(body.content, "base64").toString("utf8");
        if (text.includes("__EXIT__=")) {
          console.log(text.slice(-4000));
          const exit = text.match(/__EXIT__=(\d+)/)?.[1];
          if (exit !== "0") throw new Error(`Command failed exit=${exit}`);
          return;
        }
      }
    }
    process.stdout.write(".");
  }
  throw new Error("Command timeout");
}

console.log("=".repeat(60));
console.log("Deploy via Jupyter →", jupyterBase);
console.log("=".repeat(60));

const password = await getJupyterPassword();
const auth = await jupyterLogin(password);
console.log("[1/4] Jupyter login OK");

const kernelRes = await jupyterFetch(auth, "/api/kernels", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "python3" }),
});
if (!kernelRes.ok) throw new Error(`kernel: ${await kernelRes.text()}`);
const { id: kernelId } = await kernelRes.json();
console.log("[2/4] Kernel", kernelId);

console.log("[3/4] Upload files...");
for (const f of DEPLOY_FILES) {
  const local = join(deployDir, f);
  await uploadFile(auth, `workspace/live-streaming-ai/deploy/${f}`, local);
}

console.log("[4/4] sync-restart.sh ...");
await runCommand(
  auth,
  kernelId,
  "chmod +x /workspace/live-streaming-ai/deploy/*.sh && bash /workspace/live-streaming-ai/deploy/sync-restart.sh",
  600,
);

console.log("\nVerify worker health...");
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    const h = await fetch(`https://${podId}-8000.proxy.runpod.net/health`);
    if (h.ok) {
      console.log("HEALTH:", await h.text());
      break;
    }
  } catch {
    process.stdout.write(".");
  }
}
console.log("\n[DONE] Deploy selesai.");
