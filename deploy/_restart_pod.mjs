import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dir, "..", "backend", ".env"), "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
const podId = "soal83vccq018w";

async function gql(query, variables = {}) {
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function waitRunning(maxSec = 180) {
  for (let i = 0; i < maxSec; i += 5) {
    const j = await gql(
      `query Pod($podId: String!) {
        pod(input: { podId: $podId }) {
          desiredStatus
          runtime { uptimeInSeconds ports { ip publicPort privatePort type isIpPublic } }
        }
      }`,
      { podId },
    );
    const pod = j.data?.pod;
    const ssh = pod?.runtime?.ports?.find(
      (p) => p.privatePort === 22 && p.isIpPublic,
    );
    console.log(`[${i}s] status=${pod?.desiredStatus} uptime=${pod?.runtime?.uptimeInSeconds ?? "?"} ssh=${ssh ? `${ssh.ip}:${ssh.publicPort}` : "n/a"}`);
    if (pod?.desiredStatus === "RUNNING" && pod?.runtime?.uptimeInSeconds > 10 && ssh) {
      return ssh;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Pod tidak RUNNING dalam waktu tunggu");
}

console.log("Stopping pod...");
let r = await gql(
  `mutation PodStop($input: PodStopInput!) { podStop(input: $input) { id desiredStatus } }`,
  { input: { podId } },
);
console.log(JSON.stringify(r.data || r.errors));

await new Promise((x) => setTimeout(x, 8000));

console.log("Resuming pod...");
r = await gql(
  `mutation PodResume($input: PodResumeInput!) { podResume(input: $input) { id desiredStatus } }`,
  { input: { podId, gpuCount: 1 } },
);
console.log(JSON.stringify(r.data || r.errors));

const ssh = await waitRunning();
console.log("SSH endpoint:", `${ssh.ip}:${ssh.publicPort}`);

const podEnv = await gql(
  `query Pod($podId: String!) { pod(input: { podId: $podId }) { env } }`,
  { podId },
);
console.log("PUBLIC_KEY after resume:", podEnv.data?.pod?.env?.[0]?.slice(0, 120), "...");
