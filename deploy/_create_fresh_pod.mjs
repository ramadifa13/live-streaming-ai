import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", "backend", ".env");
const envText = readFileSync(envPath, "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
const volumeId = envText.match(/^RUNPOD_NETWORK_VOLUME_ID="([^"]+)"/m)?.[1];
const oldPodId = envText.match(/^RUNPOD_POD_ID="([^"]+)"/m)?.[1] || "soal83vccq018w";

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

const pod = await gql(
  `query Pod($podId: String!) {
    pod(input: { podId: $podId }) {
      id name gpuCount containerDiskInGb minVcpuCount minMemoryInGb
      imageName dockerArgs ports networkVolumeId volumeMountPath
      gpuTypeId dataCenterId cloudType costPerHr
    }
  }`,
  { podId: oldPodId },
);
console.log("Old pod:", JSON.stringify(pod.pod, null, 2));

const p = pod.pod;
const input = {
  cloudType: p.cloudType || "ALL",
  gpuCount: p.gpuCount || 1,
  volumeInGb: 0,
  containerDiskInGb: p.containerDiskInGb || 10,
  minVcpuCount: p.minVcpuCount || 8,
  minMemoryInGb: p.minMemoryInGb || 24,
  gpuTypeId: p.gpuTypeId,
  name: `LiveWorker-redeploy-${Date.now()}`,
  imageName: p.imageName,
  dockerArgs: p.dockerArgs,
  ports: p.ports || "8000/http",
  networkVolumeId: volumeId || p.networkVolumeId,
  volumeMountPath: p.volumeMountPath || "/workspace",
};
if (p.dataCenterId) input.dataCenterId = p.dataCenterId;

console.log("\nCreating new pod...");
const created = await gql(
  `mutation Deploy($input: PodFindAndDeployOnDemandInput!) {
    podFindAndDeployOnDemand(input: $input) { id desiredStatus }
  }`,
  { input },
);
const newPodId = created.podFindAndDeployOnDemand.id;
console.log("New pod:", newPodId);

async function waitPod(podId, maxSec = 300) {
  for (let i = 0; i < maxSec; i += 8) {
    const data = await gql(
      `query Pod($podId: String!) {
        pod(input: { podId: $podId }) {
          desiredStatus
          runtime {
            uptimeInSeconds
            ports { ip publicPort privatePort type isIpPublic }
          }
          env
        }
      }`,
      { podId },
    );
    const pod = data.pod;
    const ssh = pod.runtime?.ports?.find(
      (x) => x.privatePort === 22 && x.isIpPublic,
    );
    const http = pod.runtime?.ports?.find(
      (x) => x.privatePort === 8000,
    );
    console.log(
      `[${i}s] ${pod.desiredStatus} uptime=${pod.runtime?.uptimeInSeconds ?? 0} ssh=${ssh ? `${ssh.ip}:${ssh.publicPort}` : "-"} http=${http?.publicPort ?? "-"}`,
    );
    if (
      pod.desiredStatus === "RUNNING" &&
      (pod.runtime?.uptimeInSeconds ?? 0) > 20 &&
      ssh
    ) {
      return { pod, ssh, http };
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error("Timeout waiting for pod");
}

const ready = await waitPod(newPodId);
const pubKeyLine = ready.pod.env?.find((e) => e.startsWith("PUBLIC_KEY=")) || "";
console.log("\nPUBLIC_KEY snippet:", pubKeyLine.slice(0, 160), "...");

const sshHost = ready.ssh.ip;
const sshPort = ready.ssh.publicPort;
const workerUrl = `https://${newPodId}-8000.proxy.runpod.net`;

const meta = {
  oldPodId,
  newPodId,
  sshHost,
  sshPort,
  workerUrl,
};
writeFileSync(join(__dir, "_pod_deploy_meta.json"), JSON.stringify(meta, null, 2));
console.log("\nMeta written:", JSON.stringify(meta, null, 2));

// Update backend .env RUNPOD_POD_ID and RUNPOD_WORKER_URL
let updated = envText
  .replace(/^RUNPOD_POD_ID="[^"]*"/m, `RUNPOD_POD_ID="${newPodId}"`)
  .replace(/^RUNPOD_WORKER_URL="[^"]*"/m, `RUNPOD_WORKER_URL="${workerUrl}"`);
writeFileSync(envPath, updated);
console.log("Updated backend/.env RUNPOD_POD_ID and RUNPOD_WORKER_URL");

console.log(`\nOptional: terminate old pod ${oldPodId} after deploy succeeds.`);
