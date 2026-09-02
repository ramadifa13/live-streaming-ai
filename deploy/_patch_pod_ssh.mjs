import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dir, "..", "backend", ".env"), "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
const pubKey = readFileSync(
  join(process.env.USERPROFILE || "", ".ssh", "id_ed25519.pub"),
  "utf8",
).trim();

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

const podId = "soal83vccq018w";
const podRes = await gql(
  `query Pod($podId: String!) { pod(input: { podId: $podId }) { env } }`,
  { podId },
);
const currentEnv = podRes.data?.pod?.env || [];
const publicKeyLine = currentEnv.find((e) => e.startsWith("PUBLIC_KEY=")) || "";
const existing = publicKeyLine.replace(/^PUBLIC_KEY=/, "").trim();
const newPublicKeyValue = existing.includes(pubKey)
  ? existing
  : existing
    ? `${existing}\n${pubKey}`
    : pubKey;

const newEnv = currentEnv.map((e) =>
  e.startsWith("PUBLIC_KEY=") ? `PUBLIC_KEY=${newPublicKeyValue}` : e,
);

console.log("Updating PUBLIC_KEY on pod", podId);
const editRes = await gql(
  `mutation PodEdit($input: PodEditInput!) {
    podEdit(input: $input) { id desiredStatus env }
  }`,
  { input: { podId, env: newEnv } },
);
console.log(JSON.stringify(editRes, null, 2));

if (!editRes.errors) {
  console.log("Restarting pod to apply SSH key...");
  const stopRes = await gql(
    `mutation PodStop($input: PodStopInput!) { podStop(input: $input) { id desiredStatus } }`,
    { input: { podId } },
  );
  console.log("Stop:", JSON.stringify(stopRes.data || stopRes.errors));
  await new Promise((r) => setTimeout(r, 5000));
  const resumeRes = await gql(
    `mutation PodResume($input: PodResumeInput!) { podResume(input: $input) { id desiredStatus } }`,
    { input: { podId, gpuCount: 1 } },
  );
  console.log("Resume:", JSON.stringify(resumeRes.data || resumeRes.errors));
}
