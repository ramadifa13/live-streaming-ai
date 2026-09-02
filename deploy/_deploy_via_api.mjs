import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", "backend", ".env");
const envText = readFileSync(envPath, "utf8");
const apiKey = envText.match(/^RUNPOD_API_KEY="([^"]+)"/m)?.[1];
if (!apiKey) throw new Error("RUNPOD_API_KEY not found");

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

const podId = process.argv[2] || "soal83vccq018w";
const data = await gql(
  `query Pod($podId: String!) {
    pod(input: { podId: $podId }) {
      id name desiredStatus env imageName
      runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } }
    }
  }`,
  { podId },
);
console.log(JSON.stringify(data, null, 2));
